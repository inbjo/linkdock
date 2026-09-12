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
        .route("/audit", get(list_audit))
        .route("/smtp", get(smtp_settings).put(update_smtp_settings))
        .route("/smtp/test", post(test_smtp))
        .route("/site", get(site_settings).put(update_site_settings))
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

async fn site_settings(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<crate::services::site::SiteSettings>> {
    require_admin(&auth.0)?;
    Ok(Json(crate::services::site::SiteSettingsService::get(&state).await?))
}

async fn update_site_settings(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(req): Json<crate::services::site::UpdateSiteSettings>,
) -> AppResult<Json<crate::services::site::SiteSettings>> {
    require_admin(&auth.0)?;
    Ok(Json(
        crate::services::site::SiteSettingsService::update(&state, req).await?,
    ))
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
    documents: i64,
    folders: i64,
    bookmarks: i64,
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
    let documents: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_documents")
        .fetch_one(&state.pool)
        .await?;
    let folders: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookmark_nodes WHERE node_type = 'folder' AND deleted_at IS NULL",
    )
    .fetch_one(&state.pool)
    .await?;
    let bookmarks: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bookmark_nodes WHERE node_type = 'bookmark' AND deleted_at IS NULL",
    )
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
        documents,
        folders,
        bookmarks,
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
    document_count: i64,
}

async fn list_users(
    State(state): State<AppState>,
    auth: AuthContext,
) -> AppResult<Json<Vec<AdminUser>>> {
    require_admin(&auth.0)?;
    let rows = sqlx::query(
        "SELECT u.id, u.uuid, u.username, u.display_name, u.email, u.is_system_admin, u.disabled, u.created_at,
         (SELECT COUNT(*) FROM sync_documents d WHERE d.user_id = u.id) as document_count
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
            document_count: r.get("document_count"),
        })
        .collect();
    Ok(Json(users))
}

#[derive(serde::Deserialize)]
struct AuditQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
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
    let entries = AuditService::list_all(&state, q.limit, q.offset).await?;
    Ok(Json(entries))
}
