import assert from 'node:assert/strict';
import fs from 'node:fs';

// Contract-level regression tests for the browser-only search enhancer.  The
// production file is an MV3 IIFE, so it cannot be imported into Node without
// a DOM/chrome runtime; this deliberately keeps the fixture model tiny while
// asserting the user-visible semantics that have regressed in the past.
const source = fs.readFileSync(new URL('../vsco-search-enhancer.js', import.meta.url), 'utf8');
const backgroundSource = fs.readFileSync(new URL('../background.js', import.meta.url), 'utf8');

const windows = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
function visibleItems(items, settings, records, checked, now = Date.now()) {
  const windowMs = windows[settings.timeWindow];
  let filtered = windowMs
    ? items.filter(item => item.timestamp && now - item.timestamp <= windowMs)
    : items.slice();
  const metadataActive = settings.metadataStatus !== 'all' || settings.metadataGps !== 'all'
    || settings.metadataExif !== 'all' || settings.metadataCamera || settings.metadataSoftware
    || settings.metadataQuery || settings.metadataCountry;
  if (metadataActive) {
    filtered = filtered.filter(item => {
      const record = records.get(item.id);
      if (settings.metadataStatus === 'fetched' && !record) return false;
      if (settings.metadataStatus === 'pending' && record) return false;
      // An unchecked item remains visible while an active metadata probe is
      // in flight. This prevents a filter selected before search from flashing
      // an empty result set.
      if (!record && !checked.has(item.id)) return true;
      if (!record) return false;
      const meta = record.imageMeta || {};
      const hasGps = Boolean(record.location || meta.location);
      if (settings.metadataGps === 'yes' && !hasGps) return false;
      if (settings.metadataGps === 'no' && hasGps) return false;
      if (settings.metadataExif === 'yes' && !record.imageMeta) return false;
      if (settings.metadataExif === 'no' && record.imageMeta) return false;
      if (settings.metadataCamera && !`${meta.make || ''} ${meta.model || ''}`.toLowerCase().includes(settings.metadataCamera.toLowerCase())) return false;
      if (settings.metadataCountry && !`${record.country?.name || ''} ${record.country?.code || ''}`.toLowerCase().includes(settings.metadataCountry.toLowerCase())) return false;
      return true;
    });
  }
  return filtered.sort((a, b) => b.timestamp - a.timestamp);
}

const now = 1_000_000_000;
const items = [
  { id: 'gps', timestamp: now - 1_000 },
  { id: 'plain', timestamp: now - 2_000 },
  { id: 'pending', timestamp: now - 3_000 },
];
const records = new Map([
  ['gps', { location: { lat: 1, lng: 2 }, imageMeta: { make: 'Apple', model: 'iPhone 15' }, country: { code: 'NO', name: 'Norway' } }],
  ['plain', { imageMeta: { make: 'Canon', model: 'EOS' } }],
]);

const defaults = { metadataStatus: 'all', metadataGps: 'all', metadataExif: 'all', metadataCamera: '', metadataSoftware: '', metadataQuery: '', metadataCountry: '', timeWindow: 'all' };
assert.deepEqual(visibleItems(items, { ...defaults, metadataGps: 'yes' }, records, new Set(['gps', 'plain']), now).map(x => x.id), ['gps', 'pending'], 'unchecked records remain visible until metadata resolves');
assert.deepEqual(visibleItems(items, { ...defaults, metadataGps: 'yes' }, records, new Set(), now).map(x => x.id), ['gps', 'pending'], 'unchecked records stay pending-visible');
assert.deepEqual(visibleItems(items, { ...defaults, metadataStatus: 'pending' }, records, new Set(), now).map(x => x.id), ['pending']);
assert.deepEqual(visibleItems(items, { ...defaults, metadataCountry: 'norway' }, records, new Set(['gps', 'plain']), now).map(x => x.id), ['gps', 'pending']);
assert.deepEqual(visibleItems(items, { ...defaults, timeWindow: 'day' }, records, new Set(), now).map(x => x.id), ['gps', 'plain', 'pending']);

