use crate::auth::{AuthContext, AuthWriter};
use crate::error::AppResult;
use crate::services::link::{
    BatchDeleteInput, BatchMoveInput, BatchResult, BatchTagInput, CreateLinkInput,
    LinkService, UpdateLinkInput,
};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

#[derive(Deserialize)]
struct ListLinksQuery {
    collection_id: Option<i64>,
    #[serde(default)]
    include_deleted: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/links", get(list_links).post(create_link))
        .route("/links/batch/move", post(batch_move))
        .route("/links/batch/tag", post(batch_tag))
        .route("/links/batch/delete", post(batch_delete))
        .route("/links/batch/restore", post(batch_restore))
        .route("/links/{id}", get(get_link).put(update_link).delete(delete_link))
        .route("/links/{id}/restore", post(restore_link))
}

async fn list_links(
    State(state): State<AppState>,
    auth: AuthContext,
    Query(q): Query<ListLinksQuery>,
) -> AppResult<Json<Vec<crate::domain::link::Link>>> {
    let links = LinkService::list(&state, auth.0.tenant_id, q.collection_id, q.include_deleted).await?;
    Ok(Json(links))
}

async fn get_link(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<crate::domain::link::LinkWithTags>> {
    let link = LinkService::get_with_tags(&state, auth.0.tenant_id, id).await?;
    Ok(Json(link))
}

async fn create_link(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<CreateLinkInput>,
) -> AppResult<Json<crate::domain::link::LinkWithTags>> {
    let link = LinkService::create(&state, &auth.0, req).await?;
    let tags = LinkService::get_with_tags(&state, auth.0.tenant_id, link.id)
        .await?
        .tags;
    Ok(Json(crate::domain::link::LinkWithTags { link, tags }))
}

async fn update_link(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(req): Json<UpdateLinkInput>,
) -> AppResult<Json<crate::domain::link::LinkWithTags>> {
    let link = LinkService::update(&state, &auth.0, id, req).await?;
    let tags = LinkService::get_with_tags(&state, auth.0.tenant_id, link.id)
        .await?
        .tags;
    Ok(Json(crate::domain::link::LinkWithTags { link, tags }))
}

async fn delete_link(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    LinkService::delete(&state, &auth.0, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn restore_link(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
) -> AppResult<Json<crate::domain::link::Link>> {
    let link = LinkService::restore(&state, &auth.0, id).await?;
    Ok(Json(link))
}

async fn batch_move(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<BatchMoveInput>,
) -> AppResult<Json<BatchResult>> {
    let res = LinkService::batch_move(&state, &auth.0, req).await?;
    Ok(Json(res))
}

async fn batch_tag(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<BatchTagInput>,
) -> AppResult<Json<BatchResult>> {
    let res = LinkService::batch_tag(&state, &auth.0, req).await?;
    Ok(Json(res))
}

async fn batch_delete(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<BatchDeleteInput>,
) -> AppResult<Json<BatchResult>> {
    let res = LinkService::batch_delete(&state, &auth.0, req).await?;
    Ok(Json(res))
}

async fn batch_restore(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<BatchDeleteInput>,
) -> AppResult<Json<BatchResult>> {
    let res = LinkService::batch_restore(&state, &auth.0, req.link_ids).await?;
    Ok(Json(res))
}
