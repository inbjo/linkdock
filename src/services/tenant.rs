use crate::auth::TenantRole;
use crate::domain::tenant::{Tenant, TenantMember};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Deserialize)]
pub struct CreateTenantRequest {
    pub name: String,
    #[serde(default)]
    pub slug: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTenantRequest {
    pub name: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TenantWithRole {
    #[serde(flatten)]
    pub tenant: Tenant,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub username: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRequest {
    pub role: String,
}

pub struct TenantService;

impl TenantService {
    pub async fn list_for_user(state: &AppState, user_id: i64) -> AppResult<Vec<TenantWithRole>> {
        let rows = sqlx::query_as::<_, Tenant>(
            r#"SELECT t.* FROM tenants t
               JOIN tenant_members tm ON tm.tenant_id = t.id
               WHERE tm.user_id = ? ORDER BY t.id"#,
        )
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
        let roles =
            sqlx::query_as::<_, TenantMember>("SELECT * FROM tenant_members WHERE user_id = ?")
                .bind(user_id)
                .fetch_all(&state.pool)
                .await?;
        let role_map: std::collections::HashMap<i64, String> =
            roles.into_iter().map(|m| (m.tenant_id, m.role)).collect();
        Ok(rows
            .into_iter()
            .map(|t| {
                let role = role_map
                    .get(&t.id)
                    .cloned()
                    .unwrap_or_else(|| "member".into());
                TenantWithRole { tenant: t, role }
            })
            .collect())
    }

    pub async fn create(
        state: &AppState,
        user_id: i64,
        req: CreateTenantRequest,
    ) -> AppResult<Tenant> {
        let name = req.name.trim().to_string();
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::Validation("tenant name length invalid".into()));
        }
        let slug = req
            .slug
            .map(|s| crate::services::auth::slugify(&s))
            .unwrap_or_else(|| {
                let base = crate::services::auth::slugify(&name);
                if base.is_empty() {
                    "ws".to_string()
                } else {
                    base
                }
            });
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let mut tx = state.pool.begin().await?;
        let tenant = sqlx::query_as::<_, Tenant>(
            r#"INSERT INTO tenants (uuid, name, slug, created_by) VALUES (?, ?, ?, ?)
               RETURNING *"#,
        )
        .bind(&uuid_str)
        .bind(&name)
        .bind(&slug)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                AppError::Conflict("slug already taken".into())
            }
            other => AppError::Internal(anyhow::anyhow!(other)),
        })?;
        sqlx::query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (?, ?, 'owner')")
            .bind(tenant.id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(tenant)
    }

    pub async fn update(
        state: &AppState,
        user: &crate::auth::AuthUser,
        tenant_id: i64,
        req: UpdateTenantRequest,
    ) -> AppResult<Tenant> {
        if tenant_id != user.tenant_id {
            // Must be a member with admin+ of that tenant to update.
            Self::require_admin_of(state, user.user_id, tenant_id).await?;
        } else if !user.tenant_role.can_manage_members() {
            return Err(AppError::Forbidden);
        }
        let mut tx = state.pool.begin().await?;
        if let Some(name) = req.name {
            let name = name.trim().to_string();
            if name.is_empty() || name.len() > 100 {
                return Err(AppError::Validation("tenant name length invalid".into()));
            }
            sqlx::query("UPDATE tenants SET name = ?, updated_at = ? WHERE id = ?")
                .bind(&name)
                .bind(crate::auth::extractor::now_iso())
                .bind(tenant_id)
                .execute(&mut *tx)
                .await?;
        }
        if let Some(slug) = req.slug {
            let slug = crate::services::auth::slugify(&slug);
            if !slug.is_empty() {
                sqlx::query("UPDATE tenants SET slug = ?, updated_at = ? WHERE id = ?")
                    .bind(&slug)
                    .bind(crate::auth::extractor::now_iso())
                    .bind(tenant_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| match e {
                        sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                            AppError::Conflict("slug already taken".into())
                        }
                        other => AppError::Internal(anyhow::anyhow!(other)),
                    })?;
            }
        }
        let tenant = sqlx::query_as::<_, Tenant>("SELECT * FROM tenants WHERE id = ?")
            .bind(tenant_id)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(tenant)
    }

    pub async fn select(
        state: &AppState,
        user: &crate::auth::AuthUser,
        tenant_id: i64,
        session_token: &str,
    ) -> AppResult<()> {
        // Verify user is a member of that tenant.
        Self::require_member_of(state, user.user_id, tenant_id).await?;
        crate::auth::session::SessionService::set_active_tenant(state, session_token, tenant_id)
            .await
    }

    pub async fn list_members(state: &AppState, tenant_id: i64) -> AppResult<Vec<MemberInfo>> {
        let rows = sqlx::query(
            r#"SELECT tm.tenant_id, tm.user_id, tm.role, tm.created_at, tm.updated_at,
                      u.username, u.display_name, u.uuid
               FROM tenant_members tm
               JOIN users u ON u.id = tm.user_id
               WHERE tm.tenant_id = ? ORDER BY tm.created_at"#,
        )
        .bind(tenant_id)
        .fetch_all(&state.pool)
        .await?;
        let members = rows
            .into_iter()
            .map(|r| MemberInfo {
                user_id: r.try_get("user_id").unwrap_or(0),
                username: r.try_get("username").unwrap_or_default(),
                display_name: r.try_get("display_name").unwrap_or_default(),
                uuid: r.try_get("uuid").unwrap_or_default(),
                role: r.try_get("role").unwrap_or_default(),
                created_at: r.try_get("created_at").unwrap_or_default(),
                updated_at: r.try_get("updated_at").unwrap_or_default(),
            })
            .collect();
        Ok(members)
    }

    pub async fn add_member(
        state: &AppState,
        user: &crate::auth::AuthUser,
        tenant_id: i64,
        req: AddMemberRequest,
    ) -> AppResult<MemberInfo> {
        if tenant_id != user.tenant_id {
            Self::require_admin_of(state, user.user_id, tenant_id).await?;
        } else {
            user.require_manage_members()?;
        }
        let role = TenantRole::parse(&req.role)
            .ok_or_else(|| AppError::Validation("invalid role".into()))?;
        let user_row =
            sqlx::query("SELECT id, username, display_name, uuid FROM users WHERE username = ?")
                .bind(req.username.trim())
                .fetch_optional(&state.pool)
                .await?
                .ok_or_else(|| AppError::NotFound)?;
        let target_user_id: i64 = user_row.try_get("id").unwrap_or(0);
        let username: String = user_row.try_get("username").unwrap_or_default();
        let display_name: String = user_row.try_get("display_name").unwrap_or_default();
        let user_uuid: String = user_row.try_get("uuid").unwrap_or_default();

        sqlx::query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (?, ?, ?)")
            .bind(tenant_id)
            .bind(target_user_id)
            .bind(role.as_str())
            .execute(&state.pool)
            .await
            .map_err(|e| match e {
                sqlx::Error::Database(db) if db.code() == Some("2067".into()) => {
                    AppError::Conflict("user already a member".into())
                }
                other => AppError::Internal(anyhow::anyhow!(other)),
            })?;
        Ok(MemberInfo {
            user_id: target_user_id,
            username,
            display_name,
            uuid: user_uuid,
            role: role.as_str().to_string(),
            created_at: crate::auth::extractor::now_iso(),
            updated_at: crate::auth::extractor::now_iso(),
        })
    }

    pub async fn update_member(
        state: &AppState,
        user: &crate::auth::AuthUser,
        tenant_id: i64,
        target_user_id: i64,
        req: UpdateMemberRequest,
    ) -> AppResult<MemberInfo> {
        if tenant_id != user.tenant_id {
            Self::require_admin_of(state, user.user_id, tenant_id).await?;
        } else {
            user.require_manage_members()?;
        }
        let new_role = TenantRole::parse(&req.role)
            .ok_or_else(|| AppError::Validation("invalid role".into()))?;
        // Prevent removing the last owner.
        if new_role != TenantRole::Owner {
            let owner_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM tenant_members WHERE tenant_id = ? AND role = 'owner'",
            )
            .bind(tenant_id)
            .fetch_one(&state.pool)
            .await?;
            let is_target_owner: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND role = 'owner'",
            )
            .bind(tenant_id)
            .bind(target_user_id)
            .fetch_one(&state.pool)
            .await?;
            if is_target_owner > 0 && owner_count <= 1 {
                return Err(AppError::Validation("cannot demote the last owner".into()));
            }
        }
        let res = sqlx::query(
            "UPDATE tenant_members SET role = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ?",
        )
        .bind(new_role.as_str())
        .bind(crate::auth::extractor::now_iso())
        .bind(tenant_id)
        .bind(target_user_id)
        .execute(&state.pool)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        let row = sqlx::query(
            r#"SELECT tm.role, tm.created_at, tm.updated_at, u.username, u.display_name, u.uuid
               FROM tenant_members tm JOIN users u ON u.id = tm.user_id
               WHERE tm.tenant_id = ? AND tm.user_id = ?"#,
        )
        .bind(tenant_id)
        .bind(target_user_id)
        .fetch_one(&state.pool)
        .await?;
        Ok(MemberInfo {
            user_id: target_user_id,
            username: row.try_get("username").unwrap_or_default(),
            display_name: row.try_get("display_name").unwrap_or_default(),
            uuid: row.try_get("uuid").unwrap_or_default(),
            role: row.try_get("role").unwrap_or_default(),
            created_at: row.try_get("created_at").unwrap_or_default(),
            updated_at: row.try_get("updated_at").unwrap_or_default(),
        })
    }

    pub async fn remove_member(
        state: &AppState,
        user: &crate::auth::AuthUser,
        tenant_id: i64,
        target_user_id: i64,
    ) -> AppResult<()> {
        if tenant_id != user.tenant_id {
            Self::require_admin_of(state, user.user_id, tenant_id).await?;
        } else {
            user.require_manage_members()?;
        }
        // Prevent removing the last owner.
        let owner_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tenant_members WHERE tenant_id = ? AND role = 'owner'",
        )
        .bind(tenant_id)
        .fetch_one(&state.pool)
        .await?;
        let is_target_owner: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND role = 'owner'",
        )
        .bind(tenant_id)
        .bind(target_user_id)
        .fetch_one(&state.pool)
        .await?;
        if is_target_owner > 0 && owner_count <= 1 {
            return Err(AppError::Validation("cannot remove the last owner".into()));
        }
        let res = sqlx::query("DELETE FROM tenant_members WHERE tenant_id = ? AND user_id = ?")
            .bind(tenant_id)
            .bind(target_user_id)
            .execute(&state.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn require_member_of(state: &AppState, user_id: i64, tenant_id: i64) -> AppResult<()> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tenant_members WHERE tenant_id = ? AND user_id = ?",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;
        if count == 0 {
            return Err(AppError::Forbidden);
        }
        Ok(())
    }

    async fn require_admin_of(state: &AppState, user_id: i64, tenant_id: i64) -> AppResult<()> {
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM tenant_members WHERE tenant_id = ? AND user_id = ?",
        )
        .bind(tenant_id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?;
        match role.as_deref() {
            Some("owner") | Some("admin") => Ok(()),
            _ => Err(AppError::Forbidden),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct MemberInfo {
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub uuid: String,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
}
