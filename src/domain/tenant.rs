use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Tenant {
    pub id: i64,
    pub uuid: String,
    pub name: String,
    pub slug: String,
    pub created_by: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TenantMember {
    pub tenant_id: i64,
    pub user_id: i64,
    pub role: String,
    pub created_at: String,
    pub updated_at: String,
}
