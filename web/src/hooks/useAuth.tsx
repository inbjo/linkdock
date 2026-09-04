import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { api } from '@/lib/api'
import type { MeResponse, TenantWithRole } from '@/lib/types'

interface AuthCtx {
  me: MeResponse | null
  tenants: TenantWithRole[]
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [tenants, setTenants] = useState<TenantWithRole[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const m = await api.me()
      setMe(m)
      const t = await api.listTenants()
      setTenants(t)
    } catch {
      setMe(null)
      setTenants([])
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setMe(null)
    setTenants([])
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return <Ctx.Provider value={{ me, tenants, loading, refresh, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
