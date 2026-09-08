import type {
  AuthResponse, MeResponse, TenantWithRole, Tenant, MemberInfo, Collection,
  CollectionNode, LinkWithTags, Link, Tag, AccessToken, AccessTokenCreated,
  SessionInfo, BatchResult, ApiError,
  PasskeyInfo, PasskeyChallenge, SetupStatus, SmtpSettings,
} from './types'

const BASE = '/api/app/v1'

class ApiClient {
  private async request<T>(path: string, opts?: RequestInit): Promise<T> {
    const resp = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...opts?.headers,
      },
    })
    if (!resp.ok) {
      let err: ApiError
      try {
        err = await resp.json()
      } catch {
        throw new Error(`HTTP ${resp.status}`)
      }
      throw new Error(err.error?.message || `HTTP ${resp.status}`)
    }
    if (resp.status === 204 || resp.headers.get('content-length') === '0') {
      return undefined as T
    }
    return resp.json()
  }

  // Auth
  setupStatus() {
    return this.request<SetupStatus>('/auth/setup')
  }
  register(username: string, email: string, password: string, display_name: string, setup_token?: string) {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, display_name, setup_token }),
    })
  }
  login(username: string, password: string) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  }
  startPasskeyLogin(username?: string) {
    return this.request<PasskeyChallenge>('/auth/passkey/start', {
      method: 'POST',
      body: JSON.stringify(username ? { username } : {}),
    })
  }
  finishPasskeyLogin(flowId: string, credential: Record<string, unknown>) {
    return this.request<AuthResponse>('/auth/passkey/finish', {
      method: 'POST',
      body: JSON.stringify({ flow_id: flowId, credential }),
    })
  }
  async logout() {
    await this.request('/auth/logout', { method: 'POST' })
  }
  me() {
    return this.request<MeResponse>('/me')
  }
  updateProfile(email: string, display_name: string) {
    return this.request<{ ok: boolean; email: string }>('/me', {
      method: 'PUT', body: JSON.stringify({ email, display_name }),
    })
  }
  forgotPassword(email: string) {
    return this.request<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email }),
    })
  }
  resetPassword(token: string, password: string) {
    return this.request<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST', body: JSON.stringify({ token, password }),
    })
  }
  smtpSettings() { return this.request<SmtpSettings>('/admin/smtp') }
  updateSmtpSettings(settings: SmtpSettings & { password?: string }) {
    return this.request<SmtpSettings>('/admin/smtp', { method: 'PUT', body: JSON.stringify(settings) })
  }
  testSmtp(email: string) {
    return this.request<{ ok: boolean }>('/admin/smtp/test', { method: 'POST', body: JSON.stringify({ email }) })
  }

  // Passkeys
  listPasskeys() {
    return this.request<PasskeyInfo[]>('/passkeys')
  }
  startPasskeyRegistration() {
    return this.request<PasskeyChallenge>('/passkeys/register/start', { method: 'POST' })
  }
  finishPasskeyRegistration(flowId: string, name: string, credential: Record<string, unknown>) {
    return this.request<PasskeyInfo>('/passkeys/register/finish', {
      method: 'POST',
      body: JSON.stringify({ flow_id: flowId, name, credential }),
    })
  }
  deletePasskey(id: number) {
    return this.request(`/passkeys/${id}`, { method: 'DELETE' })
  }

  // Tenants
  listTenants() {
    return this.request<TenantWithRole[]>('/tenants')
  }
  createTenant(name: string, slug?: string) {
    return this.request<Tenant>('/tenants', {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    })
  }
  updateTenant(id: number, data: { name?: string; slug?: string }) {
    return this.request<Tenant>(`/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }
  selectTenant(id: number) {
    return this.request(`/tenants/${id}/select`, { method: 'POST' })
  }
  listMembers(tenantId: number) {
    return this.request<MemberInfo[]>(`/tenants/${tenantId}/members`)
  }
  addMember(tenantId: number, username: string, role: string) {
    return this.request<MemberInfo>(`/tenants/${tenantId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username, role }),
    })
  }
  updateMember(tenantId: number, userId: number, role: string) {
    return this.request<MemberInfo>(`/tenants/${tenantId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    })
  }
  removeMember(tenantId: number, userId: number) {
    return this.request(`/tenants/${tenantId}/members/${userId}`, {
      method: 'DELETE',
    })
  }

  // Collections
  collectionTree() {
    return this.request<CollectionNode[]>('/collections/tree')
  }
  listCollections() {
    return this.request<Collection[]>('/collections')
  }
  createCollection(data: { name: string; parent_id?: number | null; description?: string }) {
    return this.request<Collection>('/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
  updateCollection(id: number, data: { name?: string; parent_id?: number | null; description?: string }) {
    return this.request<Collection>(`/collections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }
  deleteCollection(id: number) {
    return this.request(`/collections/${id}`, { method: 'DELETE' })
  }

  // Links
  listLinks(collectionId?: number, includeDeleted?: boolean) {
    const params = new URLSearchParams()
    if (collectionId) params.set('collection_id', String(collectionId))
    if (includeDeleted) params.set('include_deleted', 'true')
    const qs = params.toString()
    return this.request<Link[]>(`/links${qs ? '?' + qs : ''}`)
  }
  getLink(id: number) {
    return this.request<LinkWithTags>(`/links/${id}`)
  }
  createLink(data: { url: string; name?: string; description?: string; collection_id: number; tags?: string[] }) {
    return this.request<LinkWithTags>('/links', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
  updateLink(id: number, data: { url?: string; name?: string; description?: string; collection_id?: number; tags?: string[] }) {
    return this.request<LinkWithTags>(`/links/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }
  deleteLink(id: number) {
    return this.request(`/links/${id}`, { method: 'DELETE' })
  }
  restoreLink(id: number) {
    return this.request<Link>(`/links/${id}/restore`, { method: 'POST' })
  }
  batchMove(linkIds: number[], targetCollectionId: number) {
    return this.request<BatchResult>('/links/batch/move', {
      method: 'POST',
      body: JSON.stringify({ link_ids: linkIds, target_collection_id: targetCollectionId }),
    })
  }
  batchDelete(linkIds: number[], permanent: boolean) {
    return this.request<BatchResult>('/links/batch/delete', {
      method: 'POST',
      body: JSON.stringify({ link_ids: linkIds, permanent }),
    })
  }
  batchRestore(linkIds: number[]) {
    return this.request<BatchResult>('/links/batch/restore', {
      method: 'POST',
      body: JSON.stringify({ link_ids: linkIds }),
    })
  }
  batchTag(linkIds: number[], tags: string[]) {
    return this.request<BatchResult>('/links/batch/tag', {
      method: 'POST',
      body: JSON.stringify({ link_ids: linkIds, tags }),
    })
  }

  // Tags
  listTags() {
    return this.request<Tag[]>('/tags')
  }
  createTag(name: string) {
    return this.request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name }) })
  }
  updateTag(id: number, name: string) {
    return this.request<Tag>(`/tags/${id}`, { method: 'PUT', body: JSON.stringify({ name }) })
  }
  deleteTag(id: number) {
    return this.request(`/tags/${id}`, { method: 'DELETE' })
  }

  // Tokens
  listTokens() {
    return this.request<AccessToken[]>('/tokens')
  }
  createToken(name: string, scopes?: string, expiresAt?: string) {
    return this.request<AccessTokenCreated>('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name, scopes, expires_at: expiresAt }),
    })
  }
  revokeToken(id: number) {
    return this.request(`/tokens/${id}`, { method: 'DELETE' })
  }

  // Sessions
  listSessions() {
    return this.request<SessionInfo[]>('/sessions')
  }
  deleteSession(id: number) {
    return this.request(`/sessions/${id}`, { method: 'DELETE' })
  }
  logoutAll() {
    return this.request('/sessions', { method: 'DELETE' })
  }
}

export const api = new ApiClient()
