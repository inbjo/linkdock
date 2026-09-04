use crate::auth::{AuthContext, AuthWriter};
use crate::error::AppResult;
use crate::services::tag::{CreateTagInput, TagService, UpdateTagInput};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Json, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/{id}", put(update_tag).delete(delete_tag))
}

async fn list_tags(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<crate::domain::tag::Tag>>> {
    let tags = TagService::list(&state, auth.0.tenant_id).await?;
    Ok(Json(tags))
}

async fn create_tag(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<CreateTagInput>,
) -> AppResult<Json<crate::domain::tag::Tag>> {
    let tag = TagService::create(&state, &auth.0, req).await?;
    Ok(Json(tag))
}

async fn update_tag(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(req): Json<UpdateTagInput>,
) -> AppResult<Json<crate::domain::tag::Tag>> {
    let tag = TagService::update(&state, &auth.0, id, req).await?;
    Ok(Json(tag))
}

async fn delete_tag(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    TagService::delete(&state, &auth.0, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
