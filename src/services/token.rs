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
        let tokens = sqlx::query_as::<_, AccessToken>(
            r#"SELECT id, uuid, tenant_id, user_id, name, token_prefix, scopes,
                      expires_at, last_used_at, revoked_at, created_at
               FROM access_tokens
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY created_at DESC"#,
        )
        .bind(user.tenant_id)
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
        user.require_manage_tokens()?;
        let name = req.name.trim().to_string();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::Validation("token name length invalid".into()));
        }
        // Enforce unique name among active tokens for same tenant+user.
        let dup: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM access_tokens
               WHERE tenant_id = ? AND user_id = ? AND name = ? AND revoked_at IS NULL"#,
        )
        .bind(user.tenant_id)
        .bind(user.user_id)
        .bind(&name)
        .fetch_one(&state.pool)
        .await?;
        if dup > 0 {
            return Err(AppError::Conflict("token name already in use".into()));
        }
        let (plaintext, prefix, hash) = crate::auth::token::generate_access_token();
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let scopes = req
            .scopes
            .unwrap_or_else(|| "bookmarks:read bookmarks:write".into());
        let token = sqlx::query_as::<_, AccessToken>(
            r#"INSERT INTO access_tokens (uuid, tenant_id, user_id, name, token_prefix, token_hash, scopes, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id, uuid, tenant_id, user_id, name, token_prefix, scopes,
                         expires_at, last_used_at, revoked_at, created_at"#,
        )
        .bind(&uuid_str)
        .bind(user.tenant_id)
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
        user.require_manage_tokens()?;
        let res = sqlx::query(
            r#"UPDATE access_tokens SET revoked_at = ?
               WHERE id = ? AND tenant_id = ? AND user_id = ? AND revoked_at IS NULL"#,
        )
        .bind(crate::auth::extractor::now_iso())
        .bind(token_id)
        .bind(user.tenant_id)
        .bind(user.user_id)
        .execute(&state.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}
