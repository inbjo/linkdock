use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::services::auth::{AuthResponse, AuthService};
use crate::state::{AppState, WebauthnChallenge, WebauthnChallengeState};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use url::Url;
use webauthn_rs::prelude::{
    CreationChallengeResponse, Passkey, PublicKeyCredential, RegisterPublicKeyCredential,
    RequestChallengeResponse, Webauthn, WebauthnBuilder,
};

const CHALLENGE_TTL_MINUTES: i64 = 5;

#[derive(Debug, Serialize)]
pub struct PasskeyInfo {
    pub id: i64,
    pub uuid: String,
    pub name: String,
    pub last_used_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ChallengeResponse<T> {
    pub flow_id: String,
    pub options: T,
}

#[derive(Debug, Deserialize)]
pub struct RegisterFinishRequest {
    pub flow_id: String,
    pub name: String,
    pub credential: RegisterPublicKeyCredential,
}

#[derive(Debug, Deserialize)]
pub struct LoginStartRequest {
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginFinishRequest {
    pub flow_id: String,
    pub credential: PublicKeyCredential,
}

pub struct PasskeyService;

impl PasskeyService {
    pub async fn list(state: &AppState, user: &AuthUser) -> AppResult<Vec<PasskeyInfo>> {
        let rows = sqlx::query(
            "SELECT id, uuid, name, last_used_at, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC",
        )
        .bind(user.user_id)
        .fetch_all(&state.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| PasskeyInfo {
                id: row.try_get("id").unwrap_or_default(),
                uuid: row.try_get("uuid").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
                last_used_at: row.try_get("last_used_at").ok(),
                created_at: row.try_get("created_at").unwrap_or_default(),
            })
            .collect())
    }

    pub async fn start_registration(
        state: &AppState,
        user: &AuthUser,
    ) -> AppResult<ChallengeResponse<CreationChallengeResponse>> {
        let row = sqlx::query("SELECT uuid, username, display_name FROM users WHERE id = ?")
            .bind(user.user_id)
            .fetch_one(&state.pool)
            .await?;
        let user_uuid: String = row.try_get("uuid").unwrap_or_default();
        let username: String = row.try_get("username").unwrap_or_default();
        let display_name: String = row.try_get("display_name").unwrap_or_default();
        let user_uuid = uuid::Uuid::parse_str(&user_uuid)
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        let credentials = load_credentials(state, user.user_id).await?;
        let exclude = credentials
            .iter()
            .map(|credential| credential.cred_id().clone())
            .collect::<Vec<_>>();
        let webauthn = webauthn(state)?;
        let (options, registration) = webauthn
            .start_passkey_registration(
                user_uuid,
                &username,
                if display_name.is_empty() {
                    &username
                } else {
                    &display_name
                },
                (!exclude.is_empty()).then_some(exclude),
            )
            .map_err(webauthn_error)?;
        let flow_id = store_challenge(
            state,
            user.user_id,
            WebauthnChallengeState::Registration(registration),
        )
        .await;
        Ok(ChallengeResponse { flow_id, options })
    }

