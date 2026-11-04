# Linkdock — Cloudflare edition

This branch provides a multi-user Floccus WebDAV/XBEL file service on Cloudflare
Workers, D1, Durable Objects, and R2. React provides file import/export, history,
profile settings, device access tokens, invitations, registration policies, storage
quotas, maintenance status and user administration.

XBEL is stored unchanged in R2. There is no visual bookmark editor, node database,
tag system, or node trash. Each user has independent files and device-owned sync
locks. The original Rust self-hosted implementation is maintained on `master`;
Rust sources here are retained for reference and are not part of this deployment.

## Start locally

```bash
cd web
npm ci
npm run build
cd ../cloudflare
npm ci
cp .dev.vars.example .dev.vars
# Replace SETUP_TOKEN with a random secret.
npm run db:local
npm run dev
```

Open `http://localhost:8787`. The first user must provide SETUP_TOKEN and becomes
administrator. Subsequent accounts are ordinary users. Administrators can choose
closed, invited or open registration, optional Turnstile, and per-user quotas.

## Floccus

Create a separate read/write access token for each device, then use:

- WebDAV URL: `https://your-domain.example/webdav/`
- Username: any non-empty value
- Password: the device access token
- Filename: `bookmarks.xbel`
- File format: XBEL

Import an existing XBEL through the web interface, or start with a local-to-server
Floccus sync. Configure subsequent devices after the first upload completes.

## Checks

```bash
cd web && npm ci && npm run build
cd ../cloudflare && npm ci
npm run preflight
npm run typecheck
npm run test:scripts
npm test
npm run build
```

Tests run in the actual local Workers runtime with D1, R2, and SQLite-backed
Durable Objects. Build includes a Wrangler dry run and never publishes a Worker.

Deployment, runtime limits, and migration boundaries are in
[cloudflare/README.md](cloudflare/README.md). Protocol guarantees are in
[docs/floccus-contract.md](docs/floccus-contract.md).

MIT licensed. The implementation follows the Cloudflare architecture discussed
in the assessment; it does not vendor code from cf-free-webdav.
