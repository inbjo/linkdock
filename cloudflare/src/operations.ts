import { digest, randomToken } from './crypto';
import { bodyJson, field, HttpError, integer, json } from './http';
import { limits, limitValue, policy, type Limits } from './policy';
import type { Env, Identity, User } from './types';

export async function filesRequest(request: Request, env: Env, identity: Identity, resolvedLimits?: Limits): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('x-linkdock-user', String(identity.userId));
  headers.set('x-linkdock-owner', identity.owner);
  headers.set('x-linkdock-write', String(identity.writable));
  headers.set('x-linkdock-limits', JSON.stringify(resolvedLimits ?? await limits(env, identity.userId)));
  const stub = env.USER_FILES.get(env.USER_FILES.idFromName(`user:${identity.userId}`));
  return stub.fetch(new Request(request, { headers }));
}

export async function sampleUser(env: Env, userId: number, resolvedLimits?: Limits): Promise<unknown> {
  const response = await filesRequest(new Request('https://internal/internal/usage'), env, { userId, owner: 'session', writable: false }, resolvedLimits);
  if (!response.ok) throw new HttpError(503, 'Unable to collect user storage statistics');
  const data = await response.json() as Record<string, number>;
  await env.DB.prepare(`INSERT INTO user_usage(user_id,files,current_bytes,history_bytes,staging_bytes,stored_bytes,pending_cleanup,failures,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET files=excluded.files,current_bytes=excluded.current_bytes,history_bytes=excluded.history_bytes,
    staging_bytes=excluded.staging_bytes,stored_bytes=excluded.stored_bytes,pending_cleanup=excluded.pending_cleanup,failures=excluded.failures,updated_at=excluded.updated_at`)
    .bind(userId, data.files, data.current_bytes, data.history_bytes, data.staging_bytes, data.stored_bytes, data.pending_cleanup, data.failures, new Date().toISOString()).run();
  return data;
}

export async function maintenance(env: Env): Promise<void> {
  const timestamp = new Date().toISOString();
  await env.DB.prepare('UPDATE maintenance_state SET last_run_at=? WHERE id=1').bind(timestamp).run();
  try {
    const removed = await env.DB.prepare('DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at<=? LIMIT 1000)').bind(timestamp).run();
    await env.DB.prepare('DELETE FROM invitations WHERE id IN (SELECT id FROM invitations WHERE expires_at<? LIMIT 1000)').bind(new Date(Date.now() - 30 * 86400_000).toISOString()).run();
    const cursor = await env.DB.prepare('SELECT cursor FROM maintenance_state WHERE id=1').first<{ cursor: number }>();
    const defaults = await policy(env);
    type SampledUser = { id: number; max_files: number | null; max_storage_bytes: number | null; max_tokens: number | null };
    let users = (await env.DB.prepare('SELECT id,max_files,max_storage_bytes,max_tokens FROM users WHERE id>? ORDER BY id LIMIT 25').bind(cursor?.cursor ?? 0).all<SampledUser>()).results;
    if (!users.length) users = (await env.DB.prepare('SELECT id,max_files,max_storage_bytes,max_tokens FROM users ORDER BY id LIMIT 25').all<SampledUser>()).results;
    let last = 0;
    for (const user of users) {
      await sampleUser(env, user.id, { max_files: user.max_files ?? defaults.max_files, max_storage_bytes: user.max_storage_bytes ?? defaults.max_storage_bytes, max_tokens: user.max_tokens ?? defaults.max_tokens });
      last = user.id;
    }
    await env.DB.prepare('UPDATE maintenance_state SET cursor=?,last_success_at=?,sessions_deleted=?,users_sampled=?,error=NULL WHERE id=1')
      .bind(last, new Date().toISOString(), removed.meta.changes, users.length).run();
  } catch (error) {
    await env.DB.prepare("UPDATE maintenance_state SET error='Maintenance failed; inspect Worker logs' WHERE id=1").run();
    throw error;
  }
}

