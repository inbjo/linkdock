use crate::auth::AuthUser;
use crate::domain::link::{Link, LinkWithTags};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize)]
pub struct CreateLinkInput {
    pub url: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub collection_id: i64,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateLinkInput {
    pub url: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub collection_id: Option<i64>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct BatchMoveInput {
    pub link_ids: Vec<i64>,
    pub target_collection_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct BatchDeleteInput {
    pub link_ids: Vec<i64>,
    #[serde(default)]
    pub permanent: bool,
}

#[derive(Debug, Deserialize)]
pub struct BatchTagInput {
    pub link_ids: Vec<i64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BatchResult {
    pub affected: usize,
}

pub struct LinkService;

impl LinkService {
    pub async fn list(
        state: &AppState,
        tenant_id: i64,
        collection_id: Option<i64>,
        include_deleted: bool,
    ) -> AppResult<Vec<Link>> {
        let links = if let Some(cid) = collection_id {
            if include_deleted {
                sqlx::query_as::<_, Link>(
                    "SELECT * FROM links WHERE tenant_id = ? AND collection_id = ? ORDER BY position, id",
                )
                .bind(tenant_id)
                .bind(cid)
                .fetch_all(&state.pool)
                .await?
            } else {
                sqlx::query_as::<_, Link>(
                    "SELECT * FROM links WHERE tenant_id = ? AND collection_id = ? AND deleted_at IS NULL ORDER BY position, id",
                )
                .bind(tenant_id)
                .bind(cid)
                .fetch_all(&state.pool)
                .await?
            }
        } else if include_deleted {
            sqlx::query_as::<_, Link>(
                "SELECT * FROM links WHERE tenant_id = ? ORDER BY position, id",
            )
            .bind(tenant_id)
            .fetch_all(&state.pool)
            .await?
        } else {
            sqlx::query_as::<_, Link>(
                "SELECT * FROM links WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY position, id",
            )
            .bind(tenant_id)
            .fetch_all(&state.pool)
            .await?
        };
        Ok(links)
    }

    pub async fn get(state: &AppState, tenant_id: i64, id: i64) -> AppResult<Link> {
        let link = sqlx::query_as::<_, Link>(
            "SELECT * FROM links WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        Ok(link)
    }

    pub async fn get_with_tags(state: &AppState, tenant_id: i64, id: i64) -> AppResult<LinkWithTags> {
        let link = Self::get(state, tenant_id, id).await?;
        let tags = Self::load_tags(state, id).await?;
        Ok(LinkWithTags { link, tags })
    }

    pub async fn create(state: &AppState, user: &AuthUser, req: CreateLinkInput) -> AppResult<Link> {
        user.require_write()?;
        let url = req.url.trim().to_string();
        if url.is_empty() || url.len() > 8000 {
            return Err(AppError::Validation("url length invalid".into()));
        }
        // Verify target collection exists in same tenant.
        let _ = crate::services::collection::CollectionService::get(
            state,
            user.tenant_id,
            req.collection_id,
        )
        .await?;
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let name = req.name.unwrap_or_default();
        let description = req.description.unwrap_or_default();
        let link = sqlx::query_as::<_, Link>(
            r#"INSERT INTO links (uuid, tenant_id, collection_id, url, name, description, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               RETURNING *"#,
        )
        .bind(&uuid_str)
        .bind(user.tenant_id)
        .bind(req.collection_id)
        .bind(&url)
        .bind(&name)
        .bind(&description)
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;
        if let Some(tags) = req.tags {
            Self::set_tags(state, user.tenant_id, link.id, &tags).await?;
        }
        Ok(link)
    }

    pub async fn update(
        state: &AppState,
        user: &AuthUser,
        id: i64,
        req: UpdateLinkInput,
    ) -> AppResult<Link> {
        user.require_write()?;
        let existing = Self::get(state, user.tenant_id, id).await?;
        if let Some(cid) = req.collection_id {
            if cid != existing.collection_id {
                let _ = crate::services::collection::CollectionService::get(
                    state,
                    user.tenant_id,
                    cid,
                )
                .await?;
            }
        }
        let url = req.url.unwrap_or(existing.url);
        let name = req.name.unwrap_or(existing.name);
        let description = req.description.unwrap_or(existing.description);
        let collection_id = req.collection_id.unwrap_or(existing.collection_id);
        let link = sqlx::query_as::<_, Link>(
            r#"UPDATE links
               SET url = ?, name = ?, description = ?, collection_id = ?, updated_at = ?
               WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
               RETURNING *"#,
        )
        .bind(&url)
        .bind(&name)
        .bind(&description)
        .bind(collection_id)
        .bind(crate::auth::extractor::now_iso())
        .bind(id)
        .bind(user.tenant_id)
        .fetch_one(&state.pool)
        .await?;
        if let Some(tags) = req.tags {
            Self::set_tags(state, user.tenant_id, id, &tags).await?;
        }
        Ok(link)
    }

    /// Soft delete (move to trash).
    pub async fn delete(state: &AppState, user: &AuthUser, id: i64) -> AppResult<()> {
        user.require_write()?;
        let now = crate::auth::extractor::now_iso();
        let res = sqlx::query(
            "UPDATE links SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
        )
        .bind(&now)
        .bind(&now)
        .bind(id)
        .bind(user.tenant_id)
        .execute(&state.pool)
        .await?;
        if res.rows_affected() == 0 {
            // Idempotent: already deleted or not found.
            return Ok(());
        }
        let _ = sqlx::query("DELETE FROM links_fts WHERE link_id = ?")
            .bind(id)
            .execute(&state.pool)
            .await;
        Ok(())
    }

    /// Restore from trash.
    pub async fn restore(state: &AppState, user: &AuthUser, id: i64) -> AppResult<Link> {
        user.require_write()?;
        let link = sqlx::query_as::<_, Link>(
            r#"UPDATE links SET deleted_at = NULL, updated_at = ?
               WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL
               RETURNING *"#,
        )
        .bind(crate::auth::extractor::now_iso())
        .bind(id)
        .bind(user.tenant_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        // Re-add to FTS.
        let _ = sqlx::query(
            "INSERT INTO links_fts (link_id, tenant_id, name, url, description) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(link.id)
        .bind(link.tenant_id)
        .bind(&link.name)
        .bind(&link.url)
        .bind(&link.description)
        .execute(&state.pool)
        .await;
        Ok(link)
    }

    /// Permanently delete.
    pub async fn purge(state: &AppState, user: &AuthUser, id: i64) -> AppResult<()> {
        user.require_write()?;
        let res = sqlx::query("DELETE FROM links WHERE id = ? AND tenant_id = ?")
            .bind(id)
            .bind(user.tenant_id)
            .execute(&state.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn batch_move(
        state: &AppState,
        user: &AuthUser,
        req: BatchMoveInput,
    ) -> AppResult<BatchResult> {
        user.require_write()?;
        let _ = crate::services::collection::CollectionService::get(
            state,
            user.tenant_id,
            req.target_collection_id,
        )
        .await?;
        let mut tx = state.pool.begin().await?;
        let now = crate::auth::extractor::now_iso();
        let mut affected = 0usize;
        for id in &req.link_ids {
            let r = sqlx::query(
                "UPDATE links SET collection_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
            )
            .bind(req.target_collection_id)
            .bind(&now)
            .bind(id)
            .bind(user.tenant_id)
            .execute(&mut *tx)
            .await?;
            affected += r.rows_affected() as usize;
        }
        tx.commit().await?;
        Ok(BatchResult { affected })
    }

    pub async fn batch_delete(
        state: &AppState,
        user: &AuthUser,
        req: BatchDeleteInput,
    ) -> AppResult<BatchResult> {
        user.require_write()?;
        let now = crate::auth::extractor::now_iso();
        let mut tx = state.pool.begin().await?;
        let mut affected = 0usize;
        for id in &req.link_ids {
            if req.permanent {
                let r = sqlx::query("DELETE FROM links WHERE id = ? AND tenant_id = ?")
                    .bind(id)
                    .bind(user.tenant_id)
                    .execute(&mut *tx)
                    .await?;
                affected += r.rows_affected() as usize;
            } else {
                let r = sqlx::query(
                    "UPDATE links SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
                )
                .bind(&now)
                .bind(&now)
                .bind(id)
                .bind(user.tenant_id)
                .execute(&mut *tx)
                .await?;
                affected += r.rows_affected() as usize;
                if r.rows_affected() > 0 {
                    let _ = sqlx::query("DELETE FROM links_fts WHERE link_id = ?")
                        .bind(id)
                        .execute(&mut *tx)
                        .await;
                }
            }
        }
        tx.commit().await?;
        Ok(BatchResult { affected })
    }

    pub async fn batch_restore(
        state: &AppState,
        user: &AuthUser,
        link_ids: Vec<i64>,
    ) -> AppResult<BatchResult> {
        user.require_write()?;
        let mut tx = state.pool.begin().await?;
        let now = crate::auth::extractor::now_iso();
        let mut affected = 0usize;
        for id in &link_ids {
            let r = sqlx::query(
                "UPDATE links SET deleted_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL",
            )
            .bind(&now)
            .bind(id)
            .bind(user.tenant_id)
            .execute(&mut *tx)
            .await?;
            if r.rows_affected() > 0 {
                affected += 1;
                // Re-add to FTS.
                let row = sqlx::query("SELECT name, url, description FROM links WHERE id = ?")
                    .bind(id)
                    .fetch_one(&mut *tx)
                    .await;
                if let Ok(row) = row {
                    let _ = sqlx::query(
                        "INSERT INTO links_fts (link_id, tenant_id, name, url, description) VALUES (?, ?, ?, ?, ?)",
                    )
                    .bind(id)
                    .bind(user.tenant_id)
                    .bind(row.try_get::<String, _>("name").unwrap_or_default())
                    .bind(row.try_get::<String, _>("url").unwrap_or_default())
                    .bind(row.try_get::<String, _>("description").unwrap_or_default())
                    .execute(&mut *tx)
                    .await;
                }
            }
        }
        tx.commit().await?;
        Ok(BatchResult { affected })
    }

    pub async fn batch_tag(
        state: &AppState,
        user: &AuthUser,
        req: BatchTagInput,
    ) -> AppResult<BatchResult> {
        user.require_write()?;
        let mut tx = state.pool.begin().await?;
        let mut affected = 0usize;
        for id in &req.link_ids {
            // Verify link belongs to tenant.
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM links WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
            )
            .bind(id)
            .bind(user.tenant_id)
            .fetch_one(&mut *tx)
            .await?;
            if exists == 0 {
                continue;
            }
            for tag_name in &req.tags {
                let tag_id =
                    crate::services::tag::TagService::ensure_tag(&mut tx, user.tenant_id, tag_name)
                        .await?;
                let _ = sqlx::query(
                    "INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)",
                )
                .bind(id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await;
            }
            affected += 1;
        }
        tx.commit().await?;
        Ok(BatchResult { affected })
    }

    async fn load_tags(state: &AppState, link_id: i64) -> AppResult<Vec<String>> {
        let rows = sqlx::query(
            r#"SELECT t.name FROM tags t
               JOIN link_tags lt ON lt.tag_id = t.id
               WHERE lt.link_id = ? ORDER BY t.name"#,
        )
        .bind(link_id)
        .fetch_all(&state.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| r.try_get::<String, _>("name").unwrap_or_default())
            .collect())
    }

    async fn set_tags(
        state: &AppState,
        tenant_id: i64,
        link_id: i64,
        tags: &[String],
    ) -> AppResult<()> {
        let mut tx = state.pool.begin().await?;
        sqlx::query("DELETE FROM link_tags WHERE link_id = ?")
            .bind(link_id)
            .execute(&mut *tx)
            .await?;
        for tag_name in tags {
            let trimmed = tag_name.trim();
            if trimmed.is_empty() {
                continue;
            }
            let tag_id =
                crate::services::tag::TagService::ensure_tag(&mut tx, tenant_id, trimmed).await?;
            sqlx::query("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)")
                .bind(link_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}
