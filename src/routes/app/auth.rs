use crate::auth::AuthContext;
use crate::error::{AppError, AppResult};
use crate::services::auth::{AuthService, LoginRequest, RegisterRequest};
use crate::state::AppState;
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/setup", get(setup_status))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/forgot-password", post(forgot_password))
        .route("/auth/reset-password", post(reset_password))
        .route("/auth/logout", post(logout))
        .route("/me", get(me).put(update_profile))
}

async fn setup_status(
    State(state): State<AppState>,
) -> AppResult<Json<crate::services::auth::SetupStatus>> {
    Ok(Json(AuthService::setup_status(&state).await?))
}

async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<impl axum::response::IntoResponse> {
    let resp = AuthService::register(&state, req).await?;
    let cookie = build_session_cookie(&resp.session, &state.config);
    Ok((
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(json!({ "user": resp.user })),
    ))
}

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<impl axum::response::IntoResponse> {
    let resp = AuthService::login(&state, req).await?;
    let cookie = build_session_cookie(&resp.session, &state.config);
    Ok((
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(json!({ "user": resp.user })),
    ))
}

async fn logout(
    State(state): State<AppState>,
    _auth: AuthContext,
    headers: axum::http::HeaderMap,
) -> AppResult<impl axum::response::IntoResponse> {
    if let Some(token) = extract_session_cookie(&headers) {
        let _ = crate::auth::session::SessionService::destroy(&state, &token).await;
    }
    let cookie = clear_session_cookie(&state.config);
    Ok((
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(json!({ "ok": true })),
    ))
}

async fn me(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<serde_json::Value>> {
    let user = &auth.0;
    let profile = sqlx::query("SELECT display_name, email FROM users WHERE id = ?")
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(json!({
        "id": user.user_id,
        "username": user.username,
        "display_name": profile.get::<String, _>("display_name"),
        "email": profile.get::<Option<String>, _>("email"),
        "is_system_admin": user.is_system_admin,
        "tenant_id": user.tenant_id,
        "tenant_role": user.tenant_role.as_str(),
    })))
}

#[derive(Deserialize)]
struct UpdateProfileRequest {
    email: String,
    #[serde(default)]
    display_name: String,
}

async fn update_profile(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<UpdateProfileRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let email = crate::services::email::normalize_email(&req.email)?;
    sqlx::query("UPDATE users SET email=?, display_name=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind(&email)
        .bind(req.display_name.trim())
        .bind(auth.0.user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                AppError::Conflict("email already taken".into())
            }
            other => AppError::Internal(anyhow::anyhow!(other)),
        })?;
    Ok(Json(json!({ "ok": true, "email": email })))
}

#[derive(Deserialize)]
struct ForgotPasswordRequest {
    email: String,
}

async fn forgot_password(
    State(state): State<AppState>,
    Json(req): Json<ForgotPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let generic = || Json(json!({ "ok": true }));
    let Ok(email) = crate::services::email::normalize_email(&req.email) else {
        return Ok(generic());
    };
    let user_id = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM users WHERE email=? COLLATE NOCASE AND disabled=0",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    let Some(user_id) = user_id else {
        return Ok(generic());
    };
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM password_reset_tokens WHERE user_id=? AND julianday(created_at) > julianday('now','-1 minute')",
    )
    .bind(user_id)
    .fetch_one(&state.pool)
    .await?;
    if recent > 0 {
        return Ok(generic());
    }
    let token = crate::auth::token::random_b64url(32);
    let token_hash = crate::auth::token::sha256_hex(token.as_bytes());
    let result = sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(crate::auth::session::future_iso(1))
    .execute(&state.pool)
    .await?;
    if let Err(error) =
        crate::services::email::EmailService::send_password_reset(&state, &email, &token).await
    {
        tracing::warn!(user_id, error = ?error, "password reset email was not delivered");
        let _ = sqlx::query("DELETE FROM password_reset_tokens WHERE id=?")
            .bind(result.last_insert_rowid())
            .execute(&state.pool)
            .await;
    }
    Ok(generic())
}

#[derive(Deserialize)]
struct ResetPasswordRequest {
    token: String,
    password: String,
}

async fn reset_password(
    State(state): State<AppState>,
    Json(req): Json<ResetPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if req.password.len() < 8 {
        return Err(AppError::Validation(
            "password must be at least 8 chars".into(),
        ));
    }
    let hash = crate::auth::password::hash_password(&req.password)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let token_hash = crate::auth::token::sha256_hex(req.token.as_bytes());
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query(
        "UPDATE password_reset_tokens SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_hash=? AND used_at IS NULL AND julianday(expires_at) > julianday('now') RETURNING user_id",
    )
    .bind(&token_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::Validation("invalid or expired reset link".into()))?;
    let user_id: i64 = row.get("user_id");
    sqlx::query("UPDATE users SET password_hash=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind(hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true })))
}

pub fn build_session_cookie(token: &str, config: &crate::config::Config) -> String {
    let mut cookie = format!(
        "lw_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        token,
        config.session_ttl_hours * 3600
    );
    if config.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

pub fn clear_session_cookie(config: &crate::config::Config) -> String {
    let mut cookie = "lw_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0".to_string();
    if config.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

pub fn extract_session_cookie(headers: &axum::http::HeaderMap) -> Option<String> {
    let header = headers.get(axum::http::header::COOKIE)?;
    let value = header.to_str().ok()?;
    for pair in value.split(';') {
        let pair = pair.trim();
        if let Some(rest) = pair.strip_prefix("lw_session=") {
            let token = rest.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

#[allow(unused_imports)]
use AppError as _AppError;
