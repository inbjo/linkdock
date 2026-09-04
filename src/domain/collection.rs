use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Collection {
    pub id: i64,
    pub uuid: String,
    pub tenant_id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub position: i64,
    pub created_by: i64,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionNode {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub description: String,
    pub color: Option<String>,
    pub children: Vec<CollectionNode>,
}
