export interface User {
  id: number
  uuid: string
  username: string
  display_name: string
  is_system_admin: boolean
}

export interface AuthResponse {
  user: User
}

export interface MeResponse {
  id: number
  username: string
  is_system_admin: boolean
  tenant_id: number
  tenant_role: 'owner' | 'admin' | 'member' | 'viewer'
}

export interface Tenant {
  id: number
  uuid: string
  name: string
  slug: string
  created_by: number
  created_at: string
  updated_at: string
}

export interface TenantWithRole extends Tenant {
  role: string
}

export interface MemberInfo {
  user_id: number
  username: string
  display_name: string
  uuid: string
  role: string
  created_at: string
  updated_at: string
}

export interface Collection {
  id: number
  uuid: string
  tenant_id: number
  parent_id: number | null
  name: string
  description: string
  color: string | null
  position: number
  created_by: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface CollectionNode {
  id: number
  name: string
  parent_id: number | null
  description: string
  color: string | null
  children: CollectionNode[]
}

export interface Link {
  id: number
  uuid: string
  tenant_id: number
  collection_id: number
  url: string
  name: string
  description: string
  position: number
  created_by: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface LinkWithTags extends Link {
  tags: string[]
}

export interface Tag {
  id: number
  uuid: string
  tenant_id: number
  name: string
  normalized_name: string
  created_at: string
}

export interface AccessToken {
  id: number
  uuid: string
  tenant_id: number
  user_id: number
  name: string
  token_prefix: string
  scopes: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface AccessTokenCreated extends AccessToken {
  plaintext: string
}

export interface SessionInfo {
  id: number
  tenant_id: number
  expires_at: string
  last_used_at: string
  created_at: string
}

export interface PasskeyInfo {
  id: number
  uuid: string
  name: string
  last_used_at: string | null
  created_at: string
}

export interface PasskeyChallenge {
  flow_id: string
  options: unknown
}

export interface BatchResult {
  affected: number
}

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

export interface ParsedBookmark {
  url: string
  name: string
  description: string
  folder_path: string[]
}
