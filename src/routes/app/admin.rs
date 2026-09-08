use crate::auth::{AuthContext, AuthUser};
use crate::error::{AppError, AppResult};
use crate::services::audit::AuditService;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stats", get(stats))
        .route("/users", get(list_users))
        .route("/tenants", get(list_tenants))
        .route("/audit", get(list_audit))
        .route("/smtp", get(smtp_settings).put(update_smtp_settings))
        .route("/smtp/test", post(test_smtp))
}

async fn smtp_settings(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<crate::services::email::SmtpSettings>> {
    require_admin(&auth.0)?;
    Ok(Json(
        crate::services::email::EmailService::settings(&state).await?,
    ))
}

async fn update_smtp_settings(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<crate::services::email::UpdateSmtpSettings>,
) -> AppResult<Json<crate::services::email::SmtpSettings>> {
    require_admin(&auth.0)?;
    Ok(Json(
        crate::services::email::EmailService::update_settings(&state, req).await?,
    ))
}

#[derive(serde::Deserialize)]
struct TestSmtpRequest {
    email: String,
}

async fn test_smtp(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<TestSmtpRequest>,
) -> AppResult<Json<serde_json::Value>> {
    require_admin(&auth.0)?;
    crate::services::email::EmailService::send_test(&state, &req.email).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn require_admin(user: &AuthUser) -> AppResult<()> {
    if !user.is_system_admin {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

#[derive(Serialize)]
struct Stats {
    users: i64,
    tenants: i64,
    collections: i64,
    links: i64,
    tags: i64,
    tokens: i64,
    sessions: i64,
    audit_entries: i64,
}

async fn stats(State(state): State<AppState>, auth: AuthContext) -> AppResult<Json<Stats>> {
    require_admin(&auth.0)?;
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await?;
    let tenants: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tenants")
        .fetch_one(&state.pool)
        .await?;
    let collections: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL")
            .fetch_one(&state.pool)
            .await?;
    let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM links WHERE deleted_at IS NULL")
        .fetch_one(&state.pool)
        .await?;
    let tags: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tags")
        .fetch_one(&state.pool)
        .await?;
    let tokens: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM access_tokens WHERE revoked_at IS NULL")
            .fetch_one(&state.pool)
            .await?;
    let sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sessions WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .fetch_one(&state.pool)
    .await?;
    let audit_entries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(Stats {
        users,
        tenants,
        collections,
        links,
        tags,
        tokens,
        sessions,
        audit_entries,
    }))
}

#[derive(Serialize)]
struct AdminUser {
    id: i64,
    uuid: String,
    username: String,
    display_name: String,
    email: Option<String>,
    is_system_admin: bool,
    disabled: bool,
    created_at: String,
    tenant_count: i64,
}

async fn list_users(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<AdminUser>>> {
    require_admin(&auth.0)?;
    let rows = sqlx::query(
        "SELECT u.id, u.uuid, u.username, u.display_name, u.email, u.is_system_admin, u.disabled, u.created_at,
         (SELECT COUNT(*) FROM tenant_members tm WHERE tm.user_id = u.id) as tenant_count
         FROM users u ORDER BY u.id",
    )
    .fetch_all(&state.pool)
    .await?;

    let users = rows
        .into_iter()
        .map(|r| AdminUser {
            id: r.get("id"),
            uuid: r.get("uuid"),
            username: r.get("username"),
            display_name: r.get("display_name"),
            email: r.get("email"),
            is_system_admin: r.get::<i64, _>("is_system_admin") != 0,
            disabled: r.get::<i64, _>("disabled") != 0,
            created_at: r.get("created_at"),
            tenant_count: r.get("tenant_count"),
        })
        .collect();
    Ok(Json(users))
}

#[derive(Serialize)]
struct AdminTenant {
    id: i64,
    uuid: String,
    name: String,
    slug: String,
    created_by: i64,
    created_at: String,
    member_count: i64,
    link_count: i64,
}

async fn list_tenants(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<AdminTenant>>> {
    require_admin(&auth.0)?;
    let rows = sqlx::query(
        "SELECT t.id, t.uuid, t.name, t.slug, t.created_by, t.created_at,
         (SELECT COUNT(*) FROM tenant_members tm WHERE tm.tenant_id = t.id) as member_count,
         (SELECT COUNT(*) FROM links l WHERE l.tenant_id = t.id AND l.deleted_at IS NULL) as link_count
         FROM tenants t ORDER BY t.id",
    )
    .fetch_all(&state.pool)
    .await?;

    let tenants = rows
        .into_iter()
        .map(|r| AdminTenant {
            id: r.get("id"),
            uuid: r.get("uuid"),
            name: r.get("name"),
            slug: r.get("slug"),
            created_by: r.get("created_by"),
            created_at: r.get("created_at"),
            member_count: r.get("member_count"),
            link_count: r.get("link_count"),
        })
        .collect();
    Ok(Json(tenants))
}

#[derive(serde::Deserialize)]
struct AuditQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(default)]
    tenant_id: Option<i64>,
}

fn default_limit() -> i64 {
    100
}

async fn list_audit(
    State(state): State<AppState>,
    auth: AuthContext,
    Query(q): Query<AuditQuery>,
) -> AppResult<Json<Vec<crate::services::audit::AuditEntry>>> {
    require_admin(&auth.0)?;
    let entries = if let Some(tid) = q.tenant_id {
        AuditService::list_tenant(&state, tid, q.limit, q.offset).await?
    } else {
        AuditService::list_all(&state, q.limit, q.offset).await?
    };
    Ok(Json(entries))
}
