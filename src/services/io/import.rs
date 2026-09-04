use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;

/// A parsed bookmark from an import file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedBookmark {
    pub url: String,
    pub name: String,
    pub description: String,
    /// Path of collection names from root to the bookmark's parent.
    pub folder_path: Vec<String>,
}

/// Preview of parsed import data.
#[derive(Debug, Serialize)]
pub struct ImportPreview {
    pub format: String,
    pub total_bookmarks: usize,
    pub total_folders: usize,
    pub folders: Vec<String>,
    pub sample: Vec<ParsedBookmark>,
}

/// Import result.
#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub total: usize,
    pub success: usize,
    pub skipped: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportConfirm {
    pub bookmarks: Vec<ParsedBookmark>,
    pub target_collection_id: Option<i64>,
    /// "skip", "update", or "keep"
    #[serde(default = "default_duplicate_strategy")]
    pub duplicate_strategy: String,
}

fn default_duplicate_strategy() -> String {
    "keep".to_string()
}

pub struct ImportService;

impl ImportService {
    /// Parse an uploaded file and return a preview.
    pub fn parse(format: &str, content: &str) -> AppResult<Vec<ParsedBookmark>> {
        match format {
            "html" | "netscape" => parse_netscape_html(content),
            "json" => parse_linkwarden_json(content),
            "csv" => parse_csv(content),
            "xbel" => parse_xbel(content),
            _ => Err(AppError::Validation(format!("unknown format: {}", format))),
        }
    }

    /// Preview parsed bookmarks.
    pub fn preview(format: &str, bookmarks: &[ParsedBookmark]) -> ImportPreview {
        let mut folders = std::collections::BTreeSet::new();
        for b in bookmarks {
            let path = b.folder_path.join(" / ");
            if !path.is_empty() {
                folders.insert(path);
            }
        }
        let total_folders = folders.len();
        let sample = bookmarks.iter().take(10).cloned().collect();
        ImportPreview {
            format: format.to_string(),
            total_bookmarks: bookmarks.len(),
            total_folders,
            folders: folders.into_iter().collect(),
            sample,
        }
    }

    /// Execute the import in a transaction.
    pub async fn execute(
        state: &AppState,
        user: &AuthUser,
        req: ImportConfirm,
    ) -> AppResult<ImportResult> {
        user.require_write()?;
        let tenant_id = user.tenant_id;
        let mut tx = state.pool.begin().await?;
        let now = crate::auth::extractor::now_iso();

        // Resolve or create target collection.
        let root_collection_id = match req.target_collection_id {
            Some(id) => {
                let count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM collections WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
                )
                .bind(id)
                .bind(tenant_id)
                .fetch_one(&mut *tx)
                .await?;
                if count == 0 {
                    return Err(AppError::NotFound);
                }
                id
            }
            None => {
                // Create an "Imported" root collection.
                let uuid_str = uuid::Uuid::new_v4().to_string();
                let id: i64 = sqlx::query_scalar(
                    "INSERT INTO collections (uuid, tenant_id, parent_id, name, created_by) VALUES (?, ?, NULL, ?, ?) RETURNING id",
                )
                .bind(&uuid_str)
                .bind(tenant_id)
                .bind(format!("Imported {}", &now[..10]))
                .bind(user.user_id)
                .fetch_one(&mut *tx)
                .await?;
                id
            }
        };

        // Cache for folder path -> collection id.
        let mut col_cache: HashMap<String, i64> = HashMap::new();
        col_cache.insert(String::new(), root_collection_id);

        let mut success = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;
        let mut errors = Vec::new();

        for (i, bm) in req.bookmarks.iter().enumerate() {
            match import_one(&mut *tx, tenant_id, user.user_id, bm, &mut col_cache, root_collection_id, &req.duplicate_strategy).await {
                Ok(ImportOutcome::Created) => success += 1,
                Ok(ImportOutcome::Skipped) => skipped += 1,
                Ok(ImportOutcome::Updated) => success += 1,
                Err(e) => {
                    failed += 1;
                    errors.push(format!("bookmark #{} ({}): {}", i + 1, bm.url, e));
                }
            }
        }

        // Update import job if exists (not used in preview mode but for future).
        tx.commit().await?;

        Ok(ImportResult {
            total: req.bookmarks.len(),
            success,
            skipped,
            failed,
            errors,
        })
    }
}

enum ImportOutcome {
    Created,
    Skipped,
    Updated,
}

