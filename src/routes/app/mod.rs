pub mod auth;
pub mod collection;
pub mod link;
pub mod tag;
pub mod tenant;
pub mod token;

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(tenant::router())
        .merge(collection::router())
        .merge(link::router())
        .merge(tag::router())
        .merge(token::router())
}
