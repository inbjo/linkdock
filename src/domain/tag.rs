use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Tag {
    pub id: i64,
    pub uuid: String,
    pub user_id: i64,
    pub name: String,
    pub normalized_name: String,
    pub created_at: String,
}
