export interface MeResponse {
  id: number
  username: string
  display_name: string
  email: string | null
  is_system_admin: boolean
}
export interface User extends MeResponse { uuid: string }
export interface AuthResponse { user: User }
export interface SetupStatus { initialized: boolean; requires_setup_token: boolean; registration_mode: 'open' | 'invite' | 'closed'; turnstile_site_key: string; turnstile_required: boolean }
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
export interface AccessTokenCreated extends AccessToken { plaintext: string }
export interface SyncFile { path: string; size: number; revision: number; updated_at: string; etag: string; locked: boolean }
export interface FileVersion { id: string; revision: number; size: number; created_at: string }
export interface Quotas { max_files: number; max_storage_bytes: number; max_tokens: number }
export interface AdminUser extends User { disabled: number; created_at: string; max_files: number | null; max_storage_bytes: number | null; max_tokens: number | null }
export interface InstanceSettings extends Quotas { registration_mode: 'open' | 'invite' | 'closed'; turnstile_enabled: number | boolean; turnstile_configured: boolean }
export interface Invitation { id: number; label: string; remaining: number; expires_at: string; revoked_at: string | null; created_at: string }
export interface Usage { files: number; current_bytes: number; history_bytes: number; staging_bytes: number; stored_bytes: number; pending_cleanup: number; failures: number; limits: Quotas }
export interface Cleanup { last_run_at: string | null; last_success_at: string | null; deleted_objects: number; expired_staging: number; scanned_objects?: number; error: string | null }
export interface UserOperations { usage: Usage; cleanup: Cleanup; failures: { id: number; method: string; status: number; created_at: string }[] }
export interface Operations { totals: { users: number; sampled_users: number; files: number; current_bytes: number; history_bytes: number; stored_bytes: number; pending_cleanup: number; oldest_sample: string | null; newest_sample: string | null }; maintenance: { last_run_at: string | null; last_success_at: string | null; sessions_deleted: number; users_sampled: number; error: string | null } }
