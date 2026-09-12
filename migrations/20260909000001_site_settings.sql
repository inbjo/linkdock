CREATE TABLE site_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    site_name TEXT NOT NULL DEFAULT 'Linkdock',
    site_title TEXT NOT NULL DEFAULT 'Linkdock',
    site_description TEXT NOT NULL DEFAULT 'Self-hosted bookmark manager with WebDAV/XBEL sync.',
    site_keywords TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO site_settings (id) VALUES (1);
