use crate::auth::AuthUser;
use crate::domain::tag::Tag;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateTagInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTagInput {
    pub name: String,
}

pub struct TagService;

impl TagService {
    pub async fn list(state: &AppState, user_id: i64) -> AppResult<Vec<Tag>> {
        let tags = sqlx::query_as::<_, Tag>(
            "SELECT * FROM tags WHERE user_id = ? ORDER BY normalized_name",
        )
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
        Ok(tags)
    }

    pub async fn create(state: &AppState, user: &AuthUser, req: CreateTagInput) -> AppResult<Tag> {
        user.require_write()?;
        let name = req.name.trim().to_string();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::Validation("tag name length invalid".into()));
        }
        let normalized = normalize(&name);
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let tag = sqlx::query_as::<_, Tag>(
            r#"INSERT INTO tags (uuid, user_id, name, normalized_name) VALUES (?, ?, ?, ?)
               RETURNING *"#,
        )
        .bind(&uuid_str)
        .bind(user.user_id)
        .bind(&name)
        .bind(&normalized)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                AppError::Conflict("tag already exists".into())
            }
            other => AppError::Internal(anyhow::anyhow!(other)),
        })?;
        Ok(tag)
    }

    pub async fn update(
        state: &AppState,
        user: &AuthUser,
        id: i64,
        req: UpdateTagInput,
    ) -> AppResult<Tag> {
        user.require_write()?;
        let name = req.name.trim().to_string();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::Validation("tag name length invalid".into()));
        }
        let normalized = normalize(&name);
        let tag = sqlx::query_as::<_, Tag>(
            r#"UPDATE tags SET name = ?, normalized_name = ? WHERE id = ? AND user_id = ?
               RETURNING *"#,
        )
        .bind(&name)
        .bind(&normalized)
        .bind(id)
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                AppError::Conflict("tag name already exists".into())
            }
            other => AppError::Internal(anyhow::anyhow!(other)),
        })?;
        Ok(tag)
    }

    pub async fn delete(state: &AppState, user: &AuthUser, id: i64) -> AppResult<()> {
        user.require_write()?;
        let res = sqlx::query("DELETE FROM tags WHERE id = ? AND user_id = ?")
            .bind(id)
            .bind(user.user_id)
            .execute(&state.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    /// Ensure a tag exists (within a transaction), return its id.
    pub async fn ensure_tag(
        tx: &mut sqlx::SqliteConnection,
        user_id: i64,
        name: &str,
    ) -> AppResult<i64> {
        let normalized = normalize(name);
        // Try to find existing.
        let existing: Option<i64> =
            sqlx::query_scalar("SELECT id FROM tags WHERE user_id = ? AND normalized_name = ?")
                .bind(user_id)
                .bind(&normalized)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(id) = existing {
            return Ok(id);
        }
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO tags (uuid, user_id, name, normalized_name) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(&uuid_str)
        .bind(user_id)
        .bind(name.trim())
        .bind(&normalized)
        .fetch_one(&mut *tx)
        .await?;
        Ok(id)
    }
}

pub fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}
