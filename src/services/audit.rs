use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use sqlx::Row;

#[derive(Debug, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub tenant_id: Option<i64>,
    pub user_id: Option<i64>,
    pub action: String,
    pub resource_type: Option<String>,
    pub resource_id: Option<i64>,
    pub detail: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: String,
}

pub struct AuditService;

impl AuditService {
    pub async fn log(
        state: &AppState,
        tenant_id: Option<i64>,
        user_id: Option<i64>,
        action: &str,
        resource_type: Option<&str>,
        resource_id: Option<i64>,
        detail: Option<&str>,
        ip_address: Option<&str>,
    ) {
        let result = sqlx::query(
            "INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(tenant_id)
        .bind(user_id)
        .bind(action)
        .bind(resource_type)
        .bind(resource_id)
        .bind(detail)
        .bind(ip_address)
        .execute(&state.pool)
        .await;

        if let Err(e) = result {
            tracing::warn!(error = ?e, action = %action, "failed to write audit log");
        }
    }

    pub async fn list_tenant(
        state: &AppState,
        tenant_id: i64,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<AuditEntry>> {
        let rows = sqlx::query(
            "SELECT id, tenant_id, user_id, action, resource_type, resource_id, detail, ip_address, created_at
             FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
        )
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| AuditEntry {
                id: r.get("id"),
                tenant_id: r.get("tenant_id"),
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

    pub async fn list_all(
        state: &AppState,
        limit: i64,
        offset: i64,
    ) -> AppResult<Vec<AuditEntry>> {
        let rows = sqlx::query(
            "SELECT id, tenant_id, user_id, action, resource_type, resource_id, detail, ip_address, created_at
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
                tenant_id: r.get("tenant_id"),
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
