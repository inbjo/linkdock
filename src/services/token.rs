use crate::auth::AuthUser;
use crate::domain::token::{AccessToken, AccessTokenCreated};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct CreateTokenRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

pub struct TokenService;

impl TokenService {
    pub async fn list(state: &AppState, user: &AuthUser) -> AppResult<Vec<AccessToken>> {
        user.require_session()?;
        let tokens = sqlx::query_as::<_, AccessToken>(
            r#"SELECT id, uuid, user_id, name, token_prefix, scopes,
                      expires_at, last_used_at, revoked_at, created_at
               FROM access_tokens
               WHERE user_id = ?
               ORDER BY created_at DESC"#,
        )
        .bind(user.user_id)
        .fetch_all(&state.pool)
        .await?;
        Ok(tokens)
    }

    pub async fn create(
        state: &AppState,
        user: &AuthUser,
        req: CreateTokenRequest,
    ) -> AppResult<AccessTokenCreated> {
        user.require_session()?;
        let name = req.name.trim().to_string();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::Validation("token name length invalid".into()));
        }
        // Enforce unique name among active tokens for the user.
        let dup: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM access_tokens
               WHERE user_id = ? AND name = ? AND revoked_at IS NULL"#,
        )
        .bind(user.user_id)
        .bind(&name)
        .fetch_one(&state.pool)
        .await?;
        if dup > 0 {
            return Err(AppError::Conflict("token name already in use".into()));
        }
        let (plaintext, prefix, hash) = crate::auth::token::generate_access_token();
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let scopes = normalize_scopes(req.scopes.as_deref())?;
        let token = sqlx::query_as::<_, AccessToken>(
            r#"INSERT INTO access_tokens (uuid, user_id, name, token_prefix, token_hash, scopes, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               RETURNING id, uuid, user_id, name, token_prefix, scopes,
                         expires_at, last_used_at, revoked_at, created_at"#,
        )
        .bind(&uuid_str)
        .bind(user.user_id)
        .bind(&name)
        .bind(&prefix)
        .bind(&hash)
        .bind(&scopes)
        .bind(req.expires_at)
        .fetch_one(&state.pool)
        .await?;
        Ok(AccessTokenCreated { token, plaintext })
    }

    pub async fn revoke(state: &AppState, user: &AuthUser, token_id: i64) -> AppResult<()> {
        user.require_session()?;
        let res = sqlx::query(
            r#"UPDATE access_tokens SET revoked_at = ?
               WHERE id = ? AND user_id = ? AND revoked_at IS NULL"#,
        )
        .bind(crate::auth::extractor::now_iso())
        .bind(token_id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}

fn normalize_scopes(requested: Option<&str>) -> AppResult<String> {
    let wants_write = match requested {
        Some(scopes) => {
            let values: Vec<_> = scopes.split_ascii_whitespace().collect();
            if values.is_empty()
                || !values
                    .iter()
                    .all(|scope| matches!(*scope, "bookmarks:read" | "bookmarks:write"))
                || !values.contains(&"bookmarks:read")
            {
                return Err(AppError::Validation("invalid token scopes".into()));
            }
            values.contains(&"bookmarks:write")
        }
        None => true,
    };
    Ok(if wants_write {
        "bookmarks:read bookmarks:write".to_string()
    } else {
        "bookmarks:read".to_string()
    })
}
