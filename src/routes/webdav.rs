use axum::body::{to_bytes, Body};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, Request, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;
use base64::Engine;
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::services::bookmark::BookmarkService;
use crate::state::AppState;

const LOCK_TTL_SECONDS: i64 = 5 * 60;

pub fn router() -> Router<AppState> {
    // Routes are declared with the full `/webdav` prefix and merged into the
    // application router (rather than nested) so that the collection URL
    // `/webdav/` (with trailing slash, as used by Floccus) is matched directly.
    // axum 0.8 `nest` maps an inner `/` route to the prefix without a trailing
    // slash, which would let `/webdav/` fall through to the SPA fallback.
    Router::new()
        .route("/webdav", any(handle_root))
        .route("/webdav/", any(handle_root))
        .route("/webdav/{*path}", any(handle))
}

async fn handle_root(State(state): State<AppState>, req: Request<Body>) -> Response<Body> {
    if authenticate(req.headers(), &state).await.is_err() {
        return unauthorized();
    }
    match req.method().as_str() {
        "GET" | "HEAD" => status(StatusCode::OK),
        "PROPFIND" => {
            let xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
                       <d:multistatus xmlns:d=\"DAV:\"><d:response><d:href>/webdav/</d:href>\
                       <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>\
                       <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>";
            Response::builder()
                .status(StatusCode::MULTI_STATUS)
                .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
                .header(header::CONTENT_LENGTH, xml.len())
                .body(Body::from(xml))
                .unwrap()
        }
        _ => status(StatusCode::METHOD_NOT_ALLOWED),
    }
}

async fn handle(
    State(state): State<AppState>,
    Path(path): Path<String>,
    req: Request<Body>,
) -> Response<Body> {
    let path = match normalize_path(&path) {
        Some(path) => path,
        None => return status(StatusCode::BAD_REQUEST),
    };
    let user = match authenticate(req.headers(), &state).await {
        Ok(user) => user,
        Err(()) => return unauthorized(),
    };
    let method = req.method().clone();
    match method.as_str() {
        "GET" => get_resource(&state, &user, &path, false).await,
        "HEAD" => get_resource(&state, &user, &path, true).await,
        "PROPFIND" => propfind(&state, &user, &path).await,
        "PUT" => put_resource(state, user, path, req).await,
        "DELETE" => delete_resource(&state, &user, &path).await,
        "MOVE" => move_resource(&state, &user, &path, req.headers()).await,
        _ => status(StatusCode::METHOD_NOT_ALLOWED),
    }
}

async fn authenticate(headers: &HeaderMap, state: &AppState) -> Result<AuthUser, ()> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(())?;
    let encoded = value.strip_prefix("Basic ").ok_or(())?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|_| ())?;
    let credentials = String::from_utf8(decoded).map_err(|_| ())?;
    let (_, token) = credentials.split_once(':').ok_or(())?;
    crate::auth::extractor::resolve_token_auth(token, state)
        .await
        .map_err(|_| ())
}

async fn get_resource(
    state: &AppState,
    user: &AuthUser,
    path: &str,
    head_only: bool,
) -> Response<Body> {
    if let Some(lock_path) = path.strip_suffix(".lock") {
        return get_lock(state, user, lock_path, head_only).await;
    }
    if path.ends_with(".temp") {
        return get_staging(state, user, path, head_only).await;
    }
    match BookmarkService::serialize_xbel(state, user.user_id, path).await {
        Ok((content, updated_at)) => file_response(
            "application/xml; charset=utf-8",
            content.len(),
            updated_at,
            if head_only { Vec::new() } else { content },
        ),
        Err(AppError::NotFound) => status(StatusCode::NOT_FOUND),
        Err(error) => error.into_response(),
    }
}

async fn get_staging(
    state: &AppState,
    user: &AuthUser,
    path: &str,
    head_only: bool,
) -> Response<Body> {
    let row = match sqlx::query(
        r#"SELECT content, content_type, updated_at FROM webdav_staging
           WHERE user_id = ? AND path = ? AND owner_token_id = ?"#,
    )
    .bind(user.user_id)
    .bind(path)
    .bind(user.token_id.unwrap_or_default())
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return status(StatusCode::NOT_FOUND),
        Err(error) => return database_error(error),
    };
    let content: Vec<u8> = row.get("content");
    let content_type: String = row.get("content_type");
    let updated_at: i64 = row.get("updated_at");
    file_response(
        &content_type,
        content.len(),
        updated_at,
        if head_only { Vec::new() } else { content },
    )
}

async fn get_lock(
    state: &AppState,
    user: &AuthUser,
    document_path: &str,
    head_only: bool,
) -> Response<Body> {
    let row = match sqlx::query("SELECT updated_at FROM sync_locks WHERE user_id = ? AND path = ?")
        .bind(user.user_id)
        .bind(document_path)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return status(StatusCode::NOT_FOUND),
        Err(error) => return database_error(error),
    };
    let updated_at: i64 = row.get("updated_at");
    if lock_expired(updated_at) {
        let _ = sqlx::query("DELETE FROM sync_locks WHERE user_id = ? AND path = ?")
            .bind(user.user_id)
            .bind(document_path)
            .execute(&state.pool)
            .await;
        return status(StatusCode::NOT_FOUND);
    }
    let content = b"Linkdock Floccus lock".to_vec();
    file_response(
        "text/plain; charset=utf-8",
        content.len(),
        updated_at,
        if head_only { Vec::new() } else { content },
    )
}

