import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createScoutframeServer } from './src/server.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const instance = await createScoutframeServer({ rootDir });
await instance.listen();

console.log(`Scoutframe is running at ${instance.baseUrl}`);
console.log('Install the companion from ./companion in Chrome, then sign in to VSCO in the same profile.');

async function shutdown(signal) {
  try {
    await instance.close();
  } finally {
    if (signal) console.log(`\nStopped Scoutframe (${signal}).`);
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
