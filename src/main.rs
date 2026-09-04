use linkdock::{config::Config, db, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let log_format = std::env::var("DOCK_LOG_FORMAT").unwrap_or_default();
    let use_json = log_format.eq_ignore_ascii_case("json");

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info,linkdock=debug".into());

    if use_json {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

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

    let app = linkdock::build_router(state);

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!(addr = %config.listen_addr, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}
