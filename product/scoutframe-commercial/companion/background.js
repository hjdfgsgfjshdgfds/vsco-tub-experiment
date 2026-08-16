const VERSION = '0.1.0';
const LOCAL_APP_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost):4177\//i;
const ALLOWED_ACTIONS = new Set(['scoutframe.health', 'scoutframe.search']);
const MODES = new Set(['images', 'people', 'bio']);

function assertSender(sender) {
  const url = String(sender?.url || '');
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}/`;
  if (!LOCAL_APP_PATTERN.test(url) && !url.startsWith(extensionOrigin)) {
    throw new Error('Scoutframe Companion rejected a request from an untrusted origin.');
  }
}

function text(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^(?:i|im|img|images)\.vsco\.co\//i.test(raw)) return `https://${raw}`;
  try {
    const url = new URL(raw, 'https://vsco.co');
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'vsco.co' && !hostname.endsWith('.vsco.co'))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function timestampFrom(item, id = '') {
  const objectIds = [id, item?.imageId, item?._id, item?.id, item?.media_id, item?.mediaId, item?.image?.id];
  for (const candidate of objectIds) {
    const value = String(candidate || '').trim();
    if (!/^[0-9a-f]{24}$/i.test(value)) continue;
    const seconds = Number.parseInt(value.slice(0, 8), 16);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  const raw = item?.upload_date ?? item?.uploadDate ?? item?.published_at ?? item?.publishedAt ??
    item?.created_at ?? item?.createdAt ?? item?.updated_at ?? item?.updatedAt ?? 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 100_000_000_000 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinatesFrom(item) {
  const candidates = [
    item?.location_coords,
    item?.locationCoords,
    item?.coordinates,
    item?.location,
    item?.image_meta?.location,
    item?.imageMeta?.location
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length >= 2) {
      const lat = finiteCoordinate(candidate[0]);
      const lng = finiteCoordinate(candidate[1]);
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
    if (typeof candidate === 'object') {
      const lat = finiteCoordinate(candidate.lat ?? candidate.latitude ?? candidate.y);
      const lng = finiteCoordinate(candidate.lng ?? candidate.lon ?? candidate.longitude ?? candidate.x);
      if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

function observedCamera(item) {
  const meta = item?.image_meta || item?.imageMeta || item?.exif || {};
  const make = text(meta.make, item?.camera_make, item?.cameraMake);
  const model = text(meta.model, item?.camera_model, item?.cameraModel, item?.camera);
  return [make, model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function observedCountry(item) {
  const location = item?.location || item?.location_data || item?.locationData || {};
  return text(item?.country, item?.country_name, item?.countryName, location?.country, location?.country_name);
}

function mapImage(item) {
  const id = text(item?.imageId, item?._id, item?.id);
  const username = text(item?.grid?.subdomain, item?.grid?.siteSubDomain, item?.siteSubDomain, item?.username);
  const displayName = text(item?.grid?.name, item?.grid?.userName, item?.userName, item?.displayName);
  const coordinates = coordinatesFrom(item);
  const meta = item?.image_meta || item?.imageMeta || {};
  const imageUrl = normalizeUrl(text(item?.responsive_url, item?.responsiveUrl, item?.image_url, item?.imageUrl, id ? `i.vsco.co/${id}` : ''));
  return {
    id,
    kind: 'image',
    username,
    displayName,
    siteId: text(item?.grid?.siteId, item?.siteId),
    imageUrl,
    profileImageUrl: '',
    description: text(item?.description, item?.caption),
    timestamp: timestampFrom(item, id),
    width: Number(item?.width || meta?.width || 0),
    height: Number(item?.height || meta?.height || 0),
    hasGps: Boolean(coordinates || item?.has_location),
    coordinates,
    country: observedCountry(item),
    camera: observedCamera(item),
    software: text(meta?.software, item?.software),
    preset: text(meta?.preset, item?.preset),
    permalink: username && id ? `https://vsco.co/${encodeURIComponent(username)}/media/${encodeURIComponent(id)}` : imageUrl
  };
}

function mapPerson(person) {
  const id = text(person?.siteId, person?.site_id, person?.siteSubDomain, person?.subdomain);
  const username = text(person?.siteSubDomain, person?.site_subdomain, person?.subdomain, person?.username).replace(/^@/, '');
  const profileImageId = text(person?.gridImageId, person?.profile_image_id, person?.profileImageId);
  const gridImage = text(person?.gridImage, person?.profile_image, person?.profileImage, person?.responsive_url);
  const profileImageUrl = normalizeUrl(gridImage
    ? (/^https?:\/\//i.test(gridImage) || gridImage.startsWith('//') ? gridImage : `img.vsco.co/${gridImage}`)
    : profileImageId ? `i.vsco.co/${profileImageId}` : '');
  return {
    id,
    kind: 'person',
    username,
    displayName: text(person?.userName, person?.displayName, person?.name, username),
    siteId: text(person?.siteId, person?.site_id),
    imageUrl: normalizeUrl(text(person?.responsive_url, profileImageId ? `i.vsco.co/${profileImageId}` : '', profileImageUrl)),
    profileImageUrl,
    description: text(person?.gridName, person?.bio, person?.description),
    timestamp: timestampFrom(person, profileImageId),
    width: Number(person?.width || 0),
    height: Number(person?.height || 0),
    hasGps: false,
    coordinates: null,
    country: '',
    camera: '',
    software: '',
    preset: '',
    permalink: username ? `https://vsco.co/${encodeURIComponent(username)}/gallery` : 'https://vsco.co/'
  };
}

function retryDelay(response, attempt) {
  const header = response.headers.get('retry-after');
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 10_000);
  const date = Date.parse(String(header || ''));
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10_000);
  return Math.min(650 * 2 ** attempt, 5000);
}

async function fetchJson(url, { timeout = 60_000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        const error = new Error('VSCO rejected the search. Sign in to vsco.co in this Chrome profile, then retry.');
        error.retryable = false;
        throw error;
      }
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 180).replace(/\s+/g, ' ').trim();
        const error = new Error(`VSCO search returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
        error.retryable = false;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError') lastError = new Error('VSCO search timed out. Try a smaller result limit.');
      if (attempt === 0 && error?.name !== 'AbortError' && error?.retryable !== false) continue;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('VSCO search failed.');
}

async function health() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://vsco.co/api/2.0/users?site_requested=1', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return { ok: true, version: VERSION, authenticated: false };
    const user = await response.json();
    const sites = Array.isArray(user?.sites) ? user.sites : [];
    const site = sites.find(candidate => candidate?.status === 'published') || sites[0];
    const authenticated = Boolean(user?.user_id || user?.id_str || user?.id || site?.id || site?.siteId);
    return { ok: true, version: VERSION, authenticated };
  } catch {
    return { ok: true, version: VERSION, authenticated: false };
  } finally {
    clearTimeout(timer);
  }
}

async function search(request) {
  const mode = MODES.has(request.mode) ? request.mode : 'images';
  const query = String(request.query || '').trim().slice(0, 500);
  const limit = Math.min(Math.max(Number(request.limit || 120), 1), 10_000);
  if (!query) throw new Error('Enter a VSCO search query.');
  const startedAt = performance.now();

  if (mode === 'images') {
    const data = await fetchJson(`https://vsco.co/api/2.0/search/images?query=${encodeURIComponent(query)}&size=${limit}`);
    const raw = (Array.isArray(data?.results) ? data.results : []).slice(0, limit);
    const items = raw.map(mapImage).filter(item => item.id && item.imageUrl)
      .sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
    return { ok: true, mode, query, items, sourceCount: raw.length, tookMs: Math.round(performance.now() - startedAt) };
  }

  const data = await fetchJson(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(query)}&page=0&size=${limit}`);
  const raw = (Array.isArray(data?.results) ? data.results : Array.isArray(data?.grids) ? data.grids : []).slice(0, limit);
  const people = raw.map(mapPerson).filter(item => item.id);
  const lowered = query.toLowerCase();
  const items = mode === 'bio'
    ? people.filter(item => item.description.toLowerCase().includes(lowered))
    : people;
  return { ok: true, mode, query, items, sourceCount: raw.length, tookMs: Math.round(performance.now() - startedAt) };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = String(request?.action || '');
  if (!ALLOWED_ACTIONS.has(action)) return false;
  (async () => {
    assertSender(sender);
    if (action === 'scoutframe.health') return health();
    return search(request);
  })().then(sendResponse).catch(error => {
    console.warn('[Scoutframe Companion]', error);
    sendResponse({ ok: false, error: String(error?.message || 'Companion request failed.').slice(0, 500) });
  });
  return true;
});
