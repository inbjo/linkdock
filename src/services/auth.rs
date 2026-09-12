use crate::auth::password;
use crate::auth::session::SessionService;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use subtle::ConstantTimeEq;

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub setup_token: Option<String>,
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
    pub email: Option<String>,
    pub is_system_admin: bool,
}

#[derive(Debug, Serialize)]
pub struct SetupStatus {
    pub initialized: bool,
    pub requires_setup_token: bool,
}

pub struct AuthService;

impl AuthService {
    pub async fn setup_status(state: &AppState) -> AppResult<SetupStatus> {
        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&state.pool)
            .await?;
        Ok(SetupStatus {
            initialized: user_count > 0,
            requires_setup_token: user_count == 0 && state.config.setup_token.is_some(),
        })
    }

    pub async fn register(state: &AppState, req: RegisterRequest) -> AppResult<AuthResponse> {
        let username = req.username.trim().to_string();
        let email = crate::services::email::normalize_email(&req.email)?;
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

        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&state.pool)
            .await?;
        if user_count == 0 {
            if let Some(expected) = state.config.setup_token.as_deref() {
                let supplied = req.setup_token.as_deref().unwrap_or_default();
                if expected.as_bytes().ct_eq(supplied.as_bytes()).unwrap_u8() != 1 {
                    return Err(AppError::Forbidden);
                }
            }
        }

        let mut tx = state.pool.begin().await?;

        let user_row = sqlx::query(
            r#"INSERT INTO users (uuid, username, email, password_hash, display_name, is_system_admin)
               VALUES (?, ?, ?, ?, ?, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 1 ELSE 0 END)
               RETURNING id, is_system_admin"#,
        )
        .bind(&user_uuid)
        .bind(&username)
        .bind(&email)
        .bind(&hash)
        .bind(req.display_name.trim())
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                AppError::Conflict("username or email already taken".into())
            }
            other => AppError::Internal(anyhow::anyhow!(other)),
        })?;
        let user_id: i64 = user_row.try_get("id").unwrap_or(0);
        let is_system_admin = user_row.try_get::<i64, _>("is_system_admin").unwrap_or(0) != 0;

        tx.commit().await?;

        let (session, _sid) = SessionService::create(state, user_id).await?;

        Ok(AuthResponse {
            user: UserInfo {
                id: user_id,
                uuid: user_uuid,
                username,
                display_name: req.display_name.trim().to_string(),
                email: Some(email),
                is_system_admin,
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
            "SELECT id, uuid, username, display_name, email, is_system_admin, disabled FROM users WHERE id = ?",
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
        let email: Option<String> = row.try_get("email").unwrap_or(None);
        let is_system_admin: i64 = row.try_get("is_system_admin").unwrap_or(0);

        let (session, _sid) = SessionService::create(state, user_id).await?;

        Ok(AuthResponse {
            user: UserInfo {
                id: user_id,
                uuid: user_uuid,
                username,
                display_name,
                email,
                is_system_admin: is_system_admin != 0,
            },
            session,
        })
    }

    pub async fn me(state: &AppState, user: &crate::auth::AuthUser) -> AppResult<UserInfo> {
        let row = sqlx::query(
            "SELECT id, uuid, username, display_name, email, is_system_admin FROM users WHERE id = ?",
        )
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;
        Ok(UserInfo {
            id: row.try_get("id").unwrap_or(0),
            uuid: row.try_get("uuid").unwrap_or_default(),
            username: row.try_get("username").unwrap_or_default(),
            display_name: row.try_get("display_name").unwrap_or_default(),
            email: row.try_get("email").unwrap_or(None),
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
