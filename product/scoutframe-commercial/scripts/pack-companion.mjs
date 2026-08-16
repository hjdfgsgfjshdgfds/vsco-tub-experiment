import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const companionDir = path.join(root, 'companion');
const distDir = path.join(root, 'dist');
const destination = path.join(distDir, 'scoutframe-companion.zip');
fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(destination, { force: true });

const result = spawnSync('zip', ['-q', '-r', destination, '.'], { cwd: companionDir, encoding: 'utf8' });
if (result.error?.code === 'ENOENT') {
  console.error('The system zip command is required to package the companion.');
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'Could not package the companion.');
  process.exit(result.status || 1);
}
console.log(destination);
