use crate::auth::AuthContext;
use crate::error::{AppError, AppResult};
use crate::services::auth::{AuthService, LoginRequest, RegisterRequest};
use crate::state::AppState;
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/me", get(me))
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
    State(_state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<serde_json::Value>> {
    let user = &auth.0;
    Ok(Json(json!({
        "id": user.user_id,
        "username": user.username,
        "is_system_admin": user.is_system_admin,
        "tenant_id": user.tenant_id,
        "tenant_role": user.tenant_role.as_str(),
    })))
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
