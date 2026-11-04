import { spawnSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readConfig, validateConfig } from './config.mjs';

// Explicit invocation publishes to existing resources. Provisioning remains a
// separate documented action, preventing accidental new databases on upgrades.
const cwd = fileURLToPath(new URL('../', import.meta.url));
const configPath = `${cwd}.deploy-${randomUUID()}.json`;
const secretsPath = `${cwd}.secrets-${randomUUID()}.json`;
function run(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed (${result.status ?? result.error?.code})`);
}
try {
  const config = await readConfig();
  validateConfig(config, true);
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
  if (process.env.SETUP_TOKEN && process.env.SETUP_TOKEN.length < 32) throw new Error('SETUP_TOKEN must be at least 32 characters');
  const secrets = Object.fromEntries(['SETUP_TOKEN', 'TURNSTILE_SECRET_KEY'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await writeFile(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
  // Verify bindings before changing a schema. Fail instead of creating resources.
  run(['d1', 'info', 'linkdock-accounts', '--config', configPath]);
  run(['r2', 'bucket', 'info', config.r2_buckets[0].bucket_name, '--config', configPath]);
  run(['deploy', '--dry-run', '--config', configPath]);
  run(['d1', 'migrations', 'apply', 'linkdock-accounts', '--remote', '--config', configPath]);
  run(['deploy', '--config', configPath, ...(Object.keys(secrets).length ? ['--secrets-file', secretsPath] : [])]);
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(new URL('/health/ready', config.vars.PUBLIC_URL), { signal: AbortSignal.timeout(10_000) });
      if (response.ok && (await response.json()).status === 'ready') { ready = true; break; }
    } catch { /* Domain propagation may take a few seconds. */ }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!ready) throw new Error('Worker deployed but public readiness did not pass; inspect DNS and Worker logs');
  console.log('Deployment completed; public readiness passed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await Promise.all([rm(configPath, { force: true }), rm(secretsPath, { force: true })]); }
