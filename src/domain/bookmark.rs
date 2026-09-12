use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SyncDocument {
    pub id: i64,
    pub uuid: String,
    pub user_id: i64,
    pub path: String,
    pub title: String,
    pub revision: i64,
    pub next_external_id: i64,
    pub updated_unix: i64,
    pub created_by: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct BookmarkNode {
    pub id: i64,
    pub uuid: String,
    pub document_id: i64,
    pub user_id: i64,
    pub parent_id: Option<i64>,
    pub node_type: String,
    pub external_id: String,
    pub title: String,
    pub url: Option<String>,
    pub description: String,
    pub color: Option<String>,
    pub position: i64,
    pub created_by: i64,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookmarkTreeNode {
    #[serde(flatten)]
    pub node: BookmarkNode,
    pub tags: Vec<String>,
    pub children: Vec<BookmarkTreeNode>,
}
