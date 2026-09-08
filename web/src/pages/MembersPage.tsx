import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import type { MemberInfo } from '@/lib/types'

export function MembersPage() {
  const { t } = useTranslation()
  const { me } = useAuth()
  const { showError, showSuccess, element } = useToast()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [addUsername, setAddUsername] = useState('')
  const [addRole, setAddRole] = useState('editor')

  const { data: members } = useQuery({
    queryKey: ['members', me?.tenant_id],
    queryFn: () => api.listMembers(me!.tenant_id),
    enabled: !!me,
  })

  const addMut = useMutation({
    mutationFn: () => api.addMember(me!.tenant_id, addUsername, addRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] })
      setShowAdd(false)
      setAddUsername('')
      showSuccess(t('members.added'))
    },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const updateRoleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => api.updateMember(me!.tenant_id, userId, role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); showSuccess(t('members.role_updated')) },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  const removeMut = useMutation({
    mutationFn: (userId: number) => api.removeMember(me!.tenant_id, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); showSuccess(t('members.removed')) },
    onError: (e) => showError(e instanceof Error ? e.message : t('common.error')),
  })

  if (!me) return null
  const canManage = me.tenant_role === 'owner' || me.tenant_role === 'admin'

  return (
    <div style={{ padding: 'var(--space-lg)', height: '100%', overflow: 'auto' }} className="scrollbar-thin page-shell">
      <div className="page-container-narrow" style={{ maxWidth: '40rem', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-lg)' }}>
          <div>
            <div className="section-label" style={{ marginBottom: 'var(--space-2xs)' }}>
              {t('settings.members')}
            </div>
            <h1
              className="font-display"
              style={{ fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}
            >
              {t('members.title')}
            </h1>
          </div>
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)}>
              + {t('members.add')}
            </button>
          )}
        </div>

        <div className="card" style={{ padding: 0 }}>
          {(members || []).map((m: MemberInfo, i: number) => (
            <div
              key={m.user_id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-sm) var(--space-md)',
                borderBottom: i < (members?.length || 0) - 1 ? '1px solid var(--color-rule)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2xs)' }}>
                <span className="font-display" style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>{m.username}</span>
                {m.display_name && (
                  <span style={{ color: 'var(--color-ink-3)', fontSize: 'var(--text-xs)' }}>{m.display_name}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2xs)', alignItems: 'center' }}>
                {canManage ? (
                  <select
                    className="input"
                    style={{ width: 'auto', padding: 'var(--space-3xs) var(--space-2xs)', fontSize: 'var(--text-xs)' }}
                    value={m.role}
                    onChange={(e) => updateRoleMut.mutate({ userId: m.user_id, role: e.target.value })}
                    disabled={m.user_id === me.id && m.role === 'owner'}
                  >
                    <option value="owner">{t('members.owner')}</option>
                    <option value="admin">{t('members.admin')}</option>
                    <option value="editor">{t('members.editor')}</option>
                    <option value="viewer">{t('members.viewer')}</option>
                  </select>
                ) : (
                  <span className="badge">{m.role}</span>
                )}
                {canManage && m.user_id !== me.id && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => { if (confirm(t('members.remove_confirm'))) removeMut.mutate(m.user_id) }}
                  >
                    {t('members.remove')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {members && members.length === 0 && (
            <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-ink-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
              {t('members.empty')}
            </div>
          )}
        </div>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('members.add')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div>
            <label className="label">{t('members.username')}</label>
            <input className="input" value={addUsername} onChange={(e) => setAddUsername(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">{t('members.role')}</label>
            <select className="input" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="admin">{t('members.admin')}</option>
              <option value="editor">{t('members.editor')}</option>
              <option value="viewer">{t('members.viewer')}</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => addMut.mutate()} disabled={!addUsername.trim() || addMut.isPending}>
            {addMut.isPending ? t('common.loading') : t('common.create')}
          </button>
        </div>
      </Modal>
      {element}
    </div>
  )
}
