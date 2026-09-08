use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub data_dir: PathBuf,
    pub listen_addr: String,
    pub session_secret: [u8; 32],
    pub session_ttl_hours: i64,
    pub cookie_secure: bool,
    pub setup_token: Option<String>,
    pub webauthn_rp_id: String,
    pub webauthn_rp_origin: String,
    pub webauthn_rp_name: String,
    pub public_url: String,
    pub cors_origins: Vec<String>,
    pub max_upload_mb: usize,
    pub default_page_size: usize,
    pub max_page_size: usize,
}

impl Config {
    pub fn from_env() -> Self {
        let data_dir = std::env::var("DOCK_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data"));
        let db_path = data_dir.join("linkdock.sqlite3");
        let database_url = std::env::var("DOCK_DATABASE_URL")
            .unwrap_or_else(|_| format!("sqlite://{}?mode=rwc", db_path.display()));
        let listen_addr =
            std::env::var("DOCK_LISTEN").unwrap_or_else(|_| "0.0.0.0:3000".to_string());
        let session_secret_hex = std::env::var("DOCK_SESSION_SECRET").unwrap_or_else(|_| {
            // Generate a random secret at startup if not provided.
            // For production, set DOCK_SESSION_SECRET explicitly.
            let mut bytes = [0u8; 32];
            use rand::RngCore;
            rand::thread_rng().fill_bytes(&mut bytes);
            hex::encode(bytes)
        });
        let session_secret = hex::decode(&session_secret_hex)
            .ok()
            .and_then(|b| {
                if b.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&b);
                    Some(arr)
                } else {
                    None
                }
            })
            .unwrap_or_else(|| {
                tracing::warn!("DOCK_SESSION_SECRET invalid, generating ephemeral secret");
                let mut bytes = [0u8; 32];
                use rand::RngCore;
                rand::thread_rng().fill_bytes(&mut bytes);
                bytes
            });
        let cookie_secure = std::env::var("DOCK_COOKIE_SECURE")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or_else(|_| {
                // Auto-detect: disable Secure for localhost / 127.0.0.1 / 0.0.0.0
                // (no HTTPS in local dev). Enable for everything else.
                let listen = std::env::var("DOCK_LISTEN").unwrap_or_default();
                !(listen.is_empty()
                    || listen.starts_with("0.0.0.0")
                    || listen.starts_with("127.")
                    || listen.starts_with("localhost")
                    || listen.starts_with("::1"))
            });
        let setup_token = std::env::var("DOCK_SETUP_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let cors_origins = std::env::var("DOCK_CORS_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect();
        let webauthn_rp_id =
            std::env::var("DOCK_WEBAUTHN_RP_ID").unwrap_or_else(|_| "localhost".to_string());
        let webauthn_rp_origin = std::env::var("DOCK_WEBAUTHN_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:3000".to_string());
        let webauthn_rp_name =
            std::env::var("DOCK_WEBAUTHN_RP_NAME").unwrap_or_else(|_| "Linkdock".to_string());
        let public_url = std::env::var("DOCK_PUBLIC_URL")
            .unwrap_or_else(|_| webauthn_rp_origin.clone())
            .trim_end_matches('/')
            .to_string();
        Self {
            database_url,
            data_dir,
            listen_addr,
            session_secret,
            session_ttl_hours: 24 * 30,
            cookie_secure,
            setup_token,
            webauthn_rp_id,
            webauthn_rp_origin,
            webauthn_rp_name,
            public_url,
            cors_origins,
            max_upload_mb: 50,
            default_page_size: 50,
            max_page_size: 500,
        }
    }
}
