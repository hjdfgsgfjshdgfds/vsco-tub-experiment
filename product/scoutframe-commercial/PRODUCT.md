# Scoutframe commercial product brief

## Positioning

**Scoutframe is the calm research workspace for finding, filtering, and keeping the VSCO material ordinary search loses.**

It is for photographers, creative researchers, casting and mood-board teams, stylists, archivists, and visually obsessive users who can describe what they remember but cannot reliably recover it through the native interface.

The product should feel like a focused library desk, not a scraping console. The default loop is:

1. describe the visual trail;
2. search through the user’s own authenticated browser session;
3. narrow by metadata that was actually observed;
4. save the useful results locally;
5. revisit a watched search intentionally;
6. export only when the trail needs to leave Scoutframe.

## Commercial offer

| Tier | Default price | Core limit |
| --- | ---: | --- |
| Free | $0 | 120 results, one collection, one watch, 250 saved items |
| Pro monthly | $12/month | 5,000 results, advanced filters, batch save, export |
| Pro yearly | $99/year | Same Pro capability at a lower annual effective price |
| Studio / lifetime | Fulfilled manually initially | 10,000 results and higher local library limits |

Every fresh local data directory receives a seven-day Pro trial. No card is required inside the app. Checkout happens through a configured external Payment Link; fulfillment returns a signed license token.

These are launch defaults, not market facts. Price and checkout URLs are environment configuration so they can be tested without rebuilding product code.

## Why this is commercially defensible

The value is not merely “more results.” It is the combination of:

- a privacy architecture that uses the customer’s existing Chrome session without uploading credentials;
- a usable local research library rather than a transient search page;
- honest metadata handling: missing GPS/camera/country remains missing;
- deliberate, bounded search instead of background scraping;
- portable exports without requiring a hosted Scoutframe account.

The companion is intentionally small enough to explain and audit. The sellable product is the workflow around search, not secret possession of the customer’s VSCO session.

## Launch funnel

The first-run page should prove value before asking for money:

- **No companion yet:** explain the boundary in one screen and offer generated demo data.
- **Demo:** let the user search, filter, save, watch, and export real local state.
- **Live companion:** detect the signed-in browser and make the first search immediate.
- **Trial:** show remaining days quietly in the sidebar, not as a blocking modal.
- **Upgrade moment:** export, batch save, or a capacity limit opens the plans page with context preserved.
- **Purchase:** external checkout followed by locally verified token activation.

## Scope for the first commercial release

Included:

- image, people, and bio-text search;
- 120–10,000 bounded result limits by entitlement;
- query syntax and observed metadata filters;
- collections and individual/batch save;
- on-demand watched-search comparisons;
- JSON and CSV export;
- generated demo data;
- signed offline licenses;
- concise local-only product event log for debugging the user’s own install.

Not included:

- hosted accounts, cloud sync, teams, or cross-device activation;
- automated background scraping or scheduled VSCO requests;
- mutation features such as follow, favorite, repost, or upload;
- inferred GPS/country/camera data;
- claims that result totals are complete when the upstream response is bounded;
- credential, cookie, authorization-token, or raw session extraction.

## Metrics for an honest first sale

Track these manually or through checkout—not through hidden in-app telemetry:

- demo-to-companion installation;
- first live search completed;
- first collection save;
- first export attempt;
- trial-to-paid conversion;
- refund/support reason;
- Chrome/VSCO breakage rate after upstream changes.

The app’s local `local_events` table exists for troubleshooting on that machine. It is not transmitted anywhere by this implementation.
