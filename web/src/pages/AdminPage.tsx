import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { Navigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { SmtpSettings, SiteSettings } from '@/lib/types'
import { useToast } from '@/components/Toast'

interface Stats {
  users: number
  documents: number
  folders: number
  bookmarks: number
  tags: number
  tokens: number
  sessions: number
  audit_entries: number
}

interface AdminUser {
  id: number
  uuid: string
  username: string
  display_name: string
  email: string | null
  is_system_admin: boolean
  disabled: boolean
  created_at: string
  document_count: number
}

interface AuditEntry {
  id: number
  user_id: number | null
  action: string
  resource_type: string | null
  resource_id: number | null
  detail: string | null
  ip_address: string | null
  created_at: string
}

export function AdminPage() {
  const { t } = useTranslation()
  const { me } = useAuth()

  if (!me) return null
  if (!me.is_system_admin) return <Navigate to="/bookmarks" replace />

  return (
    <div className="page-shell scrollbar-thin">
      <div className="page-container mx-auto">
        <div className="page-eyebrow">{t('nav.admin')}</div>
        <h1 className="font-display page-title">{t('admin.title')}</h1>
        <StatsSection />
        <SiteSettingsSection />
        <SmtpSection />
        <UsersSection />
        <AuditSection />
      </div>
    </div>
  )
}

const emptySmtp: SmtpSettings = {
  enabled: false, host: '', port: 587, security: 'starttls', username: '',
  password_configured: false, from_email: '', from_name: 'Linkdock',
}

const defaultSiteSettings: SiteSettings = {
  site_name: 'Linkdock',
  site_title: 'Linkdock',
  site_description: 'Self-hosted bookmark manager with WebDAV/XBEL sync.',
  site_keywords: '',
}

function SiteSettingsSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { showError, showSuccess, element } = useToast()
  const { data } = useQuery({ queryKey: ['admin', 'site'], queryFn: () => api.siteSettings() })
  const [form, setForm] = useState<SiteSettings>(defaultSiteSettings)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (data) setForm(data) }, [data])

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const updated = await api.updateSiteSettings(form)
      setForm(updated)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'site'] })
      showSuccess(t('admin.site_saved'))
    } catch (err) { showError(err instanceof Error ? err.message : t('admin.site_save_failed')) }
    finally { setSaving(false) }
  }

  return (
    <section className="admin-section">
      {element}
      <div className="page-eyebrow">{t('admin.site_title_label')}</div>
      <form className="card admin-site-form" onSubmit={save}>
        <div>
          <label className="label">{t('admin.site_name')}</label>
          <input className="input" required value={form.site_name} onChange={(e) => setForm({ ...form, site_name: e.target.value })} />
          <div className="modal-hint">{t('admin.site_name_hint')}</div>
        </div>
        <div>
          <label className="label">{t('admin.site_browser_title')}</label>
          <input className="input" required value={form.site_title} onChange={(e) => setForm({ ...form, site_title: e.target.value })} />
          <div className="modal-hint">{t('admin.site_browser_title_hint')}</div>
        </div>
        <div>
          <label className="label">{t('admin.site_description')}</label>
          <textarea className="input" rows={3} value={form.site_description} onChange={(e) => setForm({ ...form, site_description: e.target.value })} />
          <div className="modal-hint">{t('admin.site_description_hint')}</div>
        </div>
        <div>
          <label className="label">{t('admin.site_keywords')}</label>
          <input className="input" value={form.site_keywords} onChange={(e) => setForm({ ...form, site_keywords: e.target.value })} placeholder="bookmarks, sync, webdav" />
          <div className="modal-hint">{t('admin.site_keywords_hint')}</div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? t('common.loading') : t('admin.site_save')}</button>
      </form>
    </section>
  )
}

function SmtpSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { showError, showSuccess, element } = useToast()
  const { data } = useQuery({ queryKey: ['admin', 'smtp'], queryFn: () => api.smtpSettings() })
  const [form, setForm] = useState<SmtpSettings>(emptySmtp)
  const [password, setPassword] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  useEffect(() => { if (data) setForm(data) }, [data])

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const updated = await api.updateSmtpSettings({ ...form, password: password || undefined })
      setForm(updated); setPassword('')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'smtp'] })
      showSuccess(t('admin.smtp_saved'))
    } catch (err) { showError(err instanceof Error ? err.message : t('admin.smtp_save')) }
    finally { setSaving(false) }
  }

  const test = async () => {
    setTesting(true)
    try { await api.testSmtp(testEmail); showSuccess(t('admin.smtp_test_sent')) }
    catch (err) { showError(err instanceof Error ? err.message : t('admin.smtp_test')) }
    finally { setTesting(false) }
  }

  return (
    <section className="admin-section">
      {element}
      <div className="page-eyebrow">{t('admin.smtp_title')}</div>
      <form className="card admin-smtp-form" onSubmit={save}>
        <label className="admin-smtp-toggle">
          <span className="checkbox-hit">
            <input className="ui-checkbox" type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span className="ui-checkbox-mark" aria-hidden="true" />
          </span>
          {t('admin.smtp_enabled')}
        </label>
        <div className="smtp-grid">
          <div><label className="label">{t('admin.smtp_host')}</label><input className="input" required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></div>
          <div><label className="label">{t('admin.smtp_port')}</label><input className="input" type="number" min={1} max={65535} required value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></div>
          <div><label className="label">{t('admin.smtp_security')}</label><select className="input" value={form.security} onChange={(e) => setForm({ ...form, security: e.target.value as SmtpSettings['security'] })}><option value="starttls">STARTTLS</option><option value="tls">TLS</option><option value="none">{t('admin.smtp_none')}</option></select></div>
          <div><label className="label">{t('admin.smtp_username')}</label><input className="input" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div><label className="label">{t('admin.smtp_password')}</label><input className="input" type="password" autoComplete="new-password" value={password} placeholder={form.password_configured ? t('admin.smtp_password_saved') : ''} onChange={(e) => setPassword(e.target.value)} /></div>
          <div><label className="label">{t('admin.smtp_from_email')}</label><input className="input" type="email" required value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} /></div>
          <div><label className="label">{t('admin.smtp_from_name')}</label><input className="input" required value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} /></div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? t('common.loading') : t('admin.smtp_save')}</button>
        <div className="smtp-test-row">
          <input className="input" type="email" required value={testEmail} placeholder={t('admin.smtp_test_email')} onChange={(e) => setTestEmail(e.target.value)} />
          <button className="btn" type="button" disabled={testing || !testEmail} onClick={test}>{testing ? t('common.loading') : t('admin.smtp_test')}</button>
        </div>
      </form>
    </section>
  )
}

function StatsSection() {
  const { t } = useTranslation()
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/stats', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  if (isLoading) return <div className="admin-loading">{t('common.loading')}</div>
  if (!stats) return null

  const items = [
    { label: t('admin.users'), value: stats.users },
    { label: t('admin.documents'), value: stats.documents },
    { label: t('admin.folders'), value: stats.folders },
    { label: t('admin.bookmarks'), value: stats.bookmarks },
    { label: t('admin.tags'), value: stats.tags },
    { label: t('admin.active_tokens'), value: stats.tokens },
    { label: t('admin.active_sessions'), value: stats.sessions },
    { label: t('admin.audit_entries'), value: stats.audit_entries },
  ]

  return (
    <div className="admin-stats-grid">
      {items.map((item) => (
        <div key={item.label} className="admin-stat-card">
          <div className="font-display admin-stat-value">{item.value.toLocaleString()}</div>
          <div className="admin-stat-label">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function UsersSection() {
  const { t } = useTranslation()
  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/users', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div className="admin-section">
      <div className="page-eyebrow">{t('admin.users')}</div>
      {isLoading ? (
        <div className="admin-loading">{t('common.loading')}</div>
      ) : (
        <div className="admin-table-wrap scrollbar-thin">
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.id')}</th>
                <th>{t('admin.username')}</th>
                <th>{t('admin.display_name')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('admin.admin_flag')}</th>
                <th>{t('admin.disabled')}</th>
                <th>{t('admin.documents')}</th>
                <th>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((u) => (
                <tr key={u.id}>
                  <td className="admin-cell-mono">{u.id}</td>
                  <td className="font-display admin-cell-strong">{u.username}</td>
                  <td className="admin-cell-muted">{u.display_name}</td>
                  <td className="admin-cell-muted">{u.email || '—'}</td>
                  <td>{u.is_system_admin ? <span className="badge badge-accent">✓</span> : <span className="admin-cell-faint">—</span>}</td>
                  <td>{u.disabled ? <span className="badge badge-danger">✓</span> : <span className="admin-cell-faint">—</span>}</td>
                  <td className="admin-cell-mono">{u.document_count}</td>
                  <td className="admin-cell-mono">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AuditSection() {
  const { t } = useTranslation()
  const { data: entries, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const resp = await fetch('/api/app/v1/admin/audit?limit=50', { credentials: 'same-origin' })
      if (!resp.ok) throw new Error('Failed')
      return resp.json()
    },
  })

  return (
    <div className="admin-section">
      <div className="page-eyebrow">{t('admin.audit_log')} · {t('admin.last_50')}</div>
      {isLoading ? (
        <div className="admin-loading">{t('common.loading')}</div>
      ) : (
        <div className="admin-table-wrap admin-audit-wrap scrollbar-thin">
          <table className="table admin-audit-table">
            <thead>
              <tr>
                <th>{t('admin.id')}</th>
                <th>{t('admin.time')}</th>
                <th>{t('admin.action')}</th>
                <th>{t('admin.resource')}</th>
                <th>{t('admin.user')}</th>
                <th>{t('admin.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {(entries || []).map((e) => (
                <tr key={e.id}>
                  <td className="admin-cell-mono">{e.id}</td>
                  <td className="admin-cell-mono">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="font-display admin-cell-strong">{e.action}</td>
                  <td className="admin-cell-mono">{e.resource_type}{e.resource_id ? `:${e.resource_id}` : ''}</td>
                  <td className="admin-cell-mono">{e.user_id ?? '—'}</td>
                  <td className="admin-cell-mono">{e.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
