import { accountRoute, requireSession, requireWebdav } from './auth';
import { failure, HttpError } from './http';
import { filesRequest, maintenance } from './operations';
import type { Env } from './types';
export { UserFiles } from './files';

function checkOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(env.PUBLIC_URL).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-origin requests are not allowed');
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname === '/webdav' || url.pathname.startsWith('/webdav/')) checkOrigin(request, env);
  if (url.pathname === '/health/live') return Response.json({ status: 'ok' });
  if (url.pathname === '/health/ready') {
    await env.DB.prepare('SELECT max_files FROM users LIMIT 1').first();
    await env.DB.prepare('SELECT id FROM instance_settings LIMIT 1').first();
    return Response.json({ status: 'ready' });
  }
  if (url.pathname === '/webdav' || url.pathname.startsWith('/webdav/')) {
    if (url.pathname === '/webdav') return Response.redirect(`${url.origin}/webdav/`, 308);
    const identity = await requireWebdav(request, env);
    return filesRequest(request, env, identity);
  }
  if (url.pathname.startsWith('/api/app/v1/')) {
    const path = url.pathname.slice('/api/app/v1'.length);
    if (path.startsWith('/auth/') && request.method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') ?? 'local';
      if (!(await env.AUTH_LIMITER.limit({ key: ip })).success) throw new HttpError(429, 'Too many authentication attempts');
    }
    if (path === '/files' || path.startsWith('/files/')) {
      const user = await requireSession(request, env);
      url.pathname = `/internal${path}`;
      return filesRequest(new Request(url, request), env, { userId: user.id, owner: 'session', writable: true });
    }
    const response = await accountRoute(request, env, path);
    if (response) return response;
    throw new HttpError(404, 'Endpoint not found');
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) throw new HttpError(404, 'Endpoint not found');
  return env.ASSETS.fetch(request);
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> { await maintenance(env); },
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try { response = await dispatch(request, env); }
    catch (error) { response = failure(error); }
    const headers = new Headers(response.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set('x-frame-options', 'DENY');
    headers.set('content-security-policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (new URL(env.PUBLIC_URL).protocol === 'https:') headers.set('strict-transport-security', 'max-age=31536000');
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/webdav')) headers.set('cache-control', 'no-store');
    if (response.status === 401 && path.startsWith('/webdav')) headers.set('www-authenticate', 'Basic realm="Linkdock", charset="UTF-8"');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
