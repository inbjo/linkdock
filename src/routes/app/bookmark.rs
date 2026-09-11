use axum::extract::{Path, State};
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
        .route("/documents/{id}/order", put(reorder))
        .route("/nodes", post(create_node))
        .route("/nodes/{id}", put(update_node).delete(delete_node))
}

async fn list_documents(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<SyncDocument>>> {
    Ok(Json(
        BookmarkService::list_documents(&state, auth.0.tenant_id).await?,
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
        BookmarkService::tree(&state, auth.0.tenant_id, id).await?,
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
) -> AppResult<Json<serde_json::Value>> {
    BookmarkService::delete_node(&state, &auth.0, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
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
