import test from 'node:test';
import assert from 'node:assert/strict';
import { entitlementFor, generateLicenseKeyPair, issueLicenseToken, verifyLicenseToken } from '../src/license.mjs';

test('Ed25519 license can be issued and verified locally', () => {
  const keys = generateLicenseKeyPair();
  const now = Date.UTC(2026, 7, 16);
  const token = issueLicenseToken({ privateKey: keys.privateKey, email: 'Buyer@Example.com', plan: 'studio', days: 30, now });
  const result = verifyLicenseToken(token, keys.publicKey, { now: now + 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.payload.email, 'buyer@example.com');
  assert.equal(result.payload.plan, 'studio');
});

test('tampering and expiry are rejected', () => {
  const keys = generateLicenseKeyPair();
  const now = Date.UTC(2026, 7, 16);
  const token = issueLicenseToken({ privateKey: keys.privateKey, email: 'buyer@example.com', days: 1, now });
  assert.equal(verifyLicenseToken(`${token}x`, keys.publicKey, { now }).ok, false);
  const expired = verifyLicenseToken(token, keys.publicKey, { now: now + 2 * 86_400_000 });
  assert.equal(expired.ok, false);
  assert.equal(expired.expired, true);
});

test('trial falls back to free without a paid license', () => {
  const now = Date.UTC(2026, 7, 16);
  assert.equal(entitlementFor({ trialStartedAt: now, trialDays: 7, now }).plan, 'trial');
  assert.equal(entitlementFor({ trialStartedAt: now - 8 * 86_400_000, trialDays: 7, now }).plan, 'free');
});
