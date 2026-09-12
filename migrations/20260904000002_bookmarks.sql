-- Canonical ordered bookmark trees. Each WebDAV/XBEL file is one document;
-- folders and bookmarks share one node table and one sibling position space.
CREATE TABLE sync_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0,
    next_external_id INTEGER NOT NULL DEFAULT 1,
    updated_unix INTEGER NOT NULL DEFAULT (unixepoch()),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, path)
);

CREATE INDEX idx_sync_documents_user ON sync_documents(user_id);

CREATE TABLE bookmark_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    document_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER,
    node_type TEXT NOT NULL CHECK (node_type IN ('folder','bookmark','separator')),
    external_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT,
    description TEXT NOT NULL DEFAULT '',
    color TEXT,
    position INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (document_id, external_id),
    FOREIGN KEY (document_id) REFERENCES sync_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES bookmark_nodes(id) ON DELETE CASCADE
);

CREATE INDEX idx_bookmark_nodes_tree
ON bookmark_nodes(document_id, parent_id, position)
WHERE deleted_at IS NULL;
CREATE INDEX idx_bookmark_nodes_user_type
ON bookmark_nodes(user_id, node_type)
WHERE deleted_at IS NULL;

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, normalized_name)
);

CREATE TABLE node_tags (
    node_id INTEGER NOT NULL REFERENCES bookmark_nodes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, tag_id)
);

CREATE INDEX idx_tags_user ON tags(user_id);

CREATE VIRTUAL TABLE bookmark_nodes_fts USING fts5(
    node_id UNINDEXED,
    user_id UNINDEXED,
    title,
    url,
    description
);

CREATE TRIGGER bookmark_nodes_ai_fts AFTER INSERT ON bookmark_nodes
WHEN new.node_type = 'bookmark' AND new.deleted_at IS NULL BEGIN
    INSERT INTO bookmark_nodes_fts(node_id, user_id, title, url, description)
    VALUES (new.id, new.user_id, new.title, coalesce(new.url, ''), new.description);
END;

CREATE TRIGGER bookmark_nodes_ad_fts AFTER DELETE ON bookmark_nodes
WHEN old.node_type = 'bookmark' BEGIN
    DELETE FROM bookmark_nodes_fts WHERE node_id = old.id;
END;

CREATE TRIGGER bookmark_nodes_au_fts AFTER UPDATE OF title, url, description, deleted_at ON bookmark_nodes
WHEN new.node_type = 'bookmark' BEGIN
    DELETE FROM bookmark_nodes_fts WHERE node_id = new.id;
    INSERT INTO bookmark_nodes_fts(node_id, user_id, title, url, description)
    SELECT new.id, new.user_id, new.title, coalesce(new.url, ''), new.description
    WHERE new.deleted_at IS NULL;
END;

CREATE TABLE webdav_staging (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    owner_token_id INTEGER NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
    content BLOB NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/xml',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, path, owner_token_id)
);

CREATE TABLE sync_locks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    owner_token_id INTEGER NOT NULL REFERENCES access_tokens(id) ON DELETE CASCADE,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, path)
);
