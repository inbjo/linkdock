ALTER TABLE users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX idx_users_email_unique
ON users(email COLLATE NOCASE)
WHERE email IS NOT NULL;

CREATE TABLE smtp_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    host TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 587,
    security TEXT NOT NULL DEFAULT 'starttls' CHECK (security IN ('starttls','tls','none')),
    username TEXT NOT NULL DEFAULT '',
    password_encrypted TEXT,
    from_email TEXT NOT NULL DEFAULT '',
    from_name TEXT NOT NULL DEFAULT 'Linkdock',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO smtp_settings (id) VALUES (1);

CREATE TABLE password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_expires ON password_reset_tokens(expires_at);
