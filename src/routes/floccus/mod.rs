use crate::auth::AuthContext;
use crate::error::{AppError, AppResult};
use crate::services::collection::{
    CollectionService, CreateCollectionInput, UpdateCollectionInput,
};
use crate::services::link::{CreateLinkInput, LinkService, UpdateLinkInput};
use crate::services::search::{SearchLink, SearchService};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/search", get(search))
        .route("/collections", get(list_collections).post(create_collection))
        .route("/collections/{id}", get(get_collection).put(update_collection).delete(delete_collection))
        .route("/links", post(create_link))
        .route("/links/{id}", put(update_link).delete(delete_link))
}

// --- Search ---

#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    searchQueryString: String,
    #[serde(default, rename = "cursor")]
    cursor: Option<String>,
}

async fn search(
    State(state): State<AppState>,
    auth: AuthContext,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Value>> {
    let result = SearchService::search(
        &state,
        auth.0.tenant_id,
        &q.searchQueryString,
        q.cursor.as_deref(),
        state.config.default_page_size,
    )
    .await?;
    let links: Vec<LwLink> = result
        .links
        .into_iter()
        .map(LwLink::from_search)
        .collect();
    let resp = LwSearchResponse {
        data: LwSearchData {
            links,
            next_cursor: result.next_cursor,
        },
    };
    Ok(Json(serde_json::to_value(&resp).unwrap_or_default()))
}

// --- Collections ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LwCollection {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    owner_id: i64,
}

impl LwCollection {
    fn from(c: crate::domain::collection::Collection) -> Self {
        Self {
            id: c.id,
            name: c.name,
            parent_id: c.parent_id,
            owner_id: c.created_by,
        }
    }
}

async fn list_collections(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Value>> {
    let cols = CollectionService::list_flat(&state, auth.0.tenant_id).await?;
    let items: Vec<LwCollection> = cols.into_iter().map(LwCollection::from).collect();
    Ok(Json(json!({ "response": items })))
}

async fn get_collection(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    let col = CollectionService::get(&state, auth.0.tenant_id, id).await?;
    Ok(Json(json!({ "response": LwCollection::from(col) })))
}

#[derive(Deserialize)]
struct CreateCollectionBody {
    name: String,
    #[serde(default)]
    parentId: Option<i64>,
}

async fn create_collection(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(body): Json<CreateCollectionBody>,
) -> AppResult<Json<Value>> {
    auth.0.require_write()?;
    let col = CollectionService::create(
        &state,
        &auth.0,
        CreateCollectionInput {
            name: body.name,
            parent_id: body.parentId,
            description: None,
            color: None,
        },
    )
    .await?;
    Ok(Json(json!({ "response": LwCollection::from(col) })))
}

#[derive(Deserialize)]
struct UpdateCollectionBody {
    name: Option<String>,
    #[serde(default)]
    parentId: Option<Option<i64>>,
    // Floccus sends the full collection object; ignore unknown fields.
}

async fn update_collection(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    Json(body): Json<UpdateCollectionBody>,
) -> AppResult<Json<Value>> {
    auth.0.require_write()?;
    let col = CollectionService::update(
        &state,
        &auth.0,
        id,
        UpdateCollectionInput {
            name: body.name,
            parent_id: body.parentId,
            description: None,
            color: None,
        },
    )
    .await?;
    Ok(Json(json!({ "response": LwCollection::from(col) })))
}

async fn delete_collection(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    auth.0.require_write()?;
    // Floccus treats 401 as success; we return 200 for idempotency.
    match CollectionService::get(&state, auth.0.tenant_id, id).await {
        Ok(_) => {
            CollectionService::delete(&state, &auth.0, id).await?;
            Ok(Json(json!({ "response": { "id": id } })))
        }
        Err(AppError::NotFound) => Ok(Json(json!({ "response": { "id": id } }))),
        Err(e) => Err(e),
    }
}

// --- Links ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LwLink {
    id: i64,
    name: String,
    url: String,
    collection_id: i64,
}

impl LwLink {
    fn from_search(s: SearchLink) -> Self {
        Self {
            id: s.id,
            name: s.name,
            url: s.url,
            collection_id: s.collection_id,
        }
    }
}

// Floccus search response shape: { data: { links: [...], nextCursor: ... } }
#[derive(Serialize)]
struct LwSearchData {
    links: Vec<LwLink>,
    #[serde(rename = "nextCursor")]
    next_cursor: Option<String>,
}

#[derive(Serialize)]
struct LwSearchResponse {
    data: LwSearchData,
}

#[derive(Deserialize)]
struct CreateLinkBody {
    url: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    collection: CollectionRef,
}

#[derive(Deserialize, Default)]
struct CollectionRef {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    ownerId: Option<i64>,
}

async fn create_link(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(body): Json<CreateLinkBody>,
) -> AppResult<Json<Value>> {
    auth.0.require_write()?;
    let collection_id = body.collection.id.ok_or_else(|| {
        AppError::Validation("collection.id is required".into())
    })?;
    let link = LinkService::create(
        &state,
        &auth.0,
        CreateLinkInput {
            url: body.url,
            name: body.name,
            description: None,
            collection_id,
            tags: None,
        },
    )
    .await?;
    Ok(Json(json!({
        "response": {
            "id": link.id,
            "name": link.name,
            "url": link.url,
            "collectionId": link.collection_id,
        }
    })))
}

#[derive(Deserialize)]
struct UpdateLinkBody {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    collection: Option<CollectionRef>,
}

async fn update_link(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    Json(body): Json<UpdateLinkBody>,
) -> AppResult<Json<Value>> {
    auth.0.require_write()?;
    let link = LinkService::update(
        &state,
        &auth.0,
        id,
        UpdateLinkInput {
            url: body.url,
            name: body.name,
            description: None,
            collection_id: body.collection.and_then(|c| c.id),
            tags: body.tags,
        },
    )
    .await?;
    Ok(Json(json!({
        "response": {
            "id": link.id,
            "name": link.name,
            "url": link.url,
            "collectionId": link.collection_id,
        }
    })))
}

async fn delete_link(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<Value>> {
    auth.0.require_write()?;
    // Floccus treats 404/401/403 as success; we make delete idempotent.
    LinkService::delete(&state, &auth.0, id).await?;
    Ok(Json(json!({ "response": { "id": id } })))
}
