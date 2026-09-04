use crate::auth::{AuthContext, AuthWriter};
use crate::error::AppResult;
use crate::services::collection::{
    CollectionService, CreateCollectionInput, UpdateCollectionInput,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Json, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/collections/tree", get(tree))
        .route("/collections", get(list_collections).post(create_collection))
        .route("/collections/{id}", put(update_collection).delete(delete_collection))
}

async fn tree(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<crate::domain::collection::CollectionNode>>> {
    let tree = CollectionService::tree(&state, auth.0.tenant_id).await?;
    Ok(Json(tree))
}

async fn list_collections(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<crate::domain::collection::Collection>>> {
    let cols = CollectionService::list_flat(&state, auth.0.tenant_id).await?;
    Ok(Json(cols))
}

async fn create_collection(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<CreateCollectionInput>,
) -> AppResult<Json<crate::domain::collection::Collection>> {
    let col = CollectionService::create(&state, &auth.0, req).await?;
    Ok(Json(col))
}

async fn update_collection(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
    Json(req): Json<UpdateCollectionInput>,
) -> AppResult<Json<crate::domain::collection::Collection>> {
    let col = CollectionService::update(&state, &auth.0, id, req).await?;
    Ok(Json(col))
}

async fn delete_collection(
    State(state): State<AppState>,
    auth: AuthWriter,
    Path(id): Path<i64>,
) -> AppResult<Json<serde_json::Value>> {
    CollectionService::delete(&state, &auth.0, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
