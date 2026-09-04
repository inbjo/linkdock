-- Phase 2: collections, links, tags, link_tags, FTS5
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id),
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_collections_tenant_parent ON collections(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_collections_tenant_active ON collections(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id),
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_links_tenant_collection ON links(tenant_id, collection_id);
CREATE INDEX IF NOT EXISTS idx_links_tenant_active ON links(tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (tenant_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS link_tags (
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (link_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tags_tenant ON tags(tenant_id);

-- FTS5 full-text index for links
CREATE VIRTUAL TABLE IF NOT EXISTS links_fts USING fts5(
    link_id UNINDEXED,
    tenant_id UNINDEXED,
    name,
    url,
    description,
    content=''
);

-- Triggers to keep FTS in sync on insert/update/delete (soft delete)
CREATE TRIGGER IF NOT EXISTS links_ai_fts AFTER INSERT ON links BEGIN
    INSERT INTO links_fts(link_id, tenant_id, name, url, description)
    VALUES (new.id, new.tenant_id, new.name, new.url, new.description);
END;

CREATE TRIGGER IF NOT EXISTS links_ad_fts AFTER UPDATE OF deleted_at ON links
WHEN old.deleted_at IS NULL AND new.deleted_at IS NOT NULL BEGIN
    DELETE FROM links_fts WHERE link_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS links_au_fts AFTER UPDATE OF name, url, description ON links
WHEN new.deleted_at IS NULL BEGIN
    UPDATE links_fts
    SET name = new.name, url = new.url, description = new.description
    WHERE link_id = new.id;
END;

CREATE TABLE IF NOT EXISTS import_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    skip_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
