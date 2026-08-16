# Scoutframe Commercial

Scoutframe is a local-first visual discovery workspace for VSCO research. It combines a polished localhost app with a deliberately small Chrome companion:

- authenticated image, people, and bio-text search through the user’s existing Chrome session;
- local metadata filters that never invent missing camera, country, GPS, or timestamp data;
- local collections, watched searches, JSON/CSV export, and a generated demo mode;
- a seven-day Pro trial and offline-verifiable Ed25519 licenses;
- no hosted account service, analytics SDK, credential upload, or copied browser cookies.

This directory is additive. It does not replace the existing VSCO Tub experiment or its known-good `main` implementation.

## Run it

Requirements: Node.js 22.13 or later and Chrome/Chromium.

```bash
cd product/scoutframe-commercial
cp .env.example .env        # optional; shell exports work too
npm test
npm run check
npm start
```

Open `http://127.0.0.1:4177`.

The app uses Node’s built-in SQLite module and has no runtime npm dependencies. Data is stored at `./data/scoutframe.db` unless `SCOUTFRAME_DATA_DIR` is set.

## Install the companion

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `product/scoutframe-commercial/companion`.
4. Sign in at `https://vsco.co` in the same Chrome profile.
5. Reload Scoutframe. The connection pill should say **Companion connected**.

The companion is pinned to `127.0.0.1:4177` and `localhost:4177`. When distributing it as a zip:

```bash
npm run pack:companion
```

That creates `dist/scoutframe-companion.zip`.

## Demo mode

The onboarding screen can generate deterministic synthetic results. Demo mode exercises the real app, database, collections, watches, filters, exports, trial, and licensing UI without making a VSCO request. Demo imagery and metadata are explicitly labeled synthetic.

## Commercial configuration

Set checkout Payment Links and price display through environment variables:

```bash
export SCOUTFRAME_CHECKOUT_MONTHLY_URL='https://your-checkout.example/monthly'
export SCOUTFRAME_CHECKOUT_YEARLY_URL='https://your-checkout.example/yearly'
export SCOUTFRAME_SUPPORT_EMAIL='support@your-domain.example'
```

Stripe Payment Links, Lemon Squeezy, Paddle, or any HTTPS checkout URL can be used. Payment fulfillment should issue a signed token; the private signing key never ships with the app.

Generate keys on a private fulfillment machine:

```bash
npm run license:keygen -- --out-dir ../scoutframe-license-keys
```

Put the **public** PEM in the distributed app environment (newlines may be represented as `\\n` when your launcher requires a single line):

```bash
export SCOUTFRAME_LICENSE_PUBLIC_KEY="$(cat ../scoutframe-license-keys/scoutframe-public.pem)"
```

Issue a customer license:

```bash
npm run license:issue -- \
  --email buyer@example.com \
  --plan pro \
  --days 365 \
  --private-key-file ../scoutframe-license-keys/scoutframe-private.pem
```

The customer pastes the resulting `sf1.…` token into **Upgrade → Activate a signed license**. Verification is fully local. The current design does not enforce machine activation counts; that is a deliberate low-friction MVP choice.

## Useful query syntax

```text
quiet coast
"night train" -selfie
from:username camera:fujifilm gps:true
country:norway after:2025-01-01 aspect:portrait
```

Plain words are sent to VSCO. Exclusions and metadata constraints are applied locally to returned fields. A missing field never becomes a guessed field.

## Tests and boundaries

```bash
npm test       # query, license, API/database, CSRF guard, companion boundary
npm run check  # syntax, JSON, manifest references, permission and private-key guards
```

Automated tests do not replace a live Chrome QA pass. Before publishing a release, run image/people/bio searches in a logged-in Chrome profile, test a signed production license, and confirm checkout fulfillment end to end.

See [PRODUCT.md](PRODUCT.md), [SECURITY.md](SECURITY.md), and [docs/RELEASE.md](docs/RELEASE.md).
