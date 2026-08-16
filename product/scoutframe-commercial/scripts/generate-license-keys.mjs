import fs from 'node:fs';
import path from 'node:path';
import { generateLicenseKeyPair } from '../src/license.mjs';

const args = process.argv.slice(2);
const directoryIndex = args.indexOf('--out-dir');
const outDir = directoryIndex >= 0 ? path.resolve(args[directoryIndex + 1] || '') : '';
const keys = generateLicenseKeyPair();

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const publicPath = path.join(outDir, 'scoutframe-public.pem');
  const privatePath = path.join(outDir, 'scoutframe-private.pem');
  fs.writeFileSync(publicPath, keys.publicKey, { mode: 0o644 });
  fs.writeFileSync(privatePath, keys.privateKey, { mode: 0o600 });
  console.log(`Public key:  ${publicPath}`);
  console.log(`Private key: ${privatePath}`);
  console.log('Keep the private key outside the distributed app and repository.');
} else {
  console.log('# SCOUTFRAME_LICENSE_PUBLIC_KEY');
  console.log(keys.publicKey.trim());
  console.log('\n# SCOUTFRAME_LICENSE_PRIVATE_KEY — keep private');
  console.log(keys.privateKey.trim());
}
