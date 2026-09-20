# Floccus WebDAV/XBEL contract

Linkdock supports Floccus through its WebDAV adapter only. The former
Linkwarden-shaped `/api/v1` API is intentionally absent because that adapter does
not preserve sibling ordering.

## Authentication and isolation

- WebDAV uses HTTP Basic authentication.
- The username is ignored; the password must be a Linkdock access token.
- Each token is permanently bound to its creating user.
- Invalid credentials return `401` with a Basic-auth challenge.
- Every document, node, staging upload, and lock query is scoped by `user_id`.
- Bookmark tokens cannot access account, session, Passkey, or administrator APIs.

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
Locks are owned by access tokens: use a separate token for each device to make
competing devices distinguishable. Lock validation and writes share one SQLite
`BEGIN IMMEDIATE` transaction. Expired-lock cleanup cannot delete a refreshed lock.

GET/HEAD responses include a strong ETag based on document UUID and revision.
PUT and DELETE honor `If-Match` and `If-None-Match`. MOVE checks these conditions
against its destination and honors `Overwrite: F`. Failed conditions return 412;
clients that omit conditions retain Floccus's lock-based workflow. MOVE commits
the destination tree, snapshot, and staging deletion together, or none of them.

The visual editor reads nodes and revision together from
`GET /api/app/v1/documents/{id}/view` and includes `expected_revision` in mutations
(a query parameter for DELETE). A stale version returns 412 without changing data.
API clients should also supply this value; omitting it performs an unconditional
write subject to the active lock checks.

## Replacement semantics

An upload is fully parsed and validated first. In one SQLite transaction Linkdock
then resolves the document, matches nodes by stable external ID, upserts their
content and exact position, soft-deletes absent nodes, increments the document
revision, and commits the complete tree. If parsing or validation fails, none of
the existing tree is changed.

## Search and recovery

`GET /api/app/v1/documents/{id}/search?q=...&offset=0` searches active bookmarks by
title, URL, and description. Search and trash listings return at most 100 rows.
`GET /api/app/v1/documents/{id}/trash` lists deleted subtrees; `POST
/api/app/v1/nodes/{id}/restore` restores a subtree from the same deletion operation.
An unavailable parent causes the restored subtree to be appended to the root.

Before replacing an existing document, the server retains an XBEL snapshot, up
to 20 per document. List these at `GET /api/app/v1/documents/{id}/snapshots` and
restore with `POST /api/app/v1/snapshots/{id}/restore`. Restoration saves the
current document first and accepts `expected_revision`. Snapshots cover XBEL
content and ordering; tags and other web-only metadata keep their current values.
Snapshots belong to the document and are removed by a WebDAV document DELETE.
They complement, but do not replace, full database backups.

## Browser origins

The default policy allows only the origin of `DOCK_PUBLIC_URL`. Cross-origin
browser API/WebDAV requests are rejected before handlers run. Non-browser clients
without Origin/Fetch Metadata headers continue to use token authentication.
If an extension sends an Origin, explicitly add its exact origin to
`DOCK_CORS_ORIGINS`; do not use a wildcard.
