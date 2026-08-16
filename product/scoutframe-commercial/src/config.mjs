import path from 'node:path';

function numberFromEnv(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function absoluteFrom(rootDir, value, fallback) {
  const candidate = String(value || fallback || '').trim();
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
}

export function loadConfig(rootDir, overrides = {}) {
  const env = process.env;
  const port = overrides.port ?? numberFromEnv(env.SCOUTFRAME_PORT, 4177, { min: 0, max: 65535 });
  const trialDays = overrides.trialDays ?? numberFromEnv(env.SCOUTFRAME_TRIAL_DAYS, 7, { min: 0, max: 90 });
  const dev = overrides.dev ?? /^(1|true|yes)$/i.test(String(env.SCOUTFRAME_DEV || ''));

  return {
    rootDir,
    publicDir: overrides.publicDir || path.join(rootDir, 'public'),
    dataDir: overrides.dataDir || absoluteFrom(rootDir, env.SCOUTFRAME_DATA_DIR, './data'),
    host: overrides.host || '127.0.0.1',
    port,
    trialDays,
    dev,
    licensePublicKey: overrides.licensePublicKey ?? String(env.SCOUTFRAME_LICENSE_PUBLIC_KEY || '').replaceAll('\\n', '\n').trim(),
    billing: {
      currency: overrides.billing?.currency || String(env.SCOUTFRAME_CURRENCY || 'USD').toUpperCase(),
      monthlyPrice: overrides.billing?.monthlyPrice ?? numberFromEnv(env.SCOUTFRAME_MONTHLY_PRICE, 12, { min: 0 }),
      yearlyPrice: overrides.billing?.yearlyPrice ?? numberFromEnv(env.SCOUTFRAME_YEARLY_PRICE, 99, { min: 0 }),
      monthlyUrl: overrides.billing?.monthlyUrl ?? String(env.SCOUTFRAME_CHECKOUT_MONTHLY_URL || '').trim(),
      yearlyUrl: overrides.billing?.yearlyUrl ?? String(env.SCOUTFRAME_CHECKOUT_YEARLY_URL || '').trim(),
      supportEmail: overrides.billing?.supportEmail ?? String(env.SCOUTFRAME_SUPPORT_EMAIL || 'support@example.com').trim()
    }
  };
}
