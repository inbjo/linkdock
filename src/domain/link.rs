use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Link {
    pub id: i64,
    pub uuid: String,
    pub tenant_id: i64,
    pub collection_id: i64,
    pub url: String,
    pub name: String,
    pub description: String,
    pub position: i64,
    pub created_by: i64,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkWithTags {
    #[serde(flatten)]
    pub link: Link,
    pub tags: Vec<String>,
}
