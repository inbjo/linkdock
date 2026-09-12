# Linkdock

Linkdock is a self-hosted bookmark manager and an order-preserving WebDAV/XBEL
server for [Floccus](https://floccus.org). It is built with Rust, Axum, SQLite,
React, and TypeScript.

The browser extension and web interface operate on the same canonical tree.
Folders, bookmarks, and separators share one ordered sibling list, so their exact
mixed order is preserved between devices and remains editable in the web UI.

## Features

- WebDAV/XBEL synchronization compatible with Floccus
- Exact folder, bookmark, and separator ordering across devices
- Visual XBEL tree editor backed by the same SQLite data
- Drag-and-drop reordering and cross-folder moves
- Multiple XBEL documents per user account
- Multi-user registration with user data isolation
- Hashed, revocable access tokens with read/write or read-only scopes
- Passkey (WebAuthn) login and registration
- Password recovery via configurable SMTP
- Admin dashboard: statistics, user management, SMTP settings, audit log
- Configurable site metadata (title, description, keywords) and favicon
- Embedded frontend in a single Linux binary
- Light/dark theme with OKLCH color tokens

## Quick start

```bash
cp .env.example .env
echo "DOCK_SESSION_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d
```

Open `http://localhost:3000`, create an account, and create an access token under
Settings. On a public instance, set `DOCK_SETUP_TOKEN` before the first account is
registered; the first account becomes the system administrator.

## Floccus setup

Create one access token for your account, then configure Floccus as:

- Sync method: **WebDAV**
- Server URL: `https://your-domain.example/webdav/`
- Username: any non-empty value, such as `linkdock`
- Password: the Linkdock access token
- Bookmark file: `bookmarks.xbel`
- Bookmark file format: **XBEL**

For an existing bookmark collection, configure the device with the correct tree
first and perform one local-to-server sync. Configure other devices with the same
filename only after that upload completes.

WebDAV uploads, temporary-file moves, locks, and web editor mutations all commit
to the same transactional tree. Downloads are serialized from that tree rather
than served from a second blob copy. See [the WebDAV/XBEL contract](docs/floccus-contract.md).

## Build and test

Linux is the only release target.

```bash
cd web
npm ci
npm run build
cd ..

cargo test
cargo clippy -- -D warnings
./scripts/build.sh --static
```

The static build produces
`target/x86_64-unknown-linux-musl/release/linkdock` with the frontend embedded.

Run a development build with:

```bash
DOCK_DATA_DIR=./data DOCK_LISTEN=0.0.0.0:3000 cargo run --release
```

## Main endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health/live` | Liveness |
| `GET` | `/health/ready` | Database readiness |
| `GET` | `/metrics` | Prometheus metrics |
| WebDAV | `/webdav/*` | Floccus XBEL files and locks |
| `GET` | `/api/app/v1/documents` | List visual XBEL documents |
| `POST` | `/api/app/v1/documents/default` | Create the default document |
| `GET` | `/api/app/v1/documents/{id}/tree` | Read the ordered tree |
| `PUT` | `/api/app/v1/documents/{id}/order` | Replace one sibling order |
| `POST` | `/api/app/v1/nodes` | Create a tree node |
| `PUT/DELETE` | `/api/app/v1/nodes/{id}` | Edit or remove a subtree |
| `GET/PUT` | `/api/app/v1/admin/site` | Site metadata (TDK) |
| `GET/PUT` | `/api/app/v1/admin/smtp` | SMTP settings |
| `GET` | `/api/app/v1/admin/stats` | Instance statistics |
| `GET` | `/api/app/v1/admin/users` | User listing (admin) |
| `GET` | `/api/app/v1/admin/audit` | Audit log (admin) |

Web management APIs use the session cookie. WebDAV uses HTTP Basic auth: the
username is ignored and the access token is the password.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DOCK_DATA_DIR` | `data` | SQLite and application data directory |
| `DOCK_DATABASE_URL` | derived | SQLite connection string |
| `DOCK_LISTEN` | `0.0.0.0:3000` | Bind address |
| `DOCK_SESSION_SECRET` | generated | Session signing secret; set explicitly in production |
| `DOCK_COOKIE_SECURE` | `true` | Secure session cookie flag |
| `DOCK_SETUP_TOKEN` | empty | Protect first-account registration |
| `DOCK_CORS_ORIGINS` | empty | Additional comma-separated origins |
| `DOCK_LOG_FORMAT` | `text` | `text` or `json` |
| `RUST_LOG` | `info` | Logging filter |

Passkey deployments can additionally set `DOCK_WEBAUTHN_RP_ID`,
`DOCK_WEBAUTHN_ORIGIN`, `DOCK_WEBAUTHN_RP_NAME`, and `DOCK_PUBLIC_URL`.

## Data model

`sync_documents` identifies each XBEL file. `bookmark_nodes` stores folders,
bookmarks, and separators in one table with a shared `parent_id` and `position`.
Stable XBEL IDs allow uploads to update existing rows and retain web metadata such
as tags. Replacing a document happens in one SQLite transaction. User identity
always comes from a server-side session or access token, never from request data.

## Deployment

Docker, systemd, Nginx/Caddy, backups, and monitoring are documented in
[deploy/README.md](deploy/README.md). The release artifact is Linux-only; no
Windows packaging or runtime support is maintained.

## License

MIT
