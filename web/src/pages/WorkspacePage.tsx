import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'

export function WorkspacePage() {
  const { t } = useTranslation()
  const { me, tenants, refresh } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const current = tenants.find((tnt) => tnt.id === me?.tenant_id)
  const [name, setName] = useState(current?.name || '')
  const [slug, setSlug] = useState(current?.slug || '')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')

  useEffect(() => {
    setName(current?.name || '')
    setSlug(current?.slug || '')
  }, [current?.id, current?.name, current?.slug])

  const updateMut = useMutation({
    mutationFn: () => api.updateTenant(me!.tenant_id, { name, slug }),
    onSuccess: async () => {
      await refresh()
      qc.invalidateQueries({ queryKey: ['tenants'] })
      showSuccess(t('workspace.updated'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const createMut = useMutation({
    mutationFn: () => api.createTenant(newName, newSlug || undefined),
    onSuccess: async (tenant) => {
      await api.selectTenant(tenant.id)
      await refresh()
      qc.invalidateQueries({ queryKey: ['tenants'] })
      setNewName('')
      setNewSlug('')
      setShowCreate(false)
      showSuccess(t('workspace.created'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  if (!me || !current) return null
  const canManage = me.tenant_role === 'owner' || me.tenant_role === 'admin'

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin page-shell">
      <div className="page-container-narrow" style={{ maxWidth: '36rem', margin: '0 auto' }}>
        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('settings.workspace')}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
          <h1
            className="font-display"
            style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
          >
            {t('workspace.title')}
          </h1>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
            + {t('workspace.create')}
          </button>
        </div>

        <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div>
              <label className="label">{t('workspace.name')}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
            </div>
            <div>
              <label className="label">{t('workspace.slug')}</label>
              <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!canManage} style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            {canManage ? (
              <button className="btn btn-primary" onClick={() => updateMut.mutate()} disabled={updateMut.isPending} style={{ alignSelf: 'flex-start' }}>
                {updateMut.isPending ? t('common.loading') : t('workspace.save')}
              </button>
            ) : (
              <div style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)' }}>{t('workspace.settings_read_only')}</div>
            )}
          </div>
        </div>

        <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
          {t('workspace.switch')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xs)' }}>
          {tenants.map((tnt) => (
            <div
              key={tnt.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-sm) var(--space-md)',
                border: '1px solid var(--color-rule)',
                borderRadius: 'var(--radius)',
                background: tnt.id === me.tenant_id ? 'var(--color-accent-subtle)' : 'var(--color-paper)',
                borderColor: tnt.id === me.tenant_id ? 'var(--color-accent)' : 'var(--color-rule)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2xs)' }}>
                <span className="font-display" style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{tnt.name}</span>
                <span className="badge">{tnt.role}</span>
              </div>
              {tnt.id === me.tenant_id ? (
                <span className="badge badge-accent">{t('workspace.current')}</span>
              ) : (
                <button
                  className="btn btn-sm"
                  onClick={async () => { await api.selectTenant(tnt.id); await refresh(); showSuccess(t('workspace.switched')) }}
                >
                  {t('workspace.switch')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('workspace.create')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div>
            <label className="label">{t('workspace.name')}</label>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">{t('workspace.slug')}</label>
            <input className="input" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
            <div style={{ marginTop: 'var(--space-3xs)', color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)' }}>{t('workspace.slug_optional')}</div>
          </div>
          <button className="btn btn-primary" onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}>
            {createMut.isPending ? t('common.loading') : t('workspace.create')}
          </button>
        </div>
      </Modal>
      {element}
    </div>
  )
}