// Guard the implementation details that make the worker behavior safe:
// bounded 1k requests, ten image-search workers, and no false “checked” mark
// for IDs omitted from a successful response.
assert.match(source, /const GRPC_IMAGE_SEARCH_BATCH_SIZE = 1000/);
assert.match(source, /const GRPC_IMAGE_SEARCH_WORKERS = 10/);
assert.match(source, /if \(returnedIds\.has\(String\(id\)\.toLowerCase\(\)\)\) grpcCheckedImageIds\.add\(id\)/);
assert.match(source, /function createWorkspaceNav\(mode\)/);
assert.match(source, /explore\.textContent = 'Explore'/);
assert.match(source, /map\.textContent = 'World map'/);
assert.match(source, /collection\.textContent = 'Collection'/);
assert.match(source, /countryCounts = new Map/);
assert.match(source, /Number\.isFinite\(lat\) && Number\.isFinite\(lng\)/);
assert.match(source, /lat\.toFixed\(4\)/);
assert.match(source, /lng\.toFixed\(4\)/);
assert.match(source, /vscoTubCollectionFilter/);
assert.match(source, /vsco-tub-map-countries/);
assert.match(source, /searchSettings\.metadataCountry = country/);
assert.match(source, /countryCounts\.entries\(\)/);
assert.match(source, /\.slice\(0, 12\)/);
assert.match(source, /Filter results by \$\{country\}/);
assert.match(source, /function sendRuntimeMessage\(request, retries = 1\)/);
assert.match(source, /message channel closed\|receiving end does not exist\|asynchronous response/);
assert.match(source, /Tub is reconnecting to its background worker/);
assert.match(source, /userFacingRuntimeError\(error, 'Expansion failed'\)/);
// Continuous discovery is intentionally different from normal "Expand more":
// the submitted search is an initial corpus only, and the worker's travel path
// sends discovered tokens without pairing them back with seed terms.
assert.match(source, /expandMore\(\{ travel: true, originalEngine: false \}\)/);
assert.match(source, /Start seedless discovery after every submitted search/);
assert.match(backgroundSource, /\(options\.travel && !classicTravel\) \? \[token\]/);
assert.match(backgroundSource, /filter\(token => !seedTerms\.includes\(token\)\)/);
assert.match(source, /vsco_tub=discover-profiles/);
assert.match(source, /action: 'enhancedVscoAutonomousProfiles'/);
assert.match(source, /if \(search\.autonomous \|\| searchSettings\.expansionEnabled\) expandUntilSaturated\(\)/);
assert.match(backgroundSource, /const AUTONOMOUS_PROFILE_STARTERS = Object\.freeze\(\{/);
assert.match(backgroundSource, /if \(request\.action === 'enhancedVscoAutonomousProfiles'\)/);
assert.doesNotMatch(backgroundSource, /search\/grids\?query=&/);
assert.match(source, /slice\(0, GRPC_IMAGE_PROBE_MAX\)/);
assert.match(source, /const GRPC_PROFILE_SEARCH_WORKERS = 4/);
assert.match(source, /country results are verified from returned GPS metadata/i);
assert.match(source, /String\(record\.country\?\.code \|\| ''\)\.toUpperCase\(\) !== autonomousCountry/);
assert.match(source, /action: 'enhancedVscoCountrySignals'/);
assert.match(backgroundSource, /function addAutonomousCountrySignals/);
assert.match(backgroundSource, /countryBoostTokens\?\.get\(b\.token\)/);
const directRuntimeCalls = source.match(/chrome\.runtime\.sendMessage\(/g) || [];
assert.equal(directRuntimeCalls.length, 1, 'all Tub runtime calls must use sendRuntimeMessage');
console.log('search/filter regression tests passed');
