# Linkdock — Rust

A self-hosted bookmark manager and order-preserving Floccus WebDAV/XBEL server
built with Rust, Axum, SQLite, React, and TypeScript.

## Build and test

- `cargo build` — debug build
- `cargo build --release` — release build with embedded `web/dist/`
- `./scripts/build.sh --static` — portable x86_64 Linux musl release
- `cargo test` — backend and integration tests
- `cargo clippy -- -D warnings` — lint
- `cargo fmt` — format
- `cd web && npm ci && npm run build` — frontend build

Linux is the only supported release target.

## Architecture

- `sync_documents` represents XBEL files.
- `bookmark_nodes` is the canonical mixed folder/bookmark/separator tree.
- Every sibling type shares the same `position` ordering.
- WebDAV and the visual editor operate on the same SQLite rows.
- WebDAV uploads are parsed and committed transactionally; XBEL downloads are
  serialized from the canonical tree.
- The Linkwarden-shaped `/api/v1` compatibility API is intentionally unsupported.
- All resources (documents, nodes, tags, tokens, audit, WebDAV staging/locks)
  are owned directly by `user_id`.
- `user_id` always comes from the session or access token.
- All data queries must include `user_id` scoping.
- Access tokens are SHA-256 hashed and shown only once.
- Active WebDAV locks block competing sync and visual mutations.

## Main source areas

- `src/services/bookmark.rs` — XBEL parsing/serialization and tree operations
- `src/routes/webdav.rs` — Floccus WebDAV surface
- `src/routes/app/bookmark.rs` — visual tree management API
- `web/src/pages/BookmarksPage.tsx` — visual XBEL tree editor
- `docs/floccus-contract.md` — protocol and consistency contract
