use crate::config::Config;
use crate::state::AppState;
use std::path::PathBuf;

pub struct TestApp {
    pub base: String,
    pub client: reqwest::Client,
    pub _tmpdir: tempfile::TempDir,
    pub state: AppState,
}

impl TestApp {
    pub async fn new() -> Self {
        let tmpdir = tempfile::tempdir().unwrap();
        let db_path = tmpdir.path().join("test.sqlite3");
        let database_url = format!("sqlite://{}?mode=rwc", db_path.display());

        let pool = crate::db::connect(&database_url).await.unwrap();
        crate::db::run_migrations(&pool).await.unwrap();

        let config = Config {
            database_url,
            data_dir: PathBuf::from(tmpdir.path()),
            listen_addr: "127.0.0.1:0".to_string(),
            session_secret: {
                let mut bytes = [0u8; 32];
                use rand::RngCore;
                rand::thread_rng().fill_bytes(&mut bytes);
                bytes
            },
            session_ttl_hours: 720,
            cookie_secure: false,
            webauthn_rp_id: "localhost".to_string(),
            webauthn_rp_origin: "http://localhost".to_string(),
            webauthn_rp_name: "Linkdock Test".to_string(),
            cors_origins: vec![],
            max_upload_mb: 50,
            default_page_size: 50,
            max_page_size: 500,
        };

        let state = AppState::new(pool, config);
        let router = crate::build_router(state.clone());

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let base = format!("http://{}", addr);

        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        let client = reqwest::Client::builder()
            .cookie_store(true)
            .build()
            .unwrap();

        TestApp {
            base,
            client,
            _tmpdir: tmpdir,
            state,
        }
    }
}
