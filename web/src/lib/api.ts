import type { AccessToken, AccessTokenCreated, AuthResponse, MeResponse, SetupStatus, SyncFile, FileVersion, AdminUser, Usage, InstanceSettings, Invitation, UserOperations, Operations, Quotas } from './types'

const BASE = '/api/app/v1'

class ApiClient {
  private async request<T>(path: string, opts?: RequestInit): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin', ...opts,
      headers: { ...(typeof opts?.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts?.headers },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error?.message || `HTTP ${response.status}`)
    }
    if (response.status === 204) return undefined as T
    return response.json()
  }

  setupStatus() { return this.request<SetupStatus>('/auth/setup') }
  register(username: string, email: string, password: string, display_name: string, setup_token?: string, invitation_code?: string, turnstile_token?: string) {
    return this.request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, display_name, setup_token, invitation_code, turnstile_token }) })
  }
  login(username: string, password: string) { return this.request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }) }
  logout() { return this.request('/auth/logout', { method: 'POST' }) }
  me() { return this.request<MeResponse>('/me') }
  updateProfile(email: string, display_name: string) { return this.request('/me', { method: 'PUT', body: JSON.stringify({ email, display_name }) }) }
  changePassword(current_password: string, new_password: string) { return this.request('/me/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password }) }) }
  listTokens() { return this.request<AccessToken[]>('/tokens') }
  createToken(name: string, scopes?: string, expires_at?: string) { return this.request<AccessTokenCreated>('/tokens', { method: 'POST', body: JSON.stringify({ name, scopes, expires_at }) }) }
  revokeToken(id: number) { return this.request(`/tokens/${id}`, { method: 'DELETE' }) }
  listFiles() { return this.request<SyncFile[]>('/files') }
  async importFile(path: string, file: File, etag?: string) {
    const response = await fetch(this.fileUrl(path), {
      method: 'PUT', credentials: 'same-origin', body: file,
      headers: { 'Content-Type': 'application/xbel+xml', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error?.message || `HTTP ${response.status}`)
    }
  }
  fileUrl(path: string, version?: string) { return `${BASE}/files/${encodeURIComponent(path)}${version ? `/versions/${encodeURIComponent(version)}` : ''}` }
  deleteFile(file: SyncFile) { return this.request(`/files/${encodeURIComponent(file.path)}`, { method: 'DELETE', headers: { 'If-Match': file.etag } }) }
  versions(path: string) { return this.request<FileVersion[]>(`/files/${encodeURIComponent(path)}/versions`) }
  restoreVersion(file: SyncFile, id: string) { return this.request(`/files/${encodeURIComponent(file.path)}/versions/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'If-Match': file.etag } }) }
  usage() { return this.request<Usage>('/usage') }
  settings() { return this.request<InstanceSettings>('/admin/settings') }
  saveSettings(settings: InstanceSettings) { return this.request('/admin/settings', { method: 'PUT', body: JSON.stringify({ ...settings, turnstile_enabled: !!settings.turnstile_enabled }) }) }
  invitations() { return this.request<Invitation[]>('/admin/invitations') }
  invite(label: string, remaining: number, expires_at: string) { return this.request<{ plaintext: string }>('/admin/invitations', { method: 'POST', body: JSON.stringify({ label, remaining, expires_at }) }) }
  revokeInvitation(id: number) { return this.request(`/admin/invitations/${id}`, { method: 'DELETE' }) }
  operations() { return this.request<Operations>('/admin/operations') }
  userOperations(id: number) { return this.request<UserOperations>(`/admin/users/${id}/operations`) }
  cleanup(id: number) { return this.request(`/admin/users/${id}/cleanup`, { method: 'POST' }) }
  saveQuota(id: number, quotas: { [K in keyof Quotas]: number | null }) { return this.request(`/admin/users/${id}/quota`, { method: 'PUT', body: JSON.stringify(quotas) }) }
  adminUsers() { return this.request<AdminUser[]>('/admin/users') }
  disableUser(id: number, disabled: boolean) { return this.request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ disabled }) }) }
}

export const api = new ApiClient()
