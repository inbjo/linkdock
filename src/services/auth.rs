use crate::auth::password;
use crate::auth::session::SessionService;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub user: UserInfo,
    pub session: String,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: i64,
    pub uuid: String,
    pub username: String,
    pub display_name: String,
    pub is_system_admin: bool,
}

pub struct AuthService;

impl AuthService {
    pub async fn register(state: &AppState, req: RegisterRequest) -> AppResult<AuthResponse> {
        let username = req.username.trim().to_string();
        if username.len() < 2 || username.len() > 64 {
            return Err(AppError::Validation("username length must be 2..64".into()));
        }
        if req.password.len() < 8 {
            return Err(AppError::Validation(
                "password must be at least 8 chars".into(),
            ));
        }
        if !username
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
        {
            return Err(AppError::Validation(
                "username may only contain alphanumeric, _ - .".into(),
            ));
        }
        let hash = password::hash_password(&req.password)
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        let user_uuid = uuid::Uuid::new_v4().to_string();

        let mut tx = state.pool.begin().await?;

        let user_row = sqlx::query(
            "INSERT INTO users (uuid, username, password_hash, display_name) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(&user_uuid)
        .bind(&username)
        .bind(&hash)
        .bind(req.display_name.trim())
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                AppError::Conflict("username already taken".into())
            }
            other => AppError::Internal(anyhow::anyhow!(other)),
        })?;
        let user_id: i64 = user_row.try_get("id").unwrap_or(0);

        // Create personal workspace.
        let tenant_uuid = uuid::Uuid::new_v4().to_string();
        let slug = slugify(&username);
        let tenant_row = sqlx::query(
            "INSERT INTO tenants (uuid, name, slug, created_by) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(&tenant_uuid)
        .bind(format!("{}'s workspace", username))
        .bind(&slug)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
        let tenant_id: i64 = tenant_row.try_get("id").unwrap_or(0);

        sqlx::query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (?, ?, 'owner')")
            .bind(tenant_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        let (session, _sid) = SessionService::create(state, user_id, tenant_id).await?;

        Ok(AuthResponse {
            user: UserInfo {
                id: user_id,
                uuid: user_uuid,
                username,
                display_name: req.display_name.trim().to_string(),
                is_system_admin: false,
            },
            session,
        })
    }

    pub async fn login(state: &AppState, req: LoginRequest) -> AppResult<AuthResponse> {
        let row = sqlx::query(
            "SELECT id, uuid, username, password_hash, display_name, is_system_admin, disabled FROM users WHERE username = ?",
        )
        .bind(req.username.trim())
        .fetch_optional(&state.pool)
        .await?;
        let row = match row {
            Some(r) => r,
            None => {
                // Run a dummy verify to reduce timing attack surface.
                let _ = password::verify_password("x", "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE");
                return Err(AppError::Validation("invalid credentials".into()));
            }
        };
        let disabled: i64 = row.try_get("disabled").unwrap_or(0);
        if disabled != 0 {
            return Err(AppError::Forbidden);
        }
        let hash: String = row.try_get("password_hash").unwrap_or_default();
        if !password::verify_password(&req.password, &hash) {
            return Err(AppError::Validation("invalid credentials".into()));
        }
        let user_id: i64 = row.try_get("id").unwrap_or(0);

        Self::complete_login(state, user_id).await
    }

    pub async fn complete_login(state: &AppState, user_id: i64) -> AppResult<AuthResponse> {
        let row = sqlx::query(
            "SELECT id, uuid, username, display_name, is_system_admin, disabled FROM users WHERE id = ?",
        )
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;
        if row.try_get::<i64, _>("disabled").unwrap_or(0) != 0 {
            return Err(AppError::Forbidden);
        }
        let user_uuid: String = row.try_get("uuid").unwrap_or_default();
        let username: String = row.try_get("username").unwrap_or_default();
        let display_name: String = row.try_get("display_name").unwrap_or_default();
        let is_system_admin: i64 = row.try_get("is_system_admin").unwrap_or(0);

        // Resolve active tenant: first tenant the user is a member of.
        let tenant_row = sqlx::query(
            "SELECT tenant_id FROM tenant_members WHERE user_id = ? ORDER BY tenant_id LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;
        let tenant_id: i64 = match tenant_row {
            Some(r) => r.try_get("tenant_id").unwrap_or(0),
            None => return Err(AppError::Internal(anyhow::anyhow!("user has no tenant"))),
        };

        let (session, _sid) = SessionService::create(state, user_id, tenant_id).await?;

        Ok(AuthResponse {
            user: UserInfo {
                id: user_id,
                uuid: user_uuid,
                username,
                display_name,
                is_system_admin: is_system_admin != 0,
            },
            session,
        })
    }

    pub async fn me(state: &AppState, user: &crate::auth::AuthUser) -> AppResult<UserInfo> {
        let row = sqlx::query(
            "SELECT id, uuid, username, display_name, is_system_admin FROM users WHERE id = ?",
        )
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;
        Ok(UserInfo {
            id: row.try_get("id").unwrap_or(0),
            uuid: row.try_get("uuid").unwrap_or_default(),
            username: row.try_get("username").unwrap_or_default(),
            display_name: row.try_get("display_name").unwrap_or_default(),
            is_system_admin: row.try_get::<i64, _>("is_system_admin").unwrap_or(0) != 0,
        })
    }
}

pub fn slugify(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// Suppress unused import warning for token module (used elsewhere).
#[allow(unused_imports)]
use crate::auth::token as _token;
