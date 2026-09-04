import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import type { AccessToken } from '@/lib/types'

export function TokensPage() {
  const { t } = useTranslation()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: tokens } = useQuery({ queryKey: ['tokens'], queryFn: () => api.listTokens() })

  const createMut = useMutation({
    mutationFn: () => api.createToken(name),
    onSuccess: (data) => {
      setCreatedToken(data.plaintext)
      setName('')
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: ['tokens'] })
    },
    onError: (e) => showError(e instanceof Error ? e.message : 'Failed'),
  })

  const revokeMut = useMutation({
    mutationFn: (id: number) => api.revokeToken(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tokens'] }); showSuccess('Token revoked') },
    onError: (e) => showError(e instanceof Error ? e.message : 'Failed'),
  })

  const copyToken = () => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{ padding: '1rem', maxWidth: '40rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{t('tokens.title')}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>{t('tokens.new')}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {(tokens || []).map((tok: AccessToken) => (
          <div key={tok.id} className="card" style={{ padding: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{tok.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                  {t('tokens.prefix')}: {tok.token_prefix}… | {t('tokens.scopes')}: {tok.scopes}
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                  {t('tokens.created')}: {new Date(tok.created_at).toLocaleDateString()} |
                  {tok.last_used_at ? ` ${t('tokens.last_used')}: ${new Date(tok.last_used_at).toLocaleDateString()}` : ` ${t('tokens.last_used')}: ${t('tokens.never')}`}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                {tok.revoked_at ? (
                  <span className="badge" style={{ background: 'var(--color-danger)', color: 'white' }}>{t('tokens.revoked')}</span>
                ) : (
                  <span className="badge" style={{ background: 'var(--color-success)', color: 'white' }}>{t('tokens.active')}</span>
                )}
                {!tok.revoked_at && (
                  <button className="btn btn-sm btn-danger" onClick={() => { if (confirm('Revoke this token?')) revokeMut.mutate(tok.id) }}>
                    {t('tokens.revoke')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {tokens && tokens.length === 0 && (
          <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '2rem' }}>No tokens yet</div>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('tokens.new')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label className="label">{t('tokens.name')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary" onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
            {t('common.create')}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!createdToken}
        onClose={() => { setCreatedToken(null); setCopied(false) }}
        title={t('tokens.token_created')}
        footer={<button className="btn" onClick={() => { setCreatedToken(null); setCopied(false) }}>{t('common.close')}</button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ padding: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.375rem', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
            {createdToken}
          </div>
          <div style={{ color: 'var(--color-danger)', fontSize: '0.75rem' }}>⚠ {t('tokens.token_warning')}</div>
          <button className="btn btn-primary" onClick={copyToken}>
            {copied ? t('tokens.copied') : t('tokens.copy')}
          </button>
        </div>
      </Modal>
      {element}
    </div>
  )
}
