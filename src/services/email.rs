use crate::error::{AppError, AppResult};
use crate::state::AppState;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize)]
pub struct SmtpSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub password_configured: bool,
    pub from_email: String,
    pub from_name: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSmtpSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    pub from_email: String,
    pub from_name: String,
}

struct StoredSmtpSettings {
    public: SmtpSettings,
    encrypted_password: Option<String>,
}

pub struct EmailService;

impl EmailService {
    pub async fn settings(state: &AppState) -> AppResult<SmtpSettings> {
        Ok(Self::stored_settings(state).await?.public)
    }

    pub async fn update_settings(
        state: &AppState,
        input: UpdateSmtpSettings,
    ) -> AppResult<SmtpSettings> {
        validate_settings(&input)?;
        let existing = Self::stored_settings(state).await?;
        let encrypted_password = match input.password.as_deref() {
            Some(password) if !password.is_empty() => {
                Some(encrypt(password, &state.config.session_secret)?)
            }
            Some(_) => None,
            None => existing.encrypted_password,
        };
        sqlx::query(
            "UPDATE smtp_settings SET enabled=?, host=?, port=?, security=?, username=?, password_encrypted=?, from_email=?, from_name=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1",
        )
        .bind(input.enabled as i64)
        .bind(input.host.trim())
        .bind(i64::from(input.port))
        .bind(&input.security)
        .bind(input.username.trim())
        .bind(encrypted_password)
        .bind(normalize_email(&input.from_email)?)
        .bind(input.from_name.trim())
        .execute(&state.pool)
        .await?;
        Self::settings(state).await
    }

    pub async fn send_password_reset(
        state: &AppState,
        recipient: &str,
        token: &str,
    ) -> AppResult<()> {
        let link = format!("{}/reset-password?token={}", state.config.public_url, token);
        let subject = "Reset your Linkdock password";
        let body = format!(
            "A password reset was requested for your Linkdock account.\n\nOpen this link within one hour:\n{link}\n\nIf you did not request this, you can ignore this email."
        );
        Self::send(state, recipient, subject, &body).await
    }

    pub async fn send_test(state: &AppState, recipient: &str) -> AppResult<()> {
        Self::send(
            state,
            recipient,
            "Linkdock email test",
            "Your Linkdock SMTP settings are working.",
        )
        .await
    }

    async fn send(state: &AppState, recipient: &str, subject: &str, body: &str) -> AppResult<()> {
        let stored = Self::stored_settings(state).await?;
        let settings = stored.public;
        if !settings.enabled {
            return Err(AppError::Validation(
                "email delivery is not configured".into(),
            ));
        }
        let from_address = settings
            .from_email
            .parse()
            .map_err(|_| AppError::Validation("invalid SMTP sender email address".into()))?;
        let to_address = normalize_email(recipient)?
            .parse()
            .map_err(|_| AppError::Validation("invalid recipient email address".into()))?;
        let message = Message::builder()
            .from(Mailbox::new(Some(settings.from_name.clone()), from_address))
            .to(Mailbox::new(None, to_address))
            .subject(subject)
            .body(body.to_string())
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

        let builder = match settings.security.as_str() {
            "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&settings.host),
            "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&settings.host),
            "none" => Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
                &settings.host,
            )),
            _ => return Err(AppError::Validation("invalid SMTP security mode".into())),
        }
        .map_err(|e| AppError::Validation(format!("invalid SMTP configuration: {e}")))?;
        let mut builder = builder.port(settings.port);
        if !settings.username.is_empty() {
            let encrypted = stored
                .encrypted_password
                .ok_or_else(|| AppError::Validation("SMTP password is not configured".into()))?;
            builder = builder.credentials(Credentials::new(
                settings.username,
                decrypt(&encrypted, &state.config.session_secret)?,
            ));
        }
        builder
            .build()
            .send(message)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("SMTP delivery failed: {e}")))?;
        Ok(())
    }

    async fn stored_settings(state: &AppState) -> AppResult<StoredSmtpSettings> {
        let row = sqlx::query("SELECT enabled, host, port, security, username, password_encrypted, from_email, from_name FROM smtp_settings WHERE id=1")
            .fetch_one(&state.pool)
            .await?;
        let encrypted_password: Option<String> = row.try_get("password_encrypted").unwrap_or(None);
        Ok(StoredSmtpSettings {
            public: SmtpSettings {
                enabled: row.get::<i64, _>("enabled") != 0,
                host: row.get("host"),
                port: u16::try_from(row.get::<i64, _>("port")).unwrap_or(587),
                security: row.get("security"),
                username: row.get("username"),
                password_configured: encrypted_password.is_some(),
                from_email: row.get("from_email"),
                from_name: row.get("from_name"),
            },
            encrypted_password,
        })
    }
}

pub fn normalize_email(value: &str) -> AppResult<String> {
    let email = value.trim().to_lowercase();
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if email.len() > 254
        || local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || parts.next().is_some()
        || email.chars().any(char::is_whitespace)
    {
        return Err(AppError::Validation("invalid email address".into()));
    }
    Ok(email)
}

fn validate_settings(input: &UpdateSmtpSettings) -> AppResult<()> {
    if !matches!(input.security.as_str(), "starttls" | "tls" | "none") {
        return Err(AppError::Validation("invalid SMTP security mode".into()));
    }
    if input.host.trim().is_empty() || input.from_name.trim().is_empty() {
        return Err(AppError::Validation(
            "SMTP host and sender name are required".into(),
        ));
    }
    normalize_email(&input.from_email)?;
    Ok(())
}

fn encrypt(value: &str, key: &[u8; 32]) -> AppResult<String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), value.as_bytes())
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let mut packed = nonce_bytes.to_vec();
    packed.extend(ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(packed))
}

fn decrypt(value: &str, key: &[u8; 32]) -> AppResult<String> {
    let packed = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    if packed.len() < 13 {
        return Err(AppError::Internal(anyhow::anyhow!(
            "invalid encrypted SMTP password"
        )));
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&packed[..12]), &packed[12..])
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    String::from_utf8(plaintext).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))
}
