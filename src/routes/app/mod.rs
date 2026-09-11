pub mod admin;
pub mod auth;
pub mod bookmark;
pub mod passkey;
pub mod tag;
pub mod tenant;
pub mod token;

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(bookmark::router())
        .merge(tenant::router())
        .merge(passkey::router())
        .merge(tag::router())
        .merge(token::router())
        .nest("/admin", admin::router())
}
