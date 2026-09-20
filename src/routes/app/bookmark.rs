use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};

use crate::auth::{AuthContext, AuthWriter};
use crate::domain::bookmark::{BookmarkNode, BookmarkTreeNode, SyncDocument};
use crate::error::AppResult;
use crate::services::bookmark::{
    BookmarkService, CreateNodeInput, ReorderNodesInput, UpdateNodeInput, DEFAULT_DOCUMENT_PATH,
};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/documents", get(list_documents))
        .route("/documents/default", post(ensure_default_document))
        .route("/documents/{id}/tree", get(tree))
        .route("/documents/{id}/view", get(view))
        .route("/documents/{id}/search", get(search))
        .route("/documents/{id}/trash", get(trash))
        .route("/documents/{id}/snapshots", get(snapshots))
        .route("/snapshots/{id}/restore", post(restore_snapshot))
        .route("/nodes/{id}/restore", post(restore_node))
        .route("/documents/{id}/order", put(reorder))
        .route("/nodes", post(create_node))
        .route("/nodes/{id}", put(update_node).delete(delete_node))
}

async fn list_documents(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<SyncDocument>>> {
    Ok(Json(
        BookmarkService::list_documents(&state, auth.0.user_id).await?,
    ))
}

async fn ensure_default_document(
    State(state): State<AppState>,
    auth: AuthWriter,
) -> AppResult<Json<SyncDocument>> {
    Ok(Json(
        BookmarkService::ensure_document(&state, &auth.0, DEFAULT_DOCUMENT_PATH).await?,
    ))
}

async fn tree(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<Vec<BookmarkTreeNode>>> {
    Ok(Json(
        BookmarkService::tree(&state, auth.0.user_id, id).await?,
    ))
}

async fn create_node(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<CreateNodeInput>,
) -> AppResult<Json<BookmarkNode>> {
    Ok(Json(
        BookmarkService::create_node(&state, &auth.0, req).await?,
    ))
}

async fn update_node(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(req): Json<UpdateNodeInput>,
) -> AppResult<Json<BookmarkNode>> {
    Ok(Json(
        BookmarkService::update_node(&state, &auth.0, id, req).await?,
    ))
}

async fn delete_node(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Query(query): Query<RevisionQuery>,
) -> AppResult<Json<serde_json::Value>> {
    BookmarkService::delete_node(&state, &auth.0, id, query.expected_revision).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
struct RevisionQuery {
    expected_revision: Option<i64>,
}

#[derive(serde::Deserialize)]
struct SearchQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    offset: i64,
}

async fn view(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    let (revision, nodes) = BookmarkService::tree_snapshot(&state, auth.0.user_id, id).await?;
    Ok(Json(
        serde_json::json!({"revision": revision, "nodes": nodes}),
    ))
}

async fn search(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<Vec<BookmarkNode>>> {
    Ok(Json(
        BookmarkService::search(&state, auth.0.user_id, id, &query.q, query.offset).await?,
    ))
}

async fn trash(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<Vec<BookmarkNode>>> {
    Ok(Json(
        BookmarkService::trash(&state, auth.0.user_id, id, query.offset).await?,
    ))
}

async fn snapshots(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<Vec<crate::services::bookmark::SnapshotInfo>>> {
    Ok(Json(
        BookmarkService::snapshots(&state, auth.0.user_id, id).await?,
    ))
}

async fn restore_node(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(query): Json<RevisionQuery>,
) -> AppResult<Json<serde_json::Value>> {
    BookmarkService::restore_node(&state, &auth.0, id, query.expected_revision).await?;
    Ok(Json(serde_json::json!({"ok":true})))
}

async fn restore_snapshot(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(query): Json<RevisionQuery>,
) -> AppResult<Json<serde_json::Value>> {
    BookmarkService::restore_snapshot(&state, &auth.0, id, query.expected_revision).await?;
    Ok(Json(serde_json::json!({"ok":true})))
}

async fn reorder(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(req): Json<ReorderNodesInput>,
) -> AppResult<Json<serde_json::Value>> {
    BookmarkService::reorder(&state, &auth.0, id, req).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
