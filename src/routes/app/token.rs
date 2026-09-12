use crate::auth::AuthContext;
use crate::error::AppResult;
use crate::services::token::{CreateTokenRequest, TokenService};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::{delete, get};
use axum::{Json, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tokens", get(list_tokens).post(create_token))
        .route("/tokens/{id}", delete(revoke_token))
        .route("/sessions", get(list_sessions).delete(delete_session))
        .route("/sessions/{id}", delete(delete_session_by_id))
}

async fn list_tokens(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<crate::domain::token::AccessToken>>> {
    let tokens = TokenService::list(&state, &auth.0).await?;
    Ok(Json(tokens))
}

async fn create_token(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<CreateTokenRequest>,
) -> AppResult<Json<crate::domain::token::AccessTokenCreated>> {
    let token = TokenService::create(&state, &auth.0, req).await?;
    Ok(Json(token))
}

async fn revoke_token(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    TokenService::revoke(&state, &auth.0, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_sessions(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<serde_json::Value>>> {
    let rows = sqlx::query(
        r#"SELECT id, expires_at, last_used_at, created_at
           FROM sessions WHERE user_id = ? ORDER BY created_at DESC"#,
    )
    .bind(auth.0.user_id)
    .fetch_all(&state.pool)
    .await?;
    let sessions: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "id": r.try_get::<i64, _>("id").unwrap_or(0),
                "expires_at": r.try_get::<String, _>("expires_at").unwrap_or_default(),
                "last_used_at": r.try_get::<String, _>("last_used_at").unwrap_or_default(),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();
    Ok(Json(sessions))
}

async fn delete_session(
    State(state): State<AppState>,
    _auth: AuthContext,
    headers: axum::http::HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    if let Some(token) = crate::routes::app::auth::extract_session_cookie(&headers) {
        let _ = crate::auth::session::SessionService::destroy(&state, &token).await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_session_by_id(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    crate::auth::session::SessionService::destroy_by_id(&state, id, auth.0.user_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

use sqlx::Row;
