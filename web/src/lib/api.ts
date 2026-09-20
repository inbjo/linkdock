import type {
  AuthResponse, MeResponse, Tag,
  AccessToken, AccessTokenCreated, SessionInfo, ApiError,
  PasskeyInfo, PasskeyChallenge, SetupStatus, SmtpSettings, SiteSettings,
  SyncDocument, BookmarkTreeNode, BookmarkNode, BookmarkNodeType,
} from './types'
import i18n from '@/i18n'

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
      if (resp.status === 412) throw new Error(i18n.t('tree.conflict'))
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
  login(identifier: string, password: string) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: identifier, password }),
    })
  }
  startPasskeyLogin(identifier?: string) {
    return this.request<PasskeyChallenge>('/auth/passkey/start', {
      method: 'POST',
      body: JSON.stringify(identifier ? { username: identifier } : {}),
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
  changePassword(current_password: string, new_password: string) {
    return this.request<{ ok: boolean }>('/me/password', {
      method: 'PUT', body: JSON.stringify({ current_password, new_password }),
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
  siteSettings() { return this.request<SiteSettings>('/admin/site') }
  updateSiteSettings(settings: SiteSettings) {
    return this.request<SiteSettings>('/admin/site', { method: 'PUT', body: JSON.stringify(settings) })
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

  // Canonical XBEL documents and ordered nodes
  listDocuments() {
    return this.request<SyncDocument[]>('/documents')
  }
  ensureDefaultDocument() {
    return this.request<SyncDocument>('/documents/default', { method: 'POST' })
  }
  bookmarkTree(documentId: number) {
    return this.request<{ revision: number; nodes: BookmarkTreeNode[] }>(`/documents/${documentId}/view`)
  }
  searchNodes(documentId: number, query: string, offset = 0) {
    return this.request<BookmarkNode[]>(`/documents/${documentId}/search?q=${encodeURIComponent(query)}&offset=${offset}`)
  }
  trash(documentId: number, offset = 0) {
    return this.request<BookmarkNode[]>(`/documents/${documentId}/trash?offset=${offset}`)
  }
  snapshots(documentId: number) {
    return this.request<{ id: number; revision: number; created_at: string }[]>(`/documents/${documentId}/snapshots`)
  }
  restoreNode(id: number, revision: number) {
    return this.request(`/nodes/${id}/restore`, { method: 'POST', body: JSON.stringify({ expected_revision: revision }) })
  }
  restoreSnapshot(id: number, revision: number) {
    return this.request(`/snapshots/${id}/restore`, { method: 'POST', body: JSON.stringify({ expected_revision: revision }) })
  }
  createNode(data: {
    expected_revision: number
    document_id: number
    parent_id?: number | null
    node_type: BookmarkNodeType
    title?: string
    url?: string | null
    description?: string
    tags?: string[]
  }) {
    return this.request<BookmarkNode>('/nodes', { method: 'POST', body: JSON.stringify(data) })
  }
  updateNode(id: number, data: {
    expected_revision: number
    parent_id?: number | null
    title?: string
    url?: string | null
    description?: string
    tags?: string[]
  }) {
    return this.request<BookmarkNode>(`/nodes/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  }
  deleteNode(id: number, revision: number) {
    return this.request(`/nodes/${id}?expected_revision=${revision}`, { method: 'DELETE' })
  }
  reorderNodes(documentId: number, parentId: number | null, nodeIds: number[], revision: number) {
    return this.request(`/documents/${documentId}/order`, {
      method: 'PUT', body: JSON.stringify({ parent_id: parentId, node_ids: nodeIds, expected_revision: revision }),
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
