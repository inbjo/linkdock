use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub data_dir: PathBuf,
    pub listen_addr: String,
    pub session_secret: [u8; 32],
    pub session_ttl_hours: i64,
    pub cookie_secure: bool,
    pub cors_origins: Vec<String>,
    pub max_upload_mb: usize,
    pub default_page_size: usize,
    pub max_page_size: usize,
}

impl Config {
    pub fn from_env() -> Self {
        let data_dir = std::env::var("LW_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data"));
        let db_path = data_dir.join("linkwarden.sqlite3");
        let database_url = std::env::var("LW_DATABASE_URL").unwrap_or_else(|_| {
            format!("sqlite://{}?mode=rwc", db_path.display())
        });
        let listen_addr =
            std::env::var("LW_LISTEN").unwrap_or_else(|_| "0.0.0.0:3000".to_string());
        let session_secret_hex =
            std::env::var("LW_SESSION_SECRET").unwrap_or_else(|_| {
                // Generate a random secret at startup if not provided.
                // For production, set LW_SESSION_SECRET explicitly.
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
                tracing::warn!("LW_SESSION_SECRET invalid, generating ephemeral secret");
                let mut bytes = [0u8; 32];
                use rand::RngCore;
                rand::thread_rng().fill_bytes(&mut bytes);
                bytes
            });
        let cookie_secure = std::env::var("LW_COOKIE_SECURE")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true);
        let cors_origins = std::env::var("LW_CORS_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect();
        Self {
            database_url,
            data_dir,
            listen_addr,
            session_secret,
            session_ttl_hours: 24 * 30,
            cookie_secure,
            cors_origins,
            max_upload_mb: 50,
            default_page_size: 50,
            max_page_size: 500,
        }
    }
}
