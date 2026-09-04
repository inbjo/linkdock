use crate::auth::AuthUser;
use crate::domain::collection::{Collection, CollectionNode};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use sqlx::Row;

#[derive(Debug, Deserialize)]
pub struct CreateCollectionInput {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCollectionInput {
    pub name: Option<String>,
    pub parent_id: Option<Option<i64>>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<Option<String>>,
}

pub struct CollectionService;

impl CollectionService {
    pub async fn list_flat(state: &AppState, tenant_id: i64) -> AppResult<Vec<Collection>> {
        let cols = sqlx::query_as::<_, Collection>(
            r#"SELECT * FROM collections
               WHERE tenant_id = ? AND deleted_at IS NULL
               ORDER BY parent_id NULLS FIRST, name"#,
        )
        .bind(tenant_id)
        .fetch_all(&state.pool)
        .await?;
        Ok(cols)
    }

    pub async fn get(state: &AppState, tenant_id: i64, id: i64) -> AppResult<Collection> {
        let col = sqlx::query_as::<_, Collection>(
            "SELECT * FROM collections WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        Ok(col)
    }

    pub async fn create(
        state: &AppState,
        user: &AuthUser,
        req: CreateCollectionInput,
    ) -> AppResult<Collection> {
        user.require_write()?;
        let name = req.name.trim().to_string();
        if name.is_empty() || name.len() > 200 {
            return Err(AppError::Validation(
                "collection name length invalid".into(),
            ));
        }
        if let Some(pid) = req.parent_id {
            Self::verify_same_tenant(state, user.tenant_id, pid).await?;
        }
        let uuid_str = uuid::Uuid::new_v4().to_string();
        let col = sqlx::query_as::<_, Collection>(
            r#"INSERT INTO collections (uuid, tenant_id, parent_id, name, description, color, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               RETURNING *"#,
        )
        .bind(&uuid_str)
        .bind(user.tenant_id)
        .bind(req.parent_id)
        .bind(&name)
        .bind(req.description.unwrap_or_default())
        .bind(req.color)
        .bind(user.user_id)
        .fetch_one(&state.pool)
        .await?;
        Ok(col)
    }

    pub async fn update(
        state: &AppState,
        user: &AuthUser,
        id: i64,
        req: UpdateCollectionInput,
    ) -> AppResult<Collection> {
        user.require_write()?;
        let existing = Self::get(state, user.tenant_id, id).await?;
        if let Some(Some(pid)) = req.parent_id {
            if pid == id {
                return Err(AppError::CircularRef);
            }
            Self::verify_same_tenant(state, user.tenant_id, pid).await?;
            if Self::is_descendant(state, user.tenant_id, pid, id).await? {
                return Err(AppError::CircularRef);
            }
        }
        let name = req
            .name
            .map(|s| s.trim().to_string())
            .unwrap_or(existing.name);
        if name.is_empty() || name.len() > 200 {
            return Err(AppError::Validation(
                "collection name length invalid".into(),
            ));
        }
        let parent_id = match req.parent_id {
            Some(v) => v,
            None => existing.parent_id,
        };
        let description = req.description.unwrap_or(existing.description);
        let color = match req.color {
            Some(v) => v,
            None => existing.color,
        };
        let col = sqlx::query_as::<_, Collection>(
            r#"UPDATE collections
               SET name = ?, parent_id = ?, description = ?, color = ?, updated_at = ?
               WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
               RETURNING *"#,
        )
        .bind(&name)
        .bind(parent_id)
        .bind(&description)
        .bind(&color)
        .bind(crate::auth::extractor::now_iso())
        .bind(id)
        .bind(user.tenant_id)
        .fetch_one(&state.pool)
        .await?;
        Ok(col)
    }

    /// Soft delete a collection and all descendants (and their links).
    pub async fn delete(state: &AppState, user: &AuthUser, id: i64) -> AppResult<()> {
        user.require_write()?;
        // Verify ownership.
        let _ = Self::get(state, user.tenant_id, id).await?;
        let now = crate::auth::extractor::now_iso();
        let mut tx = state.pool.begin().await?;
        let descendants = Self::collect_descendants(&mut tx, user.tenant_id, id).await?;
        let mut all_ids = vec![id];
        all_ids.extend(descendants);
        let placeholders = all_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "UPDATE collections SET deleted_at = ?, updated_at = ? WHERE tenant_id = ? AND id IN ({}) AND deleted_at IS NULL",
            placeholders
        );
        let mut q = sqlx::query(&sql).bind(&now).bind(&now).bind(user.tenant_id);
        for id in &all_ids {
            q = q.bind(id);
        }
        q.execute(&mut *tx).await?;
        // Soft delete links in those collections.
        let link_sql = format!(
            "UPDATE links SET deleted_at = ?, updated_at = ? WHERE tenant_id = ? AND collection_id IN ({}) AND deleted_at IS NULL",
            placeholders
        );
        let mut lq = sqlx::query(&link_sql)
            .bind(&now)
            .bind(&now)
            .bind(user.tenant_id);
        for id in &all_ids {
            lq = lq.bind(id);
        }
        lq.execute(&mut *tx).await?;
        // Remove from FTS.
        for cid in &all_ids {
            let _ = sqlx::query("DELETE FROM links_fts WHERE link_id IN (SELECT id FROM links WHERE collection_id = ?)")
                .bind(cid)
                .execute(&mut *tx)
                .await;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn tree(state: &AppState, tenant_id: i64) -> AppResult<Vec<CollectionNode>> {
        let cols = Self::list_flat(state, tenant_id).await?;
        Ok(build_tree(&cols))
    }

    async fn verify_same_tenant(state: &AppState, tenant_id: i64, parent_id: i64) -> AppResult<()> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM collections WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL",
        )
        .bind(parent_id)
        .bind(tenant_id)
        .fetch_one(&state.pool)
        .await?;
        if count == 0 {
            return Err(AppError::Validation("parent collection not found".into()));
        }
        Ok(())
    }

