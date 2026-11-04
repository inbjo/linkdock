import type { Env as Bindings } from '../src/types';
import type { D1Migration } from '@cloudflare/vitest-plugin';
declare global {
  namespace Cloudflare {
    interface Env extends Bindings { TEST_MIGRATIONS: D1Migration[] }
  }
}
