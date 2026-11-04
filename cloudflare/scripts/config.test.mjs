import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readConfig, validateConfig } from './config.mjs';
const local = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
local.vars.PUBLIC_URL = 'http://localhost:8787';
local.d1_databases[0].database_id = 'REPLACE_WITH_D1_DATABASE_ID';
function production() {
  const config = structuredClone(local);
  config.vars.PUBLIC_URL = 'https://bookmarks.example.com';
  config.d1_databases[0].database_id = '12345678-1234-1234-1234-123456789abc';
  return config;
}
test('production preflight rejects placeholder IDs and localhost before any remote action', () => {
  assert.doesNotThrow(() => validateConfig(local));
  assert.throws(() => validateConfig(local, true), /Production PUBLIC_URL/);
  assert.doesNotThrow(() => validateConfig(production(), true));
});
test('preflight rejects broken bindings, invalid limits and secrets in public vars', () => {
  for (const mutate of [c => { c.durable_objects.bindings = [] }, c => { c.vars.HISTORY_LIMIT = '-1' }, c => { c.vars.SETUP_TOKEN = 'secret' }, c => { c.vars.PUBLIC_URL = 'https://example.com/path' }]) {
    const config = production(); mutate(config);
    assert.throws(() => validateConfig(config, true));
  }
});
test('configuration overrides remain structured data and never shell substitutions', async () => {
  const saved = process.env.WORKER_NAME;
  process.env.WORKER_NAME = 'bad;echo shell';
  try { const config = await readConfig(); assert.equal(config.name, 'bad;echo shell'); assert.throws(() => validateConfig(config), /Invalid Worker/); }
  finally { if (saved === undefined) delete process.env.WORKER_NAME; else process.env.WORKER_NAME = saved }
});
