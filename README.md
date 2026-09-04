# Linkwarden

A self-hosted, **Floccus-compatible** bookmark management service built with Rust, Axum, and SQLite. Sync your browser bookmarks across Chrome, Firefox, and Brave using the [Floccus](https://floccus.org) browser extension.

## Features

- **Floccus Compatibility** — Works with Floccus v5.9+ via the Linkwarden adapter (9 API endpoints)
- **Multi-Tenant** — Multiple workspaces with role-based access (owner/admin/member/viewer)
- **Collection Tree** — Nested folders with cycle detection
- **Full-Text Search** — SQLite FTS5 with cursor pagination
- **Soft Delete & Trash** — Restore accidentally deleted bookmarks
- **Import / Export** — Netscape HTML, Linkwarden JSON, CSV, XBEL
- **Access Tokens** — SHA-256 hashed, scoped, revocable (for Floccus sync)
- **Tag System** — Per-tenant tags with normalized names
- **Batch Operations** — Move, delete, restore, tag multiple bookmarks at once
- **Admin Dashboard** — System-wide stats, user/tenant management, audit log
- **Observability** — Request ID tracing, JSON structured logging, Prometheus metrics
- **Single Binary** — Frontend embedded via rust-embed, no external file dependencies
- **Dark Mode** — Automatic via `prefers-color-scheme`

## Quick Start

### Docker (Recommended)

```bash
# 1. Clone
git clone <repo-url> linkwarden
cd linkwarden

# 2. Configure
cp .env.example .env
# Generate a session secret
echo "LW_SESSION_SECRET=$(openssl rand -hex 32)" >> .env

# 3. Build and run
docker compose up -d

# 4. Verify
curl http://localhost:3000/health/live
# → ok
```

Open `http://localhost:3000` in your browser, register an account, and start bookmarking.

### With HTTPS (Caddy Reverse Proxy)

```bash
# Set your domain in .env
echo "LW_DOMAIN=bookmarks.yourdomain.com" >> .env

# Start with Caddy profile
docker compose --profile with-proxy up -d
```

Caddy will automatically provision Let's Encrypt certificates.

### Docker Build Script

```bash
# Build image only
./scripts/docker-build.sh

# Build and run immediately
./scripts/docker-build.sh --run

# Build with custom tag and port
./scripts/docker-build.sh --tag v0.1.0 --run -p 8080:3000
```

### Local Build

```bash
# Prerequisites: Rust 1.75+, Node.js 22+, npm 10+

# Build (frontend + backend)
./scripts/build.sh --release

# Run
LW_DATA_DIR=./data LW_SESSION_SECRET=$(openssl rand -hex 32) \
    ./target/release/linkwarden
```

### Development

```bash
# Start both backend (port 3000) and frontend dev server (port 5173)
./scripts/dev.sh

# Or start individually:
./scripts/dev.sh --backend    # cargo run with hot reload
./scripts/dev.sh --frontend   # vite dev server with API proxy
```

The Vite dev server proxies `/api` and `/health` to `localhost:3000`.

## Floccus Sync Setup

1. **Create an access token**: Log in → Settings → Access Tokens → Create Token → Copy
2. **Install Floccus**: Get the [Floccus browser extension](https://floccus.org)
3. **Configure Floccus**:
   - Sync method: **Linkwarden**
   - Server URL: `https://your-domain.com`
   - Access token: paste the token from step 1
   - Server folder: `Floccus` (recommended, auto-created on first sync)
4. **Sync**: Click the sync button in Floccus

> The in-app **Settings → Sync (Floccus)** page has a step-by-step guide with copy buttons.

## Build Scripts

| Script | Description |
|--------|-------------|
| `./scripts/build.sh` | Build frontend + backend (debug or `--release`) |
| `./scripts/docker-build.sh` | Build Docker image (`--run` to start, `--tag` for custom tag) |
| `./scripts/dev.sh` | Start development environment (`--backend` or `--frontend` only) |
| `./scripts/test.sh` | Run all tests (`--backend` or `--frontend` only) |
| `./scripts/release.sh` | Create a release tarball with checksum |
| `./deploy/backup.sh` | Backup SQLite database (safe online backup) |
| `./deploy/restore.sh` | Restore from a backup file |

## API Reference

### Management API (`/api/app/v1/`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login (returns session cookie) |
| POST | `/auth/logout` | Logout |
| GET | `/me` | Current user info + active tenant |
| GET | `/tenants` | List user's workspaces |
| POST | `/tenants` | Create workspace |
| PUT | `/tenants/{id}` | Update workspace |
| POST | `/tenants/{id}/select` | Switch active workspace |
| GET/POST | `/tenants/{id}/members` | List/add members |
| PUT/DELETE | `/tenants/{id}/members/{user_id}` | Update/remove member |
| GET | `/collections` | List collections |
| GET | `/collections/tree` | Get collection tree |
| POST | `/collections` | Create collection |
| PUT/DELETE | `/collections/{id}` | Update/delete collection |
| GET | `/links` | List links (optional `collection_id`, `include_deleted`) |
| GET/POST | `/links` / `/links/{id}` | Get/create/update/delete link |
| POST | `/links/{id}/restore` | Restore from trash |
| POST | `/links/batch/{move,delete,restore,tag}` | Batch operations |
| GET/POST | `/tags` / `/tags/{id}` | Tag CRUD |
| GET/POST/DELETE | `/tokens` / `/tokens/{id}` | Access token management |
| GET/DELETE | `/sessions` / `/sessions/{id}` | Session management |
| POST | `/import/upload` | Upload file for import preview |
| POST | `/import/execute` | Execute import |
| GET | `/export/{html,json,csv,xbel}` | Export bookmarks |
| GET | `/admin/stats` | System stats (admin only) |
| GET | `/admin/users` | All users (admin only) |
| GET | `/admin/tenants` | All tenants (admin only) |
| GET | `/admin/audit` | Audit log (admin only) |

### Floccus API (`/api/v1/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/collections` | List collections (Floccus format) |
| POST | `/collections` | Create collection |
| GET/PUT/DELETE | `/collections/{id}` | Collection CRUD |
| GET | `/links` | Search links (`searchQueryString` param) |
| POST | `/links` | Create bookmark |
| PUT/DELETE | `/links/{id}` | Update/delete bookmark |
| GET | `/bookmarks/tree` | Full bookmarks tree |

Authentication: Bearer token (`Authorization: Bearer lw_...`). Invalid tokens return `403`.

### Health & Metrics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/live` | Liveness check (always 200) |
| GET | `/health/ready` | Readiness check (DB connectivity) |
| GET | `/metrics` | Prometheus-compatible metrics |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LW_DATA_DIR` | `data` | Data directory (SQLite DB, imports, exports, backups) |
| `LW_DATABASE_URL` | derived | SQLite connection string |
| `LW_LISTEN` | `0.0.0.0:3000` | Bind address |
| `LW_SESSION_SECRET` | random | 32-byte hex secret for session signing |
| `LW_COOKIE_SECURE` | `true` | Set `false` if no HTTPS |
| `LW_CORS_ORIGINS` | empty | Comma-separated allowed origins |
| `LW_LOG_FORMAT` | `text` | `json` for structured logging |
| `RUST_LOG` | `info` | Log level filter |
| `LW_PORT` | `3000` | Docker compose host port |
| `LW_DOMAIN` | — | Domain for Caddy reverse proxy |

## Deployment

### Docker Compose

```bash
cp .env.example .env
# Edit .env: set LW_SESSION_SECRET
docker compose up -d
```

See `docker-compose.yml` for full configuration. The optional Caddy profile adds automatic HTTPS:

```bash
docker compose --profile with-proxy up -d
```

### Binary + systemd

```bash
# Build
./scripts/build.sh --release

# Install
sudo useradd -r -s /sbin/nologin linkwarden
sudo mkdir -p /opt/linkwarden/{bin,data}
sudo cp target/release/linkwarden /opt/linkwarden/bin/
sudo cp deploy/linkwarden.service /etc/systemd/system/

# Edit service file to set LW_SESSION_SECRET
sudo systemctl daemon-reload
sudo systemctl enable --now linkwarden
```

### Reverse Proxy

**Nginx**: Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/`, edit `server_name` and SSL paths, enable.

**Caddy**: Copy `deploy/Caddyfile` to `/etc/caddy/`, edit domain, restart Caddy.

See `deploy/README.md` for detailed instructions.

## Backup & Restore

```bash
# Backup (safe to run while server is up)
./deploy/backup.sh /opt/linkwarden/data /opt/linkwarden/data/backups

# Restore (stop server first!)
sudo systemctl stop linkwarden
./deploy/restore.sh /opt/linkwarden/data/backups/linkwarden_20260904_030000.sqlite3.gz /opt/linkwarden/data
sudo systemctl start linkwarden
```

For automated backups, add to crontab:
```cron
0 3 * * * /opt/linkwarden/deploy/backup.sh >> /var/log/linkwarden-backup.log 2>&1
```

Backups use SQLite's online backup API (safe during operation). Retention: last 30 backups.

## Monitoring

### Health Checks
- `GET /health/live` — process is running
- `GET /health/ready` — database is reachable

### Prometheus Metrics
```
GET /metrics

linkwarden_users_total 42
linkwarden_tenants_total 7
linkwarden_links_total 15234
linkwarden_collections_total 156
linkwarden_active_sessions 23
```

### Structured Logging
Set `LW_LOG_FORMAT=json` for JSON logs with request IDs:
```json
{"timestamp":"2026-09-04T03:00:00Z","level":"INFO","target":"linkwarden","fields":{"msg":"listening","addr":"0.0.0.0:3000"}}
```

Every response includes an `x-request-id` header (auto-generated or propagated from request).

## Project Structure

```
linkwarden/
├── Cargo.toml              # Rust dependencies
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Docker Compose with optional Caddy
├── build.rs                # Build script (frontend embedding)
├── .env.example            # Environment variable template
├── migrations/             # SQLite migrations
│   ├── 20260904000001_init.sql
│   ├── 20260904000002_bookmarks.sql
│   └── 20260904000003_audit.sql
├── src/
│   ├── main.rs             # Entry point, logging init
│   ├── lib.rs              # Router, SPA fallback, metrics
│   ├── config.rs           # Environment-based config
│   ├── error.rs            # Unified error → JSON
│   ├── db.rs               # SQLite pool + migrations
│   ├── state.rs            # AppState
│   ├── middleware/         # Request ID middleware
│   ├── auth/               # Password, token, session, extractors
│   ├── domain/             # SQL row structs
│   ├── services/           # Business logic
│   │   ├── auth.rs         #   Registration, login
│   │   ├── tenant.rs       #   Workspace management
│   │   ├── collection.rs   #   Collection tree CRUD
│   │   ├── link.rs         #   Bookmark CRUD, batch ops
│   │   ├── search.rs       #   FTS5 search
│   │   ├── tag.rs          #   Tag management
│   │   ├── token.rs        #   Access token CRUD
│   │   ├── io/             #   Import/export (HTML/JSON/CSV/XBEL)
│   │   └── audit.rs        #   Audit logging
│   ├── routes/
│   │   ├── app/            # Management API (/api/app/v1/)
│   │   └── linkwarden/     # Floccus API (/api/v1/)
│   └── web_assets.rs       # rust-embed frontend
├── web/                    # Frontend (Vite + React + TypeScript)
│   ├── src/
│   │   ├── main.tsx        # App entry, routing
│   │   ├── lib/            # API client, types
│   │   ├── hooks/          # Auth context
│   │   ├── components/     # Modal, Drawer, Toast, CollectionTree, LinkCard
│   │   ├── pages/          # Login, Register, Bookmarks, Search, Trash, Settings, Admin
│   │   ├── i18n/           # Internationalization
│   │   └── styles/         # CSS (Tailwind + custom)
│   ├── package.json
│   └── vite.config.ts
├── scripts/                # Build and dev scripts
│   ├── build.sh            # Build frontend + backend
│   ├── docker-build.sh     # Build/run Docker image
│   ├── dev.sh              # Development environment
│   ├── test.sh             # Run all tests
│   └── release.sh          # Create release package
├── deploy/                 # Deployment configurations
│   ├── README.md           # Detailed deployment guide
│   ├── linkwarden.service  # systemd service file
│   ├── nginx.conf          # Nginx reverse proxy config
│   ├── Caddyfile           # Caddy reverse proxy config
│   ├── backup.sh           # Database backup script
│   └── restore.sh          # Database restore script
├── docs/
│   └── floccus-contract.md # Floccus adapter contract
└── tests/
    └── integration.rs      # 12 integration tests
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum 0.8, SQLite (sqlx), FTS5 |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4 |
| State | TanStack Query 5 |
| i18n | i18next, react-i18next |
| Auth | Argon2id, session cookies, Bearer tokens |
| Embedding | rust-embed (single binary) |
| Logging | tracing, tracing-subscriber (JSON or text) |
| HTTP | tower-http (CORS, compression, tracing) |

## Development

### Prerequisites

- Rust 1.75+ (`rustc --version`)
- Node.js 22+ (`node --version`)
- npm 10+ (`npm --version`)

### Running Tests

```bash
# All tests
./scripts/test.sh

# Backend only
cargo test

# Frontend typecheck only
cd web && npm run typecheck
```

### Code Style

```bash
cargo fmt          # Format Rust code
cargo clippy       # Lint Rust code
cd web && npx tsc --noEmit  # Typecheck frontend
```

## Security

- Passwords hashed with Argon2id
- Access tokens SHA-256 hashed (never stored in plaintext)
- Session cookies: HttpOnly, SameSite=Lax, Secure (configurable)
- All DB queries scoped by `tenant_id` (no cross-tenant data leaks)
- URL protocol validation on import (no `javascript:` or `file:` schemes)
- Request ID tracing for audit trail

### Security Checklist for Production

- [ ] Set `LW_SESSION_SECRET` to a strong random value
- [ ] Use HTTPS (reverse proxy with TLS)
- [ ] Keep `LW_COOKIE_SECURE=true`
- [ ] Restrict `LW_CORS_ORIGINS` to your domain
- [ ] Set up regular backups
- [ ] Firewall the direct port (3000)
- [ ] Monitor `/metrics` and logs

## License

AGPL-3.0

## Acknowledgments

- [Floccus](https://floccus.org) — Browser bookmark sync extension
- [Linkwarden](https://linkwarden.app) — Original project (API compatibility reference)
- [Axum](https://github.com/tokio-rs/axum) — Web framework
- [sqlx](https://github.com/launchbadge/sqlx) — Async SQL toolkit
