import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScoutFilters, parseScoutQuery, scoutAspect, sortScoutItems, tokenizeScoutQuery } from '../public/modules/query.js';

test('tokenizer preserves quoted phrases and field values', () => {
  assert.deepEqual(
    tokenizeScoutQuery('"night train" -selfie camera:"Fujifilm X100V" gps:true'),
    ['night train', '-selfie', 'camera:Fujifilm X100V', 'gps:true']
  );
});

test('query parser separates API words, exclusions, and typed filters', () => {
  const parsed = parseScoutQuery('quiet coast -selfie from:mara gps:true after:2025-01-02 aspect:portrait minwidth:1000');
  assert.equal(parsed.apiQuery, 'quiet coast');
  assert.deepEqual(parsed.excludes, ['selfie']);
  assert.equal(parsed.filters.from, 'mara');
  assert.equal(parsed.filters.gps, true);
  assert.equal(parsed.filters.after, Date.parse('2025-01-02T00:00:00Z'));
  assert.equal(parsed.filters.aspect, 'portrait');
  assert.equal(parsed.filters.minwidth, 1000);
});

test('local filters only use observed metadata', () => {
  const items = [
    { id: 'a', username: 'mara', description: 'quiet coast', camera: 'Fujifilm X100V', country: 'Norway', hasGps: true, timestamp: Date.UTC(2026, 1, 1), width: 1200, height: 1600 },
    { id: 'b', username: 'nico', description: 'coast selfie', camera: '', country: '', hasGps: false, timestamp: Date.UTC(2024, 1, 1), width: 1600, height: 900 }
  ];
  const parsed = parseScoutQuery('quiet coast -selfie camera:fujifilm gps:true after:2025-01-01 aspect:portrait');
  assert.deepEqual(applyScoutFilters(items, parsed).map(item => item.id), ['a']);
});

test('aspect and sorting are deterministic', () => {
  assert.equal(scoutAspect({ width: 1200, height: 1600 }), 'portrait');
  assert.equal(scoutAspect({ width: 1920, height: 1080 }), 'wide');
  assert.deepEqual(sortScoutItems([{ id: 'old', timestamp: 1 }, { id: 'new', timestamp: 2 }]).map(item => item.id), ['new', 'old']);
});
