# Linkdock pre-1.0 architecture

## Goal

Provide deterministic multi-device bookmark synchronization through Floccus
WebDAV/XBEL while exposing the exact same ordered tree in Linkdock's web UI.

## Canonical model

- One `sync_documents` row per workspace-relative `.xbel` path.
- One `bookmark_nodes` table for folders, bookmarks, and separators.
- A shared `(parent_id, position)` sequence preserves mixed sibling order.
- XBEL external IDs remain stable across synchronization rounds.
- Tags are Linkdock metadata attached to stable node rows.

SQLite is the sole source of truth. There is no independent XBEL blob after a
commit and no legacy collection/link model.

## Write paths

1. WebDAV validates Basic credentials and workspace scope.
2. Floccus acquires a token-owned lock and uploads a private temporary file.
3. `MOVE` parses and validates the complete XBEL document.
4. A single transaction upserts stable nodes, replaces positions, soft-deletes
   missing nodes, and increments the document revision.
5. Web UI node mutations use the same tables and are rejected while a WebDAV lock
   is live.

Malformed input never changes the current tree. Competing tokens receive
`423 Locked` instead of silently overwriting one another.

## Read paths

- WebDAV serializes deterministic XBEL directly from ordered nodes.
- The visual API returns the same rows as a nested mixed-node tree.
- All reads and writes are tenant-scoped from authenticated server context.

## Supported release

Only Linux deployment artifacts are supported. The release build embeds the
React frontend and is distributed as an x86_64 musl binary or container image.
