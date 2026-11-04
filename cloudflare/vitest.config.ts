import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

const migrations = await readD1Migrations('./migrations');
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { SETUP_TOKEN: 'test-setup-token', TURNSTILE_SITE_KEY: 'test-site-key', TURNSTILE_SECRET_KEY: 'test-secret', TEST_MIGRATIONS: migrations } },
  })],
  test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'], testTimeout: 30_000 },
});
