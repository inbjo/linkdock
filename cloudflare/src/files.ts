import { DurableObject } from 'cloudflare:workers';
import { SaxesParser } from 'saxes';
import { escapeXml, failure, HttpError, json, limitedBody } from './http';
import type { Limits } from './policy';
import type { Env, Identity } from './types';

interface FileRow {
  path: string; key: string | null; revision: number; size: number;
  updated_at: string; etag: string;
}
interface VersionRow {
  id: string; path: string; key: string; revision: number; size: number; created_at: string;
}
interface StageRow { path: string; owner: string; key: string; size: number; updated_at: string; }
interface LockRow { path: string; owner: string; expires_at: number; }

const LOCK_MS = 300_000;
const LOCK_CONTENT = 'Linkdock Floccus lock';
const GC_DELAY = 86_400_000;
const ALLOW = 'OPTIONS, PROPFIND, GET, HEAD, PUT, MOVE, DELETE';

export function filePath(value: string): string {
  if (!value || value.length > 255 || value.includes('/') || /[\\\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..') throw new HttpError(400, 'Invalid filename');
  return value;
}
function documentPath(value: string): string {
  filePath(value);
  if (!value.endsWith('.xbel')) throw new HttpError(400, 'Use an .xbel filename');
  return value;
}

export function validateXbel(bytes: Uint8Array): void {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); }
  catch { throw new HttpError(400, 'XBEL must use UTF-8'); }
  // Validate without building a tree or changing bytes. Only a simple XBEL
  // doctype is allowed; external DTDs and entity declarations are unsupported.
  let depth = 0;
  let count = 0;
  let root = false;
  const parser = new SaxesParser();
  parser.on('doctype', value => { if (value.trim() !== 'xbel') throw new Error('Unsupported DTD'); });
  parser.on('opentag', tag => {
    if (depth === 0) { if (tag.name !== 'xbel') throw new Error('Expected XBEL'); root = true; }
    if (++depth > 128 || ++count > 100_000) throw new Error('XML exceeds structural limits');
  });
  parser.on('closetag', () => { depth--; });
  try { parser.write(text).close(); if (!root) throw new Error('Missing root'); }
  catch { throw new HttpError(400, 'Invalid XBEL XML or unsupported DTD'); }
}

