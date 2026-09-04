use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use sqlx::Row;

#[derive(Debug, Serialize)]
pub struct SearchLink {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub collection_id: i64,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub links: Vec<SearchLink>,
    pub next_cursor: Option<String>,
}

pub struct SearchService;

impl SearchService {
    /// Paginated search via FTS5 or full scan.
    /// `query` is the FTS query string (may be empty to return all).
    /// `cursor` is the last seen link id (string-encoded).
    pub async fn search(
        state: &AppState,
        tenant_id: i64,
        query: &str,
        cursor: Option<&str>,
        page_size: usize,
    ) -> AppResult<SearchResult> {
        let page_size = page_size.clamp(1, state.config.max_page_size);
        let after_id = cursor
            .and_then(|c| c.parse::<i64>().ok())
            .unwrap_or(i64::MAX);

        let links: Vec<SearchLink> = if query.trim().is_empty() {
            // Full scan with cursor pagination by id DESC.
            let rows = sqlx::query(
                r#"SELECT id, name, url, collection_id, description, created_at, updated_at
                   FROM links
                   WHERE tenant_id = ? AND deleted_at IS NULL AND id < ?
                   ORDER BY id DESC
                   LIMIT ?"#,
            )
            .bind(tenant_id)
            .bind(after_id)
            .bind(page_size as i64 + 1)
            .fetch_all(&state.pool)
            .await?;
            rows_to_search(rows)
        } else {
            // FTS5 search.
            let fts_query = sanitize_fts_query(query);
            let rows = sqlx::query(
                r#"SELECT l.id, l.name, l.url, l.collection_id, l.description, l.created_at, l.updated_at
                   FROM links_fts f
                   JOIN links l ON l.id = f.link_id
                   WHERE f.tenant_id = ? AND l.deleted_at IS NULL AND l.id < ?
                     AND links_fts MATCH ?
                   ORDER BY l.id DESC
                   LIMIT ?"#,
            )
            .bind(tenant_id)
            .bind(after_id)
            .bind(&fts_query)
            .bind(page_size as i64 + 1)
            .fetch_all(&state.pool)
            .await?;
            rows_to_search(rows)
        };

        let mut links = links;
        let has_more = links.len() > page_size;
        if has_more {
            links.truncate(page_size);
        }
        let next_cursor = if has_more {
            links.last().map(|l| l.id.to_string())
        } else {
            None
        };

        Ok(SearchResult { links, next_cursor })
    }
}

fn rows_to_search(rows: Vec<sqlx::sqlite::SqliteRow>) -> Vec<SearchLink> {
    rows.into_iter()
        .map(|r| SearchLink {
            id: r.try_get("id").unwrap_or(0),
            name: r.try_get("name").unwrap_or_default(),
            url: r.try_get("url").unwrap_or_default(),
            collection_id: r.try_get("collection_id").unwrap_or(0),
            description: r.try_get("description").unwrap_or_default(),
            created_at: r.try_get("created_at").unwrap_or_default(),
            updated_at: r.try_get("updated_at").unwrap_or_default(),
        })
        .collect()
}

/// Sanitize a user query for FTS5: wrap each token in quotes to avoid
/// FTS5 syntax errors from special characters.
fn sanitize_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|tok| {
            let cleaned: String = tok
                .chars()
                .filter(|c| {
                    c.is_alphanumeric()
                        || *c == '_'
                        || *c == '-'
                        || *c == '.'
                        || *c == '/'
                        || *c == ':'
                })
                .collect();
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("\"{}\"*", cleaned)
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[allow(unused_imports)]
use crate::auth::AuthUser as _AuthUser;
