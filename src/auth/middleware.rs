use crate::auth::AuthContext;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;

/// Middleware-like extractor: requires system admin.
#[derive(Debug, Clone)]
pub struct RequireSystemAdmin(pub AuthContext);

impl FromRequestParts<AppState> for RequireSystemAdmin {
    type Rejection = AppError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ctx = AuthContext::from_request_parts(parts, state).await?;
        ctx.0.require_system_admin()?;
        Ok(RequireSystemAdmin(ctx))
    }
}

/// Extractor that requires the user to be an owner of the active tenant.
#[derive(Debug, Clone)]
pub struct RequireOwner(pub AuthContext);

impl FromRequestParts<AppState> for RequireOwner {
    type Rejection = AppError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let ctx = AuthContext::from_request_parts(parts, state).await?;
        if ctx.0.tenant_role != crate::auth::TenantRole::Owner {
            return Err(AppError::Forbidden);
        }
        Ok(RequireOwner(ctx))
    }
}