export async function operationsRoute(request: Request, env: Env, path: string, user: User): Promise<Response | null> {
  if (path === '/usage' && request.method === 'GET') {
    return filesRequest(new Request('https://internal/internal/usage'), env, { userId: user.id, owner: 'session', writable: false });
  }
  if (!path.startsWith('/admin/')) return null;
  if (!user.is_system_admin) throw new HttpError(403, 'Administrator required');
  if (path === '/admin/settings') {
    if (request.method === 'GET') return json({ ...await policy(env), turnstile_configured: !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) });
    if (request.method === 'PUT') {
      const body = await bodyJson(request);
      if (!['open', 'closed', 'invite'].includes(String(body.registration_mode)) || typeof body.turnstile_enabled !== 'boolean') throw new HttpError(400, 'Invalid registration settings');
      if (body.turnstile_enabled && !(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)) throw new HttpError(400, 'Configure both Turnstile keys first');
      await env.DB.prepare(`INSERT INTO instance_settings(id,registration_mode,turnstile_enabled,max_files,max_storage_bytes,max_tokens) VALUES(1,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET registration_mode=excluded.registration_mode,turnstile_enabled=excluded.turnstile_enabled,max_files=excluded.max_files,max_storage_bytes=excluded.max_storage_bytes,max_tokens=excluded.max_tokens`)
        .bind(body.registration_mode, body.turnstile_enabled ? 1 : 0, limitValue(body.max_files, 10000), limitValue(body.max_storage_bytes, 1000_000_000_000), limitValue(body.max_tokens, 1000)).run();
      return json({ ok: true });
    }
  }
  if (/^\/admin\/users\/\d+\/quota$/.test(path) && request.method === 'PUT') {
    const target = integer(path.split('/')[3]);
    const body = await bodyJson(request);
    const optional = (key: string, max: number) => body[key] === null ? null : limitValue(body[key], max);
    const result = await env.DB.prepare('UPDATE users SET max_files=?,max_storage_bytes=?,max_tokens=? WHERE id=?').bind(optional('max_files', 10000), optional('max_storage_bytes', 1000_000_000_000), optional('max_tokens', 1000), target).run();
    if (!result.meta.changes) throw new HttpError(404, 'User not found');
    return json({ ok: true });
  }
  if (path === '/admin/invitations') {
    if (request.method === 'GET') return json((await env.DB.prepare('SELECT id,label,remaining,expires_at,revoked_at,created_at FROM invitations WHERE user_id=? ORDER BY id DESC LIMIT 100').bind(user.id).all()).results);
    if (request.method === 'POST') {
      const body = await bodyJson(request);
      const expires = new Date(field(body, 'expires_at'));
      if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now() || expires.getTime() > Date.now() + 365 * 86400_000) throw new HttpError(400, 'Expiry must be within one year');
      const plaintext = randomToken();
      const created = await env.DB.prepare('INSERT INTO invitations(user_id,code_hash,label,remaining,expires_at,created_at) VALUES(?,?,?,?,?,?) RETURNING id')
        .bind(user.id, await digest(plaintext), field(body, 'label', 128).trim(), limitValue(body.remaining, 1000), expires.toISOString(), new Date().toISOString()).first();
      return json({ ...created, plaintext }, 201);
    }
  }
  if (/^\/admin\/invitations\/\d+$/.test(path) && request.method === 'DELETE') {
    await env.DB.prepare('UPDATE invitations SET revoked_at=? WHERE id=? AND user_id=?').bind(new Date().toISOString(), integer(path.split('/')[3]), user.id).run();
    return json({ ok: true });
  }
  if (path === '/admin/operations' && request.method === 'GET') {
    const [totals, accounts, state] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS sampled_users,COALESCE(SUM(files),0) AS files,COALESCE(SUM(current_bytes),0) AS current_bytes,
        COALESCE(SUM(history_bytes),0) AS history_bytes,COALESCE(SUM(stored_bytes),0) AS stored_bytes,COALESCE(SUM(pending_cleanup),0) AS pending_cleanup,
        MIN(updated_at) AS oldest_sample,MAX(updated_at) AS newest_sample FROM user_usage`).first(),
      env.DB.prepare('SELECT COUNT(*) AS users FROM users').first(),
      env.DB.prepare('SELECT * FROM maintenance_state WHERE id=1').first(),
    ]);
    return json({ totals: { ...totals, ...accounts }, maintenance: state });
  }
  const operation = path.match(/^\/admin\/users\/(\d+)\/(operations|cleanup)$/);
  if (operation) {
    const target = integer(operation[1]);
    if (!await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(target).first()) throw new HttpError(404, 'User not found');
    if (operation[2] === 'operations' && request.method === 'GET') {
      const response = await filesRequest(new Request('https://internal/internal/operations'), env, { userId: target, owner: 'session', writable: false });
      if (response.ok) await sampleUser(env, target);
      return response;
    }
    if (operation[2] === 'cleanup' && request.method === 'POST') {
      return filesRequest(new Request('https://internal/internal/cleanup', { method: 'POST' }), env, { userId: target, owner: 'session', writable: true });
    }
  }
  return null;
}
