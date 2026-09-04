use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AccessToken {
    pub id: i64,
    pub uuid: String,
    pub tenant_id: i64,
    pub user_id: i64,
    pub name: String,
    pub token_prefix: String,
    pub scopes: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
}

impl AccessToken {
    pub fn is_revoked(&self) -> bool {
        self.revoked_at.is_some()
    }
}

/// Response when creating a token — includes the full token once.
#[derive(Debug, Clone, Serialize)]
pub struct AccessTokenCreated {
    #[serde(flatten)]
    pub token: AccessToken,
    pub plaintext: String,
}
