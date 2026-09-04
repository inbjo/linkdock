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
  const [addRole, setAddRole] = useState('member')

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
    <div style={{ padding: '1rem', maxWidth: '40rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{t('settings.members')}</h1>
        {canManage && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>{t('members.add')}</button>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {(members || []).map((m: MemberInfo) => (
          <div key={m.user_id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{m.username}</span>
              {m.display_name && <span style={{ color: 'var(--color-text-secondary)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>{m.display_name}</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {canManage ? (
                <select
                  className="input"
                  style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  value={m.role}
                  onChange={(e) => updateRoleMut.mutate({ userId: m.user_id, role: e.target.value })}
                  disabled={m.user_id === me.id && m.role === 'owner'}
                >
                  <option value="owner">{t('members.owner')}</option>
                  <option value="admin">{t('members.admin')}</option>
                  <option value="member">{t('members.member')}</option>
                  <option value="viewer">{t('members.viewer')}</option>
                </select>
              ) : (
                <span className="badge">{m.role}</span>
              )}
              {canManage && m.user_id !== me.id && (
                <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(t('members.remove_confirm'))) removeMut.mutate(m.user_id) }}>
                  {t('members.remove')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t('members.add')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label className="label">{t('members.username')}</label>
            <input className="input" value={addUsername} onChange={(e) => setAddUsername(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">{t('members.role')}</label>
            <select className="input" value={addRole} onChange={(e) => setAddRole(e.target.value)}>
              <option value="admin">{t('members.admin')}</option>
              <option value="member">{t('members.member')}</option>
              <option value="viewer">{t('members.viewer')}</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => addMut.mutate()} disabled={!addUsername.trim() || addMut.isPending}>
            {t('common.create')}
          </button>
        </div>
      </Modal>
      {element}
    </div>
  )
}
