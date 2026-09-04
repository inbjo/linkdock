use axum::body::Body;
use axum::http::{Request, Response};
use axum::middleware::Next;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(1);

/// Header name for the request ID.
pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// Axum middleware that generates or propagates a request ID for every request.
/// The ID is set on the request headers and on the response headers.
pub async fn request_id_middleware(mut req: Request<Body>, next: Next) -> Response<Body> {
    let request_id = req
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            format!("req-{}", n)
        });

    if let Ok(val) = axum::http::HeaderValue::from_str(&request_id) {
        req.headers_mut().insert(REQUEST_ID_HEADER, val);
    }

    let span = tracing::info_span!("request", request_id = %request_id);
    let mut response = span.in_scope(|| async { next.run(req).await }).await;

    if let Ok(val) = axum::http::HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(REQUEST_ID_HEADER, val);
    }

    response
}