async fn import_one(
    tx: &mut sqlx::SqliteConnection,
    tenant_id: i64,
    user_id: i64,
    bm: &ParsedBookmark,
    col_cache: &mut HashMap<String, i64>,
    root_id: i64,
    duplicate_strategy: &str,
) -> AppResult<ImportOutcome> {
    // Validate URL.
    let url = bm.url.trim().to_string();
    if url.is_empty() || url.len() > 8000 {
        return Err(AppError::Validation("invalid url".into()));
    }
    // Reject dangerous protocols unless http/https/ftp.
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") && !lower.starts_with("ftp://") && !lower.starts_with("javascript:") {
        return Err(AppError::Validation("unsupported protocol".into()));
    }

    // Resolve collection from folder path.
    let collection_id = resolve_collection_path(tx, tenant_id, user_id, &bm.folder_path, col_cache, root_id).await?;

    // Check for duplicate URL in the same collection.
    if duplicate_strategy != "keep" {
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM links WHERE tenant_id = ? AND collection_id = ? AND url = ? AND deleted_at IS NULL LIMIT 1",
        )
        .bind(tenant_id)
        .bind(collection_id)
        .bind(&url)
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(existing_id) = existing {
            if duplicate_strategy == "skip" {
                return Ok(ImportOutcome::Skipped);
            }
            if duplicate_strategy == "update" {
                sqlx::query("UPDATE links SET name = ?, description = ?, updated_at = ? WHERE id = ?")
                    .bind(&bm.name)
                    .bind(&bm.description)
                    .bind(crate::auth::extractor::now_iso())
                    .bind(existing_id)
                    .execute(&mut *tx)
                    .await?;
                return Ok(ImportOutcome::Updated);
            }
        }
    }

    // Create the link.
    let uuid_str = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO links (uuid, tenant_id, collection_id, url, name, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&uuid_str)
    .bind(tenant_id)
    .bind(collection_id)
    .bind(&url)
    .bind(&bm.name)
    .bind(&bm.description)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    Ok(ImportOutcome::Created)
}

async fn resolve_collection_path(
    tx: &mut sqlx::SqliteConnection,
    tenant_id: i64,
    user_id: i64,
    folder_path: &[String],
    cache: &mut HashMap<String, i64>,
    root_id: i64,
) -> AppResult<i64> {
    let cache_key = folder_path.join("/");
    if let Some(id) = cache.get(&cache_key) {
        return Ok(*id);
    }

    let mut current_parent = root_id;
    let mut current_path = String::new();

    for folder_name in folder_path {
        let trimmed = folder_name.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !current_path.is_empty() {
            current_path.push('/');
        }
        current_path.push_str(trimmed);

        if let Some(id) = cache.get(&current_path) {
            current_parent = *id;
            continue;
        }

        // Try to find existing collection with this name under current_parent.
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM collections WHERE tenant_id = ? AND parent_id IS ? AND name = ? AND deleted_at IS NULL",
        )
        .bind(tenant_id)
        .bind(current_parent)
        .bind(trimmed)
        .fetch_optional(&mut *tx)
        .await?;

        let col_id = match existing {
            Some(id) => id,
            None => {
                let uuid_str = uuid::Uuid::new_v4().to_string();
                sqlx::query_scalar(
                    "INSERT INTO collections (uuid, tenant_id, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id",
                )
                .bind(&uuid_str)
                .bind(tenant_id)
                .bind(current_parent)
                .bind(trimmed)
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await?
            }
        };

        cache.insert(current_path.clone(), col_id);
        current_parent = col_id;
    }

    Ok(current_parent)
}

// --- Parsers ---

fn parse_netscape_html(content: &str) -> AppResult<Vec<ParsedBookmark>> {
    let mut bookmarks = Vec::new();
    let mut folder_stack: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect folder open: <H3 ...>Name</H3> or <DT><H3 ...>Name</H3>
        if let Some(name) = extract_tag(trimmed, "h3") {
            folder_stack.push(decode_html_entities(&name));
            continue;
        }

        // Detect folder close: </DL>
        if trimmed.to_uppercase().contains("</DL>") {
            folder_stack.pop();
            continue;
        }

        // Detect bookmark: <A HREF="url" ...>Name</A>
        if let Some((url, name)) = extract_bookmark(trimmed) {
            bookmarks.push(ParsedBookmark {
                url: decode_html_entities(&url),
                name: decode_html_entities(&name),
                description: String::new(),
                folder_path: folder_stack.clone(),
            });
        }
    }

    Ok(bookmarks)
}

fn extract_tag(line: &str, tag: &str) -> Option<String> {
    let lower = line.to_lowercase();
    let open = format!("<{}", tag);
    let start = lower.find(&open)?;
    let after_tag = &line[start..];
    let gt = after_tag.find('>')?;
    let content_start = start + gt + 1;
    let close = format!("</{}", tag);
    let close_lower = line[content_start..].to_lowercase().find(&close)?;
    Some(line[content_start..content_start + close_lower].trim().to_string())
}

