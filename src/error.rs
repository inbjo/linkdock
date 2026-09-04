use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,
    #[error("forbidden")]
    Forbidden,
    #[error("unauthorized")]
    Unauthorized,
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("validation: {0}")]
    Validation(String),
    #[error("rate limited")]
    RateLimited,
    #[error("circular collection reference")]
    CircularRef,
    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Validation(_) => StatusCode::BAD_REQUEST,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::CircularRef => StatusCode::BAD_REQUEST,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound => "not_found",
            AppError::Forbidden => "forbidden",
            AppError::Unauthorized => "unauthorized",
            AppError::Conflict(_) => "conflict",
            AppError::Validation(_) => "validation",
            AppError::RateLimited => "rate_limited",
            AppError::CircularRef => "circular_ref",
            AppError::Internal(_) => "internal",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code();
        let message = match &self {
            AppError::Internal(_) => "internal error".to_string(),
            AppError::Conflict(m) => m.clone(),
            AppError::Validation(m) => m.clone(),
            _ => self.to_string(),
        };
        if status.is_server_error() {
            tracing::error!(error = ?self, "internal error");
        }
        (
            status,
            Json(json!({ "error": { "code": code, "message": message } })),
        )
            .into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound,
            sqlx::Error::Database(ref db) => {
                if let Some(code) = db.code() {
                    if code == "2067" {
                        // SQLITE_CONSTRAINT_UNIQUE
                        return AppError::Conflict("duplicate value".to_string());
                    }
                }
                tracing::error!(error = ?e, "database error");
                AppError::Internal(anyhow::anyhow!(e))
            }
            other => {
                tracing::error!(error = ?other, "database error");
                AppError::Internal(anyhow::anyhow!(other))
            }
        }
    }
}
