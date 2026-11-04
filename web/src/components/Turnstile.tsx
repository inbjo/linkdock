import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Widget = { render(element: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void }
declare global { interface Window { turnstile?: Widget } }
let loading: Promise<Widget> | undefined
function load(): Promise<Widget> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<Widget>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    const timeout = window.setTimeout(() => { script.remove(); loading = undefined; reject(new Error('Turnstile timeout')) }, 15000)
    script.onload = () => { clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else { loading = undefined; reject(new Error('Turnstile unavailable')) } }
    script.onerror = () => { clearTimeout(timeout); script.remove(); loading = undefined; reject(new Error('Turnstile unavailable')) }
    document.head.appendChild(script)
  })
  return loading
}

export function Turnstile({ siteKey, resetKey, onToken }: { siteKey: string; resetKey: number; onToken: (token: string) => void }) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let stopped = false
    let widget: Widget | undefined
    let id: string | undefined
    setFailed(false)
    onToken('')
    load().then(api => {
      if (stopped || !host.current) return
      widget = api
      id = api.render(host.current, {
        sitekey: siteKey, action: 'register', size: 'flexible',
        callback: (token: string) => { if (!stopped) onToken(token) },
        'expired-callback': () => onToken(''),
        'error-callback': () => { onToken(''); setFailed(true) },
      })
    }).catch(() => { if (!stopped) setFailed(true) })
    return () => { stopped = true; if (id && widget) widget.remove(id) }
  }, [siteKey, resetKey, onToken, retry])
  return <div><div ref={host} />{failed ? <div role="alert"><p>{t('ops.verification_failed')}</p><button className="btn btn-sm" type="button" onClick={() => setRetry(value => value + 1)}>{t('files.refresh')}</button></div> : null}</div>
}