export class UserFiles extends DurableObject<Env> {
  // R2 awaits permit DO request interleaving. Serialize both reads and writes
  // explicitly so no lock/mutation/read can enter during a pointer transition.
  private tail: Promise<unknown> = Promise.resolve();
  private quotas: Limits = { max_files: 100, max_storage_bytes: 104857600, max_tokens: 20 };
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS identity(user_id INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,key TEXT,revision INTEGER NOT NULL,size INTEGER NOT NULL,updated_at TEXT NOT NULL,etag TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,path TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS versions_path ON versions(path,revision);
      CREATE TABLE IF NOT EXISTS staging(path TEXT NOT NULL,owner TEXT NOT NULL,key TEXT NOT NULL,size INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(path,owner));
      CREATE TABLE IF NOT EXISTS locks(path TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS garbage(key TEXT PRIMARY KEY,after_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS objects(key TEXT PRIMARY KEY,size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS failures(id INTEGER PRIMARY KEY AUTOINCREMENT,method TEXT NOT NULL,status INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS maintenance(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT OR IGNORE INTO objects(key,size) SELECT key,size FROM versions;
      INSERT OR IGNORE INTO objects(key,size) SELECT key,size FROM staging;
    `);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      try { return await this.handle(request); }
      catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        if (['PUT', 'MOVE', 'DELETE', 'POST'].includes(request.method)) {
          this.ctx.storage.sql.exec('INSERT INTO failures(method,status,created_at) VALUES(?,?,?)', request.method, status, new Date().toISOString());
          this.ctx.storage.sql.exec('DELETE FROM failures WHERE id NOT IN (SELECT id FROM failures ORDER BY id DESC LIMIT 100)');
        }
        return failure(error);
      }
    });
  }

  private rows<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }
  private file(path: string): FileRow | undefined {
    return this.rows('SELECT * FROM files WHERE path=? AND key IS NOT NULL', path)[0] as unknown as FileRow | undefined;
  }
  private lock(path: string): LockRow | undefined {
    return this.rows('SELECT * FROM locks WHERE path=? AND expires_at>?', path, Date.now())[0] as unknown as LockRow | undefined;
  }
  private stage(path: string, owner: string): StageRow | undefined {
    return this.rows('SELECT * FROM staging WHERE path=? AND owner=?', path, owner)[0] as unknown as StageRow | undefined;
  }
  private checkLock(path: string, identity: Identity): void {
    const lock = this.lock(path);
    if (lock && lock.owner !== identity.owner) throw new HttpError(423, 'File is locked by another device');
  }
  private conditions(request: Request, file?: FileRow): void {
    const match = request.headers.get('if-match');
    const none = request.headers.get('if-none-match');
    if (match && !(file && (match.trim() === '*' || match.split(',').some(x => x.trim() === file.etag)))) throw new HttpError(412, 'File changed; refresh before writing');
    if (none && file && (none.trim() === '*' || none.split(',').some(x => x.trim().replace(/^W\//, '') === file.etag))) throw new HttpError(412, 'File already exists or changed');
  }
  private write(identity: Identity): void {
    if (!identity.writable) throw new HttpError(403, 'Read-only access token');
  }
  private maxBytes(): number { return Math.max(1, Math.min(Number(this.env.MAX_FILE_BYTES) || 10_485_760, 100_000_000)); }
  private queueGarbage(key: string): void {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO garbage(key,after_ms) VALUES(?,?)', key, Date.now() + GC_DELAY);
  }
  private async scheduleCleanup(): Promise<void> {
    const next = this.rows<{ due: number | null }>('SELECT MIN(after_ms) AS due FROM garbage')[0].due;
    const current = await this.ctx.storage.getAlarm();
    const due = Math.max(1000 + Date.now(), Math.min(next ?? Infinity, Date.now() + 3600_000));
    if (!current || current > due) await this.ctx.storage.setAlarm(due);
  }
  private async putObject(bytes: Uint8Array, identity: Identity): Promise<string> {
    const key = `users/${identity.userId}/versions/${crypto.randomUUID()}`;
    // Persist the cleanup record before the upload. A crash between upload and
    // commit leaves an orphan that an alarm can reclaim, never a dangling file.
    const stored = this.rows<{ bytes: number }>('SELECT COALESCE(SUM(size),0) AS bytes FROM objects')[0].bytes;
    if (stored + bytes.length > this.quotas.max_storage_bytes) throw new HttpError(507, 'Storage quota reached, including history and pending cleanup');
    this.ctx.storage.transactionSync(() => {
      this.queueGarbage(key);
      this.ctx.storage.sql.exec('INSERT INTO objects(key,size) VALUES(?,?)', key, bytes.length);
    });
    await this.scheduleCleanup();
    await this.env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/xbel+xml; charset=utf-8' } });
    return key;
  }

  private commit(path: string, key: string, size: number, stage?: StageRow): FileRow {
    return this.ctx.storage.transactionSync(() => {
      const previous = this.rows<{ revision: number }>('SELECT revision FROM files WHERE path=?', path)[0]?.revision ?? 0;
      const revision = previous + 1;
      const id = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const etag = `"${id}-${revision}"`;
      this.ctx.storage.sql.exec(`INSERT INTO files(path,key,revision,size,updated_at,etag) VALUES(?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET key=excluded.key,revision=excluded.revision,size=excluded.size,updated_at=excluded.updated_at,etag=excluded.etag`, path, key, revision, size, timestamp, etag);
      this.ctx.storage.sql.exec('INSERT INTO versions(id,path,key,revision,size,created_at) VALUES(?,?,?,?,?,?)', id, path, key, revision, size, timestamp);
      this.ctx.storage.sql.exec('DELETE FROM garbage WHERE key=?', key);
      if (stage) this.ctx.storage.sql.exec('DELETE FROM staging WHERE path=? AND owner=?', stage.path, stage.owner);
      const configured = Number(this.env.HISTORY_LIMIT ?? '20');
      const keep = (Number.isFinite(configured) ? Math.max(0, Math.min(Math.floor(configured), 100)) : 20) + 1;
      const old = this.rows<{ id: string; key: string }>('SELECT id,key FROM versions WHERE path=? ORDER BY revision DESC LIMIT -1 OFFSET ?', path, keep);
      for (const version of old) {
        this.queueGarbage(version.key);
        this.ctx.storage.sql.exec('DELETE FROM versions WHERE id=?', version.id);
      }
      return { path, key, revision, size, updated_at: timestamp, etag };
    });
  }

  private async handle(request: Request): Promise<Response> {
    const userId = Number(request.headers.get('x-linkdock-user'));
    const owner = request.headers.get('x-linkdock-owner') ?? '';
    if (!Number.isSafeInteger(userId) || userId < 1 || !/^(token:\d+|session)$/.test(owner)) throw new HttpError(403, 'Invalid internal identity');
    this.ctx.storage.sql.exec('INSERT INTO identity(user_id) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM identity)', userId);
    if (this.rows<{ user_id: number }>('SELECT user_id FROM identity')[0].user_id !== userId) throw new HttpError(403, 'User isolation violation');
    const identity: Identity = { userId, owner, writable: request.headers.get('x-linkdock-write') === 'true' };
    const rawLimits = request.headers.get('x-linkdock-limits');
    if (rawLimits) {
      const parsed = JSON.parse(rawLimits) as Limits;
      if (![parsed.max_files, parsed.max_storage_bytes, parsed.max_tokens].every(n => Number.isSafeInteger(n) && n > 0)) throw new HttpError(400, 'Invalid internal quota');
      this.quotas = parsed;
    }
    const url = new URL(request.url);
    if (url.pathname === '/internal/usage' && request.method === 'GET') {
      await this.scheduleCleanup();
      return json(this.usage());
    }
    if (url.pathname === '/internal/operations' && request.method === 'GET') return json({ usage: this.usage(), cleanup: this.cleanupState(), failures: this.rows('SELECT id,method,status,created_at FROM failures ORDER BY id DESC LIMIT 50') });
    if (url.pathname === '/internal/cleanup' && request.method === 'POST') {
      this.write(identity);
      await this.cleanup();
      return json({ usage: this.usage(), cleanup: this.cleanupState() });
    }
    if (url.pathname.startsWith('/internal/files')) return this.api(request, identity, url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: { allow: ALLOW, dav: '1' } });
    let path: string;
    try { path = decodeURIComponent(url.pathname.slice('/webdav/'.length)); }
    catch { throw new HttpError(400, 'Invalid path encoding'); }
    if (path) filePath(path);
    if (request.method === 'PROPFIND') return this.propfind(request, identity, path);
    if (!path && ['GET', 'HEAD'].includes(request.method)) return new Response(null);
    if (!path) throw new HttpError(405, 'Use a file path');
    const isLock = path.endsWith('.lock');
    const isStage = path.endsWith('.temp');
    if (isLock) return this.lockRoute(request, identity, documentPath(path.slice(0, -5)));
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (isStage) {
        const stage = this.stage(path, owner);
        if (!stage) throw new HttpError(404, 'File not found');
        return this.download(request, stage.key, stage.size, `"${stage.key.split('/').pop()}"`, stage.updated_at);
      }
      const file = this.file(documentPath(path));
      if (!file) throw new HttpError(404, 'File not found');
      return this.download(request, file.key!, file.size, file.etag, file.updated_at);
    }
    this.write(identity);
    if (request.method === 'PUT') {
      const target = documentPath(isStage ? path.slice(0, -5) : path);
      this.checkLock(target, identity);
      this.checkFileQuota(target);
      if (!isStage) this.conditions(request, this.file(path));
      if (isStage && !this.stage(path, owner)) {
        const count = this.rows<{ n: number }>('SELECT COUNT(*) AS n FROM staging')[0].n;
        if (count >= this.quotas.max_files * this.quotas.max_tokens) throw new HttpError(507, 'Staging quota reached');
      }
      const bytes = await limitedBody(request, this.maxBytes());
      // Staging bytes remain opaque until MOVE, matching Floccus's workflow.
      if (!isStage) validateXbel(bytes);
      const existed = isStage ? !!this.stage(path, owner) : !!this.file(path);
      const key = await this.putObject(bytes, identity);
      if (isStage) {
        this.ctx.storage.transactionSync(() => {
          const old = this.stage(path, owner);
          if (old) this.queueGarbage(old.key);
          this.ctx.storage.sql.exec(`INSERT INTO staging(path,owner,key,size,updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(path,owner) DO UPDATE SET key=excluded.key,size=excluded.size,updated_at=excluded.updated_at`, path, owner, key, bytes.length, new Date().toISOString());
          // Staging expires after one day; queue remains until promotion.
        });
        await this.scheduleCleanup();
        return new Response(null, { status: existed ? 204 : 201 });
      }
      const committed = this.commit(path, key, bytes.length);
      await this.scheduleCleanup();
      return new Response(null, { status: existed ? 204 : 201, headers: { etag: committed.etag } });
    }
    if (request.method === 'MOVE') {
      if (!isStage) throw new HttpError(403, 'MOVE requires a token-private .temp file');
      let destination: URL;
      try { destination = new URL(request.headers.get('destination') ?? '', request.url); }
      catch { throw new HttpError(400, 'Invalid destination'); }
      if (destination.origin !== url.origin || !destination.pathname.startsWith('/webdav/')) throw new HttpError(400, 'Destination must be on this server');
      let target: string;
      try { target = documentPath(decodeURIComponent(destination.pathname.slice('/webdav/'.length))); }
      catch { throw new HttpError(400, 'Invalid destination'); }
      this.checkLock(target, identity);
      this.checkFileQuota(target);
      const current = this.file(target);
      this.conditions(request, current);
      const overwrite = request.headers.get('overwrite') ?? 'T';
      if (!['T', 'F'].includes(overwrite)) throw new HttpError(400, 'Invalid Overwrite header');
      if (overwrite === 'F' && current) throw new HttpError(412, 'Destination exists');
      const stage = this.stage(path, owner);
      if (!stage) throw new HttpError(404, 'Staging file not found');
      const object = await this.env.FILES.get(stage.key);
      if (!object) throw new HttpError(503, 'Staging object unavailable');
      validateXbel(new Uint8Array(await object.arrayBuffer()));
      const committed = this.commit(target, stage.key, stage.size, stage);
      await this.scheduleCleanup();
      return new Response(null, { status: current ? 204 : 201, headers: { etag: committed.etag } });
    }
    if (request.method === 'DELETE') {
      if (isStage) {
        const stage = this.stage(path, owner);
        if (!stage) throw new HttpError(404, 'File not found');
        this.ctx.storage.transactionSync(() => {
          this.queueGarbage(stage.key);
          this.ctx.storage.sql.exec('DELETE FROM staging WHERE path=? AND owner=?', path, owner);
        });
      } else {
        documentPath(path);
        this.checkLock(path, identity);
        const file = this.file(path);
        this.conditions(request, file);
        if (!file) throw new HttpError(404, 'File not found');
        this.remove(path);
      }
      await this.scheduleCleanup();
      return new Response(null, { status: 204 });
    }
    throw new HttpError(405, 'Unsupported WebDAV method');
  }

  private remove(path: string): void {
    this.ctx.storage.transactionSync(() => {
      for (const row of this.rows<{ key: string }>('SELECT key FROM versions WHERE path=?', path)) this.queueGarbage(row.key);
      this.ctx.storage.sql.exec('DELETE FROM versions WHERE path=?', path);
      this.ctx.storage.sql.exec('UPDATE files SET key=NULL,size=0,revision=revision+1 WHERE path=?', path);
    });
  }

  private async api(request: Request, identity: Identity, url: URL): Promise<Response> {
    const raw = url.pathname.slice('/internal/files'.length);
    if (!raw && request.method === 'GET') {
      const rows = this.rows('SELECT path,size,revision,updated_at,etag FROM files WHERE key IS NOT NULL ORDER BY path');
      return json(rows.map(row => ({ ...row, locked: !!this.lock(row.path as string) })));
    }
    const parts = raw.split('/').filter(Boolean).map(x => decodeURIComponent(x));
    const path = documentPath(parts[0] ?? '');
    if (parts.length === 2 && parts[1] === 'versions' && request.method === 'GET') return json(this.rows('SELECT id,revision,size,created_at FROM versions WHERE path=? ORDER BY revision DESC', path));
    if (parts.length === 3 && parts[1] === 'versions' && ['GET', 'POST'].includes(request.method)) {
      const version = this.rows('SELECT * FROM versions WHERE path=? AND id=?', path, parts[2])[0] as unknown as VersionRow | undefined;
      if (!version) throw new HttpError(404, 'Version not found');
      if (request.method === 'GET') return this.download(request, version.key, version.size, `"${version.id}"`, version.created_at);
      this.write(identity);
      this.checkLock(path, identity);
      this.conditions(request, this.file(path));
      // The selected immutable object already exists. New revision and retention
      // update are atomic; multiple versions can safely reference the same key.
      this.checkFileQuota(path);
      const file = this.commit(path, version.key, version.size);
      await this.scheduleCleanup();
      return json(file);
    }
    if (parts.length !== 1) throw new HttpError(404, 'Endpoint not found');
    const forwarded = new URL(request.url);
    forwarded.pathname = `/webdav/${encodeURIComponent(path)}`;
    return this.handle(new Request(forwarded, request));
  }

  private lockRoute(request: Request, identity: Identity, path: string): Response {
    const lock = this.lock(path);
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!lock) throw new HttpError(404, 'Lock not found');
      return new Response(request.method === 'HEAD' ? null : LOCK_CONTENT, { headers: { 'content-type': 'text/plain', 'content-length': String(LOCK_CONTENT.length) } });
    }
    this.write(identity);
    this.checkLock(path, identity);
    if (request.method === 'PUT') {
      const activeLocks = this.rows<{ n: number }>('SELECT COUNT(*) AS n FROM locks WHERE expires_at>?', Date.now())[0].n;
      if (!lock && activeLocks >= this.quotas.max_files) throw new HttpError(507, 'Active lock quota reached');
      this.ctx.storage.sql.exec(`INSERT INTO locks(path,owner,expires_at) VALUES(?,?,?)
        ON CONFLICT(path) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at`, path, identity.owner, Date.now() + LOCK_MS);
      return new Response(null, { status: lock ? 204 : 201 });
    }
    if (request.method === 'DELETE') {
      this.ctx.storage.sql.exec('DELETE FROM locks WHERE path=?', path);
      return new Response(null, { status: 204 });
    }
    throw new HttpError(405, 'Unsupported lock operation');
  }

  private async download(request: Request, key: string, size: number, etag: string, timestamp: string): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/xbel+xml; charset=utf-8', etag, 'last-modified': new Date(timestamp).toUTCString(), 'content-length': String(size) });
    const match = request.headers.get('if-match');
    if (match && match !== '*' && !match.split(',').some(x => x.trim() === etag)) throw new HttpError(412, 'File changed');
    const none = request.headers.get('if-none-match');
    if (none && (none === '*' || none.split(',').some(x => x.trim().replace(/^W\//, '') === etag))) return new Response(null, { status: 304, headers: { etag } });
    if (request.method === 'HEAD') return new Response(null, { headers });
    const object = await this.env.FILES.get(key);
    if (!object) throw new HttpError(503, 'File object unavailable');
    return new Response(object.body, { headers });
  }

  private async propfind(request: Request, identity: Identity, path: string): Promise<Response> {
    await limitedBody(request, 16_384);
    const depth = request.headers.get('depth') ?? '1';
    if (!['0', '1'].includes(depth)) throw new HttpError(403, 'Only Depth 0 and 1 are supported');
    const entries: { path: string; size: number; etag?: string; updated_at?: string; collection?: boolean }[] = [];
    if (!path) {
      entries.push({ path: '', size: 0, collection: true });
      if (depth === '1') {
        entries.push(...this.rows('SELECT path,size,etag,updated_at FROM files WHERE key IS NOT NULL ORDER BY path') as unknown as FileRow[]);
        entries.push(...this.rows('SELECT path,size,updated_at FROM staging WHERE owner=?', identity.owner) as unknown as StageRow[]);
        for (const row of this.rows<{ path: string }>('SELECT path FROM locks WHERE expires_at>?', Date.now())) entries.push({ path: `${row.path}.lock`, size: LOCK_CONTENT.length });
      }
    } else if (path.endsWith('.lock')) {
      if (!this.lock(path.slice(0, -5))) throw new HttpError(404, 'Lock not found');
      entries.push({ path, size: LOCK_CONTENT.length });
    } else if (path.endsWith('.temp')) {
      const stage = this.stage(path, identity.owner);
      if (!stage) throw new HttpError(404, 'File not found');
      entries.push(stage);
    } else {
      const file = this.file(path);
      if (!file) throw new HttpError(404, 'File not found');
      entries.push(file);
    }
    const xml = entries.map(item => `<d:response><d:href>${escapeXml(`/webdav/${encodeURIComponent(item.path)}`)}</d:href><d:propstat><d:prop><d:displayname>${escapeXml(item.path || 'Linkdock')}</d:displayname><d:resourcetype>${item.collection ? '<d:collection/>' : ''}</d:resourcetype><d:getcontentlength>${item.size}</d:getcontentlength>${item.etag ? `<d:getetag>${escapeXml(item.etag)}</d:getetag>` : ''}${item.updated_at ? `<d:getlastmodified>${new Date(item.updated_at).toUTCString()}</d:getlastmodified>` : ''}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('');
    return new Response(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${xml}</d:multistatus>`, { status: 207, headers: { 'content-type': 'application/xml; charset=utf-8', dav: '1' } });
  }

  private checkFileQuota(path: string): void {
    const paths = this.rows<{ path: string }>(`SELECT path FROM files WHERE key IS NOT NULL UNION SELECT substr(path,1,length(path)-5) AS path FROM staging`);
    if (!paths.some(row => row.path === path) && paths.length >= this.quotas.max_files) throw new HttpError(507, 'File count quota reached');

  }

  private usage() {
    const sum = (query: string) => this.rows<{ n: number }>(query)[0].n;
    const current = sum('SELECT COALESCE(SUM(size),0) AS n FROM files WHERE key IS NOT NULL');
    const history = sum('SELECT COALESCE(SUM(size),0) AS n FROM (SELECT DISTINCT key,size FROM versions WHERE key NOT IN (SELECT key FROM files WHERE key IS NOT NULL))');
    return {
      files: sum('SELECT COUNT(*) AS n FROM files WHERE key IS NOT NULL'),
      current_bytes: current, history_bytes: history,
      staging_bytes: sum('SELECT COALESCE(SUM(size),0) AS n FROM staging'),
      stored_bytes: sum('SELECT COALESCE(SUM(size),0) AS n FROM objects'),
      pending_cleanup: sum('SELECT COUNT(*) AS n FROM garbage'),
      failures: sum('SELECT COUNT(*) AS n FROM failures'), limits: this.quotas,
    };
  }

  private cleanupState(): Record<string, unknown> {
    const value = this.rows<{ value: string }>("SELECT value FROM maintenance WHERE key='cleanup'")[0]?.value;
    return value ? JSON.parse(value) : { last_run_at: null, last_success_at: null, deleted_objects: 0, expired_staging: 0, error: null };
  }
  private saveCleanup(value: Record<string, unknown>): void {
    this.ctx.storage.sql.exec("INSERT INTO maintenance(key,value) VALUES('cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(value));
  }
  private references(key: string): number {
    return this.rows<{ n: number }>(`SELECT (SELECT COUNT(*) FROM files WHERE key=?)+(SELECT COUNT(*) FROM versions WHERE key=?)+(SELECT COUNT(*) FROM staging WHERE key=?) AS n`, key, key, key)[0].n;
  }

  private async cleanup(): Promise<void> {
    const state = { ...this.cleanupState(), last_run_at: new Date().toISOString(), deleted_objects: 0, expired_staging: 0, scanned_objects: 0, error: null as string | null };
    this.saveCleanup(state);
    try {
      const expired = this.rows<{ key: string; path: string; owner: string }>('SELECT key,path,owner FROM staging WHERE updated_at<? LIMIT 100', new Date(Date.now() - GC_DELAY).toISOString());
      this.ctx.storage.transactionSync(() => {
        for (const stage of expired) {
          this.queueGarbage(stage.key);
          this.ctx.storage.sql.exec('DELETE FROM staging WHERE path=? AND owner=?', stage.path, stage.owner);
        }
        this.ctx.storage.sql.exec('DELETE FROM locks WHERE expires_at<=?', Date.now());
      });
      state.expired_staging = expired.length;
      const candidates = this.rows<{ key: string }>('SELECT key FROM garbage WHERE after_ms<=? LIMIT 100', Date.now());
      for (const { key } of candidates) {
        const staged = this.rows<{ n: number }>('SELECT COUNT(*) AS n FROM staging WHERE key=?', key)[0].n;
        if (staged) {
          this.ctx.storage.sql.exec('UPDATE garbage SET after_ms=? WHERE key=?', Date.now() + 60_000, key);
          continue;
        }
        if (!this.references(key)) {
          await this.env.FILES.delete(key);
          this.ctx.storage.sql.exec('DELETE FROM objects WHERE key=?', key);
          state.deleted_objects++;
        }
        this.ctx.storage.sql.exec('DELETE FROM garbage WHERE key=?', key);
      }
      // Incremental prefix scan catches pre-existing/untracked objects too. It
      // never crosses the owning user's prefix and only deletes objects older
      // than the grace period after checking every current metadata reference.
      const userId = this.rows<{ user_id: number }>('SELECT user_id FROM identity')[0]?.user_id;
      if (userId) {
        const cursor = this.rows<{ value: string }>("SELECT value FROM maintenance WHERE key='scan_cursor'")[0]?.value;
        const list = await this.env.FILES.list({ prefix: `users/${userId}/versions/`, limit: 100, ...(cursor ? { cursor } : {}) });
        for (const object of list.objects) {
          state.scanned_objects++;
          this.ctx.storage.sql.exec('INSERT OR IGNORE INTO objects(key,size) VALUES(?,?)', object.key, object.size);
          if (object.uploaded.getTime() > Date.now() - GC_DELAY || this.references(object.key)) continue;
          const garbage = this.rows<{ after_ms: number }>('SELECT after_ms FROM garbage WHERE key=?', object.key)[0];
          if (garbage && garbage.after_ms > Date.now()) continue;
          await this.env.FILES.delete(object.key);
          this.ctx.storage.sql.exec('DELETE FROM objects WHERE key=?', object.key);
          this.ctx.storage.sql.exec('DELETE FROM garbage WHERE key=?', object.key);
          state.deleted_objects++;
        }
        this.ctx.storage.sql.exec("INSERT INTO maintenance(key,value) VALUES('scan_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", list.truncated ? list.cursor : '');
      }
      this.saveCleanup({ ...state, last_success_at: new Date().toISOString() });
      await this.scheduleCleanup();
    } catch (error) {
      this.saveCleanup({ ...state, error: 'Object cleanup failed; will retry' });
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      throw error;
    }
  }

  alarm(): Promise<void> { return this.serial(() => this.cleanup()); }
}
