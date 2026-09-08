# Deployment Guide

This guide covers deploying Linkdock in production environments.

## Quick Start (Docker)

```bash
# 1. Clone and configure
git clone <repo-url> linkdock
cd linkdock
cp .env.example .env
# Edit .env and set DOCK_SESSION_SECRET
openssl rand -hex 32  # generate a secret

# 2. Build and run
docker compose up -d

# 3. Check health
curl http://localhost:3000/health/live
```

## Binary Deployment

### 1. Build

```bash
./scripts/build.sh --static
# Binary: target/x86_64-unknown-linux-musl/release/linkdock
```

The release build automatically embeds the frontend (from `web/dist/`).

### 2. Install

```bash
sudo useradd -r -s /sbin/nologin linkdock
sudo mkdir -p /opt/linkdock/data
sudo chown linkdock:linkdock /opt/linkdock

sudo cp target/release/linkdock /opt/linkdock/bin/
sudo cp deploy/linkdock.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 3. Configure

Edit `/etc/systemd/system/linkdock.service`:
- Set `DOCK_SESSION_SECRET` to a 32-byte hex string (`openssl rand -hex 32`)
- Set `DOCK_SETUP_TOKEN` to a separate random value before exposing a fresh instance publicly
- Adjust `DOCK_LISTEN` if needed (default: `127.0.0.1:3000`)
- Set `DOCK_WEBAUTHN_RP_ID` and `DOCK_WEBAUTHN_ORIGIN` to the public domain and exact HTTPS origin

### 4. Start

```bash
sudo systemctl enable linkdock
sudo systemctl start linkdock
sudo systemctl status linkdock
```

## Reverse Proxy

### Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/linkdock
sudo ln -s /etc/nginx/sites-available/linkdock /etc/nginx/sites-enabled/
# Edit server_name and SSL paths
sudo nginx -t && sudo systemctl reload nginx
```

### Caddy

```bash
# Edit deploy/Caddyfile with your domain
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DOCK_DATA_DIR` | `data` | Data directory (SQLite DB, imports, exports) |
| `DOCK_DATABASE_URL` | derived | SQLite connection string |
| `DOCK_LISTEN` | `0.0.0.0:3000` | Bind address |
| `DOCK_SESSION_SECRET` | random | 32-byte hex secret for sessions |
| `DOCK_COOKIE_SECURE` | `true` | Set to `false` if no HTTPS |
| `DOCK_SETUP_TOKEN` | empty | Optional initialization secret required only by the first account |
| `DOCK_CORS_ORIGINS` | empty | Comma-separated allowed origins |
| `DOCK_WEBAUTHN_RP_ID` | `localhost` | Passkey relying-party domain, without scheme or port |
| `DOCK_WEBAUTHN_ORIGIN` | `http://localhost:3000` | Exact public origin used for Passkeys |
| `DOCK_WEBAUTHN_RP_NAME` | `Linkdock` | Service name shown by authenticators |
| `DOCK_LOG_FORMAT` | `text` | `json` for structured logging |
| `RUST_LOG` | `info` | Log level filter |

## Backup and Restore

### Automated Backup (cron)

```bash
# Add to crontab - run daily at 3 AM
0 3 * * * /opt/linkdock/deploy/backup.sh >> /var/log/linkdock-backup.log 2>&1
```

### Manual Backup

```bash
./deploy/backup.sh /opt/linkdock/data /opt/linkdock/data/backups
```

Backups use SQLite's online backup API, safe to run while the server is up.
Retention: last 30 backups are kept.

### Restore

```bash
# Stop the server first!
sudo systemctl stop linkdock

./deploy/restore.sh /opt/linkdock/data/backups/linkdock_20260904_030000.sqlite3.gz /opt/linkdock/data

sudo systemctl start linkdock
```

## Monitoring

### Health Checks

- `GET /health/live` — always returns 200 if the process is running
- `GET /health/ready` — returns 200 if the database is reachable

### Metrics

`GET /metrics` — Prometheus-compatible metrics:

```
linkdock_users_total 42
linkdock_tenants_total 7
linkdock_links_total 15234
linkdock_collections_total 156
linkdock_active_sessions 23
```

### Structured Logging

Set `DOCK_LOG_FORMAT=json` for JSON-structured logs with request IDs:

```json
{"timestamp":"2026-09-04T03:00:00Z","level":"INFO","target":"linkdock","fields":{"msg":"listening","addr":"127.0.0.1:3000"}}
```

Each request includes an `x-request-id` header (propagated or auto-generated).

## Security Checklist

- [ ] Set `DOCK_SESSION_SECRET` to a strong random value
- [ ] Set `DOCK_SETUP_TOKEN` before exposing an empty database publicly
- [ ] Use HTTPS (reverse proxy with TLS)
- [ ] Set `DOCK_COOKIE_SECURE=true` (default)
- [ ] Match the Passkey RP ID and Origin to the public HTTPS URL
- [ ] Restrict `DOCK_CORS_ORIGINS` to your domain
- [ ] Set up regular backups
- [ ] Keep the system updated
- [ ] Monitor `/metrics` and logs
- [ ] Firewall the direct port (3000) — only expose via reverse proxy

## Upgrading

```bash
# 1. Backup
./deploy/backup.sh

# 2. Stop
sudo systemctl stop linkdock

# 3. Build new version
git pull && cargo build --release

# 4. Replace binary
sudo cp target/release/linkdock /opt/linkdock/bin/

# 5. Start (migrations run automatically)
sudo systemctl start linkdock
```
