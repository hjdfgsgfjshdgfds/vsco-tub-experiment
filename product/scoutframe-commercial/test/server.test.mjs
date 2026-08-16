import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScoutframeServer } from '../src/server.mjs';
import { generateLicenseKeyPair, issueLicenseToken } from '../src/license.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function request(baseUrl, pathname, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Scoutframe-Client'] = 'web';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  return { response, payload };
}

test('local product API persists collections, watches, export, and a signed license', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoutframe-test-'));
  const keys = generateLicenseKeyPair();
  const instance = await createScoutframeServer({ rootDir, dataDir, port: 0, trialDays: 7, licensePublicKey: keys.publicKey, dev: true });
  await instance.listen();
  t.after(async () => {
    await instance.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const status = await request(instance.baseUrl, '/api/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.entitlement.plan, 'trial');

  const created = await request(instance.baseUrl, '/api/collections', { method: 'POST', body: { name: 'Reference' } });
  assert.equal(created.response.status, 201);
  const collectionId = created.payload.collection.id;

  const item = {
    id: '64af1234567890abcdef1234', kind: 'image', username: 'mara', imageUrl: 'https://i.vsco.co/example',
    description: '=1+1 Quiet coast', timestamp: Date.UTC(2026, 1, 1), width: 1200, height: 1600, hasGps: true,
    coordinates: { lat: 59.91, lng: 10.75 }, camera: 'Fujifilm X100V', permalink: 'https://vsco.co/mara/media/64af1234567890abcdef1234'
  };
  const saved = await request(instance.baseUrl, `/api/collections/${collectionId}/items`, { method: 'POST', body: { item, tags: ['reference'] } });
  assert.equal(saved.response.status, 201);

  const savedAgain = await request(instance.baseUrl, `/api/collections/${collectionId}/items`, {
    method: 'POST', body: { item: { ...item, coordinates: { lat: 'not-a-number', lng: 10.75 } } }
  });
  assert.equal(savedAgain.response.status, 201);

  const collectionList = await request(instance.baseUrl, '/api/collections');
  assert.equal(collectionList.payload.collections[0].itemCount, 1);

  await request(instance.baseUrl, `/api/collections/${collectionId}/items`, { method: 'POST', body: { item } });
  const listed = await request(instance.baseUrl, `/api/collections/${collectionId}/items`);
  assert.equal(listed.payload.items.length, 1);
  assert.deepEqual(listed.payload.items[0].coordinates, { lat: 59.91, lng: 10.75 });

  const watch = await request(instance.baseUrl, '/api/watches', { method: 'POST', body: { name: 'Coast', mode: 'images', query: 'quiet coast' } });
  assert.equal(watch.response.status, 201);
  assert.equal(watch.payload.watch.query, 'quiet coast');

  const exported = await request(instance.baseUrl, `/api/export?format=csv&collection=${collectionId}`);
  assert.equal(exported.response.status, 200);
  assert.match(exported.payload, /Fujifilm X100V/);
  assert.match(exported.payload, /'=1\+1 Quiet coast/);

  const token = issueLicenseToken({ privateKey: keys.privateKey, email: 'buyer@example.com', plan: 'pro', days: 30 });
  const activated = await request(instance.baseUrl, '/api/license/activate', { method: 'POST', body: { token } });
  assert.equal(activated.response.status, 200);
  assert.equal(activated.payload.entitlement.plan, 'pro');

  const index = await fetch(`${instance.baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Scoutframe/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
});

test('write API rejects requests without the local custom header', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoutframe-csrf-test-'));
  const instance = await createScoutframeServer({ rootDir, dataDir, port: 0, dev: false });
  await instance.listen();
  t.after(async () => {
    await instance.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const response = await fetch(`${instance.baseUrl}/api/collections`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Blocked' })
  });
  assert.equal(response.status, 403);
});
