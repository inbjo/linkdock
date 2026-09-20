use crate::{error::AppError, state::AppState};
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderValue, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{net::SocketAddr, time::Duration};

/// Reject disallowed browser origins before handlers run (CORS alone only
/// prevents reading responses). Non-browser WebDAV clients omit Origin.
pub async fn security(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let sensitive =
        req.uri().path().starts_with("/api/") || req.uri().path().starts_with("/webdav");
    let allowed = match req.headers().get(header::ORIGIN) {
        Some(origin) => origin.to_str().is_ok_and(|origin| {
            origin == state.config.public_url_origin()
                || state
                    .config
                    .cors_origins
                    .iter()
                    .any(|allowed| allowed == origin)
        }),
        None => req
            .headers()
            .get("sec-fetch-site")
            .is_none_or(|site| site != "cross-site"),
    };
    let auth_attempt = req.method() == Method::POST
        && req.uri().path().starts_with("/api/app/v1/auth/")
        && !req.uri().path().ends_with("/logout");
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| peer.0.ip().to_string())
        .unwrap_or_else(|| "local".into());
    let mut response = if sensitive && !allowed {
        AppError::Forbidden.into_response()
    } else if auth_attempt && !admit_auth(&state, peer).await {
        let mut response = AppError::RateLimited.into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        response
    } else {
        next.run(req).await
    };
    let headers = response.headers_mut();
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("x-permitted-cross-domain-policies", "none"),
        ("referrer-policy", "no-referrer"),
        ("cross-origin-opener-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
        ("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)"),
        ("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    if state.config.public_url.starts_with("https://") {
        headers.insert(
            "strict-transport-security",
            HeaderValue::from_static("max-age=31536000"),
        );
    }
    if sensitive {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response
}

async fn admit_auth(state: &AppState, peer: String) -> bool {
    // Trust the socket peer, never an arbitrary X-Forwarded-For header.
    // Reverse proxy deployments share a bucket and should also limit at the edge.
    let now = tokio::time::Instant::now();
    let mut buckets = state.auth_attempts.lock().await;
    buckets.retain(|_, (start, _)| now.duration_since(*start) < Duration::from_secs(60));
    if !buckets.contains_key(&peer) && buckets.len() >= 4096 {
        return false;
    }
    let (_, count) = buckets.entry(peer).or_insert((now, 0));
    if *count >= 30 {
        return false;
    }
    *count += 1;
    true
}
