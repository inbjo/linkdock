use crate::config::Config;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::Instant;
use webauthn_rs::prelude::{PasskeyAuthentication, PasskeyRegistration};

pub(crate) enum WebauthnChallengeState {
    Registration(PasskeyRegistration),
    Authentication(PasskeyAuthentication),
}

pub(crate) struct WebauthnChallenge {
    pub user_id: i64,
    pub expires_at: Instant,
    pub state: WebauthnChallengeState,
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Config,
    pub(crate) webauthn_challenges: Arc<Mutex<HashMap<String, WebauthnChallenge>>>,
}

impl AppState {
    pub fn new(pool: SqlitePool, config: Config) -> Self {
        Self {
            pool,
            config,
            webauthn_challenges: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
