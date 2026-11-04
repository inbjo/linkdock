import { Fragment, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import type { AdminUser, InstanceSettings } from '@/lib/types'

export function AdminPage() {
  const { me } = useAuth()
  return me?.is_system_admin ? <AdminContent /> : <Navigate to="/bookmarks" replace />
}
const bytes = (n: number) => `${(n / 1048576).toFixed(2)} MiB`
const time = (n?: string | null) => n ? new Date(n).toLocaleString() : '—'
const names = ['max_files', 'max_storage_bytes', 'max_tokens'] as const
const quotaLabel = (key: string) => `ops.${key === 'max_storage_bytes' ? 'max_storage' : key}`
function AdminContent() {
  const { me } = useAuth()
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<InstanceSettings | null>(null)
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const [quota, setQuota] = useState({ max_files: '', max_storage_bytes: '', max_tokens: '' })
  const [label, setLabel] = useState('')
  const [uses, setUses] = useState(1)
  const [days, setDays] = useState(7)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const key = ['admin', me?.id]
  const users = useQuery({ queryKey: [...key, 'users'], queryFn: () => api.adminUsers() })
  const settings = useQuery({ queryKey: [...key, 'settings'], queryFn: () => api.settings() })
  const invites = useQuery({ queryKey: [...key, 'invitations'], queryFn: () => api.invitations() })
  const overview = useQuery({ queryKey: [...key, 'operations'], queryFn: () => api.operations() })
  const detail = useQuery({ queryKey: [...key, 'user', selected?.id], queryFn: () => api.userOperations(selected!.id), enabled: !!selected })
  useEffect(() => { if (settings.data) setForm(settings.data) }, [settings.data])
  const error = (e: Error) => toast.showError(e.message)
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const save = useMutation({ mutationFn: () => api.saveSettings(form!), onSuccess: async () => { await refresh(); toast.showSuccess(t('ops.saved')) }, onError: error })
  const toggle = useMutation({ mutationFn: (user: AdminUser) => api.disableUser(user.id, !user.disabled), onSuccess: refresh, onError: error })
  const invite = useMutation({ mutationFn: () => api.invite(label, uses, new Date(Date.now() + days * 86400000).toISOString()), onSuccess: async data => { setCode(data.plaintext); setCopied(false); await refresh() }, onError: error })
  const revoke = useMutation({ mutationFn: (id: number) => api.revokeInvitation(id), onSuccess: refresh, onError: error })
  const cleanup = useMutation({ mutationFn: () => api.cleanup(selected!.id), onSuccess: refresh, onError: error })
  const saveQuota = useMutation({ mutationFn: () => api.saveQuota(selected!.id, {
    max_files: quota.max_files === '' ? null : Number(quota.max_files),
    max_storage_bytes: quota.max_storage_bytes === '' ? null : Math.round(Number(quota.max_storage_bytes) * 1048576),
    max_tokens: quota.max_tokens === '' ? null : Number(quota.max_tokens),
  }), onSuccess: async () => { await refresh(); toast.showSuccess(t('ops.saved')) }, onError: error })
  const totals = overview.data?.totals
  const state = overview.data?.maintenance
  return <div className="page-shell"><div className="page-container mx-auto ops-page">
    <div className="token-page-header"><div><div className="page-eyebrow">{t('nav.admin')}</div><h1 className="font-display page-title">{t('ops.title')}</h1></div><button className="btn" onClick={() => refresh()}>{t('files.refresh')}</button></div>
    <section className="ops-section"><h2 className="font-display page-subtitle">{t('ops.overview')}</h2>
      {overview.isError ? <p role="alert">{overview.error.message}</p> : overview.isPending ? <p>{t('common.loading')}</p> : <>
        <div className="ops-metrics">{[['users', totals?.users], ['files', totals?.files], ['stored', bytes(totals?.stored_bytes ?? 0)], ['pending', totals?.pending_cleanup]].map(([label, value]) => <div className="card" key={label}><span>{t(`ops.${label}`)}</span><strong>{value}</strong></div>)}</div>
        <p className="ops-note">{t('ops.snapshot', { sampled: totals?.sampled_users, total: totals?.users })} · {t('ops.oldest')}: {time(totals?.oldest_sample)}</p>
        <div className="card ops-status"><p>{t('ops.last_maintenance')}: {time(state?.last_success_at)}</p><p>{t('ops.sessions_removed')}: {state?.sessions_deleted ?? 0}</p>{state?.error ? <p role="alert">{state.error}</p> : null}</div>
      </>}
    </section>
    <section className="ops-section"><h2 className="font-display page-subtitle">{t('ops.registration')}</h2>
      {settings.isError ? <p role="alert">{settings.error.message}</p> : !form ? <p>{t('common.loading')}</p> : <form className="card profile-form" onSubmit={e => { e.preventDefault(); save.mutate() }}>
        <div><label className="label" htmlFor="reg-mode">{t('ops.mode')}</label><select id="reg-mode" className="input" value={form.registration_mode} onChange={e => setForm({ ...form, registration_mode: e.target.value as InstanceSettings['registration_mode'] })}>{(['closed', 'invite', 'open'] as const).map(mode => <option value={mode} key={mode}>{t(`ops.${mode}`)}</option>)}</select></div>
        <label className="ops-checkbox"><input type="checkbox" checked={!!form.turnstile_enabled} disabled={!form.turnstile_configured} onChange={e => setForm({ ...form, turnstile_enabled: e.target.checked })} />{t('ops.turnstile')}</label>
        {!form.turnstile_configured ? <p className="ops-note">{t('ops.turnstile_config')}</p> : null}
        <div className="ops-fields">{names.map(name => <div key={name}><label className="label" htmlFor={`default-${name}`}>{t(quotaLabel(name))}</label><input id={`default-${name}`} className="input" type="number" min={name === 'max_storage_bytes' ? .001 : 1} step={name === 'max_storage_bytes' ? 'any' : 1} required value={name === 'max_storage_bytes' ? form[name] / 1048576 : form[name]} onChange={e => setForm({ ...form, [name]: Math.round(Number(e.target.value) * (name === 'max_storage_bytes' ? 1048576 : 1)) })} /></div>)}</div>
        <p className="ops-note">{t('ops.quota_note')}</p><button className="btn btn-primary" disabled={save.isPending}>{t('profile.save')}</button>
      </form>}
    </section>
    <section className="ops-section"><h2 className="font-display page-subtitle">{t('ops.invitations')}</h2>
      <form className="card profile-form" onSubmit={e => { e.preventDefault(); invite.mutate() }}><div className="ops-fields">
        <div><label className="label" htmlFor="invite-label">{t('ops.label')}</label><input id="invite-label" className="input" maxLength={128} value={label} onChange={e => setLabel(e.target.value)} /></div>
        <div><label className="label" htmlFor="invite-uses">{t('ops.uses')}</label><input id="invite-uses" className="input" type="number" min="1" max="1000" required value={uses} onChange={e => setUses(Number(e.target.value))} /></div>
        <div><label className="label" htmlFor="invite-days">{t('ops.days')}</label><input id="invite-days" className="input" type="number" min="1" max="365" required value={days} onChange={e => setDays(Number(e.target.value))} /></div>
      </div><button className="btn btn-primary" disabled={invite.isPending}>{t('ops.create_invite')}</button></form>
      {invites.isError ? <p role="alert">{invites.error.message}</p> : <div className="card">{invites.data?.map(item => <div className="files-row" key={item.id}><div className="files-info"><h3>{item.label || `#${item.id}`}</h3><p>{t('ops.remaining')}: {item.remaining} · {time(item.expires_at)}</p></div>{item.revoked_at ? <span>{t('tokens.revoked')}</span> : <button className="btn btn-sm" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>{t('tokens.revoke')}</button>}</div>)}{invites.data?.length === 0 ? <p className="ops-status">{t('ops.no_invites')}</p> : null}</div>}
    </section>
    <section className="ops-section"><h2 className="font-display page-subtitle">{t('files.accounts')}</h2>
      {users.isError ? <p role="alert">{users.error.message}</p> : users.isPending ? <p>{t('common.loading')}</p> : <div className="card">{users.data.map(user => <div className="files-row" key={user.id}><div className="files-info"><h3>{user.username}</h3><p>{user.email}</p></div><span className="badge">{user.disabled ? t('files.disabled') : t('files.active')}</span><div className="files-actions"><button className="btn btn-sm" onClick={() => { setSelected(user); setQuota({ max_files: user.max_files?.toString() ?? '', max_storage_bytes: user.max_storage_bytes == null ? '' : String(user.max_storage_bytes / 1048576), max_tokens: user.max_tokens?.toString() ?? '' }) }}>{t('ops.manage')}</button>{!user.is_system_admin ? <button className="btn btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(user)}>{user.disabled ? t('files.enable') : t('files.disable')}</button> : null}</div></div>)}</div>}
    </section>
  </div>
  <Modal open={!!code} onClose={() => setCode('')} title={t('ops.invitation_code')}><div className="modal-form"><p>{t('ops.show_once')}</p><code className="token-reveal">{code}</code><button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true) } catch { toast.showError(t('ops.copy_failed')) } }}>{copied ? t('common.copied') : t('common.copy')}</button></div></Modal>
  <Modal open={!!selected} onClose={() => setSelected(null)} title={`${t('ops.manage')} · ${selected?.username ?? ''}`}><div className="modal-form">
    <p className="ops-note">{t('ops.override_note')}</p><form className="modal-form" onSubmit={e => { e.preventDefault(); saveQuota.mutate() }}>{names.map(name => <div key={name}><label className="label" htmlFor={`quota-${name}`}>{t(quotaLabel(name))}</label><input id={`quota-${name}`} className="input" type="number" min={name === 'max_storage_bytes' ? .001 : 1} step={name === 'max_storage_bytes' ? 'any' : 1} value={quota[name]} placeholder={t('ops.inherit')} onChange={e => setQuota({ ...quota, [name]: e.target.value })} /></div>)}<button className="btn btn-primary" disabled={saveQuota.isPending}>{t('profile.save')}</button></form>
    {detail.isError ? <p role="alert">{detail.error.message}</p> : detail.isPending ? <p>{t('common.loading')}</p> : <>
      <h3>{t('ops.storage')}</h3><dl className="ops-definition"><dt>{t('ops.files')}</dt><dd>{detail.data.usage.files} / {detail.data.usage.limits.max_files}</dd>{(['current_bytes', 'history_bytes', 'staging_bytes', 'stored_bytes'] as const).map(name => <Fragment key={name}><dt>{t(`ops.${name}`)}</dt><dd>{bytes(detail.data.usage[name])}</dd></Fragment>)}<dt>{t('ops.pending')}</dt><dd>{detail.data.usage.pending_cleanup}</dd></dl>
      <p>{t('ops.last_cleanup')}: {time(detail.data.cleanup.last_success_at)}</p><p>{t('ops.cleanup_result', { deleted: detail.data.cleanup.deleted_objects, expired: detail.data.cleanup.expired_staging })}</p>{detail.data.cleanup.error ? <p role="alert">{detail.data.cleanup.error}</p> : null}
      <button className="btn" disabled={cleanup.isPending} onClick={() => cleanup.mutate()}>{cleanup.isPending ? t('common.loading') : t('ops.cleanup')}</button>
      <h3>{t('ops.failures')}</h3><p className="ops-note">{t('ops.failures_note')}</p>{detail.data.failures.length === 0 ? <p>{t('ops.no_failures')}</p> : <div className="ops-failures">{detail.data.failures.map(item => <p key={item.id}><code>{item.method} · {item.status}</code> · {time(item.created_at)}</p>)}</div>}
    </>}
  </div></Modal>{toast.element}</div>
}
