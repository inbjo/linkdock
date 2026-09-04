use rand::RngCore;
use sha2::{Digest, Sha256};

/// Generate a random hex string of `n_bytes` bytes.
pub fn random_hex(n_bytes: usize) -> String {
    let mut buf = vec![0u8; n_bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(&buf)
}

/// Generate a random base64url string of `n_bytes` entropy.
pub fn random_b64url(n_bytes: usize) -> String {
    use base64::Engine;
    let mut buf = vec![0u8; n_bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&buf)
}

/// SHA-256 hex digest.
pub fn sha256_hex(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    hex::encode(hasher.finalize())
}

/// Generate an access token: `lw_<prefix>_<secret>`.
/// Returns (full_token, prefix, hash).
pub fn generate_access_token() -> (String, String, String) {
    let prefix = random_b64url(6);
    let secret = random_b64url(24);
    let full = format!("lw_{}_{}", prefix, secret);
    let hash = sha256_hex(full.as_bytes());
    (full, prefix, hash)
}

/// Generate a high-entropy session token (raw string to send to client).
pub fn generate_session_token() -> String {
    random_b64url(32)
}

/// Hash a session token for storage.
pub fn hash_session_token(token: &str) -> String {
    sha256_hex(token.as_bytes())
}
