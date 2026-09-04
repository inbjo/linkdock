use crate::auth::AuthContext;
use crate::error::AppResult;
use crate::services::tenant::{
    AddMemberRequest, CreateTenantRequest, MemberInfo, TenantService, TenantWithRole,
    UpdateMemberRequest, UpdateTenantRequest,
};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tenants", get(list_tenants).post(create_tenant))
        .route("/tenants/{id}", put(update_tenant))
        .route("/tenants/{id}/select", post(select_tenant))
        .route("/tenants/{id}/members", get(list_members).post(add_member))
        .route(
            "/tenants/{id}/members/{user_id}",
            put(update_member).delete(remove_member),
        )
}

async fn list_tenants(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<TenantWithRole>>> {
    let tenants = TenantService::list_for_user(&state, auth.0.user_id).await?;
    Ok(Json(tenants))
}

async fn create_tenant(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<CreateTenantRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let tenant = TenantService::create(&state, auth.0.user_id, req).await?;
    Ok(Json(serde_json::to_value(&tenant).unwrap_or_default()))
}

async fn update_tenant(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    Json(req): Json<UpdateTenantRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let tenant = TenantService::update(&state, &auth.0, id, req).await?;
    Ok(Json(serde_json::to_value(&tenant).unwrap_or_default()))
}

async fn select_tenant(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    headers: axum::http::HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    let session_token = crate::routes::app::auth::extract_session_cookie(&headers)
        .ok_or(crate::error::AppError::Unauthorized)?;
    TenantService::select(&state, &auth.0, id, &session_token).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_members(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
) -> AppResult<Json<Vec<MemberInfo>>> {
    // Must be a member of the tenant.
    if id != auth.0.tenant_id {
        // Verify membership.
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tenant_members WHERE tenant_id = ? AND user_id = ?",
        )
        .bind(id)
        .bind(auth.0.user_id)
        .fetch_one(&state.pool)
        .await?;
        if count == 0 {
            return Err(crate::error::AppError::Forbidden);
        }
    }
    let members = TenantService::list_members(&state, id).await?;
    Ok(Json(members))
}

async fn add_member(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(id): Path<i64>,
    Json(req): Json<AddMemberRequest>,
) -> AppResult<Json<MemberInfo>> {
    let member = TenantService::add_member(&state, &auth.0, id, req).await?;
    Ok(Json(member))
}

async fn update_member(
    State(state): State<AppState>,
    auth: AuthContext,
    Path((id, user_id)): Path<(i64, i64)>,
    Json(req): Json<UpdateMemberRequest>,
) -> AppResult<Json<MemberInfo>> {
    let member = TenantService::update_member(&state, &auth.0, id, user_id, req).await?;
    Ok(Json(member))
}

async fn remove_member(
    State(state): State<AppState>,
    auth: AuthContext,
    Path((id, user_id)): Path<(i64, i64)>,
) -> AppResult<Json<serde_json::Value>> {
    TenantService::remove_member(&state, &auth.0, id, user_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
