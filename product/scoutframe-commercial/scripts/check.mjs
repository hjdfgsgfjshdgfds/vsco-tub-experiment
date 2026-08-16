import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'data', 'dist', 'node_modules']);
const failures = [];

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else output.push(full);
  }
  return output;
}

const files = walk(root);
for (const file of files.filter(file => /\.(?:js|mjs|cjs)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.stderr || result.stdout}`);
}

for (const file of files.filter(file => file.endsWith('.json'))) {
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${path.relative(root, file)}: invalid JSON (${error.message})`);
  }
}

const manifestPath = path.join(root, 'companion', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const required of ['background.js', 'bridge.js', 'popup.html', 'popup.css', 'popup.js']) {
  if (!fs.existsSync(path.join(root, 'companion', required))) failures.push(`companion/${required}: referenced companion file is missing`);
}
if (manifest.permissions?.includes('cookies')) failures.push('companion manifest must not request the cookies permission');
if (!manifest.content_scripts?.some(script => script.matches?.includes('http://127.0.0.1:4177/*'))) {
  failures.push('companion manifest must pin the default local app origin');
}

const privateKeyPattern = new RegExp(['-----BEGIN', 'PRIVATE KEY-----'].join(' '));
for (const file of files.filter(file => !file.endsWith('.md') && !file.endsWith('.example'))) {
  const content = fs.readFileSync(file);
  if (content.length > 5_000_000 || content.includes(0)) continue;
  if (privateKeyPattern.test(content.toString('utf8'))) failures.push(`${path.relative(root, file)}: embedded private license key`);
}

if (failures.length) {
  console.error(`Scoutframe check failed with ${failures.length} issue${failures.length === 1 ? '' : 's'}:`);
  for (const failure of failures) console.error(`- ${failure.trim()}`);
  process.exit(1);
}

console.log(`Scoutframe check passed: ${files.length} files, syntax + JSON + manifest + secret guards.`);
