# Deployment Guide

This guide covers deploying Linkwarden in production environments.

## Quick Start (Docker)

```bash
# 1. Clone and configure
git clone <repo-url> linkwarden
cd linkwarden
cp .env.example .env
# Edit .env and set LW_SESSION_SECRET
openssl rand -hex 32  # generate a secret

# 2. Build and run
docker compose up -d

# 3. Check health
curl http://localhost:3000/health/live
```

## Binary Deployment

### 1. Build

```bash
cargo build --release
# Binary: target/release/linkwarden
```

The release build automatically embeds the frontend (from `web/dist/`).

### 2. Install

```bash
sudo useradd -r -s /sbin/nologin linkwarden
sudo mkdir -p /opt/linkwarden/data
sudo chown linkwarden:linkwarden /opt/linkwarden

sudo cp target/release/linkwarden /opt/linkwarden/bin/
sudo cp deploy/linkwarden.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 3. Configure

Edit `/etc/systemd/system/linkwarden.service`:
- Set `LW_SESSION_SECRET` to a 32-byte hex string (`openssl rand -hex 32`)
- Adjust `LW_LISTEN` if needed (default: `127.0.0.1:3000`)

### 4. Start

```bash
sudo systemctl enable linkwarden
sudo systemctl start linkwarden
sudo systemctl status linkwarden
```

## Reverse Proxy

### Nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/linkwarden
sudo ln -s /etc/nginx/sites-available/linkwarden /etc/nginx/sites-enabled/
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
| `LW_DATA_DIR` | `data` | Data directory (SQLite DB, imports, exports) |
| `LW_DATABASE_URL` | derived | SQLite connection string |
| `LW_LISTEN` | `0.0.0.0:3000` | Bind address |
| `LW_SESSION_SECRET` | random | 32-byte hex secret for sessions |
| `LW_COOKIE_SECURE` | `true` | Set to `false` if no HTTPS |
| `LW_CORS_ORIGINS` | empty | Comma-separated allowed origins |
| `LW_LOG_FORMAT` | `text` | `json` for structured logging |
| `RUST_LOG` | `info` | Log level filter |

## Backup and Restore

### Automated Backup (cron)

```bash
# Add to crontab - run daily at 3 AM
0 3 * * * /opt/linkwarden/deploy/backup.sh >> /var/log/linkwarden-backup.log 2>&1
```

### Manual Backup

```bash
./deploy/backup.sh /opt/linkwarden/data /opt/linkwarden/data/backups
```

Backups use SQLite's online backup API, safe to run while the server is up.
Retention: last 30 backups are kept.

### Restore

```bash
# Stop the server first!
sudo systemctl stop linkwarden

./deploy/restore.sh /opt/linkwarden/data/backups/linkwarden_20260904_030000.sqlite3.gz /opt/linkwarden/data

sudo systemctl start linkwarden
```

## Monitoring

### Health Checks

- `GET /health/live` — always returns 200 if the process is running
- `GET /health/ready` — returns 200 if the database is reachable

### Metrics

`GET /metrics` — Prometheus-compatible metrics:

```
linkwarden_users_total 42
linkwarden_tenants_total 7
linkwarden_links_total 15234
linkwarden_collections_total 156
linkwarden_active_sessions 23
```

### Structured Logging

Set `LW_LOG_FORMAT=json` for JSON-structured logs with request IDs:

```json
{"timestamp":"2026-09-04T03:00:00Z","level":"INFO","target":"linkwarden","fields":{"msg":"listening","addr":"127.0.0.1:3000"}}
```

Each request includes an `x-request-id` header (propagated or auto-generated).

## Security Checklist

- [ ] Set `LW_SESSION_SECRET` to a strong random value
- [ ] Use HTTPS (reverse proxy with TLS)
- [ ] Set `LW_COOKIE_SECURE=true` (default)
- [ ] Restrict `LW_CORS_ORIGINS` to your domain
- [ ] Set up regular backups
- [ ] Keep the system updated
- [ ] Monitor `/metrics` and logs
- [ ] Firewall the direct port (3000) — only expose via reverse proxy

## Upgrading

```bash
# 1. Backup
./deploy/backup.sh

# 2. Stop
sudo systemctl stop linkwarden

# 3. Build new version
git pull && cargo build --release

# 4. Replace binary
sudo cp target/release/linkwarden /opt/linkwarden/bin/

# 5. Start (migrations run automatically)
sudo systemctl start linkwarden
```
