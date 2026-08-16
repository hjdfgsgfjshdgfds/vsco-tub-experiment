# Baseline and integration note

Scoutframe Commercial was designed as an additive directory for:

- repository: `hjdfgsgfjshdgfds/vsco-tub-experiment`
- target branch: `main`
- inspected baseline: `5b041ca7a6f7eea91476bb31bf2b99d6b3b200fa`
- additive path: `product/scoutframe-commercial`

It intentionally does not alter the known-good extension or local-app files already on `main`. The product reuses the observed image/people response normalization patterns while narrowing the browser companion to two read-only actions and fixed localhost origins.

Before merge, apply the additive commit on top of the target baseline, rerun the automated gates, and complete the authenticated Chrome checklist in `RELEASE.md`.