async fn propfind(state: &AppState, user: &AuthUser, path: &str) -> Response<Body> {
    let response = get_resource(state, user, path, false).await;
    if response.status() != StatusCode::OK {
        return response;
    }
    let size = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("0");
    let modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("Thu, 01 Jan 1970 00:00:00 GMT");
    let href = format!("/webdav/{}", xml_escape(path));
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <d:multistatus xmlns:d=\"DAV:\"><d:response><d:href>{href}</d:href>\
         <d:propstat><d:prop><d:getcontentlength>{size}</d:getcontentlength>\
         <d:getlastmodified>{modified}</d:getlastmodified></d:prop>\
         <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"
    );
    Response::builder()
        .status(StatusCode::MULTI_STATUS)
        .header(header::CONTENT_TYPE, "application/xml; charset=utf-8")
        .header(header::CONTENT_LENGTH, xml.len())
        .body(Body::from(xml))
        .unwrap()
}

async fn put_resource(
    state: AppState,
    user: AuthUser,
    path: String,
    req: Request<Body>,
) -> Response<Body> {
    if user.require_write().is_err() {
        return status(StatusCode::FORBIDDEN);
    }
    let token_id = match user.token_id {
        Some(id) => id,
        None => return status(StatusCode::FORBIDDEN),
    };
    let content_type = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/xml")
        .to_string();
    let limit = state.config.max_upload_mb.saturating_mul(1024 * 1024);
    let content = match to_bytes(req.into_body(), limit).await {
        Ok(content) => content,
        Err(_) => return status(StatusCode::PAYLOAD_TOO_LARGE),
    };

    if let Some(document_path) = path.strip_suffix(".lock") {
        return put_lock(&state, &user, document_path, token_id).await;
    }
    if path.ends_with(".temp") {
        let document_path = path.trim_end_matches(".temp");
        if !owns_lock(&state, &user, document_path, token_id).await {
            return status(StatusCode::LOCKED);
        }
        let result = sqlx::query(
            r#"INSERT INTO webdav_staging
               (user_id, path, owner_token_id, content, content_type, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, path, owner_token_id) DO UPDATE SET
                 content = excluded.content,
                 content_type = excluded.content_type,
                 updated_at = excluded.updated_at"#,
        )
        .bind(user.user_id)
        .bind(path)
        .bind(token_id)
        .bind(content.as_ref())
        .bind(content_type)
        .bind(unix_now())
        .execute(&state.pool)
        .await;
        return match result {
            Ok(_) => status(StatusCode::CREATED),
            Err(error) => database_error(error),
        };
    }
    if !path.to_ascii_lowercase().ends_with(".xbel") {
        return status(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    if !owns_lock(&state, &user, &path, token_id).await {
        return status(StatusCode::LOCKED);
    }
    match BookmarkService::replace_from_xbel(&state, &user, &path, &content).await {
        Ok(_) => status(StatusCode::NO_CONTENT),
        Err(error) => error.into_response(),
    }
}

async fn put_lock(
    state: &AppState,
    user: &AuthUser,
    document_path: &str,
    token_id: i64,
) -> Response<Body> {
    match sqlx::query(
        r#"INSERT INTO sync_locks (user_id, path, owner_token_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, path) DO UPDATE SET
             owner_token_id = excluded.owner_token_id, updated_at = excluded.updated_at
           WHERE sync_locks.owner_token_id = excluded.owner_token_id
              OR sync_locks.updated_at < ?"#,
    )
    .bind(user.user_id)
    .bind(document_path)
    .bind(token_id)
    .bind(unix_now())
    .bind(unix_now() - LOCK_TTL_SECONDS)
    .execute(&state.pool)
    .await
    {
        Ok(result) if result.rows_affected() > 0 => status(StatusCode::CREATED),
        Ok(_) => status(StatusCode::LOCKED),
        Err(error) => database_error(error),
    }
}

async fn delete_resource(state: &AppState, user: &AuthUser, path: &str) -> Response<Body> {
    if user.require_write().is_err() {
        return status(StatusCode::FORBIDDEN);
    }
    let token_id = user.token_id.unwrap_or_default();
    if let Some(document_path) = path.strip_suffix(".lock") {
        let result = sqlx::query(
            r#"DELETE FROM sync_locks WHERE user_id = ? AND path = ?
               AND (owner_token_id = ? OR updated_at < ?)"#,
        )
        .bind(user.user_id)
        .bind(document_path)
        .bind(token_id)
        .bind(unix_now() - LOCK_TTL_SECONDS)
        .execute(&state.pool)
        .await;
        return match result {
            Ok(result) if result.rows_affected() > 0 => status(StatusCode::NO_CONTENT),
            Ok(_) => status(StatusCode::LOCKED),
            Err(error) => database_error(error),
        };
    }
    if path.ends_with(".temp") {
        return match sqlx::query(
            "DELETE FROM webdav_staging WHERE user_id = ? AND path = ? AND owner_token_id = ?",
        )
        .bind(user.user_id)
        .bind(path)
        .bind(token_id)
        .execute(&state.pool)
        .await
        {
            Ok(result) if result.rows_affected() > 0 => status(StatusCode::NO_CONTENT),
            Ok(_) => status(StatusCode::NOT_FOUND),
            Err(error) => database_error(error),
        };
    }
    if !owns_lock(state, user, path, token_id).await {
        return status(StatusCode::LOCKED);
    }
    match sqlx::query("DELETE FROM sync_documents WHERE user_id = ? AND path = ?")
        .bind(user.user_id)
        .bind(path)
        .execute(&state.pool)
        .await
    {
        Ok(result) if result.rows_affected() > 0 => status(StatusCode::NO_CONTENT),
        Ok(_) => status(StatusCode::NOT_FOUND),
        Err(error) => database_error(error),
    }
}

async fn move_resource(
    state: &AppState,
    user: &AuthUser,
    source: &str,
    headers: &HeaderMap,
) -> Response<Body> {
    if user.require_write().is_err() || !source.ends_with(".temp") {
        return status(StatusCode::FORBIDDEN);
    }
    let token_id = user.token_id.unwrap_or_default();
    let destination = match headers
        .get("destination")
        .and_then(|value| value.to_str().ok())
        .and_then(destination_path)
        .filter(|path| path.to_ascii_lowercase().ends_with(".xbel"))
    {
        Some(path) => path,
        None => return status(StatusCode::BAD_REQUEST),
    };
    if !owns_lock(state, user, &destination, token_id).await {
        return status(StatusCode::LOCKED);
    }
    let content: Vec<u8> = match sqlx::query_scalar(
        r#"SELECT content FROM webdav_staging
           WHERE user_id = ? AND path = ? AND owner_token_id = ?"#,
    )
    .bind(user.user_id)
    .bind(source)
    .bind(token_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(content)) => content,
        Ok(None) => return status(StatusCode::NOT_FOUND),
        Err(error) => return database_error(error),
    };
    if let Err(error) =
        BookmarkService::replace_from_xbel(state, user, &destination, &content).await
    {
        return error.into_response();
    }
    if let Err(error) = sqlx::query(
        "DELETE FROM webdav_staging WHERE user_id = ? AND path = ? AND owner_token_id = ?",
    )
    .bind(user.user_id)
    .bind(source)
    .bind(token_id)
    .execute(&state.pool)
    .await
    {
        return database_error(error);
    }
    status(StatusCode::NO_CONTENT)
}

async fn owns_lock(state: &AppState, user: &AuthUser, path: &str, token_id: i64) -> bool {
    match sqlx::query(
        "SELECT owner_token_id, updated_at FROM sync_locks WHERE user_id = ? AND path = ?",
    )
    .bind(user.user_id)
    .bind(path)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(None) => true,
        Ok(Some(row)) => {
            row.get::<i64, _>("owner_token_id") == token_id || lock_expired(row.get("updated_at"))
        }
        Err(_) => false,
    }
}

