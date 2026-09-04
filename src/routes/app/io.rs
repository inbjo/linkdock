use crate::auth::{AuthContext, AuthWriter};
use crate::error::{AppError, AppResult};
use crate::services::io::import::{ImportConfirm, ImportPreview, ImportResult, ImportService, ParsedBookmark};
use crate::state::AppState;
use axum::body::Body;
use axum::extract::{Multipart, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/import/parse", post(parse_import))
        .route("/import/preview", post(preview_import))
        .route("/import/execute", post(execute_import))
        .route("/import/upload", post(upload_import))
        .route("/export/html", get(export_html))
        .route("/export/json", get(export_json))
        .route("/export/csv", get(export_csv))
        .route("/export/xbel", get(export_xbel))
}

#[derive(Deserialize)]
struct ParseRequest {
    format: String,
    content: String,
}

async fn parse_import(
    _auth: AuthContext,
    Json(req): Json<ParseRequest>,
) -> AppResult<Json<Vec<ParsedBookmark>>> {
    let bookmarks = ImportService::parse(&req.format, &req.content)?;
    Ok(Json(bookmarks))
}

async fn preview_import(
    _auth: AuthContext,
    Json(req): Json<ParseRequest>,
) -> AppResult<Json<ImportPreview>> {
    let bookmarks = ImportService::parse(&req.format, &req.content)?;
    let preview = ImportService::preview(&req.format, &bookmarks);
    Ok(Json(preview))
}

async fn execute_import(
    State(state): State<AppState>,
    auth: AuthWriter,
    Json(req): Json<ImportConfirm>,
) -> AppResult<Json<ImportResult>> {
    let result = ImportService::execute(&state, &auth.0, req).await?;
    Ok(Json(result))
}

/// Upload a file and get a preview in one step.
async fn upload_import(
    State(state): State<AppState>,
    auth: AuthContext,
    mut multipart: Multipart,
) -> AppResult<Json<serde_json::Value>> {
    auth.0.require_write()?;
    let max_size = state.config.max_upload_mb * 1024 * 1024;
    let mut format = String::from("html");
    let mut content = String::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("multipart error: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "format" {
            format = field.text().await.unwrap_or_default();
        } else if name == "file" {
            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::Validation(format!("read error: {}", e)))?;
            if data.len() > max_size {
                return Err(AppError::Validation(format!(
                    "file too large (max {}MB)",
                    state.config.max_upload_mb
                )));
            }
            content = String::from_utf8_lossy(&data).to_string();
        }
    }

    if content.is_empty() {
        return Err(AppError::Validation("no file uploaded".into()));
    }

    let bookmarks = ImportService::parse(&format, &content)?;
    let preview = ImportService::preview(&format, &bookmarks);
    Ok(Json(json!({
        "preview": preview,
        "bookmarks": bookmarks,
    })))
}

#[derive(Deserialize)]
struct ExportQuery {
    collection_id: Option<i64>,
}

async fn export_html(
    State(state): State<AppState>,
    auth: AuthContext,
    Query(q): Query<ExportQuery>,
) -> AppResult<Response> {
    let html = crate::services::io::export::export_html(&state, auth.0.tenant_id, q.collection_id).await?;
    Ok(download_response("bookmarks.html", "text/html", html))
}

async fn export_json(
    State(state): State<AppState>,
    auth: AuthContext,
    _q: Query<ExportQuery>,
) -> AppResult<Response> {
    let json = crate::services::io::export::export_json(&state, auth.0.tenant_id).await?;
    Ok(download_response("bookmarks.json", "application/json", json))
}

async fn export_csv(
    State(state): State<AppState>,
    auth: AuthContext,
    _q: Query<ExportQuery>,
) -> AppResult<Response> {
    let csv = crate::services::io::export::export_csv(&state, auth.0.tenant_id).await?;
    Ok(download_response("bookmarks.csv", "text/csv", csv))
}

async fn export_xbel(
    State(state): State<AppState>,
    auth: AuthContext,
    _q: Query<ExportQuery>,
) -> AppResult<Response> {
    let xbel = crate::services::io::export::export_xbel(&state, auth.0.tenant_id).await?;
    Ok(download_response("bookmarks.xbel", "application/xml", xbel))
}

fn download_response(filename: &str, mime: &str, body: String) -> Response {
    let cd = format!("attachment; filename=\"{}\"", filename);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_str(mime).unwrap())
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&cd).unwrap(),
        )
        .body(Body::from(body))
        .unwrap()
}
