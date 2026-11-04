import { env } from 'cloudflare:workers';
import { SELF, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digest } from '../src/crypto';
import { maintenance } from '../src/operations';
import worker from '../src/index';

const origin = 'http://localhost:8787';
const xml = '<xbel><bookmark href="https://example.com"/></xbel>';
const api = (path: string, method = 'GET', body?: unknown, cookie = 'admin') => SELF.fetch(`${origin}/api/app/v1${path}`, { method, headers: { cookie: `linkdock_session=${cookie}` }, ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const dav = (path: string, body = xml, token = 'a') => SELF.fetch(`${origin}/webdav/${path}`, { method: 'PUT', headers: { authorization: `Basic ${btoa(`user:${token}`)}` }, body });
const register = (username: string, extra = {}) => SELF.fetch(`${origin}/api/app/v1/auth/register`, { method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'test-password', ...extra }) });
const defaults = { registration_mode: 'open', turnstile_enabled: false, max_files: 100, max_storage_bytes: 104857600, max_tokens: 20 };
const settings = (extra = {}) => api('/admin/settings', 'PUT', { ...defaults, ...extra });
const stub = () => env.USER_FILES.get(env.USER_FILES.idFromName('user:1'));

beforeEach(async () => {
  for (const id of [1, 2]) {
    await env.DB.prepare('INSERT INTO users(id,uuid,username,email,password_hash,is_system_admin) VALUES(?,?,?,?,?,?)').bind(id, `u${id}`, `u${id}`, `u${id}@example.com`, 'unused', id === 1 ? 1 : 0).run();
    await env.DB.prepare('INSERT INTO sessions(user_id,session_hash,expires_at) VALUES(?,?,?)').bind(id, await digest(id === 1 ? 'admin' : 'user'), '2099-01-01').run();
  }
  for (const token of ['a', 'b']) await env.DB.prepare('INSERT INTO access_tokens(uuid,user_id,name,token_hash,token_prefix,scopes) VALUES(?,1,?,?,?,?)').bind(token, token, await digest(token), token, 'bookmarks:read bookmarks:write').run();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('registration and resource policy', () => {
  it('restricts settings, quotas, invitations, operations and cleanup to administrators', async () => {
    for (const [path, method] of [['/admin/settings', 'PUT'], ['/admin/invitations', 'POST'], ['/admin/users/1/quota', 'PUT'], ['/admin/users/1/cleanup', 'POST'], ['/admin/operations', 'GET'], ['/admin/users/1/operations', 'GET']]) expect((await api(path, method, {}, 'user')).status).toBe(403);
    expect((await settings({ max_files: 0 })).status).toBe(400);
    expect((await api('/admin/users/1/quota', 'PUT', { max_files: -1, max_tokens: null, max_storage_bytes: null })).status).toBe(400);
    expect((await api('/admin/users/999/quota', 'PUT', { max_files: null, max_tokens: null, max_storage_bytes: null })).status).toBe(404);
    expect((await api('/usage', 'GET', undefined, 'user')).status).toBe(200);
  });

  it('supports closed and invite registration, hashes invitation codes and atomically consumes the final use', async () => {
    await settings({ registration_mode: 'closed' });
    expect((await register('closeduser')).status).toBe(403);
    await settings({ registration_mode: 'invite' });
    const created = await api('/admin/invitations', 'POST', { label: 'team', remaining: 1, expires_at: new Date(Date.now() + 86400000).toISOString() });
    const invitation = await created.json() as { plaintext: string; id: number };
    expect(created.status).toBe(201);
    expect(JSON.stringify(await (await api('/admin/invitations')).json())).not.toContain(invitation.plaintext);
    expect((await register('nocode')).status).toBe(400);
    const raced = await Promise.all(['inviteone', 'invitetwo'].map(name => register(name, { invitation_code: invitation.plaintext })));
    expect(raced.map(r => r.status).sort()).toEqual([200, 403]);
    expect((await register('thirduser', { invitation_code: invitation.plaintext })).status).toBe(403);
    const stored = await env.DB.prepare('SELECT code_hash,remaining FROM invitations WHERE id=?').bind(invitation.id).first<{ code_hash: string; remaining: number }>();
    expect(stored!.code_hash).toBe(await digest(invitation.plaintext));
    expect(stored!.remaining).toBe(0);
  });

  it('does not consume invitations on duplicate accounts and rejects expired or revoked codes', async () => {
    await settings({ registration_mode: 'invite' });
    const create = async () => await (await api('/admin/invitations', 'POST', { label: 'test', remaining: 2, expires_at: new Date(Date.now() + 86400000).toISOString() })).json() as { plaintext: string; id: number };
    const code = await create();
    expect((await register('u2', { invitation_code: code.plaintext })).status).toBe(409);
    expect((await env.DB.prepare('SELECT remaining FROM invitations WHERE id=?').bind(code.id).first<{ remaining: number }>())!.remaining).toBe(2);
    await api(`/admin/invitations/${code.id}`, 'DELETE');
    expect((await register('revoked', { invitation_code: code.plaintext })).status).toBe(403);
    const expired = await create();
    await env.DB.prepare("UPDATE invitations SET expires_at='2000-01-01' WHERE id=?").bind(expired.id).run();
    expect((await register('expired', { invitation_code: expired.plaintext })).status).toBe(403);
  });

  it('requires server-verified Turnstile success, hostname and registration action', async () => {
    expect((await settings({ turnstile_enabled: true })).status).toBe(200);
    const setup = await (await api('/auth/setup')).json() as { turnstile_required: boolean; turnstile_site_key: string };
    expect(setup.turnstile_required).toBe(true);
    expect((await register('missingtoken')).status).toBe(400);
    const siteverify = vi.spyOn(globalThis, 'fetch');
    for (const [name, result, status] of [
      ['badtoken', { success: false }, 400],
      ['badhost', { success: true, hostname: 'evil.example', action: 'register' }, 400],
      ['badaction', { success: true, hostname: 'localhost', action: 'login' }, 400],
      ['goodtoken', { success: true, hostname: 'localhost', action: 'register' }, 200],
    ] as const) {
      siteverify.mockResolvedValueOnce(Response.json(result));
      const response = await worker.fetch(new Request(`${origin}/api/app/v1/auth/register`, { method: 'POST', body: JSON.stringify({ username: name, email: `${name}@example.com`, password: 'test-password', turnstile_token: 'token' }) }), env);
      expect(response.status).toBe(status);
    }
    expect(siteverify).toHaveBeenCalledTimes(4);
    expect(siteverify.mock.calls[0][0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('atomically enforces active token limits and allows replacement after revocation', async () => {
    await settings({ max_tokens: 3 });
    const raced = await Promise.all(['phone', 'tablet'].map(name => api('/tokens', 'POST', { name })));
    expect(raced.map(r => r.status).sort()).toEqual([201, 409]);
    const tokens = await (await api('/tokens')).json() as { id: number }[];
    await api(`/tokens/${tokens[0].id}`, 'DELETE');
    expect((await api('/tokens', 'POST', { name: 'new' })).status).toBe(201);
  });

  it('enforces file count across concurrent files and staging, while honoring per-user overrides', async () => {
    await settings({ max_files: 1 });
    const raced = await Promise.all([dav('one.xbel.temp'), dav('two.xbel')]);
    expect(raced.map(r => r.status).sort()).toEqual([201, 507]);
    await api('/admin/users/1/quota', 'PUT', { max_files: 2, max_tokens: null, max_storage_bytes: null });
    expect((await dav('three.xbel')).status).toBe(201);
    expect((await api('/usage')).status).toBe(200);
    const userUsage = await (await api('/usage', 'GET', undefined, 'user')).json() as { stored_bytes: number };
    expect(userUsage.stored_bytes).toBe(0);
  });

  it('counts history, staging and pending bytes and rejects uploads before writing R2', async () => {
    const length = new TextEncoder().encode(xml).length;
    await settings({ max_storage_bytes: length * 2 });
    expect((await dav('bookmarks.xbel')).status).toBe(201);
    expect((await dav('bookmarks.xbel')).status).toBe(204);
    expect((await dav('bookmarks.xbel.temp')).status).toBe(507);
    expect((await env.FILES.list()).objects.length).toBe(2);
    const usage = await (await api('/usage')).json() as { history_bytes: number; stored_bytes: number };
    expect(usage.stored_bytes).toBe(length * 2);
    expect(usage.history_bytes).toBe(length);
    expect((await api('/files/bookmarks.xbel', 'DELETE')).status).toBe(204);
    expect((await dav('new.xbel')).status).toBe(507);
    await runInDurableObject(stub(), async (_instance, state) => {
      state.storage.sql.exec('UPDATE garbage SET after_ms=0');
      await state.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub());
    expect((await dav('new.xbel')).status).toBe(201);
  });
});

describe('maintenance and observability', () => {
  it('cleans expired sessions, keeps live sessions and stores timestamped sampled totals', async () => {
    await env.DB.prepare("INSERT INTO sessions(user_id,session_hash,expires_at) VALUES(1,'expired','2000-01-01')").run();
    await dav('bookmarks.xbel');
    await maintenance(env);
    expect(await env.DB.prepare("SELECT id FROM sessions WHERE session_hash='expired'").first()).toBeNull();
    expect((await api('/me')).status).toBe(200);
    const data = await (await api('/admin/operations')).json() as { totals: { users: number; sampled_users: number; files: number }; maintenance: { sessions_deleted: number; last_success_at: string } };
    expect(data.totals).toMatchObject({ users: 2, sampled_users: 2, files: 1 });
    expect(data.maintenance.sessions_deleted).toBe(1);
    expect(data.maintenance.last_success_at).toBeTruthy();
  });

  it('bounds sanitized failed-write records and reports quota rejection without credentials or content', async () => {
    await settings({ max_files: 1 });
    await dav('one.xbel');
    for (let i = 0; i < 102; i++) await dav('two.xbel');
    const result = await (await api('/admin/users/1/operations')).json() as { failures: { status: number }[]; usage: { failures: number } };
    expect(result.usage.failures).toBe(100);
    expect(result.failures.length).toBe(50);
    expect(result.failures[0].status).toBe(507);
    expect(JSON.stringify(result)).not.toContain('https://example.com');
    expect(JSON.stringify(result)).not.toContain('authorization');
  });

  it('expires abandoned staging, records cleanup and preserves referenced data', async () => {
    await dav('bookmarks.xbel');
    await dav('abandoned.xbel.temp');
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE staging SET updated_at='2000-01-01'");
      state.storage.sql.exec('UPDATE garbage SET after_ms=0');
    });
    const cleaned = await api('/admin/users/1/cleanup', 'POST');
    expect(cleaned.status).toBe(200);
    const data = await cleaned.json() as { cleanup: { expired_staging: number; deleted_objects: number; last_success_at: string }; usage: { files: number; staging_bytes: number } };
    expect(data.cleanup.expired_staging).toBe(1);
    expect(data.cleanup.deleted_objects).toBe(1);
    expect(data.cleanup.last_success_at).toBeTruthy();
    expect(data.usage.files).toBe(1);
    expect(data.usage.staging_bytes).toBe(0);
  });
});

describe('cleanup recovery and policy changes', () => {
  it('records cleanup failure, schedules retry and recovers without deleting live objects', async () => {
    await dav('bookmarks.xbel');
    await env.FILES.put('users/1/versions/orphan', 'orphan');
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("INSERT INTO garbage(key,after_ms) VALUES('users/1/versions/orphan',0)");
      state.storage.sql.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON garbage BEGIN SELECT RAISE(ABORT,'test failure'); END");
    });
    expect((await api('/admin/users/1/cleanup', 'POST')).status).toBe(500);
    const failed = await (await api('/admin/users/1/operations')).json() as { cleanup: { error: string } };
    expect(failed.cleanup.error).toContain('retry');
    await runInDurableObject(stub(), async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
      state.storage.sql.exec('DROP TRIGGER fail_cleanup');
    });
    await runDurableObjectAlarm(stub());
    const recovered = await (await api('/admin/users/1/operations')).json() as { cleanup: { error: string | null; last_success_at: string }; usage: { files: number } };
    expect(recovered.cleanup.error).toBeNull();
    expect(recovered.cleanup.last_success_at).toBeTruthy();
    expect(recovered.usage.files).toBe(1);
  });

  it('preserves data when quotas shrink and lets a user reset an override to the default', async () => {
    await dav('one.xbel'); await dav('two.xbel');
    expect((await settings({ max_files: 1, max_storage_bytes: 1 })).status).toBe(200);
    expect((await dav('three.xbel')).status).toBe(507);
    const files = await (await api('/files')).json() as unknown[];
    expect(files.length).toBe(2);
    expect((await api('/admin/users/1/quota', 'PUT', { max_files: 3, max_storage_bytes: 1000000, max_tokens: null })).status).toBe(200);
    expect((await dav('three.xbel')).status).toBe(201);
    await api('/admin/users/1/quota', 'PUT', { max_files: null, max_storage_bytes: null, max_tokens: null });
    const usage = await (await api('/usage')).json() as { limits: { max_files: number } };
    expect(usage.limits.max_files).toBe(1);
  });
});

describe('bounded maintenance sampling', () => {
  it('persists the sampling cursor and covers later users on the next run', async () => {
    await env.DB.batch(Array.from({ length: 28 }, (_, index) => {
      const id = index + 3;
      return env.DB.prepare('INSERT INTO users(id,uuid,username,email,password_hash) VALUES(?,?,?,?,?)').bind(id, `u${id}`, `u${id}`, `u${id}@example.com`, 'unused');
    }));
    await maintenance(env);
    expect((await env.DB.prepare('SELECT users_sampled,cursor FROM maintenance_state WHERE id=1').first())).toMatchObject({ users_sampled: 25, cursor: 25 });
    await maintenance(env);
    expect((await env.DB.prepare('SELECT users_sampled,cursor FROM maintenance_state WHERE id=1').first())).toMatchObject({ users_sampled: 5, cursor: 30 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM user_usage').first<{ count: number }>())!.count).toBe(30);
  });
});
