# Linkdock — Rust

A self-hosted, Floccus-compatible bookmark service built with Rust, Axum, and SQLite.

## Build & Test Commands

- `cargo build` — build debug binary
- `cargo build --release` — build release binary (embeds frontend from `web/dist/`)
- `cargo test` — run all tests (12 integration tests covering Floccus compat + multi-tenant)
- `cargo clippy` — lint
- `cargo fmt` — format
- `cd web && npm install && npm run build` — build frontend
- `cd web && npm run dev` — frontend dev server (proxies API to localhost:3000)

## Running

```bash
DOCK_DATA_DIR=./data DOCK_LISTEN=0.0.0.0:3000 cargo run --release
```

Environment variables:
- `DOCK_DATA_DIR` — data directory (default: `data`)
- `DOCK_DATABASE_URL` — SQLite connection string (default: derived from `DOCK_DATA_DIR`)
- `DOCK_LISTEN` — bind address (default: `0.0.0.0:3000`)
- `DOCK_SESSION_SECRET` — 32-byte hex secret for sessions (auto-generated if missing)
- `DOCK_COOKIE_SECURE` — `0`/`false` to disable Secure flag (default: enabled)
- `DOCK_SETUP_TOKEN` — optional first-account initialization secret; the first account becomes system administrator
- `DOCK_CORS_ORIGINS` — comma-separated allowed origins
- `DOCK_LOG_FORMAT` — `json` for structured logging, `text` for default
- `RUST_LOG` — log level filter (default: `info,linkdock=debug`)

## Architecture

- **Backend**: Rust + Axum 0.8 + SQLite (sqlx) + FTS5
- **Frontend**: Vite + React + TypeScript + Tailwind CSS (embedded via rust-embed)
- **Floccus target**: v5.9.2 (see `docs/floccus-contract.md`)

### Key Design Decisions

- `tenant_id` always comes from server-side session or access token, never from request body.
- All DB queries include `tenant_id` in WHERE clauses.
- Access tokens are SHA-256 hashed; only shown once at creation.
- Invalid tokens return `403` (Floccus browser adapter expects this).
- Soft delete for links and collections; FTS index kept in sync via triggers.
- Cursor pagination by `id DESC` (stable, no skip on changes).
- Request ID middleware: auto-generates or propagates `x-request-id` header.
- JSON structured logging via `DOCK_LOG_FORMAT=json`.
- Prometheus metrics at `/metrics`.

## Project Structure

```
src/
├── lib.rs          — router builder, SPA fallback, metrics
├── main.rs         — entry point, logging init
├── config.rs       — env-based config
├── error.rs        — unified error -> JSON
├── db.rs           — SQLite pool + migrations
├── state.rs        — AppState
├── middleware/     — request ID middleware
├── auth/           — password, token, session, extractors, middleware
├── domain/         — SQL row structs
├── services/       — business logic (auth, tenant, collection, link, search, tag, token, io, audit)
├── routes/
│   ├── app/        — /api/app/v1/* management API (auth, tenant, collection, link, tag, token, io, admin)
│   └── linkdock/ — /api/v1/* Floccus-compatible API
└── web_assets.rs   — rust-embed frontend

deploy/             — systemd service, nginx/Caddy configs, backup/restore scripts, deployment docs
```

## Deployment

See `deploy/README.md` for detailed deployment instructions including:
- Docker / docker-compose
- Binary + systemd
- Nginx / Caddy reverse proxy
- Backup and restore
- Monitoring (health checks, metrics, structured logging)
