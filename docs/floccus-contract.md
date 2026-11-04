# Cloudflare Floccus WebDAV/XBEL contract

## Identity and storage

WebDAV uses HTTP Basic authentication: any username, and a Linkdock access token
as password. Each token is bound to one user and one read-only/read-write scope.
Use one token per device. Tokens are SHA-256 hashed and shown once on creation.
Account and administrator APIs accept only session cookies. Sessions are hashed.

The collection is `/webdav/`. Each flat `.xbel` filename maps to a current immutable
R2 object through the user's Durable Object. Files are checked for UTF-8 and
well-formed XBEL XML, but never rewritten. Stable IDs, mixed order and unknown
metadata remain byte-for-byte intact. External DTDs/entities are rejected; a
simple `<!DOCTYPE xbel>` is accepted. Maximum depth is 128, maximum XML elements
100,000, and the default maximum upload size is 10 MiB.

## Methods

- OPTIONS reports supported methods.
- PROPFIND supports Depth 0/1 and lists current files, the requesting token's
  staging files, and active locks.
- GET/HEAD reads files and returns ETag, size and Last-Modified.
- PUT `.xbel` validates and commits a new immutable version.
- PUT `.xbel.temp` stores private staging bytes for the requesting device.
- MOVE `.temp` to `.xbel` validates staged bytes and atomically updates the current
  pointer/history while deleting staging metadata.
- PUT `.xbel.lock` acquires or refreshes a five-minute device-owned lock.
- DELETE removes files, owned staging, or an owned/expired lock.

LOCK/UNLOCK, arbitrary folders, COPY, dead properties, and visual node editing are
not supported. This is an XBEL synchronization service, not a general file drive.

## Concurrency and failures

Every operation for a user passes through one serialized Durable Object queue,
including the web file API. R2 awaits must not let other requests enter a pointer
transition. Competing live lock owners receive 423. Session-authenticated file
imports, deletes and history restores are blocked by any live device lock.
Locks expire by timestamp; no asynchronous cleanup can delete a refreshed lock.

PUT/DELETE honor If-Match and If-None-Match. MOVE applies them to its destination
and honors Overwrite: F. Failed conditions return 412. The web UI supplies the
current ETag, or If-None-Match: * when importing a new filename. A client omitting
conditions still uses Floccus's lock workflow; a successful raw upload does not
perform semantic merges of simultaneous bookmark changes.

R2 does not participate in SQLite transactions. New bytes are uploaded under an
immutable key, then the current pointer, revision, history and staging deletion
change in one synchronous SQLite transaction. A failed commit leaves the old file
intact. Failed uploads/commits leave cleanup records, rather than current pointers
to nonexistent objects. MOVE reuses the existing immutable staging object.

Cleanup uses durable alarms and only deletes unreferenced object keys. Abandoned
staging expires after one day. Old history and deleted objects are reclaimed after
a grace period. R2 and DO storage must both be retained/backed up; copying the R2
bucket alone does not restore filenames, locks or history.

## Web file API and history

- GET `/api/app/v1/files` lists this user's files.
- GET/HEAD/PUT/DELETE `/api/app/v1/files/{filename}` exports/imports/deletes files.
- GET `/api/app/v1/files/{filename}/versions` lists versions.
- GET `/api/app/v1/files/{filename}/versions/{id}` exports a version.
- POST to the same version URL restores it as a new current revision.

Default retention is the current version plus 20 previous versions. Restoration
preserves selected bytes and saves the displaced current version in history.
Deleting a file removes its history too. These snapshots do not replace backups.
All paths and history IDs remain user-scoped. Filenames cannot contain slashes,
backslashes or control characters.

## Browser security

PUBLIC_URL sets the allowed browser origin. Cross-origin browser API/WebDAV
requests are rejected. Non-browser requests without Origin/Fetch Metadata headers
remain supported with credentials. Account cookies are HttpOnly/SameSite=Lax and
Secure on HTTPS. API and WebDAV responses use Cache-Control: no-store.

## Quotas and operations

Per-user file count, unique object bytes (including history/staging/pending cleanup),
and active token limits are configurable. Global defaults may be overridden per
user. Lower limits never delete data. Storage/file exhaustion returns 507 and token
exhaustion returns 409. Downloads/deletion remain available subject to locks. File
count reserves staged targets; bytes are reserved before R2 upload. Failed uploads
retain conservative reservations until safe cleanup.

GET `/api/app/v1/usage` returns authenticated live usage. Administrator-only
`/admin/settings`, `/admin/invitations`, `/admin/users/{id}/quota`,
`/admin/operations`, `/admin/users/{id}/operations` and `/admin/users/{id}/cleanup`
manage policy and operations. Global totals are timestamped samples. Failure logs
are bounded and contain only method/status/time. No content or credentials are logged.

Hourly cron expires D1 sessions and samples up to 25 users using a persistent cursor.
DO alarms process bounded cleanup queues and scan only the owning R2 prefix for old
unreferenced objects. Metadata references and grace periods are always checked
before deleting. Failed cleanup records an error and retries.
