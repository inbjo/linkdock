import { readFile } from 'node:fs/promises';

export async function readConfig(path = new URL('../wrangler.jsonc', import.meta.url)) {
  // The checked-in file is JSON-compatible JSONC. Parse structurally; never
  // substitute untrusted values into shell commands or sed expressions.
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (process.env.WORKER_NAME) config.name = process.env.WORKER_NAME;
  if (process.env.D1_DATABASE_ID) config.d1_databases[0].database_id = process.env.D1_DATABASE_ID;
  if (process.env.R2_BUCKET_NAME) config.r2_buckets[0].bucket_name = process.env.R2_BUCKET_NAME;
  if (process.env.PUBLIC_URL) config.vars.PUBLIC_URL = process.env.PUBLIC_URL;
  if (process.env.TURNSTILE_SITE_KEY) config.vars.TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY;
  if (process.env.CUSTOM_DOMAIN === 'true') config.routes = [{ pattern: new URL(config.vars.PUBLIC_URL).hostname, custom_domain: true }];
  return config;
}

export function validateConfig(config, production = false) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.name ?? '')) errors.push('Invalid Worker name');
  if (!config.d1_databases?.some(item => item.binding === 'DB')) errors.push('Missing DB binding');
  if (!config.r2_buckets?.some(item => item.binding === 'FILES')) errors.push('Missing FILES binding');
  if (!config.durable_objects?.bindings?.some(item => item.name === 'USER_FILES' && item.class_name === 'UserFiles')) errors.push('Missing USER_FILES binding');
  if (!config.assets?.directory || !config.assets.run_worker_first) errors.push('Assets must route through the Worker');
  if (!config.triggers?.crons?.length) errors.push('Missing maintenance cron');
  try {
    const url = new URL(config.vars?.PUBLIC_URL);
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) errors.push('PUBLIC_URL must be an origin without path, query or credentials');
    if (production && (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname))) errors.push('Production PUBLIC_URL must use a public HTTPS origin');
    if (!['http:', 'https:'].includes(url.protocol)) errors.push('PUBLIC_URL must use HTTP(S)');
  } catch { errors.push('Invalid PUBLIC_URL'); }
  if (production && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(config.d1_databases?.find(item => item.binding === 'DB')?.database_id ?? '')) errors.push('Set a real D1_DATABASE_ID');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.r2_buckets?.find(item => item.binding === 'FILES')?.bucket_name ?? '')) errors.push('Invalid R2 bucket name');
  for (const key of ['MAX_FILE_BYTES', 'HISTORY_LIMIT']) {
    const value = Number(config.vars?.[key]);
    if (!Number.isSafeInteger(value) || value < (key === 'HISTORY_LIMIT' ? 0 : 1)) errors.push(`Invalid ${key}`);
  }
  if (Number(config.vars?.MAX_FILE_BYTES) > 100_000_000 || Number(config.vars?.HISTORY_LIMIT) > 100) errors.push('Configured file/history limits exceed supported bounds');
  if (config.vars?.TURNSTILE_SECRET_KEY || config.vars?.SETUP_TOKEN) errors.push('Private secrets must not be stored in vars');
  if (errors.length) throw new Error(errors.join('\n'));
}
