use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: i64,
    pub uuid: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub display_name: String,
    pub is_system_admin: i64,
    pub disabled: i64,
    pub created_at: String,
    pub updated_at: String,
}
