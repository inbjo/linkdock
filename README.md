# Linkdock

A self-hosted, **Floccus-compatible** bookmark management service built with Rust, Axum, and SQLite. Sync your browser bookmarks across Chrome, Firefox, and Brave using the [Floccus](https://floccus.org) browser extension.

## Features

- **Floccus Compatibility** — Works with Floccus v5.9+ via the Linkdock adapter (9 API endpoints)
- **Multi-Workspace** — Separate personal, work, family, or team bookmark libraries with role-based access
- **Collection Tree** — Nested folders with cycle detection
- **Full-Text Search** — SQLite FTS5 with cursor pagination
- **Soft Delete & Trash** — Restore accidentally deleted bookmarks
- **Import / Export** — Netscape HTML, Linkdock JSON, CSV, XBEL
- **Access Tokens** — SHA-256 hashed, scoped, revocable (for Floccus sync)
- **Passkeys** — Passwordless login with Touch ID, Face ID, Windows Hello, or security keys
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
git clone <repo-url> linkdock
cd linkdock

# 2. Configure
cp .env.example .env
# Generate a session secret
echo "DOCK_SESSION_SECRET=$(openssl rand -hex 32)" >> .env

# 3. Build and run
docker compose up -d

# 4. Verify
curl http://localhost:3000/health/live
# → ok
```

Open `http://localhost:3000` in your browser, register an account, and start bookmarking.

On a fresh public instance, protect the first registration with a one-time initialization token:

```bash
DOCK_SETUP_TOKEN=$(openssl rand -hex 32)
```

The first account becomes the system administrator. Each account receives a personal workspace;
users can create additional workspaces and share them as owner, admin, editor, or viewer.

To enable Passkeys on a production domain, the configured origin must exactly match the
public HTTPS origin. For the `sina.dev` mirror:

```bash
DOCK_WEBAUTHN_RP_ID=sina.dev
DOCK_WEBAUTHN_ORIGIN=https://sina.dev
```

### With HTTPS (Caddy Reverse Proxy)

```bash
# Set your domain in .env
echo "DOCK_DOMAIN=bookmarks.yourdomain.com" >> .env

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
DOCK_DATA_DIR=./data DOCK_SESSION_SECRET=$(openssl rand -hex 32) \
    ./target/release/linkdock
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

Each access token is permanently bound to the active workspace at creation time. When syncing
multiple workspaces in one browser, use separate, non-overlapping local bookmark folders and one
Floccus profile/token per workspace. Viewers receive read-only tokens and should select Floccus's
one-way server-to-browser strategy; owner, admin, and editor roles may use bidirectional sync.

1. **Create an access token**: Log in → Settings → Access Tokens → Create Token → Copy
2. **Install Floccus**: Get the [Floccus browser extension](https://floccus.org)
3. **Configure Floccus**:
   - Sync method: **Linkdock**
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
| GET | `/auth/setup` | Check first-account initialization requirements |
| POST | `/auth/login` | Login (returns session cookie) |
| POST | `/auth/passkey/start` | Start Passkey login for a username |
| POST | `/auth/passkey/finish` | Verify Passkey and create session |
| POST | `/auth/logout` | Logout |
| GET | `/me` | Current user info + active tenant |
| GET/DELETE | `/passkeys` / `/passkeys/{id}` | List/remove Passkeys |
| POST | `/passkeys/register/{start,finish}` | Register a Passkey |
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
| `DOCK_DATA_DIR` | `data` | Data directory (SQLite DB, imports, exports, backups) |
| `DOCK_DATABASE_URL` | derived | SQLite connection string |
| `DOCK_LISTEN` | `0.0.0.0:3000` | Bind address |
| `DOCK_SESSION_SECRET` | random | 32-byte hex secret for session signing |
| `DOCK_COOKIE_SECURE` | `true` | Set `false` if no HTTPS |
| `DOCK_SETUP_TOKEN` | empty | Optional one-time protection for the first account on a fresh instance |
| `DOCK_CORS_ORIGINS` | empty | Comma-separated allowed origins |
| `DOCK_WEBAUTHN_RP_ID` | `localhost` | Passkey relying-party domain (no scheme or port) |
| `DOCK_WEBAUTHN_ORIGIN` | `http://localhost:3000` | Exact public origin used for Passkeys |
| `DOCK_WEBAUTHN_RP_NAME` | `Linkdock` | Service name shown by authenticators |
| `DOCK_LOG_FORMAT` | `text` | `json` for structured logging |
| `RUST_LOG` | `info` | Log level filter |
| `DOCK_PORT` | `3000` | Docker compose host port |
| `DOCK_DOMAIN` | — | Domain for Caddy reverse proxy |

## Deployment

### Docker Compose

```bash
cp .env.example .env
# Edit .env: set DOCK_SESSION_SECRET
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
sudo useradd -r -s /sbin/nologin linkdock
sudo mkdir -p /opt/linkdock/{bin,data}
sudo cp target/release/linkdock /opt/linkdock/bin/
sudo cp deploy/linkdock.service /etc/systemd/system/

# Edit service file to set DOCK_SESSION_SECRET
sudo systemctl daemon-reload
sudo systemctl enable --now linkdock
```

### Reverse Proxy

**Nginx**: Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/`, edit `server_name` and SSL paths, enable.

**Caddy**: Copy `deploy/Caddyfile` to `/etc/caddy/`, edit domain, restart Caddy.

See `deploy/README.md` for detailed instructions.

## Backup & Restore

```bash
# Backup (safe to run while server is up)
./deploy/backup.sh /opt/linkdock/data /opt/linkdock/data/backups

# Restore (stop server first!)
sudo systemctl stop linkdock
./deploy/restore.sh /opt/linkdock/data/backups/linkdock_20260904_030000.sqlite3.gz /opt/linkdock/data
sudo systemctl start linkdock
```

For automated backups, add to crontab:
```cron
0 3 * * * /opt/linkdock/deploy/backup.sh >> /var/log/linkdock-backup.log 2>&1
```

Backups use SQLite's online backup API (safe during operation). Retention: last 30 backups.

## Monitoring

### Health Checks
- `GET /health/live` — process is running
- `GET /health/ready` — database is reachable

### Prometheus Metrics
```
GET /metrics

linkdock_users_total 42
linkdock_tenants_total 7
linkdock_links_total 15234
linkdock_collections_total 156
linkdock_active_sessions 23
```

### Structured Logging
Set `DOCK_LOG_FORMAT=json` for JSON logs with request IDs:
```json
{"timestamp":"2026-09-04T03:00:00Z","level":"INFO","target":"linkdock","fields":{"msg":"listening","addr":"0.0.0.0:3000"}}
```

Every response includes an `x-request-id` header (auto-generated or propagated from request).

## Project Structure

```
linkdock/
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
│   │   └── linkdock/     # Floccus API (/api/v1/)
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
│   ├── linkdock.service  # systemd service file
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

- [ ] Set `DOCK_SESSION_SECRET` to a strong random value
- [ ] Use HTTPS (reverse proxy with TLS)
- [ ] Keep `DOCK_COOKIE_SECURE=true`
- [ ] Restrict `DOCK_CORS_ORIGINS` to your domain
- [ ] Set up regular backups
- [ ] Firewall the direct port (3000)
- [ ] Monitor `/metrics` and logs

## License

AGPL-3.0

## Acknowledgments

- [Floccus](https://floccus.org) — Browser bookmark sync extension
- [Linkdock](https://linkdock.app) — Original project (API compatibility reference)
- [Axum](https://github.com/tokio-rs/axum) — Web framework
- [sqlx](https://github.com/launchbadge/sqlx) — Async SQL toolkit
