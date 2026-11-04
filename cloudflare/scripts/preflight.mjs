import { readConfig, validateConfig } from './config.mjs';
try {
  validateConfig(await readConfig(), process.argv.includes('--production'));
  console.log('Configuration checks passed. No remote resources were accessed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
