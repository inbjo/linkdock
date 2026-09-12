export interface User {
  id: number
  uuid: string
  username: string
  display_name: string
  email: string | null
  is_system_admin: boolean
}

export interface AuthResponse {
  user: User
}

export interface SetupStatus {
  initialized: boolean
  requires_setup_token: boolean
}

export interface MeResponse {
  id: number
  username: string
  display_name: string
  email: string | null
  is_system_admin: boolean
}

export interface SmtpSettings {
  enabled: boolean
  host: string
  port: number
  security: 'starttls' | 'tls' | 'none'
  username: string
  password_configured: boolean
  from_email: string
  from_name: string
}

export interface SiteSettings {
  site_name: string
  site_title: string
  site_description: string
  site_keywords: string
}

export interface Tag {
  id: number
  uuid: string
  user_id: number
  name: string
  normalized_name: string
  created_at: string
}

export interface AccessToken {
  id: number
  uuid: string
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

export interface SyncDocument {
  id: number
  uuid: string
  user_id: number
  path: string
  title: string
  revision: number
  next_external_id: number
  updated_unix: number
  created_by: number
  created_at: string
  updated_at: string
}

export type BookmarkNodeType = 'folder' | 'bookmark' | 'separator'

export interface BookmarkTreeNode {
  id: number
  uuid: string
  document_id: number
  user_id: number
  parent_id: number | null
  node_type: BookmarkNodeType
  external_id: string
  title: string
  url: string | null
  description: string
  color: string | null
  position: number
  created_by: number
  deleted_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
  children: BookmarkTreeNode[]
}

export interface ApiError {
  error: {
    code: string
    message: string
  }
}
