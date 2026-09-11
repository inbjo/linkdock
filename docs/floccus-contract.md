# Floccus WebDAV/XBEL contract

Linkdock supports Floccus through its WebDAV adapter only. The former
Linkwarden-shaped `/api/v1` API is intentionally absent because that adapter does
not preserve sibling ordering.

## Authentication and isolation

- WebDAV uses HTTP Basic authentication.
- The username is ignored; the password must be a Linkdock access token.
- Each token is permanently bound to one workspace.
- Invalid credentials return `401` with a Basic-auth challenge.
- Every document, node, staging upload, and lock query is scoped by `tenant_id`.

## Resource model

The collection URL is `/webdav/`. A path ending in `.xbel` maps to one
`sync_documents` row. The default file is `bookmarks.xbel`.

An XBEL document is not stored as an opaque duplicate blob. Uploads are parsed
into `bookmark_nodes`, and downloads are serialized from those rows. The web tree
editor reads and writes the same rows.

Supported nodes are `<folder>`, `<bookmark href="…">`, and `<separator/>`.
`<title>` and `<desc>` are preserved. Stable element IDs are emitted and reused
on later uploads. Unknown metadata is ignored. Malformed XML, invalid bookmark
URLs, excessive depth, and excessive node counts are rejected before commit.

## Ordering

Folders, bookmarks, and separators use a single `position` sequence for each
parent. Serialization sorts by that position, never by node type. Visual reorder
requests must include every active sibling exactly once.

## WebDAV operations

- `GET` and `HEAD` serialize an `.xbel` document.
- `PROPFIND` reports collections, documents, staging files, and locks.
- `PUT *.xbel` parses and transactionally replaces the canonical tree.
- `PUT *.temp` stores token-private staging bytes.
- `MOVE *.temp -> *.xbel` parses and commits the staged file atomically.
- `PUT *.lock` acquires or refreshes a five-minute token-owned lock.
- `DELETE` removes a lock, staging resource, or document as appropriate.

A live lock owned by another token returns `423 Locked`. Session-authenticated
visual mutations also return `423` while a document has an active WebDAV lock.

## Replacement semantics

An upload is fully parsed and validated first. In one SQLite transaction Linkdock
then resolves the document, matches nodes by stable external ID, upserts their
content and exact position, soft-deletes absent nodes, increments the document
revision, and commits the complete tree. If parsing or validation fails, none of
the existing tree is changed.
