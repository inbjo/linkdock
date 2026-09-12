import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { Navigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { SmtpSettings } from '@/lib/types'
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
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin page-shell">
      <div className="page-container" style={{ maxWidth: '56rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('nav.admin')}
        </div>
        <h1
          className="font-display"
          style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 'var(--space-lg)' }}
        >
          {t('admin.title')}
        </h1>
        <StatsSection />
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
    <section style={{ marginBottom: 'var(--space-xl)' }}>
      {element}
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>{t('admin.smtp_title')}</div>
      <form className="card" onSubmit={save} style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 'var(--text-sm)' }}>
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
        <button className="btn btn-primary" type="submit" disabled={saving} style={{ justifySelf: 'start' }}>{saving ? t('common.loading') : t('admin.smtp_save')}</button>
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

  if (isLoading) return <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-lg)' }}>{t('common.loading')}</div>
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))',
        gap: 'var(--space-2xs)',
        marginBottom: 'var(--space-xl)',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: 'var(--space-sm)',
            border: '1px solid var(--color-rule)',
            borderRadius: 'var(--radius)',
            background: 'var(--color-paper)',
          }}
        >
          <div
            className="font-display"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.02em' }}
          >
            {item.value.toLocaleString()}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginTop: 'var(--space-3xs)',
            }}
          >
            {item.label}
          </div>
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
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>{t('admin.users')}</div>
      {isLoading ? (
        <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{t('common.loading')}</div>
      ) : (
        <div style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius)', overflow: 'auto' }} className="scrollbar-thin">
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
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{u.id}</td>
                  <td className="font-display" style={{ fontWeight: 500 }}>{u.username}</td>
                  <td style={{ color: 'var(--color-ink-2)' }}>{u.display_name}</td>
                  <td style={{ color: 'var(--color-ink-2)' }}>{u.email || '—'}</td>
                  <td>{u.is_system_admin ? <span className="badge badge-accent">✓</span> : <span style={{ color: 'var(--color-ink-3)' }}>—</span>}</td>
                  <td>{u.disabled ? <span className="badge badge-danger">✓</span> : <span style={{ color: 'var(--color-ink-3)' }}>—</span>}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{u.document_count}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
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
    <div>
      <div className="section-label" style={{ marginBottom: 'var(--space-sm)' }}>
        {t('admin.audit_log')} · {t('admin.last_50')}
      </div>
      {isLoading ? (
        <div style={{ color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>{t('common.loading')}</div>
      ) : (
        <div
          style={{ border: '1px solid var(--color-rule)', borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: '24rem' }}
          className="scrollbar-thin"
        >
          <table className="table" style={{ fontSize: 'var(--text-xs)' }}>
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
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{e.id}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{new Date(e.created_at).toLocaleString()}</td>
                  <td className="font-display" style={{ fontWeight: 500 }}>{e.action}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{e.resource_type}{e.resource_id ? `:${e.resource_id}` : ''}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{e.user_id ?? '—'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-ink-3)' }}>{e.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
