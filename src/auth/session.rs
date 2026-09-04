use crate::auth::extractor::now_iso;
use crate::auth::token;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use sqlx::Row;

pub struct SessionService;

impl SessionService {
    pub async fn create(
        state: &AppState,
        user_id: i64,
        tenant_id: i64,
    ) -> AppResult<(String, i64)> {
        let raw = token::generate_session_token();
        let hash = token::hash_session_token(&raw);
        let expires_at = future_iso(state.config.session_ttl_hours);
        let row = sqlx::query(
            "INSERT INTO sessions (session_hash, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .bind(&hash)
        .bind(user_id)
        .bind(tenant_id)
        .bind(&expires_at)
        .fetch_one(&state.pool)
        .await?;
        let id: i64 = row.try_get("id").unwrap_or(0);
        Ok((raw, id))
    }

    pub async fn destroy(state: &AppState, raw_token: &str) -> AppResult<()> {
        let hash = token::hash_session_token(raw_token);
        sqlx::query("DELETE FROM sessions WHERE session_hash = ?")
            .bind(&hash)
            .execute(&state.pool)
            .await?;
        Ok(())
    }

    pub async fn destroy_by_id(state: &AppState, session_id: i64, user_id: i64) -> AppResult<()> {
        let res = sqlx::query("DELETE FROM sessions WHERE id = ? AND user_id = ?")
            .bind(session_id)
            .bind(user_id)
            .execute(&state.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn destroy_all_for_user(state: &AppState, user_id: i64) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE user_id = ?")
            .bind(user_id)
            .execute(&state.pool)
            .await?;
        Ok(())
    }

    pub async fn set_active_tenant(
        state: &AppState,
        raw_token: &str,
        tenant_id: i64,
    ) -> AppResult<()> {
        let hash = token::hash_session_token(raw_token);
        let res = sqlx::query("UPDATE sessions SET active_tenant_id = ? WHERE session_hash = ?")
            .bind(tenant_id)
            .bind(&hash)
            .execute(&state.pool)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::Unauthorized);
        }
        Ok(())
    }
}

pub fn future_iso(hours: i64) -> String {
    use time::Duration;
    let dt = time::OffsetDateTime::now_utc() + Duration::hours(hours);
    dt.format(&time::format_description::well_known::Iso8601::DEFAULT)
        .unwrap_or_else(|_| String::new())
}

pub fn _now_iso() -> String {
    now_iso()
}