    /// Check if `ancestor_id` is a descendant of `id` (i.e. moving `id` under
    /// `ancestor_id` would create a cycle).
    async fn is_descendant(
        state: &AppState,
        tenant_id: i64,
        ancestor_id: i64,
        id: i64,
    ) -> AppResult<bool> {
        let cols = Self::list_flat(state, tenant_id).await?;
        let mut children_map: std::collections::HashMap<Option<i64>, Vec<i64>> =
            std::collections::HashMap::new();
        for c in &cols {
            children_map.entry(c.parent_id).or_default().push(c.id);
        }
        // BFS from id; if we reach ancestor_id, then ancestor_id is a descendant of id.
        let mut queue = vec![id];
        while let Some(cur) = queue.pop() {
            if let Some(children) = children_map.get(&Some(cur)) {
                for child in children {
                    if *child == ancestor_id {
                        return Ok(true);
                    }
                    queue.push(*child);
                }
            }
        }
        Ok(false)
    }

    async fn collect_descendants(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        tenant_id: i64,
        id: i64,
    ) -> AppResult<Vec<i64>> {
        let rows = sqlx::query(
            "SELECT id, parent_id FROM collections WHERE tenant_id = ? AND deleted_at IS NULL",
        )
        .bind(tenant_id)
        .fetch_all(&mut **tx)
        .await?;
        let mut children_map: std::collections::HashMap<Option<i64>, Vec<i64>> =
            std::collections::HashMap::new();
        for r in rows {
            let cid: i64 = r.try_get("id").unwrap_or(0);
            let pid: Option<i64> = r.try_get("parent_id").ok().flatten();
            children_map.entry(pid).or_default().push(cid);
        }
        let mut result = Vec::new();
        let mut queue = vec![id];
        while let Some(cur) = queue.pop() {
            if let Some(children) = children_map.get(&Some(cur)) {
                for child in children {
                    result.push(*child);
                    queue.push(*child);
                }
            }
        }
        Ok(result)
    }
}

pub fn build_tree(cols: &[Collection]) -> Vec<CollectionNode> {
    let mut children_map: std::collections::HashMap<Option<i64>, Vec<&Collection>> =
        std::collections::HashMap::new();
    for c in cols {
        children_map.entry(c.parent_id).or_default().push(c);
    }
    fn build_node(
        c: &Collection,
        map: &std::collections::HashMap<Option<i64>, Vec<&Collection>>,
    ) -> CollectionNode {
        let children = map
            .get(&Some(c.id))
            .map(|v| v.iter().map(|ch| build_node(ch, map)).collect())
            .unwrap_or_default();
        CollectionNode {
            id: c.id,
            name: c.name.clone(),
            parent_id: c.parent_id,
            description: c.description.clone(),
            color: c.color.clone(),
            children,
        }
    }
    children_map
        .get(&None)
        .map(|roots| {
            let mut nodes: Vec<CollectionNode> =
                roots.iter().map(|c| build_node(c, &children_map)).collect();
            nodes.sort_by(|a, b| a.name.cmp(&b.name));
            nodes
        })
        .unwrap_or_default()
}