fn destination_path(value: &str) -> Option<String> {
    let path = url::Url::parse(value)
        .map(|url| url.path().to_string())
        .unwrap_or_else(|_| value.to_string());
    let encoded = path.strip_prefix("/webdav/")?;
    normalize_path(&percent_decode(encoded)?)
}

fn normalize_path(path: &str) -> Option<String> {
    let path = path.trim_matches('/');
    if path.is_empty()
        || path.len() > 1024
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    Some(path.to_string())
}

fn file_response(
    content_type: &str,
    content_length: usize,
    updated_at: i64,
    content: Vec<u8>,
) -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::LAST_MODIFIED, format_http_date(updated_at))
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(content))
        .unwrap()
}

fn lock_expired(updated_at: i64) -> bool {
    updated_at < unix_now() - LOCK_TTL_SECONDS
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn format_http_date(timestamp: i64) -> String {
    let date = time::OffsetDateTime::from_unix_timestamp(timestamp.max(0)).unwrap_or_else(|_| {
        time::OffsetDateTime::from_unix_timestamp(0).expect("Unix epoch is valid")
    });
    let weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        [date.weekday().number_days_from_monday() as usize];
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ][date.month() as usize - 1];
    format!(
        "{weekday}, {:02} {month} {:04} {:02}:{:02}:{:02} GMT",
        date.day(),
        date.year(),
        date.hour(),
        date.minute(),
        date.second()
    )
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_digit(*bytes.get(index + 1)?)?;
            let low = hex_digit(*bytes.get(index + 2)?)?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn unauthorized() -> Response<Body> {
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Basic realm=\"Linkdock WebDAV\""),
        )
        .body(Body::empty())
        .unwrap()
}

fn status(code: StatusCode) -> Response<Body> {
    code.into_response()
}

fn database_error(error: sqlx::Error) -> Response<Body> {
    tracing::error!(error = ?error, "WebDAV database error");
    status(StatusCode::INTERNAL_SERVER_ERROR)
}
