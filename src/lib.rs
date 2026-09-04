pub mod auth;
pub mod config;
pub mod db;
pub mod domain;
pub mod error;
pub mod middleware;
pub mod routes;
pub mod services;
pub mod state;
pub mod web_assets;

#[cfg(feature = "test-support")]
pub mod test_support;

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::middleware::from_fn;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use axum::extract::State;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

pub fn build_router(state: state::AppState) -> Router {
    // CORS: allow all origins but with explicit headers (credentials + wildcard
    // headers is not allowed by the CORS spec).
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::COOKIE,
            header::ACCEPT,
        ])
        .allow_credentials(true);

    let app_state = state.clone();

    Router::new()
        .route("/health/live", get(|| async { "ok" }))
        .route("/health/ready", get(health_ready))
        .route("/metrics", get(metrics))
        .nest("/api/app/v1", routes::app::router())
        .nest("/api/v1", routes::linkwarden::router())
        .fallback(spa_fallback)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(from_fn(middleware::request_id::request_id_middleware))
        .with_state(app_state)
}

async fn health_ready(State(state): State<state::AppState>) -> impl IntoResponse {
    match sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => (StatusCode::OK, "ready"),
        Err(e) => {
            tracing::error!(error = ?e, "health check failed");
            (StatusCode::SERVICE_UNAVAILABLE, "not ready")
        }
    }
}

/// Prometheus-compatible metrics endpoint.
async fn metrics(State(state): State<state::AppState>) -> String {
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    let tenants: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tenants")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM links WHERE deleted_at IS NULL")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    let collections: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

    format!(
        "# HELP linkwarden_users_total Total number of registered users.\n\
         # TYPE linkwarden_users_total gauge\n\
         linkwarden_users_total {users}\n\
         # HELP linkwarden_tenants_total Total number of workspaces.\n\
         # TYPE linkwarden_tenants_total gauge\n\
         linkwarden_tenants_total {tenants}\n\
         # HELP linkwarden_links_total Total number of active bookmarks.\n\
         # TYPE linkwarden_links_total gauge\n\
         linkwarden_links_total {links}\n\
         # HELP linkwarden_collections_total Total number of active collections.\n\
         # TYPE linkwarden_collections_total gauge\n\
         linkwarden_collections_total {collections}\n\
         # HELP linkwarden_active_sessions Total number of active sessions.\n\
         # TYPE linkwarden_active_sessions gauge\n\
         linkwarden_active_sessions {sessions}\n"
    )
}

async fn spa_fallback(req: Request<Body>) -> Response {
    let path = req.uri().path();

    if path.starts_with("/api/") {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":{"code":"not_found","message":"unknown api path"}}"#,
        )
            .into_response();
    }

    let asset_path = path.trim_start_matches('/');
    if !asset_path.is_empty() {
        if let Some((data, mime)) = web_assets::serve_asset(asset_path) {
            return Response::builder()
                .status(StatusCode::OK)
                .header(
                    header::CONTENT_TYPE,
                    HeaderValue::from_str(&mime)
                        .unwrap_or(HeaderValue::from_static("application/octet-stream")),
                )
                .header(header::CACHE_CONTROL, "public, max-age=3600")
                .body(Body::from(data))
                .unwrap();
        }
    }

    if let Some(index) = web_assets::serve_index() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(index))
            .unwrap();
    }

    (StatusCode::NOT_FOUND, "not found").into_response()
}
