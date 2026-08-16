# Release and first-sale checklist

## Build gate

- [ ] `npm test` passes on the supported Node version.
- [ ] `npm run check` passes.
- [ ] `npm run pack:companion` creates a clean zip.
- [ ] A release data directory starts with a seven-day trial.
- [ ] The distributed environment includes only the Ed25519 public key.
- [ ] No `.env`, database, private key, test token, or customer export is in the package.

## Live Chrome gate

Use a dedicated, ordinary Chrome profile—not a developer profile containing unrelated credentials.

- [ ] Load the unpacked companion and inspect its requested permissions.
- [ ] Open Scoutframe at exactly `http://127.0.0.1:4177`.
- [ ] Confirm the page cannot search before the companion is installed.
- [ ] Confirm image search returns bounded results and source links open correctly.
- [ ] Confirm people and bio-text modes return expected profile records.
- [ ] Sign out of VSCO and confirm the error clearly asks the user to sign in.
- [ ] Confirm no request sends cookies or license data to a Scoutframe-owned host.
- [ ] Confirm camera/GPS/country UI says “Not observed” when absent.
- [ ] Test 120, 5,000, and 10,000-result entitlement boundaries against realistic browser memory.

## Commerce gate

- [ ] Replace placeholder support email and checkout URLs.
- [ ] Complete monthly and annual test-mode purchases.
- [ ] Fulfill each purchase with the correct email, plan, and expiry.
- [ ] Activate, restart, export, deactivate, and reactivate a production-format token.
- [ ] Document refund and replacement-token handling.
- [ ] Publish pricing, privacy, terms, and independent-product notice.

## Packaging

The current implementation runs from source:

```bash
npm start
npm run pack:companion
```

A later packaging pass can wrap the local server as a signed desktop binary. Do not weaken the privacy boundary by moving authenticated VSCO search into a hosted backend merely to simplify packaging.

## Known release limitation

Automated tests cannot verify the current upstream VSCO API or Chrome cookie behavior. A successful live, authenticated QA pass is mandatory before calling a build releasable.
