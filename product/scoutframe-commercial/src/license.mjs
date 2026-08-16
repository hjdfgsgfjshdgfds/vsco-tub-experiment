import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';

const TOKEN_PREFIX = 'sf1';
const encoder = new TextEncoder();

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function normalizedPlan(plan) {
  const candidate = String(plan || 'pro').toLowerCase();
  return ['pro', 'studio', 'lifetime'].includes(candidate) ? candidate : 'pro';
}

export function generateLicenseKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  };
}

export function issueLicenseToken({
  privateKey,
  email,
  plan = 'pro',
  expiresAt,
  days = 365,
  licenseId = randomUUID(),
  now = Date.now()
}) {
  if (!privateKey) throw new Error('An Ed25519 private key is required to issue a license.');
  if (!String(email || '').includes('@')) throw new Error('A customer email is required.');

  const expiry = expiresAt ? new Date(expiresAt).getTime() : now + Number(days) * 86_400_000;
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error('License expiry must be in the future.');

  const payload = {
    v: 1,
    licenseId: String(licenseId),
    email: String(email).trim().toLowerCase(),
    plan: normalizedPlan(plan),
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiry / 1000)
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(null, encoder.encode(encodedPayload), createPrivateKey(privateKey));
  return `${TOKEN_PREFIX}.${encodedPayload}.${base64url(signature)}`;
}

export function verifyLicenseToken(token, publicKey, { now = Date.now() } = {}) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: 'This is not a Scoutframe license token.' };
  }
  if (!publicKey) {
    return { ok: false, reason: 'This build has no license verification key configured.' };
  }

  try {
    const [, encodedPayload, encodedSignature] = parts;
    const valid = verify(
      null,
      encoder.encode(encodedPayload),
      createPublicKey(publicKey),
      decodeBase64url(encodedSignature)
    );
    if (!valid) return { ok: false, reason: 'The license signature is invalid.' };

    const payload = JSON.parse(decodeBase64url(encodedPayload).toString('utf8'));
    if (payload.v !== 1 || !payload.licenseId || !payload.email || !payload.exp) {
      return { ok: false, reason: 'The license payload is incomplete.' };
    }
    if (Number(payload.exp) * 1000 <= now) {
      return { ok: false, reason: 'This license has expired.', payload, expired: true };
    }
    return { ok: true, payload: { ...payload, plan: normalizedPlan(payload.plan) } };
  } catch (error) {
    return { ok: false, reason: `The license could not be read: ${error.message}` };
  }
}

export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({
    resultLimit: 120,
    collections: 1,
    watches: 1,
    collectionItems: 250,
    export: false,
    advancedFilters: false,
    batchSave: false
  }),
  trial: Object.freeze({
    resultLimit: 5000,
    collections: 25,
    watches: 25,
    collectionItems: 25_000,
    export: true,
    advancedFilters: true,
    batchSave: true
  }),
  pro: Object.freeze({
    resultLimit: 5000,
    collections: 100,
    watches: 100,
    collectionItems: 100_000,
    export: true,
    advancedFilters: true,
    batchSave: true
  }),
  studio: Object.freeze({
    resultLimit: 10_000,
    collections: 500,
    watches: 500,
    collectionItems: 500_000,
    export: true,
    advancedFilters: true,
    batchSave: true
  }),
  lifetime: Object.freeze({
    resultLimit: 10_000,
    collections: 500,
    watches: 500,
    collectionItems: 500_000,
    export: true,
    advancedFilters: true,
    batchSave: true
  })
});

export function entitlementFor({ trialStartedAt, trialDays, licenseResult, now = Date.now() }) {
  if (licenseResult?.ok) {
    const plan = normalizedPlan(licenseResult.payload.plan);
    return {
      plan,
      paid: true,
      trial: false,
      license: licenseResult.payload,
      limits: PLAN_LIMITS[plan] || PLAN_LIMITS.pro
    };
  }

  const startedAt = Number(trialStartedAt || now);
  const trialEndsAt = startedAt + Number(trialDays || 0) * 86_400_000;
  if (trialEndsAt > now) {
    return {
      plan: 'trial',
      paid: false,
      trial: true,
      trialStartedAt: startedAt,
      trialEndsAt,
      daysRemaining: Math.max(1, Math.ceil((trialEndsAt - now) / 86_400_000)),
      limits: PLAN_LIMITS.trial,
      licenseError: licenseResult && !licenseResult.ok ? licenseResult.reason : ''
    };
  }

  return {
    plan: 'free',
    paid: false,
    trial: false,
    trialStartedAt: startedAt,
    trialEndsAt,
    daysRemaining: 0,
    limits: PLAN_LIMITS.free,
    licenseError: licenseResult && !licenseResult.ok ? licenseResult.reason : ''
  };
}
