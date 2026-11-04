import { constantEqual, digest, hashPassword, randomToken, verifyPassword } from './crypto';
import { bodyJson, field, HttpError, integer, json } from './http';
import { limits, policy, verifyTurnstile } from './policy';
import { operationsRoute } from './operations';
import type { Env, Identity, User } from './types';

const COOKIE = 'linkdock_session';
const now = () => new Date().toISOString();

export function sessionToken(request: Request): string {
  return request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
}

function publicUser(user: User) {
  return { id: user.id, uuid: user.uuid, username: user.username, email: user.email, display_name: user.display_name, is_system_admin: !!user.is_system_admin };
}

function cookie(token: string, env: Env, clear = false): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${new URL(env.PUBLIC_URL).protocol === 'https:' ? '; Secure' : ''}`;
}

async function createSession(env: Env, user: User): Promise<Response> {
  const plaintext = randomToken();
  await env.DB.prepare('INSERT INTO sessions(user_id,session_hash,expires_at) VALUES(?,?,?)')
    .bind(user.id, await digest(plaintext), new Date(Date.now() + 604800_000).toISOString()).run();
  return json({ user: publicUser(user) }, 200, { 'set-cookie': cookie(plaintext, env) });
}

export async function requireSession(request: Request, env: Env): Promise<User> {
  const token = sessionToken(request);
  if (!token) throw new HttpError(401, 'Sign in required');
  const user = await env.DB.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.session_hash=? AND s.expires_at>? AND u.disabled=0')
    .bind(await digest(token), now()).first<User>();
  if (!user) throw new HttpError(401, 'Sign in required');
  return user;
}

export async function requireWebdav(request: Request, env: Env): Promise<Identity> {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Basic ')) throw new HttpError(401, 'Access token required');
  let password: string;
  try {
    const decoded = atob(auth.slice(6));
    const separator = decoded.indexOf(':');
    if (separator < 0) throw new Error();
    password = decoded.slice(separator + 1);
  } catch { throw new HttpError(401, 'Invalid credentials'); }
  const token = await env.DB.prepare(`SELECT t.id,t.user_id,t.scopes,t.last_used_at FROM access_tokens t
    JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at>?) AND u.disabled=0`)
    .bind(await digest(password), now()).first<{ id: number; user_id: number; scopes: string; last_used_at: string | null }>();
  if (!token) throw new HttpError(401, 'Invalid credentials');
  const scopes = token.scopes.split(' ');
  if (!scopes.includes('bookmarks:read')) throw new HttpError(403, 'Read permission required');
  if (!token.last_used_at || Date.now() - new Date(token.last_used_at).getTime() > 3600_000) {
    await env.DB.prepare('UPDATE access_tokens SET last_used_at=? WHERE id=? AND user_id=?').bind(now(), token.id, token.user_id).run();
  }
  return { userId: token.user_id, owner: `token:${token.id}`, writable: scopes.includes('bookmarks:write') };
}

export async function accountRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === '/auth/setup' && method === 'GET') {
    const initialized = !!await env.DB.prepare('SELECT id FROM users LIMIT 1').first();
    const settings = await policy(env);
    return json({ initialized, requires_setup_token: !initialized, registration_mode: settings.registration_mode, turnstile_site_key: settings.turnstile_enabled ? env.TURNSTILE_SITE_KEY ?? '' : '', turnstile_required: !!settings.turnstile_enabled });
  }
  if (path === '/auth/register' && method === 'POST') {
    const body = await bodyJson(request);
    const username = field(body, 'username', 64).trim();
    const email = field(body, 'email', 254).trim().toLowerCase();
    const displayName = typeof body.display_name === 'string' ? field(body, 'display_name', 128).trim() : '';
    if (!/^[\p{L}\p{N}_-]{2,64}$/u.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid username or email');
    const first = !await env.DB.prepare('SELECT id FROM users LIMIT 1').first();
    const settings = await policy(env);
    if (settings.turnstile_enabled) await verifyTurnstile(request, env, body.turnstile_token);
    if (first) {
      if (!env.SETUP_TOKEN) throw new HttpError(503, 'Configure SETUP_TOKEN before registration');
      if (!constantEqual(String(body.setup_token ?? ''), env.SETUP_TOKEN)) throw new HttpError(403, 'Invalid setup token');
    } else if (settings.registration_mode === 'closed') throw new HttpError(403, 'Registration is closed');
    const invitation = !first && settings.registration_mode === 'invite' ? await digest(field(body, 'invitation_code', 256)) : null;
    const passwordHash = await hashPassword(field(body, 'password', 1024));
    let user: User | null;
    try {
      // A concurrent initial registration fails the unique admin index instead of
      // accidentally granting administrator permissions to a second account.
      const uuid = crypto.randomUUID();
      if (invitation) {
        // Insert and consume in the same D1 transaction. No read/decrement race,
        // and a failed user insert cannot consume an invitation.
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO users(uuid,username,email,display_name,password_hash,is_system_admin)
            SELECT ?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM invitations WHERE code_hash=? AND remaining>0 AND revoked_at IS NULL AND expires_at>?)`)
            .bind(uuid, username, email, displayName, passwordHash, invitation, now()),
          env.DB.prepare(`UPDATE invitations SET remaining=remaining-1 WHERE code_hash=? AND remaining>0
            AND EXISTS(SELECT 1 FROM users WHERE uuid=?)`).bind(invitation, uuid),
        ]);
        user = await env.DB.prepare('SELECT * FROM users WHERE uuid=?').bind(uuid).first<User>();
        if (!user) throw new HttpError(403, 'Invitation is invalid, expired or exhausted');
      } else {
        user = await env.DB.prepare('INSERT INTO users(uuid,username,email,display_name,password_hash,is_system_admin) VALUES(?,?,?,?,?,?) RETURNING *')
          .bind(uuid, username, email, displayName, passwordHash, first ? 1 : 0).first<User>();
      }
    } catch (error) {
      if (String(error).includes('UNIQUE constraint')) throw new HttpError(409, 'Username/email is taken or setup completed; retry registration');
      throw error;
    }
    return createSession(env, user!);
  }
  if (path === '/auth/login' && method === 'POST') {
    const body = await bodyJson(request);
    const identifier = field(body, 'username').trim();
    const password = field(body, 'password', 1024);
    const user = await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').bind(identifier, identifier).first<User>();
    // Use a real derivation for unknown accounts too, avoiding a cheap timing oracle.
    const dummyHash = `pbkdf2-sha256$600000$${'0'.repeat(32)}$${'0'.repeat(64)}`;
    const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
    if (!user || user.disabled || !valid) throw new HttpError(401, 'Invalid credentials');
    return createSession(env, user);
  }
  if (!['/me', '/me/password', '/auth/logout', '/tokens', '/sessions', '/usage'].includes(path) && !/^\/(tokens|sessions)\/\d+$/.test(path) && !path.startsWith('/admin/')) return null;
  const user = await requireSession(request, env);
  const operation = await operationsRoute(request, env, path, user);
  if (operation) return operation;
  if (path === '/me' && method === 'GET') return json(publicUser(user));
  if (path === '/me' && method === 'PUT') {
    const body = await bodyJson(request);
    const email = field(body, 'email', 254).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email');
    try {
      await env.DB.prepare('UPDATE users SET email=?,display_name=? WHERE id=?').bind(email, field(body, 'display_name', 128).trim(), user.id).run();
    } catch (error) {
      if (String(error).includes('UNIQUE constraint')) throw new HttpError(409, 'Email is taken');
      throw error;
    }
    return json({ ok: true, email });
  }
  if (path === '/me/password' && method === 'PUT') {
    const body = await bodyJson(request);
    if (!await verifyPassword(field(body, 'current_password', 1024), user.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    const hash = await hashPassword(field(body, 'new_password', 1024));
    const sessionHash = await digest(sessionToken(request));
    // Conditional update is followed by session invalidation only if it won.
    const result = await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').bind(hash, user.id, user.password_hash),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND session_hash<>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(user.id, sessionHash, user.id, hash),
    ]);
    if (result[0].meta.changes !== 1) throw new HttpError(409, 'Password changed concurrently');
    return json({ ok: true });
  }
  if (path === '/auth/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND session_hash=?').bind(user.id, await digest(sessionToken(request))).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('', env, true) });
  }
  if (path === '/sessions' && method === 'GET') return json((await env.DB.prepare('SELECT id,expires_at,created_at,created_at AS last_used_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY id DESC').bind(user.id, now()).all()).results);
  if ((path === '/sessions' || /^\/sessions\/\d+$/.test(path)) && method === 'DELETE') {
    await (path === '/sessions' ? env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id) : env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND id=?').bind(user.id, integer(path.split('/')[2]))).run();
    return json({ ok: true });
  }
  if (path === '/tokens' && method === 'GET') return json((await env.DB.prepare('SELECT id,uuid,user_id,name,token_prefix,scopes,expires_at,revoked_at,last_used_at,created_at FROM access_tokens WHERE user_id=? ORDER BY id DESC').bind(user.id).all()).results);
  if (path === '/tokens' && method === 'POST') {
    const body = await bodyJson(request);
    const name = field(body, 'name', 128).trim();
    if (!name) throw new HttpError(400, 'Name is required');
    const scopes = typeof body.scopes === 'string' ? body.scopes : 'bookmarks:read bookmarks:write';
    if (!['bookmarks:read', 'bookmarks:read bookmarks:write'].includes(scopes)) throw new HttpError(400, 'Invalid scopes');
    let expiresAt: string | null = null;
    if (body.expires_at != null) {
      const date = new Date(field(body, 'expires_at'));
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new HttpError(400, 'Invalid expiry');
      expiresAt = date.toISOString();
    }
    const plaintext = `ld_${randomToken()}`;
    const quota = await limits(env, user.id);
    const token = await env.DB.prepare(`INSERT INTO access_tokens(uuid,user_id,name,token_hash,token_prefix,scopes,expires_at)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM access_tokens WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?))<?
      RETURNING id,uuid,user_id,name,token_prefix,scopes,expires_at,revoked_at,last_used_at,created_at`)
      .bind(crypto.randomUUID(), user.id, name, await digest(plaintext), plaintext.slice(0, 11), scopes, expiresAt, user.id, now(), quota.max_tokens).first();
    if (!token) throw new HttpError(409, 'Active token quota reached; revoke an unused token');
    return json({ ...token, plaintext }, 201);
  }
  if (/^\/tokens\/\d+$/.test(path) && method === 'DELETE') {
    await env.DB.prepare('UPDATE access_tokens SET revoked_at=? WHERE id=? AND user_id=?').bind(now(), integer(path.split('/')[2]), user.id).run();
    return json({ ok: true });
  }
  if (path.startsWith('/admin/')) {
    if (!user.is_system_admin) throw new HttpError(403, 'Administrator required');
    if (path === '/admin/users' && method === 'GET') return json((await env.DB.prepare('SELECT id,uuid,username,email,display_name,is_system_admin,disabled,created_at,max_files,max_storage_bytes,max_tokens FROM users ORDER BY id DESC LIMIT 1000').all()).results);
    if (/^\/admin\/users\/\d+$/.test(path) && method === 'PUT') {
      const id = integer(path.split('/')[3]);
      const body = await bodyJson(request);
      if (id === user.id || typeof body.disabled !== 'boolean') throw new HttpError(400, 'Invalid account change');
      await env.DB.prepare('UPDATE users SET disabled=? WHERE id=? AND is_system_admin=0').bind(body.disabled ? 1 : 0, id).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Endpoint not found');
}
