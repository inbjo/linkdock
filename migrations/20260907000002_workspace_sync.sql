-- Remember the user's preferred workspace across new login sessions.
ALTER TABLE users ADD COLUMN preferred_tenant_id INTEGER;

-- Rename the ambiguous "member" role to "editor" while preserving existing memberships.
CREATE TABLE tenant_members_new (
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (tenant_id, user_id)
);

INSERT INTO tenant_members_new (tenant_id, user_id, role, created_at, updated_at)
SELECT tenant_id,
       user_id,
       CASE WHEN role = 'member' THEN 'editor' ELSE role END,
       created_at,
       updated_at
FROM tenant_members;

DROP TABLE tenant_members;
ALTER TABLE tenant_members_new RENAME TO tenant_members;

UPDATE users
SET preferred_tenant_id = (
    SELECT tenant_id
    FROM tenant_members
    WHERE tenant_members.user_id = users.id
    ORDER BY tenant_id
    LIMIT 1
);

-- Existing installations predate automatic bootstrap administration. Promote
-- the earliest account only when the instance does not already have an admin.
UPDATE users
SET is_system_admin = 1
WHERE id = (SELECT MIN(id) FROM users)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_system_admin = 1);
