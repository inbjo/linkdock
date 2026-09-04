use linkwarden::{config::Config, db, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,linkwarden=debug".into()),
        )
        .init();

    let config = Config::from_env();

    // Ensure data directory exists.
    if let Some(parent) = config.data_dir.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::create_dir_all(&config.data_dir)?;
    std::fs::create_dir_all(config.data_dir.join("imports"))?;
    std::fs::create_dir_all(config.data_dir.join("exports"))?;
    std::fs::create_dir_all(config.data_dir.join("backups"))?;

    let pool = db::connect(&config.database_url).await?;
    db::run_migrations(&pool).await?;
    tracing::info!("migrations applied");

    let state = AppState::new(pool.clone(), config.clone());

    let app = linkwarden::build_router(state);

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!("listening on {}", config.listen_addr);
    axum::serve(listener, app).await?;
    Ok(())
}
