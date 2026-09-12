use crate::auth::AuthUser;
use crate::domain::bookmark::{BookmarkNode, BookmarkTreeNode, SyncDocument};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::QName;
use quick_xml::Reader;
use sqlx::{Row, SqliteConnection};
use std::collections::{HashMap, HashSet};

pub const DEFAULT_DOCUMENT_PATH: &str = "bookmarks.xbel";
const MAX_TREE_DEPTH: usize = 128;
const MAX_TREE_NODES: usize = 100_000;

#[derive(Debug, Clone)]
struct ParsedNode {
    external_id: Option<String>,
    node_type: &'static str,
    title: String,
    url: Option<String>,
    description: String,
    children: Vec<ParsedNode>,
}

#[derive(Debug)]
struct ParsedDocument {
    title: String,
    nodes: Vec<ParsedNode>,
}

struct FlatNode {
    parent_index: Option<usize>,
    position: i64,
    node: ParsedNode,
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateNodeInput {
    pub document_id: i64,
    #[serde(default)]
    pub parent_id: Option<i64>,
    pub node_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateNodeInput {
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub parent_id: Option<Option<i64>>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub url: Option<Option<String>>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    <Option<T> as serde::Deserialize>::deserialize(deserializer).map(Some)
}

#[derive(Debug, serde::Deserialize)]
pub struct ReorderNodesInput {
    pub parent_id: Option<i64>,
    pub node_ids: Vec<i64>,
}

pub struct BookmarkService;

impl BookmarkService {
    pub async fn list_documents(state: &AppState, user_id: i64) -> AppResult<Vec<SyncDocument>> {
        Ok(sqlx::query_as::<_, SyncDocument>(
            "SELECT * FROM sync_documents WHERE user_id = ? ORDER BY path",
        )
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?)
    }

    pub async fn get_document_by_path(
        state: &AppState,
        user_id: i64,
        path: &str,
    ) -> AppResult<SyncDocument> {
        sqlx::query_as::<_, SyncDocument>(
            "SELECT * FROM sync_documents WHERE user_id = ? AND path = ?",
        )
        .bind(user_id)
        .bind(path)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)
    }

    pub async fn ensure_document(
        state: &AppState,
        user: &AuthUser,
        path: &str,
    ) -> AppResult<SyncDocument> {
        let mut tx = state.pool.begin().await?;
        let doc = ensure_document_tx(&mut tx, user, path).await?;
        tx.commit().await?;
        Ok(doc)
    }

    pub async fn tree(
        state: &AppState,
        user_id: i64,
        document_id: i64,
    ) -> AppResult<Vec<BookmarkTreeNode>> {
        let exists: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_documents WHERE id = ? AND user_id = ?")
                .bind(document_id)
                .bind(user_id)
                .fetch_one(&state.pool)
                .await?;
        if exists == 0 {
            return Err(AppError::NotFound);
        }
        let nodes = sqlx::query_as::<_, BookmarkNode>(
            r#"SELECT * FROM bookmark_nodes
               WHERE document_id = ? AND user_id = ? AND deleted_at IS NULL
               ORDER BY position, id"#,
        )
        .bind(document_id)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
        let tag_rows = sqlx::query(
            r#"SELECT nt.node_id, t.name FROM node_tags nt
               JOIN tags t ON t.id = nt.tag_id
               JOIN bookmark_nodes n ON n.id = nt.node_id
               WHERE n.document_id = ? AND n.user_id = ? ORDER BY t.name"#,
        )
        .bind(document_id)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
        let mut tags: HashMap<i64, Vec<String>> = HashMap::new();
        for row in tag_rows {
            tags.entry(row.get("node_id"))
                .or_default()
                .push(row.get("name"));
        }
        Ok(build_tree(nodes, tags))
    }

    pub async fn serialize_xbel(
        state: &AppState,
        user_id: i64,
        path: &str,
    ) -> AppResult<(Vec<u8>, i64)> {
        let document = Self::get_document_by_path(state, user_id, path).await?;
        let nodes = sqlx::query_as::<_, BookmarkNode>(
            r#"SELECT * FROM bookmark_nodes
               WHERE document_id = ? AND user_id = ? AND deleted_at IS NULL
               ORDER BY position, id"#,
        )
        .bind(document.id)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
        let mut children: HashMap<Option<i64>, Vec<BookmarkNode>> = HashMap::new();
        for node in nodes {
            children.entry(node.parent_id).or_default().push(node);
        }
        let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.push_str("<xbel version=\"1.0\">\n");
        if !document.title.is_empty() {
            xml.push_str("  <title>");
            xml.push_str(&escape_text(&document.title));
            xml.push_str("</title>\n");
        }
        write_children(&mut xml, None, &children, 1);
        xml.push_str(&format!(
            "  <!--- highestId :{}: -->\n",
            document.next_external_id.saturating_sub(1)
        ));
        xml.push_str("</xbel>\n");
        Ok((xml.into_bytes(), document.updated_unix))
    }

    pub async fn replace_from_xbel(
        state: &AppState,
        user: &AuthUser,
        path: &str,
        content: &[u8],
    ) -> AppResult<SyncDocument> {
        user.require_write()?;
        let text = std::str::from_utf8(content)
            .map_err(|_| AppError::Validation("XBEL must be UTF-8".into()))?;
        let parsed = parse_xbel(text)?;
        let mut tx = state.pool.begin().await?;
        let mut document = ensure_document_tx(&mut tx, user, path).await?;
        let mut flat = Vec::new();
        flatten_nodes(parsed.nodes, None, &mut flat);

        let mut used_external_ids = HashSet::new();
        let mut next_external_id = document.next_external_id.max(1);
        for item in &mut flat {
            let usable = item
                .node
                .external_id
                .as_ref()
                .filter(|id| !id.is_empty() && used_external_ids.insert((*id).clone()))
                .cloned();
            let external_id = match usable {
                Some(id) => {
                    if let Ok(number) = id.parse::<i64>() {
                        next_external_id = next_external_id.max(number.saturating_add(1));
                    }
                    id
                }
                None => allocate_external_id(&mut next_external_id, &mut used_external_ids),
            };
            item.node.external_id = Some(external_id);
        }

        let now = crate::auth::extractor::now_iso();
        sqlx::query(
            "UPDATE bookmark_nodes SET deleted_at = ?, updated_at = ? WHERE document_id = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(document.id)
        .execute(&mut *tx)
        .await?;

        let mut database_ids = Vec::with_capacity(flat.len());
        for item in flat {
            let parent_id = item.parent_index.map(|index| database_ids[index]);
            let id: i64 = sqlx::query_scalar(
                r#"INSERT INTO bookmark_nodes
                   (uuid, document_id, user_id, parent_id, node_type, external_id,
                    title, url, description, position, created_by, deleted_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                   ON CONFLICT(document_id, external_id) DO UPDATE SET
                     parent_id = excluded.parent_id,
                     node_type = excluded.node_type,
                     title = excluded.title,
                     url = excluded.url,
                     description = excluded.description,
                     position = excluded.position,
                     deleted_at = NULL,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
                   RETURNING id"#,
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(document.id)
            .bind(user.user_id)
            .bind(parent_id)
            .bind(item.node.node_type)
            .bind(item.node.external_id.expect("external id assigned"))
            .bind(item.node.title)
            .bind(item.node.url)
            .bind(item.node.description)
            .bind(item.position)
            .bind(user.user_id)
            .fetch_one(&mut *tx)
            .await?;
            database_ids.push(id);
        }
        let updated_unix = unix_now();
        document = sqlx::query_as::<_, SyncDocument>(
            r#"UPDATE sync_documents
               SET title = ?, revision = revision + 1, next_external_id = ?,
                   updated_unix = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               WHERE id = ? AND user_id = ? RETURNING *"#,
        )
        .bind(parsed.title)
        .bind(next_external_id)
        .bind(updated_unix)
        .bind(document.id)
        .bind(user.user_id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(document)
    }

    pub async fn create_node(
        state: &AppState,
        user: &AuthUser,
        req: CreateNodeInput,
    ) -> AppResult<BookmarkNode> {
        user.require_write()?;
        validate_node_input(&req.node_type, &req.title, req.url.as_deref())?;
        let mut tx = state.pool.begin().await?;
        verify_document(&mut tx, user.user_id, req.document_id).await?;
        ensure_document_unlocked(&mut tx, user.user_id, req.document_id).await?;
        verify_parent(&mut tx, user.user_id, req.document_id, req.parent_id).await?;
        let external_id = allocate_document_id(&mut tx, req.document_id).await?;
        let position: i64 = sqlx::query_scalar(
            r#"SELECT coalesce(max(position) + 1, 0) FROM bookmark_nodes
               WHERE document_id = ? AND parent_id IS ? AND deleted_at IS NULL"#,
        )
        .bind(req.document_id)
        .bind(req.parent_id)
        .fetch_one(&mut *tx)
        .await?;
        let node = sqlx::query_as::<_, BookmarkNode>(
            r#"INSERT INTO bookmark_nodes
               (uuid, document_id, user_id, parent_id, node_type, external_id,
                title, url, description, position, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(req.document_id)
        .bind(user.user_id)
        .bind(req.parent_id)
        .bind(req.node_type)
        .bind(external_id)
        .bind(req.title.trim())
        .bind(req.url.map(|url| url.trim().to_string()))
        .bind(req.description)
        .bind(position)
        .bind(user.user_id)
        .fetch_one(&mut *tx)
        .await?;
        set_node_tags(&mut tx, user.user_id, node.id, &req.tags).await?;
        touch_document(&mut tx, req.document_id).await?;
        tx.commit().await?;
        Ok(node)
    }

    pub async fn update_node(
        state: &AppState,
        user: &AuthUser,
        id: i64,
        req: UpdateNodeInput,
    ) -> AppResult<BookmarkNode> {
        user.require_write()?;
        let mut tx = state.pool.begin().await?;
        let existing = get_node_tx(&mut tx, user.user_id, id).await?;
        ensure_document_unlocked(&mut tx, user.user_id, existing.document_id).await?;
        let parent_id = req.parent_id.unwrap_or(existing.parent_id);
        verify_parent(&mut tx, user.user_id, existing.document_id, parent_id).await?;
        if parent_id == Some(id)
            || is_descendant(&mut tx, existing.document_id, id, parent_id).await?
        {
            return Err(AppError::CircularRef);
        }
        let title = req.title.unwrap_or(existing.title);
        let url = req.url.unwrap_or(existing.url);
        let description = req.description.unwrap_or(existing.description);
        validate_node_input(&existing.node_type, &title, url.as_deref())?;
        let position = if parent_id != existing.parent_id {
            sqlx::query_scalar(
                r#"SELECT coalesce(max(position) + 1, 0) FROM bookmark_nodes
                   WHERE document_id = ? AND parent_id IS ? AND deleted_at IS NULL"#,
            )
            .bind(existing.document_id)
            .bind(parent_id)
            .fetch_one(&mut *tx)
            .await?
        } else {
            existing.position
        };
        let node = sqlx::query_as::<_, BookmarkNode>(
            r#"UPDATE bookmark_nodes SET parent_id = ?, title = ?, url = ?, description = ?,
               position = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *"#,
        )
        .bind(parent_id)
        .bind(title.trim())
        .bind(url.map(|value| value.trim().to_string()))
        .bind(description)
        .bind(position)
        .bind(id)
        .bind(user.user_id)
        .fetch_one(&mut *tx)
        .await?;
        if let Some(tags) = req.tags {
            set_node_tags(&mut tx, user.user_id, node.id, &tags).await?;
        }
        touch_document(&mut tx, existing.document_id).await?;
        tx.commit().await?;
        Ok(node)
    }

    pub async fn delete_node(state: &AppState, user: &AuthUser, id: i64) -> AppResult<()> {
        user.require_write()?;
        let mut tx = state.pool.begin().await?;
        let node = get_node_tx(&mut tx, user.user_id, id).await?;
        ensure_document_unlocked(&mut tx, user.user_id, node.document_id).await?;
        let now = crate::auth::extractor::now_iso();
        sqlx::query(
            r#"WITH RECURSIVE descendants(id) AS (
                 SELECT id FROM bookmark_nodes WHERE id = ? AND user_id = ?
                 UNION ALL
                 SELECT n.id FROM bookmark_nodes n JOIN descendants d ON n.parent_id = d.id
               )
               UPDATE bookmark_nodes SET deleted_at = ?, updated_at = ?
               WHERE id IN (SELECT id FROM descendants)"#,
        )
        .bind(id)
        .bind(user.user_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        touch_document(&mut tx, node.document_id).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn reorder(
        state: &AppState,
        user: &AuthUser,
        document_id: i64,
        req: ReorderNodesInput,
    ) -> AppResult<()> {
        user.require_write()?;
        let mut tx = state.pool.begin().await?;
        verify_document(&mut tx, user.user_id, document_id).await?;
        ensure_document_unlocked(&mut tx, user.user_id, document_id).await?;
        let actual: Vec<i64> = sqlx::query_scalar(
            r#"SELECT id FROM bookmark_nodes WHERE document_id = ? AND user_id = ?
               AND parent_id IS ? AND deleted_at IS NULL ORDER BY position, id"#,
        )
        .bind(document_id)
        .bind(user.user_id)
        .bind(req.parent_id)
        .fetch_all(&mut *tx)
        .await?;
        if actual.len() != req.node_ids.len()
            || actual.iter().copied().collect::<HashSet<_>>()
                != req.node_ids.iter().copied().collect::<HashSet<_>>()
        {
            return Err(AppError::Validation(
                "node_ids must contain every sibling exactly once".into(),
            ));
        }
        for (position, id) in req.node_ids.into_iter().enumerate() {
            sqlx::query("UPDATE bookmark_nodes SET position = ? WHERE id = ? AND user_id = ?")
                .bind(position as i64)
                .bind(id)
                .bind(user.user_id)
                .execute(&mut *tx)
                .await?;
        }
        touch_document(&mut tx, document_id).await?;
        tx.commit().await?;
        Ok(())
    }
}

async fn ensure_document_unlocked(
    tx: &mut SqliteConnection,
    user_id: i64,
    document_id: i64,
) -> AppResult<()> {
    let locked: i64 = sqlx::query_scalar(
        r#"SELECT EXISTS(
             SELECT 1 FROM sync_locks l
             JOIN sync_documents d ON d.user_id = l.user_id AND d.path = l.path
             WHERE d.id = ? AND d.user_id = ? AND l.updated_at >= ?
           )"#,
    )
    .bind(document_id)
    .bind(user_id)
    .bind(unix_now() - 300)
    .fetch_one(&mut *tx)
    .await?;
    if locked != 0 {
        return Err(AppError::Locked);
    }
    Ok(())
}

async fn ensure_document_tx(
    tx: &mut SqliteConnection,
    user: &AuthUser,
    path: &str,
) -> AppResult<SyncDocument> {
    if path.is_empty() || path.len() > 1024 || !path.to_ascii_lowercase().ends_with(".xbel") {
        return Err(AppError::Validation(
            "sync document path must end in .xbel".into(),
        ));
    }
    sqlx::query(
        r#"INSERT OR IGNORE INTO sync_documents
           (uuid, user_id, path, title, created_by)
           VALUES (?, ?, ?, ?, ?)"#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(user.user_id)
    .bind(path)
    .bind(path.trim_end_matches(".xbel"))
    .bind(user.user_id)
    .execute(&mut *tx)
    .await?;
    Ok(sqlx::query_as::<_, SyncDocument>(
        "SELECT * FROM sync_documents WHERE user_id = ? AND path = ?",
    )
    .bind(user.user_id)
    .bind(path)
    .fetch_one(&mut *tx)
    .await?)
}

fn parse_xbel(input: &str) -> AppResult<ParsedDocument> {
    let mut reader = Reader::from_str(input);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<ParsedNode> = Vec::new();
    let mut roots = Vec::new();
    let mut document_title = String::new();
    let mut count = 0usize;
    let mut saw_xbel = false;
    let mut inside_xbel = false;
    let mut finished_xbel = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) if start.name().as_ref() == b"xbel" => {
                if saw_xbel || inside_xbel || finished_xbel || !stack.is_empty() {
                    return Err(AppError::Validation("invalid XBEL root".into()));
                }
                saw_xbel = true;
                inside_xbel = true;
            }
            Ok(Event::Start(start)) if start.name().as_ref() == b"folder" => {
                if !inside_xbel {
                    return Err(AppError::Validation("node outside XBEL root".into()));
                }
                count += 1;
                validate_tree_limits(stack.len() + 1, count)?;
                stack.push(parsed_element(&reader, &start, "folder")?);
            }
            Ok(Event::Start(start)) if start.name().as_ref() == b"bookmark" => {
                if !inside_xbel {
                    return Err(AppError::Validation("node outside XBEL root".into()));
                }
                count += 1;
                validate_tree_limits(stack.len() + 1, count)?;
                stack.push(parsed_element(&reader, &start, "bookmark")?);
            }
            Ok(Event::Empty(start)) if start.name().as_ref() == b"separator" => {
                if !inside_xbel {
                    return Err(AppError::Validation("node outside XBEL root".into()));
                }
                count += 1;
                validate_tree_limits(stack.len() + 1, count)?;
                append_parsed(
                    ParsedNode {
                        external_id: attribute(&reader, &start, b"id")?,
                        node_type: "separator",
                        title: String::new(),
                        url: None,
                        description: String::new(),
                        children: Vec::new(),
                    },
                    &mut stack,
                    &mut roots,
                );
            }
            Ok(Event::Empty(start))
                if start.name().as_ref() == b"folder" || start.name().as_ref() == b"bookmark" =>
            {
                if !inside_xbel {
                    return Err(AppError::Validation("node outside XBEL root".into()));
                }
                count += 1;
                validate_tree_limits(stack.len() + 1, count)?;
                let kind = if start.name().as_ref() == b"folder" {
                    "folder"
                } else {
                    "bookmark"
                };
                let node = parsed_element(&reader, &start, kind)?;
                append_parsed(node, &mut stack, &mut roots);
            }
            Ok(Event::Start(start)) if start.name().as_ref() == b"title" => {
                if !inside_xbel {
                    return Err(AppError::Validation("title outside XBEL root".into()));
                }
                let text = element_text(&mut reader, QName(b"title"))?;
                if let Some(node) = stack.last_mut() {
                    node.title = text;
                } else {
                    document_title = text;
                }
            }
            Ok(Event::Start(start)) if start.name().as_ref() == b"desc" => {
                if !inside_xbel {
                    return Err(AppError::Validation("description outside XBEL root".into()));
                }
                let text = element_text(&mut reader, QName(b"desc"))?;
                if let Some(node) = stack.last_mut() {
                    node.description = text;
                }
            }
            Ok(Event::End(end))
                if end.name().as_ref() == b"folder" || end.name().as_ref() == b"bookmark" =>
            {
                let node = stack
                    .pop()
                    .ok_or_else(|| AppError::Validation("unbalanced XBEL tree".into()))?;
                if node.node_type.as_bytes() != end.name().as_ref() {
                    return Err(AppError::Validation("mismatched XBEL node".into()));
                }
                append_parsed(node, &mut stack, &mut roots);
            }
            Ok(Event::End(end)) if end.name().as_ref() == b"xbel" => {
                if !inside_xbel || !stack.is_empty() {
                    return Err(AppError::Validation("unbalanced XBEL tree".into()));
                }
                inside_xbel = false;
                finished_xbel = true;
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(xml_error(error)),
        }
    }
    if !saw_xbel || !finished_xbel || inside_xbel || !stack.is_empty() {
        return Err(AppError::Validation("unbalanced XBEL tree".into()));
    }
    Ok(ParsedDocument {
        title: document_title,
        nodes: roots,
    })
}

/// Reads the text content of an element up to its matching end tag, decoding
/// the byte encoding and unescaping XML predefined entities (`&`, `<`,
/// `>`, `"`, `'`) and character references.
fn element_text(reader: &mut Reader<&[u8]>, end: QName) -> AppResult<String> {
    let raw = reader.read_text(end).map_err(xml_error)?;
    let unescaped = quick_xml::escape::unescape(&raw).map_err(|e| xml_error(e.into()))?;
    Ok(unescaped.into_owned())
}

fn parsed_element(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
    node_type: &'static str,
) -> AppResult<ParsedNode> {
    let url = if node_type == "bookmark" {
        let url = attribute(reader, start, b"href")?.unwrap_or_default();
        if url.is_empty() || url.len() > 8000 {
            return Err(AppError::Validation("bookmark URL is invalid".into()));
        }
        Some(url)
    } else {
        None
    };
    Ok(ParsedNode {
        external_id: attribute(reader, start, b"id")?,
        node_type,
        title: String::new(),
        url,
        description: String::new(),
        children: Vec::new(),
    })
}

fn attribute(
    reader: &Reader<&[u8]>,
    start: &BytesStart<'_>,
    key: &[u8],
) -> AppResult<Option<String>> {
    for attribute in start.attributes().with_checks(false) {
        let attribute = attribute.map_err(|error| AppError::Validation(error.to_string()))?;
        if attribute.key.as_ref() == key {
            return attribute
                .decode_and_unescape_value(reader.decoder())
                .map(|value| Some(value.into_owned()))
                .map_err(xml_error);
        }
    }
    Ok(None)
}

fn append_parsed(node: ParsedNode, stack: &mut [ParsedNode], roots: &mut Vec<ParsedNode>) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        roots.push(node);
    }
}

fn validate_tree_limits(depth: usize, count: usize) -> AppResult<()> {
    if depth > MAX_TREE_DEPTH {
        return Err(AppError::Validation("XBEL tree is too deep".into()));
    }
    if count > MAX_TREE_NODES {
        return Err(AppError::Validation("XBEL contains too many nodes".into()));
    }
    Ok(())
}

fn flatten_nodes(nodes: Vec<ParsedNode>, parent_index: Option<usize>, out: &mut Vec<FlatNode>) {
    for (position, mut node) in nodes.into_iter().enumerate() {
        let children = std::mem::take(&mut node.children);
        let index = out.len();
        out.push(FlatNode {
            parent_index,
            position: position as i64,
            node,
        });
        flatten_nodes(children, Some(index), out);
    }
}

fn allocate_external_id(next: &mut i64, used: &mut HashSet<String>) -> String {
    loop {
        let id = next.to_string();
        *next = next.saturating_add(1);
        if used.insert(id.clone()) {
            return id;
        }
    }
}

fn build_tree(
    nodes: Vec<BookmarkNode>,
    mut tags: HashMap<i64, Vec<String>>,
) -> Vec<BookmarkTreeNode> {
    let mut children: HashMap<Option<i64>, Vec<BookmarkNode>> = HashMap::new();
    for node in nodes {
        children.entry(node.parent_id).or_default().push(node);
    }
    fn descend(
        parent_id: Option<i64>,
        children: &mut HashMap<Option<i64>, Vec<BookmarkNode>>,
        tags: &mut HashMap<i64, Vec<String>>,
    ) -> Vec<BookmarkTreeNode> {
        children
            .remove(&parent_id)
            .unwrap_or_default()
            .into_iter()
            .map(|node| {
                let id = node.id;
                BookmarkTreeNode {
                    tags: tags.remove(&id).unwrap_or_default(),
                    children: descend(Some(id), children, tags),
                    node,
                }
            })
            .collect()
    }
    descend(None, &mut children, &mut tags)
}

fn write_children(
    xml: &mut String,
    parent_id: Option<i64>,
    children: &HashMap<Option<i64>, Vec<BookmarkNode>>,
    depth: usize,
) {
    if let Some(nodes) = children.get(&parent_id) {
        for node in nodes {
            let indent = "  ".repeat(depth);
            match node.node_type.as_str() {
                "folder" => {
                    xml.push_str(&format!(
                        "{indent}<folder id=\"{}\">\n",
                        escape_attr(&node.external_id)
                    ));
                    xml.push_str(&format!(
                        "{indent}  <title>{}</title>\n",
                        escape_text(&node.title)
                    ));
                    if !node.description.is_empty() {
                        xml.push_str(&format!(
                            "{indent}  <desc>{}</desc>\n",
                            escape_text(&node.description)
                        ));
                    }
                    write_children(xml, Some(node.id), children, depth + 1);
                    xml.push_str(&format!("{indent}</folder>\n"));
                }
                "bookmark" => {
                    xml.push_str(&format!(
                        "{indent}<bookmark href=\"{}\" id=\"{}\">\n",
                        escape_attr(node.url.as_deref().unwrap_or_default()),
                        escape_attr(&node.external_id)
                    ));
                    xml.push_str(&format!(
                        "{indent}  <title>{}</title>\n",
                        escape_text(&node.title)
                    ));
                    if !node.description.is_empty() {
                        xml.push_str(&format!(
                            "{indent}  <desc>{}</desc>\n",
                            escape_text(&node.description)
                        ));
                    }
                    xml.push_str(&format!("{indent}</bookmark>\n"));
                }
                "separator" => xml.push_str(&format!(
                    "{indent}<separator id=\"{}\"/>\n",
                    escape_attr(&node.external_id)
                )),
                _ => {}
            }
        }
    }
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    escape_text(value)
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn xml_error(error: quick_xml::Error) -> AppError {
    AppError::Validation(format!("invalid XBEL: {error}"))
}

fn validate_node_input(node_type: &str, title: &str, url: Option<&str>) -> AppResult<()> {
    if !matches!(node_type, "folder" | "bookmark" | "separator") {
        return Err(AppError::Validation("invalid node_type".into()));
    }
    if title.len() > 200 {
        return Err(AppError::Validation("title is too long".into()));
    }
    if node_type == "bookmark" {
        let url = url.unwrap_or("").trim();
        if url.is_empty() || url.len() > 8000 {
            return Err(AppError::Validation("bookmark URL is invalid".into()));
        }
    }
    Ok(())
}

async fn verify_document(
    tx: &mut SqliteConnection,
    user_id: i64,
    document_id: i64,
) -> AppResult<()> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sync_documents WHERE id = ? AND user_id = ?")
            .bind(document_id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
    if count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

async fn verify_parent(
    tx: &mut SqliteConnection,
    user_id: i64,
    document_id: i64,
    parent_id: Option<i64>,
) -> AppResult<()> {
    if let Some(parent_id) = parent_id {
        let count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM bookmark_nodes WHERE id = ? AND user_id = ?
               AND document_id = ? AND node_type = 'folder' AND deleted_at IS NULL"#,
        )
        .bind(parent_id)
        .bind(user_id)
        .bind(document_id)
        .fetch_one(&mut *tx)
        .await?;
        if count == 0 {
            return Err(AppError::Validation("parent folder not found".into()));
        }
    }
    Ok(())
}

async fn get_node_tx(tx: &mut SqliteConnection, user_id: i64, id: i64) -> AppResult<BookmarkNode> {
    sqlx::query_as::<_, BookmarkNode>(
        "SELECT * FROM bookmark_nodes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)
}

async fn is_descendant(
    tx: &mut SqliteConnection,
    document_id: i64,
    node_id: i64,
    possible_descendant: Option<i64>,
) -> AppResult<bool> {
    let Some(possible_descendant) = possible_descendant else {
        return Ok(false);
    };
    let count: i64 = sqlx::query_scalar(
        r#"WITH RECURSIVE descendants(id) AS (
             SELECT id FROM bookmark_nodes WHERE parent_id = ? AND document_id = ? AND deleted_at IS NULL
             UNION ALL
             SELECT n.id FROM bookmark_nodes n JOIN descendants d ON n.parent_id = d.id
             WHERE n.deleted_at IS NULL
           ) SELECT COUNT(*) FROM descendants WHERE id = ?"#,
    )
    .bind(node_id)
    .bind(document_id)
    .bind(possible_descendant)
    .fetch_one(&mut *tx)
    .await?;
    Ok(count > 0)
}

async fn allocate_document_id(tx: &mut SqliteConnection, document_id: i64) -> AppResult<String> {
    let next: i64 = sqlx::query_scalar(
        "UPDATE sync_documents SET next_external_id = next_external_id + 1 WHERE id = ? RETURNING next_external_id - 1",
    )
    .bind(document_id)
    .fetch_one(&mut *tx)
    .await?;
    Ok(next.to_string())
}

async fn touch_document(tx: &mut SqliteConnection, document_id: i64) -> AppResult<()> {
    sqlx::query(
        r#"UPDATE sync_documents SET revision = revision + 1, updated_unix = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"#,
    )
    .bind(unix_now())
    .bind(document_id)
    .execute(&mut *tx)
    .await?;
    Ok(())
}

async fn set_node_tags(
    tx: &mut SqliteConnection,
    user_id: i64,
    node_id: i64,
    tags: &[String],
) -> AppResult<()> {
    sqlx::query("DELETE FROM node_tags WHERE node_id = ?")
        .bind(node_id)
        .execute(&mut *tx)
        .await?;
    for name in tags {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let tag_id = crate::services::tag::TagService::ensure_tag(tx, user_id, name).await?;
        sqlx::query("INSERT OR IGNORE INTO node_tags (node_id, tag_id) VALUES (?, ?)")
            .bind(node_id)
            .bind(tag_id)
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mixed_order_and_entities() {
        let document = parse_xbel(
            r#"<?xml version="1.0"?><xbel><title>Main</title>
            <bookmark id="1" href="https://one.example/?a=1&amp;b=2"><title>One &amp; first</title></bookmark>
            <folder id="2"><title>Middle</title><bookmark id="3" href="https://nested.example"><title>Nested</title></bookmark></folder>
            <separator/><bookmark id="4" href="https://last.example"><title>Last</title></bookmark>
            </xbel>"#,
        )
        .unwrap();
        assert_eq!(document.title, "Main");
        assert_eq!(document.nodes.len(), 4);
        assert_eq!(document.nodes[0].node_type, "bookmark");
        assert_eq!(document.nodes[0].title, "One & first");
        assert_eq!(document.nodes[1].node_type, "folder");
        assert_eq!(document.nodes[1].children.len(), 1);
        assert_eq!(document.nodes[2].node_type, "separator");
        assert_eq!(document.nodes[3].title, "Last");
    }

    #[test]
    fn update_input_distinguishes_null_from_missing() {
        let input: UpdateNodeInput = serde_json::from_value(serde_json::json!({
            "parent_id": null,
            "url": null
        }))
        .unwrap();
        assert!(matches!(input.parent_id, Some(None)));
        assert!(matches!(input.url, Some(None)));

        let input: UpdateNodeInput = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(input.parent_id.is_none());
        assert!(input.url.is_none());
    }
}
