use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

static PASSWORD_WORKERS: std::sync::LazyLock<std::sync::Arc<tokio::sync::Semaphore>> =
    std::sync::LazyLock::new(|| std::sync::Arc::new(tokio::sync::Semaphore::new(4)));
static PASSWORD_QUEUE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(64);

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> crate::error::AppResult<T> {
    let _queue_slot = PASSWORD_QUEUE
        .try_acquire()
        .map_err(|_| crate::error::AppError::RateLimited)?;
    let permit = PASSWORD_WORKERS
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| crate::error::AppError::RateLimited)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(|error| crate::error::AppError::Internal(error.into()))
}

pub async fn hash_async(plain: String) -> crate::error::AppResult<String> {
    if plain.len() > 1024 {
        return Err(crate::error::AppError::Validation(
            "password exceeds 1024 bytes".into(),
        ));
    }
    blocking(move || hash_password(&plain))
        .await?
        .map_err(|error| crate::error::AppError::Internal(anyhow::anyhow!(error)))
}

pub async fn verify_async(plain: String, hash: String) -> crate::error::AppResult<bool> {
    if plain.len() > 1024 {
        return Ok(false);
    }
    blocking(move || verify_password(&plain, &hash)).await
}

pub fn hash_password(plain: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(plain.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

pub fn verify_password(plain: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok()
}
