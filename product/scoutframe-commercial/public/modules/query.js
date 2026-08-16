const FILTER_NAMES = new Set([
  'from', 'camera', 'country', 'gps', 'after', 'before', 'aspect', 'minwidth', 'minheight', 'sort'
]);

export function tokenizeScoutQuery(input) {
  const source = String(input || '').trim();
  const tokens = [];
  const pattern = /(?:[^\s"]+|"[^"]*")+/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[0];
    const colon = raw.indexOf(':');
    if (colon > 0 && FILTER_NAMES.has(raw.slice(0, colon).replace(/^-/, '').toLowerCase())) {
      const name = raw.slice(0, colon);
      const value = raw.slice(colon + 1).replace(/^"|"$/g, '');
      tokens.push(`${name}:${value}`);
    } else {
      tokens.push(raw.replace(/^"|"$/g, ''));
    }
  }
  return tokens.filter(Boolean);
}

function parseBoolean(value) {
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseScoutQuery(input) {
  const filters = {};
  const includes = [];
  const excludes = [];
  const unknownFilters = [];

  for (const token of tokenizeScoutQuery(input)) {
    const negative = token.startsWith('-');
    const normalized = negative ? token.slice(1) : token;
    const colon = normalized.indexOf(':');
    if (colon > 0) {
      const name = normalized.slice(0, colon).toLowerCase();
      const value = normalized.slice(colon + 1).trim();
      if (!FILTER_NAMES.has(name)) {
        unknownFilters.push({ name, value, negative });
        (negative ? excludes : includes).push(normalized);
        continue;
      }
      if (name === 'gps') filters.gps = parseBoolean(value);
      else if (name === 'after' || name === 'before') filters[name] = parseDate(value);
      else if (name === 'minwidth' || name === 'minheight') filters[name] = Math.max(0, Number.parseInt(value, 10) || 0);
      else filters[name] = value.toLowerCase();
      continue;
    }
    (negative ? excludes : includes).push(normalized.toLowerCase());
  }

  return {
    raw: String(input || ''),
    apiQuery: includes.join(' ').trim(),
    includes,
    excludes,
    filters,
    unknownFilters
  };
}

function searchableText(item) {
  return [item.username, item.displayName, item.description, item.camera, item.country, item.preset, item.software]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function aspectFor(item) {
  const width = Number(item.width || 0);
  const height = Number(item.height || 0);
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (ratio >= 1.65) return 'wide';
  if (ratio >= 1.08) return 'landscape';
  if (ratio <= 0.62) return 'tall';
  if (ratio <= 0.92) return 'portrait';
  return 'square';
}

function contains(value, needle) {
  return String(value || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function mergedFilters(parsed, ui = {}) {
  const query = parsed?.filters || {};
  const cleanedUi = Object.fromEntries(Object.entries(ui || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined));
  return { ...query, ...cleanedUi };
}

export function applyScoutFilters(items, parsed = parseScoutQuery(''), uiFilters = {}) {
  const list = Array.isArray(items) ? items : [];
  const filters = mergedFilters(parsed, uiFilters);
  return list.filter(item => {
    const haystack = searchableText(item);
    if (parsed.excludes?.some(term => haystack.includes(term.toLowerCase()))) return false;
    if (filters.from && !contains(item.username, filters.from)) return false;
    if (filters.camera && !contains(item.camera, filters.camera)) return false;
    if (filters.country && !contains(item.country, filters.country)) return false;
    if (typeof filters.gps === 'boolean' && Boolean(item.hasGps) !== filters.gps) return false;
    if (filters.after && Number(item.timestamp || 0) < Number(filters.after)) return false;
    if (filters.before && Number(item.timestamp || 0) >= Number(filters.before) + 86_400_000) return false;
    if (filters.aspect && filters.aspect !== 'any' && aspectFor(item) !== String(filters.aspect).toLowerCase()) return false;
    if (filters.minwidth && Number(item.width || 0) < Number(filters.minwidth)) return false;
    if (filters.minheight && Number(item.height || 0) < Number(filters.minheight)) return false;
    return true;
  });
}

export function sortScoutItems(items, sort = 'newest') {
  const list = [...(Array.isArray(items) ? items : [])];
  const mode = String(sort || 'newest').toLowerCase();
  if (mode === 'oldest') return list.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  if (mode === 'largest') return list.sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0));
  if (mode === 'username') return list.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
  return list.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

export function filterAndSortScoutItems(items, parsed, uiFilters = {}) {
  const sort = uiFilters.sort || parsed?.filters?.sort || 'newest';
  return sortScoutItems(applyScoutFilters(items, parsed, uiFilters), sort);
}

export function scoutAspect(item) {
  return aspectFor(item);
}
