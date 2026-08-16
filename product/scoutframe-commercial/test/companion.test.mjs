import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'companion', 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'companion', 'background.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('companion has a narrow permission and origin boundary', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions?.includes('cookies') || false, false);
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://127.0.0.1:4177/*', 'http://localhost:4177/*']);
  assert.ok(manifest.host_permissions.every(value => value.startsWith('https://')));
  assert.equal(packageJson.engines.node, '>=22.13.0');
});

test('companion surface is read-only and bounded', () => {
  assert.match(background, /scoutframe\.search/);
  assert.match(background, /Math\.min\([\s\S]*10_000/);
  assert.match(background, /\.slice\(0, limit\)/);
  assert.doesNotMatch(background, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(background, /chrome\.cookies/);
});
