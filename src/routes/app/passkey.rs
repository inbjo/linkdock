use crate::auth::AuthContext;
use crate::error::AppResult;
use crate::services::passkey::{
    LoginFinishRequest, LoginStartRequest, PasskeyService, RegisterFinishRequest,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde_json::json;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/passkeys", get(list_passkeys))
        .route("/passkeys/{id}", delete(delete_passkey))
        .route("/passkeys/register/start", post(start_registration))
        .route("/passkeys/register/finish", post(finish_registration))
        .route("/auth/passkey/start", post(start_login))
        .route("/auth/passkey/finish", post(finish_login))
}

async fn list_passkeys(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(PasskeyService::list(&state, &auth.0).await?)))
}

async fn start_registration(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(
        PasskeyService::start_registration(&state, &auth.0).await?
    )))
}

async fn finish_registration(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<RegisterFinishRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(
        PasskeyService::finish_registration(&state, &auth.0, req).await?
    )))
}

async fn delete_passkey(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    PasskeyService::delete(&state, &auth.0, id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn start_login(
    State(state): State<AppState>,
    Json(req): Json<LoginStartRequest>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(json!(PasskeyService::start_login(&state, req).await?)))
}

async fn finish_login(
    State(state): State<AppState>,
    Json(req): Json<LoginFinishRequest>,
) -> AppResult<impl axum::response::IntoResponse> {
    let response = PasskeyService::finish_login(&state, req).await?;
    let cookie = crate::routes::app::auth::build_session_cookie(&response.session, &state.config);
    Ok((
        [(axum::http::header::SET_COOKIE, cookie)],
        Json(json!({ "user": response.user })),
    ))
}
