# Linkdock — Cloudflare branch

Multi-user Floccus WebDAV/XBEL file service on Workers, D1, Durable Objects, R2,
React and TypeScript. Original Rust sources are reference material; `master`
maintains the Rust release.

## Build and test

- `cd web && npm ci && npm run build`
- `cd cloudflare && npm ci && npm run typecheck && npm test`
- `cd cloudflare && npm run build` — frontend and Wrangler dry-run bundle
- `cd cloudflare && npm run db:local && npm run dev` — local runtime

Do not deploy, create remote resources, or apply remote migrations unless requested.

## Architecture

- D1 owns users, hashed sessions and hashed device tokens.
- Authenticate at the Worker edge; user identity always comes from credentials.
- Route every user's file operation to one UserFiles Durable Object.
- Explicitly serialize operations across R2 awaits; DO handlers can interleave.
- Durable Object SQLite owns locks, staging, current file pointers and history.
- R2 stores immutable XBEL bytes. Preserve metadata and exact mixed-node order.
- Never persist or maintain a second canonical bookmark tree.
- `.lock` resources have device-token ownership and a five-minute expiry.
- All mutations, including web import/delete/restore, obey the same locks.
- R2 writes precede an atomic SQLite pointer/history/staging transition.
- Cleanup must never delete any referenced R2 object.
- Scope D1 session and token queries by authenticated user_id.
- Account/admin APIs require a session; bookmark tokens cannot use them.
- The `/api/v1` compatibility API and visual node APIs remain unsupported.

## Main source areas

- `cloudflare/src/index.ts` — edge routing, identity, browser security
- `cloudflare/src/auth.ts` — D1 accounts, sessions, tokens, administration
- `cloudflare/src/files.ts` — serialized files, locks, history and R2 cleanup
- `cloudflare/test/integration.test.ts` — real runtime contract tests
- `web/src/pages/FilesPage.tsx` — file import/export and history
- `docs/floccus-contract.md` — synchronization contract

## Operations

- D1 migrations are append-only; keep existing users and binding identities.
- Invitation consumption and user insertion must share one D1 transaction.
- Storage quotas include unique historical, staging and queued-for-cleanup objects.
- Never cache locks, token revocation or quota decisions in eventually consistent KV.
- Turnstile requires server-side success, hostname and action checks.
- Admin statistics are sampled and timestamped; they are not provider billing.
- Deployment is manual; scripts must reject placeholder production config before mutation.
