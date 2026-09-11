use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use serde::{Deserialize, Serialize};
use sqlx::Row;

/// Resolved role in the active tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TenantRole {
    Owner,
    Admin,
    Editor,
    Viewer,
}

impl TenantRole {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Self::Owner),
            "admin" => Some(Self::Admin),
            "editor" | "member" => Some(Self::Editor),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Editor => "editor",
            Self::Viewer => "viewer",
        }
    }

    pub fn can_manage_members(&self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }

    pub fn can_manage_tokens(&self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }

    pub fn can_write(&self) -> bool {
        !matches!(self, Self::Viewer)
    }
}

/// Authenticated user context resolved from session cookie or bearer token.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: i64,
    pub username: String,
    pub is_system_admin: bool,
    pub tenant_id: i64,
    pub tenant_role: TenantRole,
    /// Whether this request was authenticated via access token (Floccus path).
    pub via_token: bool,
    /// Access token id if via_token.
    pub token_id: Option<i64>,
    /// Space-separated scopes when authenticated via an access token.
    pub token_scopes: Option<String>,
}

impl AuthUser {
    pub fn require_write(&self) -> AppResult<()> {
        let token_can_write = !self.via_token
            || self
                .token_scopes
                .as_deref()
                .is_some_and(|scopes| has_scope(scopes, "bookmarks:write"));
        if self.tenant_role.can_write() && token_can_write {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }

    pub fn require_manage_members(&self) -> AppResult<()> {
        if self.tenant_role.can_manage_members() {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }

    pub fn require_manage_tokens(&self) -> AppResult<()> {
        if self.tenant_role.can_manage_tokens() {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }

    pub fn require_session(&self) -> AppResult<()> {
        if self.via_token {
            Err(AppError::Forbidden)
        } else {
            Ok(())
        }
    }

    pub fn require_system_admin(&self) -> AppResult<()> {
        if self.is_system_admin {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }
}

/// Extractor that resolves an authenticated user from either a session cookie
/// or a Bearer access token. The active tenant is resolved from the session's
/// active_tenant_id or the token's bound tenant_id.
#[derive(Debug, Clone)]
pub struct AuthContext(pub AuthUser);

impl FromRequestParts<AppState> for AuthContext {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = resolve_auth(parts, state).await?;
        Ok(AuthContext(user))
    }
}

/// Extractor that requires write permission (used by mutating app endpoints).
#[derive(Debug, Clone)]
pub struct AuthWriter(pub AuthUser);

impl FromRequestParts<AppState> for AuthWriter {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = resolve_auth(parts, state).await?;
        user.require_write()?;
        Ok(AuthWriter(user))
    }
}

async fn resolve_auth(parts: &mut Parts, state: &AppState) -> AppResult<AuthUser> {
    // Try Bearer token first (Floccus path).
    if let Some(token) = bearer_token(parts) {
        return resolve_token_auth(&token, state).await;
    }
    // Try session cookie.
    if let Some(session_token) = session_cookie(parts, &state.config) {
        return resolve_session_auth(&session_token, state).await;
    }
    Err(AppError::Unauthorized)
}

fn bearer_token(parts: &Parts) -> Option<String> {
    let header = parts.headers.get(axum::http::header::AUTHORIZATION)?;
    let value = header.to_str().ok()?;
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("Bearer ") {
        let t = rest.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

fn session_cookie(parts: &Parts, config: &crate::config::Config) -> Option<String> {
    let header = parts.headers.get(axum::http::header::COOKIE)?;
    let value = header.to_str().ok()?;
    for pair in value.split(';') {
        let pair = pair.trim();
        if let Some(rest) = pair.strip_prefix("linkdock_session=") {
            let token = rest.trim();
            if !token.is_empty() {
                let _ = config; // cookie name fixed
                return Some(token.to_string());
            }
        }
    }
    None
}

pub(crate) async fn resolve_token_auth(token: &str, state: &AppState) -> AppResult<AuthUser> {
    let hash = crate::auth::token::sha256_hex(token.as_bytes());
    let row = sqlx::query(
        r#"SELECT at.id, at.tenant_id, at.user_id, at.scopes, at.expires_at, at.revoked_at,
                  u.username, u.is_system_admin, u.disabled,
                  tm.role
           FROM access_tokens at
           JOIN users u ON u.id = at.user_id
           JOIN tenant_members tm ON tm.tenant_id = at.tenant_id AND tm.user_id = at.user_id
           WHERE at.token_hash = ?"#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let row = match row {
        Some(r) => r,
        None => return Err(AppError::Forbidden), // Floccus expects 403
    };

    let revoked: Option<String> = row.try_get("revoked_at").ok().flatten();
    if revoked.is_some() {
        return Err(AppError::Forbidden);
    }
    let disabled: i64 = row.try_get("disabled").unwrap_or(0);
    if disabled != 0 {
        return Err(AppError::Forbidden);
    }
    let expires_at: Option<String> = row.try_get("expires_at").ok().flatten();
    if let Some(exp) = expires_at {
        if now_iso() > exp {
            return Err(AppError::Forbidden);
        }
    }
    let token_id: i64 = row.try_get("id").unwrap_or(0);
    let tenant_id: i64 = row.try_get("tenant_id").unwrap_or(0);
    let user_id: i64 = row.try_get("user_id").unwrap_or(0);
    let username: String = row.try_get("username").unwrap_or_default();
    let is_system_admin: i64 = row.try_get("is_system_admin").unwrap_or(0);
    let role_str: String = row.try_get("role").unwrap_or_default();
    let role = TenantRole::parse(&role_str).ok_or(AppError::Forbidden)?;
    let scopes: String = row.try_get("scopes").unwrap_or_default();
    if !has_scope(&scopes, "bookmarks:read") {
        return Err(AppError::Forbidden);
    }

    // Update last_used_at (best effort).
    let _ = sqlx::query("UPDATE access_tokens SET last_used_at = ? WHERE id = ?")
        .bind(now_iso())
        .bind(token_id)
        .execute(&state.pool)
        .await;

    Ok(AuthUser {
        user_id,
        username,
        is_system_admin: is_system_admin != 0,
        tenant_id,
        tenant_role: role,
        via_token: true,
        token_id: Some(token_id),
        token_scopes: Some(scopes),
    })
}

async fn resolve_session_auth(token: &str, state: &AppState) -> AppResult<AuthUser> {
    let hash = crate::auth::token::hash_session_token(token);
    let row = sqlx::query(
        r#"SELECT s.id, s.user_id, s.active_tenant_id, s.expires_at,
                  u.username, u.is_system_admin, u.disabled,
                  tm.role
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           JOIN tenant_members tm ON tm.tenant_id = s.active_tenant_id AND tm.user_id = s.user_id
           WHERE s.session_hash = ?"#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let row = match row {
        Some(r) => r,
        None => return Err(AppError::Unauthorized),
    };

    let expires_at: String = row.try_get("expires_at").unwrap_or_default();
    if now_iso() > expires_at {
        return Err(AppError::Unauthorized);
    }
    let disabled: i64 = row.try_get("disabled").unwrap_or(0);
    if disabled != 0 {
        return Err(AppError::Forbidden);
    }
    let user_id: i64 = row.try_get("user_id").unwrap_or(0);
    let tenant_id: i64 = row.try_get("active_tenant_id").unwrap_or(0);
    let username: String = row.try_get("username").unwrap_or_default();
    let is_system_admin: i64 = row.try_get("is_system_admin").unwrap_or(0);
    let role_str: String = row.try_get("role").unwrap_or_default();
    let role = TenantRole::parse(&role_str).ok_or(AppError::Forbidden)?;

    // Update last_used_at.
    let session_id: i64 = row.try_get("id").unwrap_or(0);
    let _ = sqlx::query("UPDATE sessions SET last_used_at = ? WHERE id = ?")
        .bind(now_iso())
        .bind(session_id)
        .execute(&state.pool)
        .await;

    Ok(AuthUser {
        user_id,
        username,
        is_system_admin: is_system_admin != 0,
        tenant_id,
        tenant_role: role,
        via_token: false,
        token_id: None,
        token_scopes: None,
    })
}

fn has_scope(scopes: &str, expected: &str) -> bool {
    scopes
        .split_ascii_whitespace()
        .any(|scope| scope == expected)
}

pub fn now_iso() -> String {
    // Format: YYYY-MM-DDTHH:MM:SSfZ (compatible with SQLite strftime output)
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Iso8601::DEFAULT)
        .unwrap_or_else(|_| String::new())
}