    pub async fn finish_registration(
        state: &AppState,
        user: &AuthUser,
        req: RegisterFinishRequest,
    ) -> AppResult<PasskeyInfo> {
        let name = req.name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::Validation(
                "passkey name length must be 1..64".into(),
            ));
        }
        let registration = match consume_challenge(state, &req.flow_id, user.user_id).await? {
            WebauthnChallengeState::Registration(registration) => registration,
            WebauthnChallengeState::Authentication(_) => {
                return Err(AppError::Validation("invalid passkey challenge".into()))
            }
        };
        let passkey = webauthn(state)?
            .finish_passkey_registration(&req.credential, &registration)
            .map_err(webauthn_error)?;
        let credential_id = serde_json::to_string(passkey.cred_id())
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        let credential_json =
            serde_json::to_string(&passkey).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
        let uuid = uuid::Uuid::new_v4().to_string();
        let row = sqlx::query(
            r#"INSERT INTO passkeys (uuid, user_id, name, credential_id, credential_json)
               VALUES (?, ?, ?, ?, ?)
               RETURNING id, uuid, name, last_used_at, created_at"#,
        )
        .bind(&uuid)
        .bind(user.user_id)
        .bind(name)
        .bind(credential_id)
        .bind(credential_json)
        .fetch_one(&state.pool)
        .await
        .map_err(|error| match error {
            sqlx::Error::Database(ref db) if db.is_unique_violation() => {
                AppError::Conflict("passkey is already registered".into())
            }
            other => AppError::from(other),
        })?;
        Ok(PasskeyInfo {
            id: row.try_get("id").unwrap_or_default(),
            uuid: row.try_get("uuid").unwrap_or_default(),
            name: row.try_get("name").unwrap_or_default(),
            last_used_at: row.try_get("last_used_at").ok(),
            created_at: row.try_get("created_at").unwrap_or_default(),
        })
    }

    pub async fn delete(state: &AppState, user: &AuthUser, id: i64) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
            .bind(id)
            .bind(user.user_id)
            .execute(&state.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn start_login(
        state: &AppState,
        req: LoginStartRequest,
    ) -> AppResult<ChallengeResponse<RequestChallengeResponse>> {
        let row = sqlx::query("SELECT id, disabled FROM users WHERE username = ?")
            .bind(req.username.trim())
            .fetch_optional(&state.pool)
            .await?;
        let user_id = match row {
            Some(row) if row.try_get::<i64, _>("disabled").unwrap_or(0) == 0 => {
                row.try_get("id").unwrap_or_default()
            }
            _ => return Err(AppError::Validation("passkey login failed".into())),
        };
        let credentials = load_credentials(state, user_id).await?;
        if credentials.is_empty() {
            return Err(AppError::Validation("passkey login failed".into()));
        }
        let (options, authentication) = webauthn(state)?
            .start_passkey_authentication(&credentials)
            .map_err(webauthn_error)?;
        let flow_id = store_challenge(
            state,
            user_id,
            WebauthnChallengeState::Authentication(authentication),
        )
        .await;
        Ok(ChallengeResponse { flow_id, options })
    }

    pub async fn finish_login(
        state: &AppState,
        req: LoginFinishRequest,
    ) -> AppResult<AuthResponse> {
        let (user_id, authentication) = consume_login_challenge(state, &req.flow_id).await?;
        let result = webauthn(state)?
            .finish_passkey_authentication(&req.credential, &authentication)
            .map_err(webauthn_error)?;

        let rows = sqlx::query("SELECT id, credential_json FROM passkeys WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(&state.pool)
            .await?;
        let mut matched = false;
        for row in rows {
            let mut passkey: Passkey = serde_json::from_str(
                &row.try_get::<String, _>("credential_json")
                    .unwrap_or_default(),
            )
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
            if passkey.update_credential(&result).is_some() {
                let credential_json = serde_json::to_string(&passkey)
                    .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
                sqlx::query(
                    "UPDATE passkeys SET credential_json = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?",
                )
                .bind(credential_json)
                .bind(row.try_get::<i64, _>("id").unwrap_or_default())
                .bind(user_id)
                .execute(&state.pool)
                .await?;
                matched = true;
                break;
            }
        }
        if !matched {
            return Err(AppError::Validation("passkey login failed".into()));
        }
        AuthService::complete_login(state, user_id).await
    }
}

fn webauthn(state: &AppState) -> AppResult<Webauthn> {
    let origin = Url::parse(&state.config.webauthn_rp_origin)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("invalid WebAuthn origin: {e}")))?;
    WebauthnBuilder::new(&state.config.webauthn_rp_id, &origin)
        .map_err(webauthn_error)?
        .rp_name(&state.config.webauthn_rp_name)
        .build()
        .map_err(webauthn_error)
}

async fn load_credentials(state: &AppState, user_id: i64) -> AppResult<Vec<Passkey>> {
    let rows = sqlx::query("SELECT credential_json FROM passkeys WHERE user_id = ?")
        .bind(user_id)
        .fetch_all(&state.pool)
        .await?;
    rows.into_iter()
        .map(|row| {
            serde_json::from_str(
                &row.try_get::<String, _>("credential_json")
                    .unwrap_or_default(),
            )
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))
        })
        .collect()
}

async fn store_challenge(
    state: &AppState,
    user_id: i64,
    challenge: WebauthnChallengeState,
) -> String {
    let flow_id = uuid::Uuid::new_v4().to_string();
    let now = tokio::time::Instant::now();
    let mut challenges = state.webauthn_challenges.lock().await;
    challenges.retain(|_, pending| pending.expires_at > now);
    challenges.insert(
        flow_id.clone(),
        WebauthnChallenge {
            user_id,
            expires_at: now + std::time::Duration::from_secs(CHALLENGE_TTL_MINUTES as u64 * 60),
            state: challenge,
        },
    );
    flow_id
}

async fn consume_challenge(
    state: &AppState,
    flow_id: &str,
    user_id: i64,
) -> AppResult<WebauthnChallengeState> {
    let pending = state
        .webauthn_challenges
        .lock()
        .await
        .remove(flow_id)
        .filter(|pending| {
            pending.user_id == user_id && pending.expires_at > tokio::time::Instant::now()
        })
        .ok_or_else(|| AppError::Validation("passkey challenge expired".into()))?;
    Ok(pending.state)
}

async fn consume_login_challenge(
    state: &AppState,
    flow_id: &str,
) -> AppResult<(i64, webauthn_rs::prelude::PasskeyAuthentication)> {
    let pending = state
        .webauthn_challenges
        .lock()
        .await
        .remove(flow_id)
        .filter(|pending| pending.expires_at > tokio::time::Instant::now())
        .ok_or_else(|| AppError::Validation("passkey challenge expired".into()))?;
    match pending.state {
        WebauthnChallengeState::Authentication(authentication) => {
            Ok((pending.user_id, authentication))
        }
        WebauthnChallengeState::Registration(_) => {
            Err(AppError::Validation("invalid passkey challenge".into()))
        }
    }
}

fn webauthn_error(error: impl std::fmt::Display) -> AppError {
    tracing::warn!(error = %error, "webauthn operation rejected");
    AppError::Validation("passkey verification failed".into())
}
