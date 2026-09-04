# Linkwarden — Rust

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
LW_DATA_DIR=./data LW_LISTEN=0.0.0.0:3000 cargo run --release
```

Environment variables:
- `LW_DATA_DIR` — data directory (default: `data`)
- `LW_DATABASE_URL` — SQLite connection string (default: derived from `LW_DATA_DIR`)
- `LW_LISTEN` — bind address (default: `0.0.0.0:3000`)
- `LW_SESSION_SECRET` — 32-byte hex secret for sessions (auto-generated if missing)
- `LW_COOKIE_SECURE` — `0`/`false` to disable Secure flag (default: enabled)
- `LW_CORS_ORIGINS` — comma-separated allowed origins

## Architecture

- **Backend**: Rust + Axum 0.8 + SQLite (sqlx) + FTS5
- **Frontend**: Vite + React + TypeScript (embedded via rust-embed at build time)
- **Floccus target**: v5.9.2 (see `docs/floccus-contract.md`)

### Key Design Decisions

- `tenant_id` always comes from server-side session or access token, never from request body.
- All DB queries include `tenant_id` in WHERE clauses.
- Access tokens are SHA-256 hashed; only shown once at creation.
- Invalid tokens return `403` (Floccus browser adapter expects this).
- Soft delete for links and collections; FTS index kept in sync via triggers.
- Cursor pagination by `id DESC` (stable, no skip on changes).

## Project Structure

```
src/
├── lib.rs          — router builder, SPA fallback
├── main.rs         — entry point
├── config.rs       — env-based config
├── error.rs        — unified error -> JSON
├── db.rs           — SQLite pool + migrations
├── state.rs        — AppState
├── auth/           — password, token, session, extractors, middleware
├── domain/         — SQL row structs
├── services/       — business logic (auth, tenant, collection, link, search, tag, token)
├── routes/
│   ├── app/        — /api/app/v1/* management API
│   └── linkwarden/ — /api/v1/* Floccus-compatible API
└── web_assets.rs   — rust-embed frontend
```
