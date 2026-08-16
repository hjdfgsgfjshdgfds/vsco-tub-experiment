import fs from 'node:fs';
import path from 'node:path';
import { issueLicenseToken } from '../src/license.mjs';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const email = argument('email');
const plan = argument('plan', 'pro');
const days = Number(argument('days', plan === 'lifetime' ? '36500' : '365'));
const expiresAt = argument('expires');
const privateKeyFile = argument('private-key-file');
const output = argument('out');
const privateKey = privateKeyFile
  ? fs.readFileSync(path.resolve(privateKeyFile), 'utf8')
  : String(process.env.SCOUTFRAME_LICENSE_PRIVATE_KEY || '').replaceAll('\\n', '\n');

if (!email) {
  console.error('Usage: npm run license:issue -- --email customer@example.com [--plan pro] [--days 365] [--private-key-file path]');
  process.exit(2);
}
if (!privateKey) {
  console.error('Provide SCOUTFRAME_LICENSE_PRIVATE_KEY or --private-key-file.');
  process.exit(2);
}

try {
  const token = issueLicenseToken({ privateKey, email, plan, days, expiresAt: expiresAt || undefined });
  if (output) {
    const destination = path.resolve(output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${token}\n`, { mode: 0o600 });
    console.log(destination);
  } else {
    console.log(token);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
