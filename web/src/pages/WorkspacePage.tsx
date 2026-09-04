import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'

export function WorkspacePage() {
  const { t } = useTranslation()
  const { me, tenants, refresh } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const current = tenants.find((t) => t.id === me?.tenant_id)
  const [name, setName] = useState(current?.name || '')
  const [slug, setSlug] = useState(current?.slug || '')

  const updateMut = useMutation({
    mutationFn: () => api.updateTenant(me!.tenant_id, { name, slug }),
    onSuccess: async () => {
      await refresh()
      qc.invalidateQueries({ queryKey: ['tenants'] })
      showSuccess('Workspace updated')
    },
    onError: (e) => showError(e instanceof Error ? e.message : 'Failed'),
  })

  if (!me || !current) return null

  return (
    <div style={{ padding: '1rem', maxWidth: '32rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>{t('settings.workspace')}</h1>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div>
          <label className="label">{t('workspace.name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('workspace.slug')}</label>
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>
          {t('workspace.save')}
        </button>
      </div>

      <h2 style={{ fontSize: '1rem', fontWeight: 600, marginTop: '1.5rem', marginBottom: '0.75rem' }}>{t('workspace.switch')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {tenants.map((tnt) => (
          <div key={tnt.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem' }}>
            <span style={{ fontSize: '0.875rem' }}>{tnt.name} <span className="badge" style={{ marginLeft: '0.25rem' }}>{tnt.role}</span></span>
            {tnt.id === me.tenant_id ? (
              <span className="badge" style={{ background: 'var(--color-primary)', color: 'white' }}>{t('workspace.current')}</span>
            ) : (
              <button className="btn btn-sm" onClick={async () => { await api.selectTenant(tnt.id); await refresh(); showSuccess('Switched') }}>
                {t('workspace.switch')}
              </button>
            )}
          </div>
        ))}
      </div>
      {element}
    </div>
  )
}
