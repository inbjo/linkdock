import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import type { AccessToken } from '@/lib/types'
import { useAuth } from '@/hooks/useAuth'

export function TokensPage() {
  const { t } = useTranslation()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const { me } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [accessMode, setAccessMode] = useState<'read' | 'write'>('write')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const canWrite = true
  const { data: tokens } = useQuery({
    queryKey: ['tokens', me?.id],
    queryFn: () => api.listTokens(),
    enabled: !!me,
  })

  const createMut = useMutation({
    mutationFn: () => api.createToken(
      name,
      accessMode === 'write' && canWrite ? 'bookmarks:read bookmarks:write' : 'bookmarks:read',
    ),
    onSuccess: (data) => {
      setCreatedToken(data.plaintext)
      setName('')
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: ['tokens', me?.id] })
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const revokeMut = useMutation({
    mutationFn: (id: number) => api.revokeToken(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tokens', me?.id] }); showSuccess(t('tokens.revoked')) },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const copyToken = () => {
    if (createdToken) {
      navigator.clipboard.writeText(createdToken)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin page-shell">
      <div className="page-container-narrow" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <div className="token-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-lg)' }}>
          <div>
            <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
              {t('settings.tokens')}
            </div>
            <h1
              className="font-display"
              style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
            >
              {t('tokens.title')}
            </h1>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
            + {t('tokens.new')}
          </button>
        </div>

        <div className="card token-list" style={{ padding: 0 }}>
          {(tokens || []).map((tok: AccessToken, i: number) => (
            <div
              key={tok.id}
              className="token-row"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                padding: 'var(--space-sm) var(--space-md)',
                borderBottom: i < (tokens?.length || 0) - 1 ? '1px solid var(--color-rule)' : 'none',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="font-display token-row-title" style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>{tok.name}</div>
                <div
                  className="token-row-meta"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-ink-3)',
                    marginTop: 'var(--space-3xs)',
                  }}
                >
                  {t('tokens.prefix')}: {tok.token_prefix}… · {t('tokens.scopes')}: {tok.scopes}
                </div>
                <div
                  className="token-row-meta"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-ink-3)',
                    marginTop: 'var(--space-3xs)',
                  }}
                >
                  {t('tokens.created')}: {new Date(tok.created_at).toLocaleDateString()}
                  {tok.last_used_at ? ` · ${t('tokens.last_used')}: ${new Date(tok.last_used_at).toLocaleDateString()}` : ` · ${t('tokens.last_used')}: ${t('tokens.never')}`}
                </div>
              </div>
              <div className="token-row-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2xs)', flexShrink: 0, marginLeft: 'var(--space-sm)' }}>
                {tok.revoked_at ? (
                  <span className="badge badge-danger">{t('tokens.revoked')}</span>
                ) : (
                  <span className="badge badge-success">{t('tokens.active')}</span>
                )}
                {!tok.revoked_at && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => { if (confirm(t('tokens.revoke_confirm'))) revokeMut.mutate(tok.id) }}
                  >
                    {t('tokens.revoke')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {tokens && tokens.length === 0 && (
            <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
              {t('tokens.empty')}
            </div>
          )}
        </div>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('tokens.new')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div>
            <label className="label">{t('tokens.name')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">{t('tokens.access_mode')}</label>
            <select
              className="input"
              value={canWrite ? accessMode : 'read'}
              onChange={(e) => setAccessMode(e.target.value as 'read' | 'write')}
              disabled={!canWrite}
            >
              <option value="write">{t('tokens.read_write')}</option>
              <option value="read">{t('tokens.read_only')}</option>
            </select>
            <div style={{ marginTop: 'var(--space-3xs)', color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
              {t('tokens.binding_hint')}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending ? t('common.loading') : t('common.create')}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!createdToken}
        onClose={() => { setCreatedToken(null); setCopied(false) }}
        title={t('tokens.token_created')}
        footer={<button className="btn" onClick={() => { setCreatedToken(null); setCopied(false) }}>{t('common.close')}</button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div
            style={{
              padding: 'var(--space-sm)',
              background: 'var(--color-paper-3)',
              borderRadius: 'var(--radius)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              wordBreak: 'break-all',
              border: '1px solid var(--color-rule)',
            }}
          >
            {createdToken}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2xs)', color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: '0.125rem' }}>
              <path d="M8 2v8M8 12v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span>{t('tokens.token_warning')}</span>
          </div>
          <button className="btn btn-primary" onClick={copyToken}>
            {copied ? t('tokens.copied') : t('tokens.copy')}
          </button>
        </div>
      </Modal>
      {element}
    </div>
  )
}
