use crate::error::{AppError, AppResult};
use crate::state::AppState;
use sqlx::Row;

pub struct ExportService;

/// Export bookmarks as Netscape HTML format.
pub async fn export_html(state: &AppState, tenant_id: i64, collection_id: Option<i64>) -> AppResult<String> {
    let collections = sqlx::query_as::<_, crate::domain::collection::Collection>(
        "SELECT * FROM collections WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY parent_id NULLS FIRST, name",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let links = if let Some(cid) = collection_id {
        sqlx::query_as::<_, crate::domain::link::Link>(
            "SELECT * FROM links WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY collection_id, position",
        )
        .bind(tenant_id)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, crate::domain::link::Link>(
            "SELECT * FROM links WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY collection_id, position",
        )
        .bind(tenant_id)
        .fetch_all(&state.pool)
        .await?
    };

    // Build collection tree.
    let mut children_map: std::collections::HashMap<Option<i64>, Vec<&crate::domain::collection::Collection>> =
        std::collections::HashMap::new();
    for c in &collections {
        children_map.entry(c.parent_id).or_default().push(c);
    }

    let mut links_by_col: std::collections::HashMap<i64, Vec<&crate::domain::link::Link>> =
        std::collections::HashMap::new();
    for l in &links {
        links_by_col.entry(l.collection_id).or_default().push(l);
    }

    let mut html = String::new();
    html.push_str("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n");
    html.push_str("<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n");
    html.push_str("<TITLE>Bookmarks</TITLE>\n");
    html.push_str("<H1>Bookmarks</H1>\n");
    html.push_str("<DL><p>\n");

    fn write_folder(
        html: &mut String,
        col: &crate::domain::collection::Collection,
        children_map: &std::collections::HashMap<Option<i64>, Vec<&crate::domain::collection::Collection>>,
        links_by_col: &std::collections::HashMap<i64, Vec<&crate::domain::link::Link>>,
        depth: usize,
    ) {
        let indent = "    ".repeat(depth);
        html.push_str(&format!("{}<DT><H3>{}</H3>\n", indent, escape_html(&col.name)));
        html.push_str(&format!("{}<DL><p>\n", indent));
        // Sub-folders.
        if let Some(children) = children_map.get(&Some(col.id)) {
            for child in children {
                write_folder(html, child, children_map, links_by_col, depth + 1);
            }
        }
        // Bookmarks.
        if let Some(links) = links_by_col.get(&col.id) {
            for link in links {
                html.push_str(&format!(
                    "{}    <DT><A HREF=\"{}\">{}</A>\n",
                    indent,
                    escape_html(&link.url),
                    escape_html(&link.name)
                ));
                if !link.description.is_empty() {
                    html.push_str(&format!("{}    <DD>{}\n", indent, escape_html(&link.description)));
                }
            }
        }
        html.push_str(&format!("{}</DL><p>\n", indent));
    }

    // Root-level folders.
    if let Some(roots) = children_map.get(&None) {
        for root in roots {
            write_folder(&mut html, root, &children_map, &links_by_col, 1);
        }
    }

    // Root-level bookmarks (no collection).
    if let Some(root_links) = links_by_col.get(&0) {
        for link in root_links {
            html.push_str(&format!(
                "    <DT><A HREF=\"{}\">{}</A>\n",
                escape_html(&link.url),
                escape_html(&link.name)
            ));
        }
    }

    html.push_str("</DL><p>\n");
    Ok(html)
}

/// Export as Linkwarden-compatible JSON.
pub async fn export_json(state: &AppState, tenant_id: i64) -> AppResult<String> {
    let collections = sqlx::query_as::<_, crate::domain::collection::Collection>(
        "SELECT * FROM collections WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY id",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let links = sqlx::query_as::<_, crate::domain::link::Link>(
        "SELECT * FROM links WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY id",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let tags = sqlx::query_as::<_, crate::domain::tag::Tag>(
        "SELECT * FROM tags WHERE tenant_id = ? ORDER BY id",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    // Get link_tags.
    let link_tags_rows = sqlx::query("SELECT link_id, tag_id FROM link_tags")
        .fetch_all(&state.pool)
        .await?;

    let mut link_tags: std::collections::HashMap<i64, Vec<i64>> = std::collections::HashMap::new();
    for r in link_tags_rows {
        let link_id: i64 = r.try_get("link_id").unwrap_or(0);
        let tag_id: i64 = r.try_get("tag_id").unwrap_or(0);
        link_tags.entry(link_id).or_default().push(tag_id);
    }

    let json = serde_json::json!({
        "version": 1,
        "exported_at": crate::auth::extractor::now_iso(),
        "collections": collections.iter().map(|c| serde_json::json!({
            "id": c.id,
            "uuid": c.uuid,
            "parentId": c.parent_id,
            "name": c.name,
            "description": c.description,
            "color": c.color,
            "createdAt": c.created_at,
            "updatedAt": c.updated_at,
        })).collect::<Vec<_>>(),
        "links": links.iter().map(|l| {
            let tag_ids = link_tags.get(&l.id).cloned().unwrap_or_default();
            let tag_names: Vec<&str> = tag_ids.iter().filter_map(|tid| {
                tags.iter().find(|t| t.id == *tid).map(|t| t.name.as_str())
            }).collect();
            serde_json::json!({
                "id": l.id,
                "uuid": l.uuid,
                "collectionId": l.collection_id,
                "url": l.url,
                "name": l.name,
                "description": l.description,
                "tags": tag_names,
                "createdAt": l.created_at,
                "updatedAt": l.updated_at,
            })
        }).collect::<Vec<_>>(),
        "tags": tags.iter().map(|t| serde_json::json!({
            "id": t.id,
            "uuid": t.uuid,
            "name": t.name,
        })).collect::<Vec<_>>(),
    });

    Ok(serde_json::to_string_pretty(&json).unwrap_or_default())
}

/// Export as CSV.
pub async fn export_csv(state: &AppState, tenant_id: i64) -> AppResult<String> {
    let links = sqlx::query_as::<_, crate::domain::link::Link>(
        "SELECT * FROM links WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY id",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let collections = sqlx::query_as::<_, crate::domain::collection::Collection>(
        "SELECT * FROM collections WHERE tenant_id = ? AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let col_map: std::collections::HashMap<i64, String> =
        collections.iter().map(|c| (c.id, c.name.clone())).collect();

    let mut wtr = csv::Writer::from_writer(Vec::new());
    wtr.write_record(&["url", "name", "description", "collection"])
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    for link in &links {
        let col_name = col_map.get(&link.collection_id).cloned().unwrap_or_default();
        wtr.write_record(&[&link.url, &link.name, &link.description, &col_name])
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    }

    let data = wtr.into_inner().map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(String::from_utf8_lossy(&data).to_string())
}

/// Export as XBEL.
pub async fn export_xbel(state: &AppState, tenant_id: i64) -> AppResult<String> {
    let collections = sqlx::query_as::<_, crate::domain::collection::Collection>(
        "SELECT * FROM collections WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY parent_id NULLS FIRST, name",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let links = sqlx::query_as::<_, crate::domain::link::Link>(
        "SELECT * FROM links WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY collection_id, position",
    )
    .bind(tenant_id)
    .fetch_all(&state.pool)
    .await?;

    let mut children_map: std::collections::HashMap<Option<i64>, Vec<&crate::domain::collection::Collection>> =
        std::collections::HashMap::new();
    for c in &collections {
        children_map.entry(c.parent_id).or_default().push(c);
    }

    let mut links_by_col: std::collections::HashMap<i64, Vec<&crate::domain::link::Link>> =
        std::collections::HashMap::new();
    for l in &links {
        links_by_col.entry(l.collection_id).or_default().push(l);
    }

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<!DOCTYPE xbel PUBLIC \"+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML\" \"http://www.python.org/topics/xml/dtds/xbel-1.0.dtd\">\n");
    xml.push_str("<xbel version=\"1.0\">\n");

    fn write_folder(
        xml: &mut String,
        col: &crate::domain::collection::Collection,
        children_map: &std::collections::HashMap<Option<i64>, Vec<&crate::domain::collection::Collection>>,
        links_by_col: &std::collections::HashMap<i64, Vec<&crate::domain::link::Link>>,
        depth: usize,
    ) {
        let indent = "  ".repeat(depth);
        xml.push_str(&format!("{}<folder>\n", indent));
        xml.push_str(&format!("{}  <title>{}</title>\n", indent, escape_xml(&col.name)));
        if let Some(children) = children_map.get(&Some(col.id)) {
            for child in children {
                write_folder(xml, child, children_map, links_by_col, depth + 1);
            }
        }
        if let Some(links) = links_by_col.get(&col.id) {
            for link in links {
                xml.push_str(&format!("{}  <bookmark href=\"{}\">\n", indent, escape_xml(&link.url)));
                xml.push_str(&format!("{}    <title>{}</title>\n", indent, escape_xml(&link.name)));
                xml.push_str(&format!("{}  </bookmark>\n", indent));
            }
        }
        xml.push_str(&format!("{}</folder>\n", indent));
    }

    if let Some(roots) = children_map.get(&None) {
        for root in roots {
            write_folder(&mut xml, root, &children_map, &links_by_col, 1);
        }
    }

    // Root-level bookmarks.
    if let Some(root_links) = links_by_col.get(&0) {
        for link in root_links {
            xml.push_str(&format!("  <bookmark href=\"{}\">\n", escape_xml(&link.url)));
            xml.push_str(&format!("    <title>{}</title>\n", escape_xml(&link.name)));
            xml.push_str("  </bookmark>\n");
        }
    }

    xml.push_str("</xbel>\n");
    Ok(xml)
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_xml(s: &str) -> String {
    escape_html(s)
}
