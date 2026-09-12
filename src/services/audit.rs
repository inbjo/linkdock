use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use sqlx::Row;

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub user_id: Option<i64>,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<i64>,
    pub detail: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: String,
}

pub struct AuditService;

pub struct AuditLogInput<'a> {
    pub user_id: Option<i64>,
    pub action: &'a str,
    pub resource_type: Option<&'a str>,
    pub resource_id: Option<i64>,
    pub detail: Option<&'a str>,
    pub ip_address: Option<&'a str>,
}

impl AuditService {
    pub async fn log(state: &AppState, entry: AuditLogInput<'_>) {
        let result = sqlx::query(
            "INSERT INTO audit_log (user_id, action, resource_type, resource_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(entry.user_id)
        .bind(entry.action)
        .bind(entry.resource_type)
        .bind(entry.resource_id)
        .bind(entry.detail)
        .bind(entry.ip_address)
        .execute(&state.pool)
        .await;

        if let Err(e) = result {
            tracing::warn!(error = ?e, action = %entry.action, "failed to write audit log");
        }
    }

    pub async fn list_all(state: &AppState, limit: i64, offset: i64) -> AppResult<Vec<AuditEntry>> {
        let rows = sqlx::query(
            "SELECT id, user_id, action, resource_type, resource_id, detail, ip_address, created_at
             FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| AuditEntry {
                id: r.get("id"),
                user_id: r.get("user_id"),
                action: r.get("action"),
                resource_type: r.get("resource_type"),
                resource_id: r.get("resource_id"),
                detail: r.get("detail"),
                ip_address: r.get("ip_address"),
                created_at: r.get("created_at"),
            })
            .collect())
    }
}
