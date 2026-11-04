import { env } from 'cloudflare:workers';
import { SELF, runInDurableObject, runDurableObjectAlarm, evictDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { digest } from '../src/crypto';

const ORIGIN = 'http://localhost:8787';
const xml = '<?xml version="1.0"?><!DOCTYPE xbel><xbel version="1.0"><folder id="4"><title>工作</title><bookmark href="https://example.com" id="5"><title>A &amp; B</title><info><metadata owner="custom">preserve</metadata></info></bookmark><separator/></folder><!-- highestId :5: --></xbel>';
const nextXml = '<xbel><bookmark href="https://second.example"><title>Second</title></bookmark></xbel>';
const auth = (token = 'device-a') => ({ authorization: `Basic ${btoa(`linkdock:${token}`)}` });
const session = (name = 'alice-session') => ({ cookie: `linkdock_session=${name}` });
const api = (path: string, options: RequestInit = {}, name = 'alice-session') => SELF.fetch(`${ORIGIN}/api/app/v1${path}`, { ...options, headers: { ...session(name), ...options.headers } });
const dav = (path = 'bookmarks.xbel', options: RequestInit = {}, token = 'device-a') => SELF.fetch(`${ORIGIN}/webdav/${path}`, { ...options, headers: { ...auth(token), ...options.headers } });
const stub = () => env.USER_FILES.get(env.USER_FILES.idFromName('user:1'));

beforeEach(async () => {
  await env.DB.prepare('INSERT INTO users(id,uuid,username,email,password_hash,is_system_admin) VALUES(1,?,?,?,?,1)').bind('alice-id', 'alice', 'alice@example.com', 'unused').run();
  await env.DB.prepare('INSERT INTO users(id,uuid,username,email,password_hash) VALUES(2,?,?,?,?)').bind('bob-id', 'bob', 'bob@example.com', 'unused').run();
  for (const [id, name] of [[1, 'alice-session'], [2, 'bob-session']] as const) await env.DB.prepare('INSERT INTO sessions(user_id,session_hash,expires_at) VALUES(?,?,?)').bind(id, await digest(name), '2099-01-01T00:00:00.000Z').run();
  for (const [id, token, scopes] of [[1, 'device-a', 'bookmarks:read bookmarks:write'], [1, 'device-b', 'bookmarks:read bookmarks:write'], [1, 'readonly', 'bookmarks:read'], [2, 'bob-device', 'bookmarks:read bookmarks:write']] as const) {
    await env.DB.prepare('INSERT INTO access_tokens(uuid,user_id,name,token_hash,token_prefix,scopes) VALUES(?,?,?,?,?,?)').bind(token, id, token, await digest(token), token, scopes).run();
  }
});

describe('Cloudflare XBEL file synchronization', () => {
  it('preserves exact XBEL bytes, metadata, mixed order, ETags and WebDAV listing', async () => {
    const upload = await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    expect(upload.status).toBe(201);
    const response = await dav();
    expect(await response.text()).toBe(xml);
    expect(response.headers.get('etag')).toBe(upload.headers.get('etag'));
    expect((await dav('', { method: 'PROPFIND', headers: { depth: '1' } })).status).toBe(207);
    expect((await dav('', { method: 'PROPFIND', headers: { depth: 'infinity' } })).status).toBe(403);
    const head = await dav('bookmarks.xbel', { method: 'HEAD' });
    expect(Number(head.headers.get('content-length'))).toBe(new TextEncoder().encode(xml).length);
    expect(await head.text()).toBe('');
    expect((await dav('bookmarks.xbel', { headers: { 'if-none-match': head.headers.get('etag')! } })).status).toBe(304);
    expect((await api('/files')).status).toBe(200);
  });

  it('isolates user files, staging, tokens, versions and spoofed identity headers', async () => {
    await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    await dav('bookmarks.xbel.temp', { method: 'PUT', body: nextXml });
    expect((await dav('bookmarks.xbel', { headers: { 'x-linkdock-user': '1' } }, 'bob-device')).status).toBe(404);
    expect((await dav('bookmarks.xbel.temp', {}, 'device-b')).status).toBe(404);
    expect(await (await api('/files', {}, 'bob-session')).json()).toEqual([]);
    const versions = await (await api('/files/bookmarks.xbel/versions')).json() as { id: string }[];
    expect((await api(`/files/bookmarks.xbel/versions/${versions[0].id}`, {}, 'bob-session')).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/me`, { headers: auth() })).status).toBe(401);
    expect((await api('/admin/users', {}, 'bob-session')).status).toBe(403);
    const created = await (await api('/tokens', { method: 'POST', body: JSON.stringify({ name: 'phone', user_id: 2 }) })).json() as { user_id: number; plaintext: string };
    expect(created.user_id).toBe(1);
    expect(created.plaintext).toMatch(/^ld_/);
    expect(JSON.stringify(await (await api('/tokens')).json())).not.toContain(created.plaintext);
  });

  it('enforces read-only, revoked and expired tokens and disabled accounts', async () => {
    expect((await dav('bookmarks.xbel', { method: 'PUT', body: xml }, 'readonly')).status).toBe(403);
    expect((await dav('bookmarks.xbel.lock', { method: 'PUT' }, 'readonly')).status).toBe(403);
    await env.DB.prepare("UPDATE access_tokens SET revoked_at='2026-01-01' WHERE name='device-b'").run();
    expect((await dav('', { method: 'PROPFIND' }, 'device-b')).status).toBe(401);
    await env.DB.prepare("UPDATE access_tokens SET expires_at='2000-01-01' WHERE name='device-a'").run();
    expect((await dav()).status).toBe(401);
    expect((await api('/admin/users/2', { method: 'PUT', body: JSON.stringify({ disabled: true }) })).status).toBe(200);
    expect((await api('/me', {}, 'bob-session')).status).toBe(401);
    expect((await dav('', { method: 'PROPFIND' }, 'bob-device')).status).toBe(401);
    expect((await api('/admin/users/1', { method: 'PUT', body: JSON.stringify({ disabled: true }) })).status).toBe(400);
  });

  it('allows only one concurrent lock owner and blocks web imports, deletes and restore', async () => {
    await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    const races = await Promise.all(['device-a', 'device-b'].map(token => dav('bookmarks.xbel.lock', { method: 'PUT' }, token)));
    expect(races.map(response => response.status).sort()).toEqual([201, 423]);
    const winner = races[0].status === 201 ? 'device-a' : 'device-b';
    const loser = winner === 'device-a' ? 'device-b' : 'device-a';
    expect((await dav('bookmarks.xbel', { method: 'PUT', body: nextXml }, loser)).status).toBe(423);
    expect((await dav('bookmarks.xbel.lock', { method: 'DELETE' }, loser)).status).toBe(423);
    expect((await api('/files/bookmarks.xbel', { method: 'PUT', body: nextXml })).status).toBe(423);
    expect((await api('/files/bookmarks.xbel', { method: 'DELETE' })).status).toBe(423);
    const versions = await (await api('/files/bookmarks.xbel/versions')).json() as { id: string }[];
    expect((await api(`/files/bookmarks.xbel/versions/${versions[0].id}`, { method: 'POST' })).status).toBe(423);
    expect((await dav('bookmarks.xbel.lock', { method: 'PUT' }, winner)).status).toBe(204);
    expect((await dav('bookmarks.xbel.lock', { method: 'DELETE' }, winner)).status).toBe(204);
    expect((await api('/files/bookmarks.xbel', { method: 'PUT', body: nextXml })).status).toBe(204);
  });

  it('expires locks and never lets expiry cleanup delete a refreshed lock', async () => {
    await dav('bookmarks.xbel.lock', { method: 'PUT' });
    await runInDurableObject(stub(), (_instance, state) => { state.storage.sql.exec('UPDATE locks SET expires_at=0'); });
    expect((await dav('bookmarks.xbel.lock', {}, 'device-b')).status).toBe(404);
    expect((await dav('bookmarks.xbel.lock', { method: 'PUT' }, 'device-b')).status).toBe(201);
    expect((await dav('bookmarks.xbel.lock', { method: 'PUT' })).status).toBe(423);
    expect(await (await dav('bookmarks.xbel.lock')).text()).toBe('Linkdock Floccus lock');
    expect((await dav('bookmarks.xbel.lock', { method: 'HEAD' })).headers.get('content-length')).toBe(String('Linkdock Floccus lock'.length));
  });

  it('commits a token-private staged MOVE and honors destination conditions', async () => {
    const first = await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    await dav('bookmarks.xbel.temp', { method: 'PUT', body: nextXml });
    const destination = `${ORIGIN}/webdav/bookmarks.xbel`;
    expect((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { destination, overwrite: 'F' } })).status).toBe(412);
    expect((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { destination, 'if-match': '"stale"' } })).status).toBe(412);
    expect((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { destination } }, 'device-b')).status).toBe(404);
    expect((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { destination, 'if-match': first.headers.get('etag')! } })).status).toBe(204);
    expect(await (await dav()).text()).toBe(nextXml);
    expect((await dav('bookmarks.xbel.temp')).status).toBe(404);
    expect((await (await api('/files/bookmarks.xbel/versions')).json() as unknown[]).length).toBe(2);
  });

  it('rolls back the pointer, revision, history and staging deletion on commit failure', async () => {
    await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    await dav('bookmarks.xbel.temp', { method: 'PUT', body: nextXml });
    await runInDurableObject(stub(), (_instance, state) => {
      state.storage.sql.exec("CREATE TRIGGER abort_staging BEFORE DELETE ON staging BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    });
    expect((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { destination: `${ORIGIN}/webdav/bookmarks.xbel` } })).status).toBe(500);
    expect(await (await dav()).text()).toBe(xml);
    expect(await (await dav('bookmarks.xbel.temp')).text()).toBe(nextXml);
    expect((await (await api('/files/bookmarks.xbel/versions')).json() as unknown[]).length).toBe(1);
  });

  it('rejects malformed XML, external entities, traversal and oversize uploads without replacing files', async () => {
    await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    for (const body of ['<xbel><folder></xbel>', '<html/>', '<xbel/><html/>', '<xbel>&undefined;</xbel>', '<!DOCTYPE xbel SYSTEM "https://bad.example"><xbel/>', '<!DOCTYPE xbel [<!ENTITY x "bad">]><xbel/>']) expect((await dav('bookmarks.xbel', { method: 'PUT', body })).status).toBe(400);
    expect((await dav('bookmarks.xbel', { method: 'PUT', headers: { 'content-length': '10485761' }, body: 'x' })).status).toBe(413);
    expect((await dav('folder%2Fbookmarks.xbel', { method: 'PUT', body: xml })).status).toBe(400);
    expect(await (await dav()).text()).toBe(xml);
  });

  it('only accepts one concurrent update using the same ETag, retains history and restores exactly', async () => {
    const first = await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    const updates = await Promise.all([nextXml, '<xbel/>'].map(body => dav('bookmarks.xbel', { method: 'PUT', body, headers: { 'if-match': first.headers.get('etag')! } })));
    expect(updates.map(response => response.status).sort()).toEqual([204, 412]);
    const files = await (await api('/files')).json() as { etag: string }[];
    const versions = await (await api('/files/bookmarks.xbel/versions')).json() as { id: string; revision: number }[];
    const original = versions.find(version => version.revision === 1)!;
    expect(await (await api(`/files/bookmarks.xbel/versions/${original.id}`)).text()).toBe(xml);
    expect((await api(`/files/bookmarks.xbel/versions/${original.id}`, { method: 'POST', headers: { 'if-match': files[0].etag } })).status).toBe(200);
    expect(await (await dav()).text()).toBe(xml);
    for (let i = 0; i < 22; i++) await dav('bookmarks.xbel', { method: 'PUT', body: nextXml });
    expect((await (await api('/files/bookmarks.xbel/versions')).json() as unknown[]).length).toBe(21);
  });

  it('reclaims orphan R2 objects while preserving referenced versions', async () => {
    await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    await env.FILES.put('users/1/versions/orphan', 'orphan');
    await runInDurableObject(stub(), async (_instance, state) => {
      state.storage.sql.exec("INSERT INTO garbage(key,after_ms) VALUES('users/1/versions/orphan',0)");
      state.storage.sql.exec('INSERT INTO garbage(key,after_ms) SELECT key,0 FROM files WHERE key IS NOT NULL');
      await state.storage.setAlarm(Date.now() + 1000);
    });
    expect(await runDurableObjectAlarm(stub())).toBe(true);
    expect(await env.FILES.get('users/1/versions/orphan')).toBeNull();
    expect(await (await dav()).text()).toBe(xml);
  });

  it('keeps file pointers, staging and lock ownership across Durable Object eviction', async () => {
    await dav('bookmarks.xbel', { method: 'PUT', body: xml });
    await dav('bookmarks.xbel.temp', { method: 'PUT', body: nextXml });
    await dav('bookmarks.xbel.lock', { method: 'PUT' });
    await evictDurableObject(stub());
    expect(await (await dav()).text()).toBe(xml);
    expect(await (await dav('bookmarks.xbel.temp')).text()).toBe(nextXml);
    expect((await dav('bookmarks.xbel.lock', { method: 'PUT' }, 'device-b')).status).toBe(423);
    expect((await dav('bookmarks.xbel.temp', { method: 'MOVE', headers: { destination: `${ORIGIN}/webdav/bookmarks.xbel` } })).status).toBe(204);
    expect(await (await dav()).text()).toBe(nextXml);
  });

  it('protects setup and grants administrator rights to exactly one concurrent first registration', async () => {
    await env.DB.prepare('DELETE FROM users').run();
    const register = (username: string, token = 'test-setup-token') => SELF.fetch(`${ORIGIN}/api/app/v1/auth/register`, {
      method: 'POST', body: JSON.stringify({ username, email: `${username}@example.com`, password: 'test-password', setup_token: token }),
    });
    expect((await register('mallory', 'wrong')).status).toBe(403);
    const races = await Promise.all([register('firstuser'), register('otheruser')]);
    expect(races.filter(response => response.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(races.every(response => [200, 409].includes(response.status))).toBe(true);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM users WHERE is_system_admin=1').first<{ count: number }>())!.count).toBe(1);
    const retry = await register('lateruser');
    expect(retry.status).toBe(200);
    expect((await retry.json() as { user: { is_system_admin: boolean } }).user.is_system_admin).toBe(false);
  });

  it('rejects cross-origin writes, token access to accounts, and public internal routes', async () => {
    expect((await api('/files/bookmarks.xbel', { method: 'PUT', body: xml, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await dav('bookmarks.xbel', { method: 'PUT', body: xml, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await SELF.fetch(`${ORIGIN}/internal/files`, { headers: { 'x-linkdock-user': '1', 'x-linkdock-owner': 'session', 'x-linkdock-write': 'true' } })).status).toBe(404);
    expect((await api('/documents')).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/webdav/bookmarks.xbel`)).headers.get('www-authenticate')).toContain('Basic');
  });

  it('registers, logs in by email, changes passwords and revokes other sessions', async () => {
    const register = await SELF.fetch(`${ORIGIN}/api/app/v1/auth/register`, { method: 'POST', body: JSON.stringify({ username: 'charlie', email: 'charlie@example.com', password: 'test-password', display_name: 'Charlie' }) });
    expect(register.status).toBe(200);
    const cookie = register.headers.get('set-cookie')!.split(';')[0];
    const user = await register.json() as { user: { id: number; is_system_admin: boolean } };
    expect(user.user.is_system_admin).toBe(false);
    const login = await SELF.fetch(`${ORIGIN}/api/app/v1/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'CHARLIE@example.com', password: 'test-password' }) });
    expect(login.status).toBe(200);
    const otherCookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/me/password`, { method: 'PUT', headers: { cookie }, body: JSON.stringify({ current_password: 'test-password', new_password: 'new-password', user_id: 1 }) })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/me`, { headers: { cookie: otherCookie } })).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/me`, { headers: { cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'charlie', password: 'test-password' }) })).status).toBe(401);
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/auth/logout`, { method: 'POST', headers: { cookie } })).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/api/app/v1/me`, { headers: { cookie } })).status).toBe(401);
  });
});