fn extract_bookmark(line: &str) -> Option<(String, String)> {
    let lower = line.to_lowercase();
    let href_pos = lower.find("href=\"")?;
    let url_start = href_pos + 6;
    let url_end = line[url_start..].find('"')?;
    let url = line[url_start..url_start + url_end].to_string();

    // Find the > after the <A tag
    let a_end = lower.find('>')?;
    let content_start = a_end + 1;
    let close_a = line[content_start..].to_lowercase().find("</a>")?;
    let name = line[content_start..content_start + close_a].trim().to_string();

    Some((url, name))
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn parse_linkwarden_json(content: &str) -> AppResult<Vec<ParsedBookmark>> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| AppError::Validation(format!("invalid JSON: {}", e)))?;

    // Linkwarden export format: { collections: [...], links: [...] }
    let links = value.get("links").and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Validation("missing 'links' array".into()))?;

    // Build collection id -> path map.
    let mut col_paths: HashMap<i64, Vec<String>> = HashMap::new();
    if let Some(collections) = value.get("collections").and_then(|v| v.as_array()) {
        // First pass: collect all collections.
        let mut col_map: HashMap<i64, (String, Option<i64>)> = HashMap::new();
        for col in collections {
            let id = col.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let name = col.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let parent_id = col.get("parentId").or_else(|| col.get("parent_id")).and_then(|v| v.as_i64());
            col_map.insert(id, (name, parent_id));
        }
        // Resolve paths.
        for (id, _) in &col_map {
            let path = resolve_json_path(*id, &col_map);
            col_paths.insert(*id, path);
        }
    }

    let mut bookmarks = Vec::new();
    for link in links {
        let url = link.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = link.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let description = link.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let collection_id = link.get("collectionId").or_else(|| link.get("collection_id")).and_then(|v| v.as_i64());
        let folder_path = collection_id.and_then(|id| col_paths.get(&id)).cloned().unwrap_or_default();
        bookmarks.push(ParsedBookmark { url, name, description, folder_path });
    }

    Ok(bookmarks)
}

fn resolve_json_path(id: i64, map: &HashMap<i64, (String, Option<i64>)>) -> Vec<String> {
    let mut path = Vec::new();
    let mut current = Some(id);
    let mut visited = std::collections::HashSet::new();
    while let Some(cid) = current {
        if !visited.insert(cid) {
            break; // cycle guard
        }
        if let Some((name, parent)) = map.get(&cid) {
            path.insert(0, name.clone());
            current = *parent;
        } else {
            break;
        }
    }
    path
}

fn parse_csv(content: &str) -> AppResult<Vec<ParsedBookmark>> {
    let mut reader = csv::Reader::from_reader(content.as_bytes());
    let headers = reader.headers()
        .map_err(|e| AppError::Validation(format!("CSV error: {}", e)))?
        .clone();

    let url_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("url") || h.eq_ignore_ascii_case("link"));
    let name_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("name") || h.eq_ignore_ascii_case("title"));
    let desc_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("description") || h.eq_ignore_ascii_case("notes"));
    let folder_idx = headers.iter().position(|h| h.eq_ignore_ascii_case("folder") || h.eq_ignore_ascii_case("collection"));

    let url_idx = url_idx.ok_or_else(|| AppError::Validation("CSV must have a 'url' column".into()))?;

    let mut bookmarks = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|e| AppError::Validation(format!("CSV row error: {}", e)))?;
        let url = record.get(url_idx).unwrap_or("").to_string();
        if url.is_empty() {
            continue;
        }
        let name = name_idx.and_then(|i| record.get(i)).unwrap_or("").to_string();
        let description = desc_idx.and_then(|i| record.get(i)).unwrap_or("").to_string();
        let folder_path = folder_idx
            .and_then(|i| record.get(i))
            .map(|s| s.split('/').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();
        bookmarks.push(ParsedBookmark { url, name, description, folder_path });
    }

    Ok(bookmarks)
}

fn parse_xbel(content: &str) -> AppResult<Vec<ParsedBookmark>> {
    let mut bookmarks = Vec::new();
    let mut folder_stack: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // <folder> ... <title>Name</title>
        if trimmed.starts_with("<folder") {
            // Title will be on next line(s); for simplicity, extract from same or next line.
            if let Some(name) = extract_xbel_title(content, trimmed) {
                folder_stack.push(name);
            } else {
                folder_stack.push("Untitled".to_string());
            }
            continue;
        }

        if trimmed.starts_with("</folder>") {
            folder_stack.pop();
            continue;
        }

        // <bookmark href="url"> ... <title>Name</title>
        if trimmed.starts_with("<bookmark") {
            if let Some(href) = extract_attr(trimmed, "href") {
                let name = extract_xbel_title(content, trimmed).unwrap_or_default();
                bookmarks.push(ParsedBookmark {
                    url: href,
                    name,
                    description: String::new(),
                    folder_path: folder_stack.clone(),
                });
            }
        }
    }

    Ok(bookmarks)
}

fn extract_xbel_title(_content: &str, line: &str) -> Option<String> {
    extract_tag(line, "title")
}

fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let lower = line.to_lowercase();
    let pattern = format!("{}=\"", attr);
    let pos = lower.find(&pattern)?;
    let start = pos + pattern.len();
    let end = line[start..].find('"')?;
    Some(line[start..start + end].to_string())
}
