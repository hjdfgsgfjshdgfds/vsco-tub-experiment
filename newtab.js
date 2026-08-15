// ============ VSCO FEED ============

// Small localhost compatibility layer. The Chrome extension uses
// chrome.storage.local; the mirror uses the same keys in localStorage.
if (!globalThis.chrome?.storage?.local) {
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
        // The mirror has its own origin; discard stale mirror-only cache so the
        // raw following baseline has room. Chrome extension storage is untouched.
        try { localStorage.clear(); } catch {}
    }
    const mirrorStorage = {
        get(keys, callback) {
            const out = {};
            const names = keys === null || keys === undefined ? Object.keys(localStorage)
                : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
            for (const key of names) {
                const raw = localStorage.getItem(key);
                if (raw !== null) { try { out[key] = JSON.parse(raw); } catch { out[key] = raw; } }
                else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[key] = keys[key];
            }
            queueMicrotask(() => callback?.(out));
            return Promise.resolve(out);
        },
        set(values, callback) {
            for (const [key, value] of Object.entries(values || {})) localStorage.setItem(key, JSON.stringify(value));
            queueMicrotask(() => callback?.());
            return Promise.resolve();
        },
        remove(keys, callback) {
            for (const key of (Array.isArray(keys) ? keys : [keys])) localStorage.removeItem(key);
            queueMicrotask(() => callback?.());
            return Promise.resolve();
        }
    };
    globalThis.chrome = globalThis.chrome || {};
    try {
        Object.defineProperty(globalThis.chrome, 'storage', { configurable: true, value: { ...(globalThis.chrome.storage || {}), local: mirrorStorage } });
    } catch {
        globalThis.chrome.storage = { ...(globalThis.chrome.storage || {}), local: mirrorStorage };
    }
    globalThis.chrome.runtime = globalThis.chrome.runtime || { lastError: null };
    globalThis.chrome.runtime.getURL = globalThis.chrome.runtime.getURL || (path => new URL(path, location.href).href);
    globalThis.chrome.tabs = globalThis.chrome.tabs || { create: ({ url }) => window.open(url, '_blank') };
    globalThis.chrome.action = globalThis.chrome.action || {};
}

// The localhost mirror relays VSCO API GETs through the local server so the
// supplied .vsco.co cookie export can be used without exposing it to the page.
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url;
        if (url?.startsWith('https://vsco.co/api/')) {
            return new Promise((resolve, reject) => {
                const id = `local-api-${Date.now()}-${Math.random()}`;
                const onMessage = event => {
                    if (event.source !== window || event.data?.source !== 'vsco-local-app-response' || event.data.id !== id) return;
                    window.removeEventListener('message', onMessage);
                    if (event.data.error) return reject(new Error(event.data.error));
                    const result = event.data.response || {};
                    resolve(new Response(result.body || '', { status: result.status || (result.ok ? 200 : 502), headers: { 'Content-Type': 'application/json' } }));
                };
                window.addEventListener('message', onMessage);
                window.postMessage({ source: 'vsco-local-app-request', id, payload: { action: 'localApiRequest', url } }, '*');
            });
        }
        return nativeFetch(input, init);
    };
}

// ============ GLOBAL ERROR HANDLER ============
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
});

// ============ CONFIGURATION CONSTANTS ============
const DISPLAY_BATCH_SIZE = 50;
const PAGE_SIZE = 18;
const FOREGROUND_SEARCH_RESULT_LIMIT = 10000; // normal image-search limit
const GRID_SEARCH_RESULT_LIMIT = 10000;      // People/Bio grid searches
// Expansion is intentionally generous; the empty-streak stop and request
// retry limits prevent it from running forever while still allowing broad searches.
const PARTITION_SEARCH_DEFAULT_QUERIES = 100;
const PARTITION_SEARCH_MAX_CANDIDATES = 40;
const PARTITION_SEARCH_EMPTY_STOP = 4;
const PROFILE_MEDIA_REQUEST_MIN_INTERVAL_MS = 2500;
const PROFILE_MEDIA_MAX_PAGES = 3;
const SCRAPER_CONCURRENCY = 10;        // term-level pipeline workers feeding the adaptive request pool
const SCRAPER_WORKER_STAGGER_MS = 75;  // spread worker launch instead of one request burst
const SCRAPER_QUERY_SIZE = 10000;
const FILTER_LOCAL_MAX_RESULTS = 20000;
const FILTER_LOCAL_PAGE_SIZE = 500;
const SCRAPE_DELAY_MS = 4500;        // legacy delay between scraper queries
const API_TIMEOUT_MS = 60000;         // fetch timeout per API call
const SCROLL_THRESHOLD_PX = 700;      // pixels from bottom to preload the next small batch
const AUTO_PFP_DELAY_MS = 1500;       // ms between each profile pic fetch
const INITIAL_BACKOFF_MS = 4000;      // starting backoff on rate limit
const MAX_BACKOFF_MS = 60000;         // max backoff ceiling
const MAX_RETRIES = 3;                // max retries per API call on failure
const GRID_REQUEST_MIN_INTERVAL_MS = 50;
const GRID_REQUEST_JITTER_MS = 150;
const HEAVY_SEARCH_INITIAL_CONCURRENCY = 4;
const HEAVY_SEARCH_MAX_CONCURRENCY = 6;
const HEAVY_SEARCH_SUCCESS_RAMP = 8;
const VAULT_WRITE_CHUNK_SIZE = 2000;
const VAULT_WRITE_YIELD_MS = 5;
const PFP_VIEWPORT_MARGIN = 2000;     // IntersectionObserver rootMargin for pre-fetch
const PFP_VISIBILITY_RANGE = 2500;    // px beyond viewport to consider card "near"
const FOLLOWING_PAGE_SIZE = 100;
const MAX_FOLLOWING_PAGES = 30;       // 2.9k follows means valid pages are 0-29 at size=100
const MAX_FOLLOWING_SCRAPE_TERM_PROFILES = 12;
const FOLLOWING_PRELOAD_TIME_BUDGET_MS = 2500;
const FOLLOWING_REPOST_TIME_BUDGET_MS = 10000;
const MAX_FOLLOWING_REPOST_PROFILES = 5;
const FOLLOWING_REPOST_PAGE_SIZE = 12;
const MAX_REPOSTED_SITE_DETAIL_FETCHES = 12;
const OPTIONAL_API_TIMEOUT_MS = 8000;
const TALL_VERTICAL_ASPECT_THRESHOLD = 16 / 9;
const WIDE_HORIZONTAL_ASPECT_THRESHOLD = 16 / 9;

const grid = document.getElementById("grid");
const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const info = document.getElementById("info");
const browseBtn = document.getElementById("browse-btn");
const challengeBtn = document.getElementById("challenge-btn");
const scraperUi = document.getElementById("scraper-ui");
const tmStart = document.getElementById("scrape-start");
const tmEnd = document.getElementById("scrape-end");
const vaultDateMode = document.getElementById("vault-date-mode");
const startScrapeBtn = document.getElementById("start-scrape-btn");
const filterLocalBtn = document.getElementById("filter-local-btn");
const clearSeenBtn = document.getElementById("clear-seen-btn");
const vaultStatsBtn = document.getElementById("vault-stats-btn");
const sourceTestBtn = document.getElementById("source-test-btn");
const exportVaultBtn = document.getElementById("export-vault-btn");
const importVaultBtn = document.getElementById("import-vault-btn");
const globalExifGpsFilter = document.getElementById("global-exifgps-filter");
const termQueueBtn = document.getElementById("term-queue-btn");
const pfpSourceTermInput = document.getElementById("pfp-source-term-input");
const pfpSourceTermBtn = document.getElementById("pfp-source-term-btn");
const pfpSourceTermList = document.getElementById("pfp-source-term-list");
const localSearchInput = document.getElementById("local-search-input");
const localSearchBtn = document.getElementById("local-search-btn");
const shownPfpBtn = document.getElementById("shown-pfp-btn");
const pfpWorkerCountInput = document.getElementById("pfp-worker-count");
const scrapeStats = document.getElementById("scrape-stats");
const luckBtn = document.getElementById("luck-btn");
const gridFieldFilter = document.getElementById("grid-field-filter");
const peopleBtn = document.getElementById("people-btn");
const followingBtn = document.getElementById("following-btn");
const forYouBtn = document.getElementById("for-you-btn");
const bioBtn = document.getElementById("bio-btn");
const updatesBtn = document.getElementById("updates-btn");
const socialMatchesBtn = document.getElementById("social-matches-btn");
const siteIdsBtn = document.getElementById("siteids-btn");
const siteEdgeBtn = document.getElementById("site-edge-btn");

// ============ SEARCH TERMS ============
const SEARCHES = [
    '🍑', '👙', '🩱', '🔥', '💋', '😍', '🥵', '😈', '🫦', '💦', '🍒',
    '☀️', '🌊', '🏖️', '✨', '💅', '💄', '🤳', '📸', '🪞', '🖤', '❤️',
    'bikini', 'beach', 'pool', 'summer', 'tan', 'selfie', 'mirror', 'model',
    'miami', 'ibiza', 'bali', 'cabo', 'maldives', 'coachella', 'festival'
];

// Broad queries for Live Feed — each returns up to 10k, all fired in parallel
const FEED_QUERIES = [
    '#vsco', '#photography', '#portrait', '#love', '#fashion',
    '#art', '#nature', '#travel', '#film', '#aesthetic',
    '#beauty', '#photo', '#street', '#explore', '#vibes',
    '#color', '#light', '#life', '#style', '#creative'
];

let appSettings = {
    updatesOnlyCheckPfps: false,
    pfpScanWorkers: 32,
    autoHideViewed: true,
    gpsEnabled: false,
    autoScrapeOnLike: false,
    scrapeDescriptionsOnLike: true,
    scrapeNameBioOnLike: true,
    followedScrapeUsernames: false,
    followedScrapeBioDescriptions: true,
    followedScrapeImageDescriptions: true,
    followedScrapeRepostedUsers: false,
    showOriginalPosterPfpInReposts: false,
    scraperTargetDescriptions: true,
    scraperTargetProfileBio: true
};

let mode = null;               // 'search' | 'feed' | null
let fetching = false;
let scraperState = 'idle';     // 'idle' | 'running' | 'stopping'
let scraperAbort = null;       // AbortController for current scraper run
let currentBackoffMs = INITIAL_BACKOFF_MS;
let heavySearchRequestChains = Array.from({ length: HEAVY_SEARCH_MAX_CONCURRENCY }, () => Promise.resolve());
let heavySearchLaneCursor = 0;
let activeHeavySearchConcurrency = HEAVY_SEARCH_INITIAL_CONCURRENCY;
let heavySearchSuccessStreak = 0;
let nextGridRequestAt = 0;
let gridRateLimitUntil = 0;
let adaptiveSearchGapMs = 0;
let lastScraperLongTaskAt = 0;
let scraperLongTaskPressure = 0;

try {
    const scraperLongTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            if (entry.duration < 100) continue;
            lastScraperLongTaskAt = Date.now();
            scraperLongTaskPressure = Math.min(1000, scraperLongTaskPressure + entry.duration);
            if (entry.duration >= 180) {
                activeHeavySearchConcurrency = Math.max(2, activeHeavySearchConcurrency - 1);
                adaptiveSearchGapMs = Math.max(adaptiveSearchGapMs, 100);
                heavySearchSuccessStreak = 0;
            }
        }
    });
    scraperLongTaskObserver.observe({ type: 'longtask', buffered: true });
} catch (error) {
    // Long Task API is optional; 429 and heap feedback still tune the pool.
}
let allResults = [];
let displayedCount = 0;
let currentPage = 0;
let aspectFilterMode = 'all';
let seenIds = new Set();
let permanentSeenIds = new Set();
let masterScrapeCount = 0;          // vault size (count, not all IDs in memory)
let scraperSessionIds = new Set();  // IDs added THIS session (for fast dedup within a run)
let customQueue = [];
let reviewQueue = {};
let vaultPageState = null;
let vaultPageLoadInProgress = false;
let fullyLikedImages = {};
let fullyLikedCache = null;
let fullyLikedSiteIds = new Set();
let likedQueries = new Set();
let siteIdToCollectionId = {};
let savedPfps = {};

function seedPfpBaselineIfMissing(siteId, pfpUrl) {
    const sid = String(siteId || '');
    const normalizedUrl = normalizeStoredPfpValue(pfpUrl);
    if (!sid || !normalizedUrl || isVscoDefaultAvatarUrl(normalizedUrl) || savedPfps[sid]) return false;
    const pfpImageId = extractVscoImageId(normalizedUrl);
    // Store a stable VSCO image-ID URL so CDN/host/query-string changes do not
    // look like profile-picture changes.
    savedPfps[sid] = pfpImageId ? `https://i.vsco.co/${pfpImageId}` : normalizedUrl;
    chrome.storage.local.set({ savedPfps });
    return true;
}
let discoveredSiteIds = {};
let repostsSortMode = 'recent-likes'; // 'recent-likes' | 'newest' | 'oldest' | 'random'
let currentRepostsMedia = [];
let singleUserRepostsState = null;
let lastUserScrollDownAt = 0;
let lastLoadMoreAt = 0;
let activeSearchController = null;
let lastPeopleFilteredCount = 0;

// Observer to automatically hide items we have scrolled past
const autoHideObserver = new IntersectionObserver((entries) => {
    if (!appSettings.autoHideViewed) return;
    if (aspectFilterMode !== 'all') return;
    if (showHiddenItemsTemporarily) return;

    let newlyHidden = false;
    entries.forEach(entry => {
        // When the very bottom of the card passes the top of the viewport (i.e. user scrolled down past it)
        if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
            const img = entry.target._imgData;
            // Never auto-hide when viewing fully-liked or specific user bios
            if (img && mode !== 'fully-liked' && mode !== 'bio') {
                markItemHidden(img);
                newlyHidden = true;

                // Native Scroll Anchoring protects the viewport from jumping! Completely remove it from the page layout so the user knows they are gone
                entry.target.style.display = 'none';
            }
            autoHideObserver.unobserve(entry.target);
        }
    });

    if (newlyHidden) {
        saveHiddenIdsToDB();
    }
}, { rootMargin: "0px", threshold: 0 });

let currentVaultRawItems = [];
let vaultFilterMode = 'all'; // 'all' | 'images' | 'profiles'
let vaultSortMode = 'random'; // 'newest' | 'oldest' | 'random' | 'grouped'
let exifGpsFilterOnly = false;
let showHiddenItemsTemporarily = false; // session-only visibility override; never persisted
let lastSearchResults = [];
let imageExpansionAvailable = false;
let localResultSearchQuery = '';
let localResultMaxAgeDays = 0;
let partitionSearchBudget = PARTITION_SEARCH_DEFAULT_QUERIES;
let partitionMatchMode = 'strict'; // 'strict' keeps the original term; 'related' is experimental
let partitionExpansionRunning = false;
let partitionExpansionStopRequested = false;
let partitionMonitor = null;
let lastSearchApiTotal = null;

function beginPartitionMonitor(kind, seedCount, apiTotal = null) {
    partitionMonitor = {
        runId: `${kind}-${Date.now()}`,
        kind,
        seedCount,
        apiTotal: Number.isFinite(Number(apiTotal)) ? Number(apiTotal) : null,
        candidateCount: 0,
        queued: 0,
        completed: 0,
        requests: 0,
        returned: 0,
        accepted: 0,
        added: 0,
        errors: 0,
        apiEmpty: 0,
        rejectedAll: 0,
        duplicateOnly: 0,
        authFailures: 0,
        rateLimited: 0,
        requestErrors: 0,
        zeroSamples: [],
        emptyStreak: 0,
        startedAt: Date.now(),
        lastQuery: '',
        recent: []
    };
    console.info('[partition-monitor:start]', { ...partitionMonitor });
}

function updatePartitionMonitor(patch = {}) {
    if (!partitionMonitor) return;
    Object.assign(partitionMonitor, patch);
    if (patch.query) {
        partitionMonitor.lastQuery = patch.query;
        partitionMonitor.recent.push({ query: patch.query, returned: patch.rowReturned ?? patch.returned ?? 0, accepted: patch.rowAccepted ?? patch.accepted ?? 0, added: patch.rowAdded ?? patch.added ?? 0, error: patch.rowError ?? patch.error ?? null, ms: patch.rowMs ?? patch.ms ?? 0 });
        partitionMonitor.recent = partitionMonitor.recent.slice(-8);
        if (patch.zeroReason === 'api-empty') partitionMonitor.apiEmpty++;
        if (patch.zeroReason === 'strict-rejected-all') partitionMonitor.rejectedAll++;
        if (patch.zeroReason === 'duplicate-only') partitionMonitor.duplicateOnly++;
        if (patch.zeroReason === 'auth') partitionMonitor.authFailures++;
        if (patch.zeroReason === 'rate-limited') partitionMonitor.rateLimited++;
        if (patch.zeroReason === 'request-error' || patch.zeroReason === 'aborted') partitionMonitor.requestErrors++;
        if (patch.zeroReason && patch.zeroReason !== 'none' && partitionMonitor.zeroSamples.length < 30) {
            partitionMonitor.zeroSamples.push({ query: patch.query, reason: patch.zeroReason, returned: patch.rowReturned || 0, accepted: patch.rowAccepted || 0, added: patch.rowAdded || 0 });
        }
    }
    console.debug('[partition-monitor:update]', { ...partitionMonitor, recent: undefined });
}

function renderPartitionMonitor() {
    if (!partitionMonitor) return '';
    const m = partitionMonitor;
    const elapsed = Math.max(0, Math.round((Date.now() - m.startedAt) / 1000));
    const recent = m.recent.slice().reverse().map(row => `<li><code>${escapeHtml(row.query)}</code> · ${row.returned}→${row.accepted} · +${row.added}${row.error ? ` · ${escapeHtml(row.error)}` : ''} · ${row.ms}ms</li>`).join('');
    const zeroSamples = m.zeroSamples.slice(-8).reverse().map(row => `<li><code>${escapeHtml(row.query)}</code> → ${escapeHtml(row.reason)} (${row.returned}→${row.accepted} · +${row.added})</li>`).join('');
    return `<details class="partition-monitor"><summary>🩺 Monitor · ${m.completed} requests · ${m.returned.toLocaleString()} returned · ${m.added.toLocaleString()} new · ${m.errors} errors · ${elapsed}s</summary><div class="partition-monitor-body">baseline API total ${m.apiTotal == null ? 'unknown' : m.apiTotal.toLocaleString()} · fetched ${m.seedCount.toLocaleString()} · candidates ${m.candidateCount} · queued ${m.queued} · accepted ${m.accepted.toLocaleString()} · empty streak ${m.emptyStreak}<br>zeros: API empty ${m.apiEmpty} · strict rejected ${m.rejectedAll} · duplicate-only ${m.duplicateOnly} · auth ${m.authFailures} · rate-limited ${m.rateLimited} · request errors ${m.requestErrors}<br><small>Zero samples</small><ul>${zeroSamples || '<li>none yet</li>'}</ul><small>Recent queries</small><ul>${recent || '<li>none yet</li>'}</ul></div></details>`;
}

function classifyPartitionResult(response, exactCount, newExact) {
    if (response?.authError) return 'auth';
    if (response?.rateLimited) return 'rate-limited';
    if (response?.error === 'aborted') return 'aborted';
    if (response?.error) return 'request-error';
    if ((response?.results?.length || 0) === 0) return 'api-empty';
    if (exactCount === 0) return 'strict-rejected-all';
    if (newExact === 0) return 'duplicate-only';
    return 'none';
}

function stopPartitionExpansion() {
    if (!partitionExpansionRunning) return;
    partitionExpansionStopRequested = true;
    activeSearchController?.abort();
    info.textContent = '⏹ Stopping expansion after the current partition…';
}
let scrapeHistory = {}; // term -> last-scraped timestamp
let vaultWriteQueue = Promise.resolve();
let scraperProgressWriteQueue = Promise.resolve();
let termQueueRandSpace = false;
let termQueueRandLength = 2;
let termQueueRandPool = { lat: true, cyr: false, grk: false, ara: false, heb: false, num: false, emo: false };

function parseQueueTermsInput(value) {
    return String(value || '')
        .split(/[,\n\r]+/)
        .map(term => term.trim())
        .filter(Boolean);
}

function addCustomQueueTerms(value) {
    const existingTerms = new Set(customQueue);
    const addedTerms = [];

    parseQueueTermsInput(value).forEach(term => {
        if (!existingTerms.has(term)) {
            customQueue.push(term);
            existingTerms.add(term);
            addedTerms.push(term);
        }
    });

    return addedTerms;
}

function normalizeAppSettings(settings) {
    const normalized = { ...appSettings, ...(settings || {}) };
    if (typeof normalized.gpsEnabled !== 'boolean') normalized.gpsEnabled = false;
    normalized.pfpScanWorkers = Math.max(1, Math.min(128, Number.parseInt(normalized.pfpScanWorkers, 10) || 32));
    if (normalized.scraperTargetDescriptions === false && normalized.scraperTargetProfileBio === false) {
        normalized.scraperTargetDescriptions = true;
    }
    return normalized;
}

// ============ INDEXEDDB VAULT STORAGE ============
const DB_NAME = "VSCO_Vault";
const DB_VERSION = 7; // adds a lightweight fetched-time index for Vault browsing

function openVaultDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("images")) {
                db.createObjectStore("images", { keyPath: "imageId" });
            }
            let fetchStore;
            if (!db.objectStoreNames.contains("fetch_index")) {
                fetchStore = db.createObjectStore("fetch_index", { keyPath: "imageId" });
            } else {
                fetchStore = e.target.transaction.objectStore("fetch_index");
            }
            if (!fetchStore.indexNames.contains("byFetchedAt")) {
                fetchStore.createIndex("byFetchedAt", ["fetchedAt", "imageId"], { unique: false });
            }
            // New store for hidden IDs — bypasses chrome.storage.local 5MB quota
            if (!db.objectStoreNames.contains("hidden_ids")) {
                db.createObjectStore("hidden_ids", { keyPath: "id" });
            }
            // Dedicated store for fully liked users' profile info (separate from vault)
            if (!db.objectStoreNames.contains("liked_profiles")) {
                db.createObjectStore("liked_profiles", { keyPath: "siteId" });
            }
            if (!db.objectStoreNames.contains("followed_profiles")) {
                db.createObjectStore("followed_profiles", { keyPath: "siteId" });
            }
            // Site Edge results are kept separate from the scraper/image vault.
            if (!db.objectStoreNames.contains("site_edge_profiles")) {
                db.createObjectStore("site_edge_profiles", { keyPath: "siteId" });
            }
            if (!db.objectStoreNames.contains("site_edge_probes")) {
                db.createObjectStore("site_edge_probes", { keyPath: "siteId" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Save the full permanentSeenIds set to IndexedDB (replaces unreliable chrome.storage.local)
async function saveHiddenIdsToDB() {
    try {
        const db = await openVaultDB();
        const tx = db.transaction("hidden_ids", "readwrite");
        const store = tx.objectStore("hidden_ids");
        store.clear();
        permanentSeenIds.forEach(id => store.put({ id }));
        return new Promise((resolve) => {
            tx.oncomplete = resolve;
            tx.onerror = () => { console.error('Failed to save hidden IDs to IDB', tx.error); resolve(); };
        });
    } catch (e) {
        console.error('saveHiddenIdsToDB error:', e);
    }
}

// Load permanentSeenIds from IndexedDB into the in-memory Set
async function loadHiddenIdsFromDB() {
    try {
        const db = await openVaultDB();
        const tx = db.transaction("hidden_ids", "readonly");
        const store = tx.objectStore("hidden_ids");
        const req = store.getAll();
        return new Promise((resolve) => {
            req.onsuccess = () => {
                (req.result || []).forEach(row => permanentSeenIds.add(String(row.id)));
                resolve();
            };
            req.onerror = resolve;
        });
    } catch (e) {
        console.error('loadHiddenIdsFromDB error:', e);
    }
}

// Convert ms timestamp to MongoDB ObjectId hex prefix for key range queries
function timeToObjectIdPrefix(timeMs) {
    const seconds = Math.min(0xffffffff, Math.max(0, Math.floor(Number(timeMs || 0) / 1000)));
    return seconds.toString(16).padStart(8, '0');
}

function hasExifGpsData(img) {
    const exifSources = [
        img?.exifdata,
        img?.exifData,
        img?.exif,
        img?.exifGps?.exif,
        img?.image?.exifdata,
        img?.image?.exifData,
        img?.image?.exif,
        img?.metadata?.exifdata,
        img?.metadata?.exifData,
        img?.metadata?.exif,
        img?.metadata?.exifGps?.exif
    ];

    for (const exif of exifSources) {
        if (!exif || typeof exif !== 'object') continue;
        const lat = exif.GPSLatitude;
        const lng = exif.GPSLongitude;
        if (Array.isArray(lat) && Array.isArray(lng) && lat.length === 3 && lng.length === 3) {
            return true;
        }
        if (lat && lng) return true;
    }

    const coordSources = [
        img?.location_coords,
        img?.gpsLocation,
        img?.exifGps?.location_coords,
        img?.metadata?.location_coords,
        img?.metadata?.gpsLocation
    ];
    for (const coords of coordSources) {
        if (parseLocationCoords(coords)) return true;
    }

    return false;
}

function hasLocationMetadata(item) {
    if (!item || typeof item !== 'object') return false;
    if (!appSettings.gpsEnabled) return false;
    if (hasExifGpsData(item)) return true;
    if (item.has_location === true) return true;
    if (parseLocationCoords(item.location_coords)) return true;

    const nested = item.image || item.media || item.profile || item.metadata;
    if (nested && nested !== item) {
        return hasLocationMetadata(nested);
    }

    return false;
}

function syncExifGpsToggleUI() {
    document.querySelectorAll('.exif-gps-toggle').forEach(el => {
        el.classList.toggle('active', exifGpsFilterOnly);
    });
    document.querySelectorAll('input#global-exifgps-filter, input#vault-filter-exifgps').forEach(el => {
        el.checked = exifGpsFilterOnly && appSettings.gpsEnabled;
        el.disabled = !appSettings.gpsEnabled;
    });
    document.querySelectorAll('.gps-feature-toggle').forEach(el => {
        el.classList.toggle('active', appSettings.gpsEnabled);
    });
    document.querySelectorAll('input#global-gps-toggle').forEach(el => {
        el.checked = appSettings.gpsEnabled;
    });
}

function setGpsEnabled(enabled) {
    appSettings.gpsEnabled = Boolean(enabled);
    if (!appSettings.gpsEnabled && exifGpsFilterOnly) {
        exifGpsFilterOnly = false;
    }
    syncExifGpsToggleUI();
    document.querySelectorAll('.card').forEach(card => updateExifGpsCardVisibility(card));
    if (!appSettings.gpsEnabled) {
        document.querySelectorAll('.exif-gps-badge').forEach(el => el.remove());
    } else {
        document.querySelectorAll('.card').forEach(card => {
            if (itemHasExifGpsMetadata(card._imgData)) {
                addExifGpsBadge(card, card._imgData?.exifGps || card._imgData);
            }
        });
    }
    updateInfo();
    chrome.storage.local.set({ appSettings });
}

function setExifGpsFilterOnly(enabled) {
    if (!appSettings.gpsEnabled) {
        exifGpsFilterOnly = false;
        syncExifGpsToggleUI();
        return;
    }
    exifGpsFilterOnly = Boolean(enabled);
    syncExifGpsToggleUI();
    document.querySelectorAll('.card').forEach(card => {
        updateExifGpsCardVisibility(card);
        if (exifGpsFilterOnly && card.dataset.exifGpsChecked !== '1') {
            inspectCardForExifGps(card);
        }
    });
    if (exifGpsFilterOnly) requestExifGpsBackgroundScan(true);
}

function itemHasExifGpsMetadata(item) {
    if (!appSettings.gpsEnabled) return false;
    const hasGps = hasLocationMetadata(item) || item?.hasExifGps === true;
    item.hasExifGps = hasGps;
    return hasGps;
}

function personHasExifGpsMetadata(person) {
    const siteId = String(person?.siteId || '');
    if (!siteId) return false;
    const media = profileCache[siteId] || [];
    return hasLocationMetadata(person) || media.some(hasLocationMetadata);
}

function filterItemsByExifGps(items, kind) {
    if (!exifGpsFilterOnly) return items;
    return items.filter(item => {
        if (kind === 'people') return personHasExifGpsMetadata(item);
        return itemHasExifGpsMetadata(item);
    });
}

function rerenderSearchResults() {
    if (mode !== 'search') return;
    const localTerms = getPartitionBaseTerms(localResultSearchQuery);
    allResults = lastSearchResults.filter(item =>
        (!localTerms.length || partitionRecordMatchesTerms(item, localTerms)) && partitionResultPassesAge(item, 'image')
    );
    if (forYouMode) sortForYouImages(allResults);
    else allResults.sort(compareNewestUpload);
    resetPagination();
    grid.classList.toggle('grid-dual-pfp', autoPfpEnabled);
    renderNew();
    renderAutoPfpToggle();
    renderPartitionSearchToggle();
    renderForYouControls();
    updateInfo();
}

function renderPartitionSearchToggle() {
    document.querySelectorAll('.partition-search-bar').forEach(el => el.remove());
    if (mode !== 'search' || !lastSearchQuery || !lastSearchResults.length) return;

    const bar = document.createElement('div');
    bar.className = 'partition-search-bar sort-bar';
    bar.innerHTML = `
        ${partitionExpansionRunning ? '<button class="sort-btn partition-stop-btn">⏹ Stop Expansion</button>' : `
            <label class="partition-budget-label">Partitions <input class="partition-budget" type="number" min="1" max="500" value="${partitionSearchBudget}" title="Maximum expansion searches"></label>
            <label>Match <select class="partition-match-mode" title="Choose how expanded results are admitted"><option value="related" ${partitionMatchMode === 'related' ? 'selected' : ''}>Related</option><option value="strict" ${partitionMatchMode === 'strict' ? 'selected' : ''}>Original term</option></select></label>
            <button class="sort-btn partition-search-btn" title="Expand this image search using caption tokens discovered in the current results">🧩 Expand Search</button>
        `}
        ${imageExpansionAvailable ? `
            <span class="sort-divider"></span>
            <input class="partition-result-search" type="search" value="${escapeHtml(localResultSearchQuery)}" placeholder="Search within expanded results…" title="Search locally across every field in the expanded image results">
            <select class="partition-result-age" title="Hide expanded image results older than this age">
                ${renderPartitionAgeOptions()}
            </select>
            <button class="sort-btn partition-result-clear" ${localResultSearchQuery || localResultMaxAgeDays ? '' : 'disabled'}>Clear</button>
        ` : ''}
        ${renderPartitionMonitor()}
    `;
    bar.querySelector('.partition-search-btn')?.addEventListener('click', () => {
        void runPartitionImageSearch();
    });
    bar.querySelector('.partition-stop-btn')?.addEventListener('click', stopPartitionExpansion);
    bar.querySelector('.partition-budget')?.addEventListener('input', (event) => {
        partitionSearchBudget = Math.max(1, Math.min(500, Number.parseInt(event.target.value, 10) || PARTITION_SEARCH_DEFAULT_QUERIES));
    });
    bar.querySelector('.partition-budget')?.addEventListener('change', (event) => { event.target.value = partitionSearchBudget; });
    bar.querySelector('.partition-match-mode')?.addEventListener('change', (event) => {
        partitionMatchMode = event.target.value === 'strict' ? 'strict' : 'related';
    });
    const localInput = bar.querySelector('.partition-result-search');
    localInput?.addEventListener('input', (event) => {
        localResultSearchQuery = event.target.value;
        rerenderSearchResults();
        const nextInput = document.querySelector('.partition-result-search');
        nextInput?.focus();
        nextInput?.setSelectionRange(localResultSearchQuery.length, localResultSearchQuery.length);
    });
    bar.querySelector('.partition-result-age')?.addEventListener('change', (event) => {
        localResultMaxAgeDays = Number(event.target.value) || 0;
        rerenderSearchResults();
    });
    bar.querySelector('.partition-result-clear')?.addEventListener('click', () => {
        localResultSearchQuery = '';
        localResultMaxAgeDays = 0;
        rerenderSearchResults();
    });
    grid.before(bar);
}

async function runPartitionImageSearch() {
    if (mode !== 'search' || !lastSearchQuery) return;
    if (activeSearchController) activeSearchController.abort();
    const controller = new AbortController();
    activeSearchController = controller;
    partitionExpansionRunning = true;
    partitionExpansionStopRequested = false;
    const maxQueries = partitionSearchBudget;
    rerenderSearchResults();
    const base = lastSearchQuery.trim();
    const baseTerms = getPartitionBaseTerms(base);
    const merged = new Map();
    const seed = lastSearchResults.length ? lastSearchResults : allResults;
    for (const item of seed) {
        if (item?.imageId) merged.set(String(item.imageId), item);
    }

    const baseTokens = new Set(baseTerms.flatMap(term => extractPartitionTokens(term)));
    const candidateScores = new Map();
    const queuedQueries = [];
    const queuedQuerySet = new Set();
    const completedQueries = new Set();
    const partitionStats = [];
    beginPartitionMonitor('images', seed.length, lastSearchApiTotal);

    const addCandidateTokens = (items) => {
        for (const item of items || []) {
            const searchable = partitionRecordSearchText(item);
            const matchingTerms = partitionMatchMode === 'related'
                ? baseTerms
                : baseTerms.filter(term => searchable.includes(term));
            if (!matchingTerms.length) continue;
            for (const term of matchingTerms) {
                for (const token of extractPartitionTokens(searchable)) {
                    if (baseTokens.has(token) || PARTITION_SEARCH_STOP_WORDS.has(token)) continue;
                    const key = JSON.stringify([term, token]);
                    const current = candidateScores.get(key) || { term, token, score: 0 };
                    current.score++;
                    candidateScores.set(key, current);
                }
            }
        }
    };

    const queueCandidateQueries = () => {
        const ranked = [...candidateScores.values()]
            .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
            .slice(0, PARTITION_SEARCH_MAX_CANDIDATES);
        for (const { term, token } of ranked) {
            for (const query of [`${term} ${token}`, `${token} ${term}`]) {
                const normalizedQuery = normalizePartitionText(query);
                if (baseTerms.some(term => normalizedQuery === term) || queuedQuerySet.has(normalizedQuery) || completedQueries.has(normalizedQuery)) continue;
                queuedQuerySet.add(normalizedQuery);
                queuedQueries.push(query);
            }
        }
        updatePartitionMonitor({ candidateCount: candidateScores.size, queued: queuedQueries.length });
    };

    addCandidateTokens(seed);
    queueCandidateQueries();
    let emptyStreak = 0;
    let index = 0;
    info.textContent = `🧩 Expand search: queued ${queuedQueries.length} follow-up queries from ${seed.length.toLocaleString()} fetched results…`;
    while (index < queuedQueries.length && partitionStats.length < maxQueries && !partitionExpansionStopRequested) {
        if (activeSearchController !== controller) return;
        const query = queuedQueries[index++];
        const normalizedQuery = normalizePartitionText(query);
        completedQueries.add(normalizedQuery);
        const startedAt = performance.now();
        const response = await fetchQuery(query, FOREGROUND_SEARCH_RESULT_LIMIT, controller.signal, {
            foregroundFast: true,
            maxRetries: 1,
            timeoutMs: 10000
        });
        let exactCount = 0;
        let newExact = 0;
        for (const item of response.results || []) {
            const isRelated = partitionMatchMode === 'related';
            const searchable = partitionRecordSearchText(item);
            const anchor = getPartitionAnchorToken(query, baseTerms);
            if (isRelated ? (anchor && !searchable.includes(anchor)) : !baseTerms.some(term => searchable.includes(term))) continue;
            exactCount++;
            const id = item?.imageId ? String(item.imageId) : '';
            if (id && !merged.has(id)) newExact++;
            if (id) merged.set(id, item);
        }
        addCandidateTokens(response.results);
        queueCandidateQueries();
        const zeroReason = classifyPartitionResult(response, exactCount, newExact);
        partitionStats.push({ query, returned: response.results?.length || 0, exact: exactCount, added: newExact, zeroReason, error: zeroReason !== 'none' ? zeroReason : null, ms: Math.round(performance.now() - startedAt) });
        updatePartitionMonitor({ completed: partitionStats.length, requests: partitionStats.length, returned: (partitionMonitor?.returned || 0) + (response.results?.length || 0), accepted: (partitionMonitor?.accepted || 0) + exactCount, added: (partitionMonitor?.added || 0) + newExact, errors: (partitionMonitor?.errors || 0) + (zeroReason !== 'none' ? 1 : 0), emptyStreak: newExact === 0 ? emptyStreak + 1 : 0, query, zeroReason, rowReturned: response.results?.length || 0, rowAccepted: exactCount, rowAdded: newExact, rowError: zeroReason !== 'none' ? zeroReason : null, rowMs: Math.round(performance.now() - startedAt), queued: queuedQueries.length });
        emptyStreak = newExact === 0 ? emptyStreak + 1 : 0;
        info.textContent = `🧩 Expand search: ${partitionStats.length}/${Math.min(queuedQueries.length, maxQueries)} partitions · ${merged.size.toLocaleString()} ${partitionMatchMode === 'related' ? 'related' : 'term-matched'} images · +${newExact} · ${queuedQueries.length - index} queued`;
        if (partitionMatchMode === 'strict' && partitionStats.length >= 12 && emptyStreak >= PARTITION_SEARCH_EMPTY_STOP) break;
    }

    if (activeSearchController !== controller) return;
    lastSearchResults = [...merged.values()];
    imageExpansionAvailable = true;
    allResults = lastSearchResults.slice();
    seenIds.clear();
    allResults.forEach(item => seenIds.add(String(item.imageId)));
    resetPagination();
    const failed = partitionStats.filter(stat => stat.error).length;
    const added = Math.max(0, allResults.length - seed.length);
    const stopped = partitionExpansionStopRequested;
    partitionExpansionRunning = false;
    partitionExpansionStopRequested = false;
        rerenderSearchResults();
    info.textContent = `${stopped ? '⏹ Expand search stopped' : '🧩 Expand search complete'} · ${allResults.length.toLocaleString()} ${partitionMatchMode === 'related' ? 'related' : 'term-matched'} images · +${added} new · ${partitionStats.length} partitions${failed ? ` · ${failed} failed` : ''}`;
    console.table?.(partitionStats);
    activeSearchController = null;
}

function normalizePartitionText(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
}

function getPartitionBaseTerms(query) {
    const extracted = extractApiQueries(String(query || '').trim());
    const sourceTerms = extracted.length ? extracted : [query];
    const terms = [];
    sourceTerms.forEach(term => {
        const normalized = normalizePartitionText(term);
        if (normalized) terms.push(normalized);
        // A multi-word or multi-emoji search is semantically a set of
        // searchable components. Keep the original phrase, but also let
        // strict expansion recognize results containing one component.
        extractPartitionTokens(term).forEach(token => terms.push(token));
    });
    return [...new Set(terms.filter(Boolean))];
}

function partitionRecordMatchesTerms(record, terms) {
    if (!terms?.length) return false;
    const serialized = normalizePartitionText(partitionRecordSearchText(record));
    return terms.some(term => serialized.includes(term));
}

function partitionRecordSearchText(record, key = '', depth = 0, output = []) {
    if (depth > 5 || record == null) return output.join(' ');
    const normalizedKey = String(key || '').toLowerCase();
    if (isPartitionNonSemanticKey(normalizedKey)) {
        return output.join(' ');
    }
    if (typeof record === 'string' && /^(https?:)?\/\//i.test(record.trim())) return output.join(' ');
    if (typeof record === 'string' || typeof record === 'number') {
        output.push(String(record));
        return output.join(' ');
    }
    if (Array.isArray(record)) {
        record.slice(0, 200).forEach(value => partitionRecordSearchText(value, key, depth + 1, output));
        return output.join(' ');
    }
    if (typeof record === 'object') {
        Object.entries(record).forEach(([childKey, value]) => partitionRecordSearchText(value, childKey, depth + 1, output));
    }
    return normalizePartitionText(output.join(' '));
}

function isPartitionNonSemanticKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[-]/g, '_');
    return /(?:^|_)(?:id|ids|uuid|url|urls|uri|uris|hash|timestamp|date|time|created|updated|width|height|page|pages|cursor|limit|offset)(?:$|_)/.test(normalized)
        || /(?:site|user|profile|owner|account|image|media|grid|collection|file)(?:id|ids|url|urls|uuid|hash)$/.test(normalized);
}

function partitionResultTimestamp(record, kind) {
    return kind === 'grid' ? getPersonTimestamp(record) : getTimestamp(record);
}

function partitionResultPassesAge(record, kind) {
    if (!localResultMaxAgeDays) return true;
    const timestamp = partitionResultTimestamp(record, kind);
    if (!timestamp) return true; // Keep records whose source omitted a usable date.
    return timestamp >= Date.now() - localResultMaxAgeDays * 24 * 60 * 60 * 1000;
}

const AGE_FILTER_OPTIONS = [
    [1 / 24, '1 hour'],
    [3 / 24, '3 hours'],
    [6 / 24, '6 hours'],
    [12 / 24, '12 hours'],
    [1, '1 day'],
    [3, '3 days'],
    [7, '7 days'],
    [14, '14 days'],
    [30, '30 days'],
    [90, '3 months'],
    [180, '6 months'],
    [365, '1 year'],
    [730, '2 years'],
    [1825, '5 years']
];

function formatAgeLimit(days) {
    if (!days) return 'Any age';
    const match = AGE_FILTER_OPTIONS.find(([value]) => value === days);
    return match ? `≤ ${match[1]}` : `≤ ${days} days`;
}

function renderPartitionAgeOptions() {
    const options = [[0, 'Any age'], ...AGE_FILTER_OPTIONS.map(([days, label]) => [days, `Last ${label}`])];
    return options.map(([days, label]) => `<option value="${days}" ${localResultMaxAgeDays === days ? 'selected' : ''}>${label}</option>`).join('');
}

function extractPartitionTokens(value) {
    const withoutUrls = String(value || '').replace(/(?:https?:\/\/|www\.)\S+/gi, ' ');
    return [...new Set((normalizePartitionText(withoutUrls).match(/#[\p{L}\p{N}_-]+|[\p{L}\p{N}_-]{2,}|[\u{1F300}-\u{1FAFF}]/gu) || [])
        .filter(token => !PARTITION_SEARCH_STOP_WORDS.has(token) && !PARTITION_SEARCH_URL_TOKENS.has(token)))];
}

function getPartitionAnchorToken(query, baseTerms = []) {
    const baseTokens = new Set(baseTerms.flatMap(term => extractPartitionTokens(term)));
    return extractPartitionTokens(query).find(token => !baseTokens.has(token)) || '';
}

const PARTITION_SEARCH_URL_TOKENS = new Set(['http', 'https', 'www', 'com', 'co', 'vsco', 'api', 'share', 'media', 'image', 'jpg', 'jpeg', 'png']);

const PARTITION_SEARCH_STOP_WORDS = new Set([
    'about', 'after', 'again', 'also', 'been', 'being', 'from', 'have', 'into', 'just',
    'like', 'more', 'only', 'that', 'their', 'there', 'these', 'they', 'this', 'with',
    'you', 'your'
]);

function fetchFilteredVault(startTime, endTime, termQuery, textQuery, limit = FILTER_LOCAL_MAX_RESULTS) {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("images", "readonly");
            const store = tx.objectStore("images");

            // Use IDBKeyRange on imageId — MongoDB ObjectIds sort chronologically
            // since their first 8 hex chars are a Unix timestamp.
            // This turns a full 11M-row scan into an indexed range lookup.
            const lowerKey = timeToObjectIdPrefix(startTime) + "0000000000000000";
            const upperKey = timeToObjectIdPrefix(endTime) + "ffffffffffffffff";
            const range = IDBKeyRange.bound(lowerKey, upperKey);

            const req = store.openCursor(range, 'prev');
            const results = [];
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return resolve(results);
                const img = cursor.value;
                let match = true;
                if (termQuery && img.sourceQuery !== termQuery) match = false;
                if (match && textQuery) {
                    const desc = (img.description || '').toLowerCase();
                    const userName = (img.grid?.subdomain || '').toLowerCase();
                    const qStr = (img.sourceQuery || '').toLowerCase();
                    if (!desc.includes(textQuery) && !userName.includes(textQuery) && !qStr.includes(textQuery)) {
                        match = false;
                    }
                }
                if (match) results.push(img);
                if (limit && results.length >= limit) return resolve(results);
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

// Fast date-range browsing for Filter Local. Each call resumes strictly before
// the previous page's last ObjectId, so wide ranges never rescan from the top.
function fetchVaultRangePage(startTime, endTime, beforeKey = null, limit = FILTER_LOCAL_PAGE_SIZE) {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("images", "readonly");
            const store = tx.objectStore("images");
            const lowerKey = timeToObjectIdPrefix(startTime) + "0000000000000000";
            const rangeUpperKey = timeToObjectIdPrefix(endTime) + "ffffffffffffffff";
            const upperKey = beforeKey && beforeKey < rangeUpperKey ? beforeKey : rangeUpperKey;
            const range = IDBKeyRange.bound(lowerKey, upperKey, false, Boolean(beforeKey));
            const req = store.openCursor(range, 'prev');
            const items = [];
            let hasMore = false;

            req.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) {
                    resolve({ items, hasMore: false, nextKey: items.at(-1)?.imageId || null });
                    return;
                }
                if (items.length >= limit) {
                    hasMore = true;
                    resolve({ items, hasMore, nextKey: items.at(-1)?.imageId || null });
                    return;
                }
                items.push(cursor.value);
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        } catch (error) {
            reject(error);
        }
    });
}

function fetchVaultFetchedPage(startTime, endTime, beforeKey = null, limit = FILTER_LOCAL_PAGE_SIZE) {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction(["fetch_index", "images"], "readonly");
            const fetchIndex = tx.objectStore("fetch_index").index("byFetchedAt");
            const imageStore = tx.objectStore("images");
            const lowerKey = [Math.max(0, Number(startTime || 0)), ""];
            const rangeEnd = Math.min(Number(endTime || Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
            const upperKey = beforeKey || [rangeEnd, "\uffff"];
            const range = IDBKeyRange.bound(lowerKey, upperKey, false, Boolean(beforeKey));
            const req = fetchIndex.openCursor(range, 'prev');
            const items = [];
            let queued = 0;
            let pending = 0;
            let scanDone = false;
            let hasMore = false;
            let nextKey = null;

            const finishIfReady = () => {
                if (scanDone && pending === 0) resolve({ items: items.filter(Boolean), hasMore, nextKey });
            };

            req.onsuccess = event => {
                const cursor = event.target.result;
                if (!cursor) {
                    scanDone = true;
                    finishIfReady();
                    return;
                }
                if (queued >= limit) {
                    hasMore = true;
                    scanDone = true;
                    finishIfReady();
                    return;
                }

                const position = queued++;
                nextKey = cursor.key;
                const fetchedAt = Number(cursor.value?.fetchedAt || 0);
                pending++;
                const imageReq = imageStore.get(cursor.primaryKey);
                imageReq.onsuccess = () => {
                    const item = imageReq.result || null;
                    if (item) {
                        item.vaultFetchedAt = fetchedAt || Number(item.vaultFetchedAt || 0);
                    }
                    items[position] = item;
                    pending--;
                    finishIfReady();
                };
                imageReq.onerror = () => {
                    items[position] = null;
                    pending--;
                    finishIfReady();
                };
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
            tx.onabort = () => reject(tx.error || new Error('Fetched-time Vault query aborted'));
        } catch (error) {
            reject(error);
        }
    });
}

function extractProfileMediaItems(payload) {
    const items = [];
    const media = payload?.media || [];
    for (const entry of media) {
        const img = entry?.image || entry || null;
        if (!img) continue;
        const clone = { ...img };
        if (!clone.imageId) clone.imageId = clone._id || clone.id || entry?._id || entry?.id || '';
        if (!clone.imageId) continue;
        items.push(clone);
    }
    return items;
}

function getPrefetchedProfilePfpUrl(siteId) {
    const media = profilePrefetchCache[String(siteId)] || [];
    for (const item of media) {
        const url = normalize(item.site_profile_image_url || item.profile_image_url || item.responsive_url || '');
        if (url) return url;
    }
    return '';
}

function setPrefetchedProfileMedia(siteId, media, sourceQuery = '') {
    const sid = String(siteId || '');
    if (!sid) return 0;
    profilePrefetchCache[sid] = media || [];

    const pfpUrl = getPrefetchedProfilePfpUrl(sid);
    if (pfpUrl) {
        pfpCache[sid] = pfpUrl;
        seedPfpBaselineIfMissing(sid, pfpUrl);
    }

    return saveToVaultDB((media || []).map(item => ({
        ...item,
        sourceQuery: item.sourceQuery || sourceQuery || 'Profile Prefetch',
        prefetchSource: 'profile-medias',
        prefetchSiteId: sid
    })));
}

async function fetchPrefetchedProfileMedia(siteId, limit = 6, sourceQuery = '') {
    return [];
}

function queueProfilePrefetch(card, siteId, sourceQuery = '') {
    return;
}

function initProfilePrefetchObserver() {
    return;
}

async function processProfilePrefetchQueue() {
    return;
}

function stopProfilePrefetch() {
    profilePrefetchQueue = [];
    profilePrefetchProcessing = false;
    if (profilePrefetchAbort) {
        profilePrefetchAbort.abort();
        profilePrefetchAbort = null;
    }
    if (profilePrefetchObserver) {
        profilePrefetchObserver.disconnect();
        profilePrefetchObserver = null;
    }
}

function getVaultStatsFromDB(startTime, endTime, filterMode = 'unseen', recentStartTime = startTime, recentEndTime = endTime) {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("images", "readonly");
            const store = tx.objectStore("images");

            // Scope to time range using key range (same trick as fetchFilteredVault)
            let req;
            if (startTime && endTime) {
                const lowerKey = timeToObjectIdPrefix(startTime) + "0000000000000000";
                const upperKey = timeToObjectIdPrefix(endTime) + "ffffffffffffffff";
                req = store.openCursor(IDBKeyRange.bound(lowerKey, upperKey));
            } else {
                req = store.openCursor();
            }
            const termStats = {};
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return resolve(termStats);
                const img = cursor.value;

                const isSeen = isHiddenItem(img);
                let isMatch = false;
                if (filterMode === 'unseen') isMatch = !isSeen;
                else if (filterMode === 'seen') isMatch = isSeen;
                else if (filterMode === 'both') isMatch = true;
                else if (filterMode === 'liked') isMatch = fullyLikedImages[getItemPrimaryId(img)] !== undefined;

                if (isMatch) {
                    const q = img.sourceQuery || 'Unknown';
                    const stat = termStats[q] || {
                        total: 0,
                        recent: 0,
                        images: 0,
                        profiles: 0,
                        newest: 0
                    };
                    const ts = getTimestamp(img);
                    stat.total++;
                    if (img.isProfile === true) stat.profiles++;
                    else stat.images++;
                    if (ts >= recentStartTime && ts <= recentEndTime) stat.recent++;
                    if (ts > stat.newest) stat.newest = ts;
                    termStats[q] = stat;
                }
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

function loadVaultObjectIdsFromDB() {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("images", "readonly");
            const store = tx.objectStore("images");
            const req = store.count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

// Check if an image already exists in the vault (used during scraping)
function existsInVaultDB(imageId) {
    return new Promise(async (resolve) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("images", "readonly");
            const store = tx.objectStore("images");
            const req = store.getKey(imageId);
            req.onsuccess = () => resolve(req.result !== undefined);
            req.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

function saveToVaultDB(images) {
    return new Promise(async (resolve, reject) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction(["images", "fetch_index"], "readwrite");
            const store = tx.objectStore("images");
            const fetchStore = tx.objectStore("fetch_index");
            let quotaHit = false;
            let newlyAddedCount = 0;

            for (const img of images) {
                if (img) {
                    if (!img.imageId) img.imageId = getItemPrimaryId(img);
                    const id = img.imageId;

                    if (id) {
                        try {
                            const req = store.get(id);
                            req.onsuccess = () => {
                                const existing = req.result || null;
                                const merged = existing ? {
                                    ...existing,
                                    ...img,
                                    grid: { ...(existing.grid || {}), ...(img.grid || {}) },
                                    image: { ...(existing.image || {}), ...(img.image || {}) },
                                    metadata: { ...(existing.metadata || {}), ...(img.metadata || {}) }
                                } : { ...img };
                                if (existing) {
                                    merged.sourceQuery = img.sourceQuery || existing.sourceQuery || merged.sourceQuery || '';
                                }
                                if (merged.metadata && merged.metadata.exifGps && !merged.exifGps) {
                                    merged.exifGps = merged.metadata.exifGps;
                                }
                                if (merged.metadata && merged.metadata.location_coords && !merged.location_coords) {
                                    merged.location_coords = merged.metadata.location_coords;
                                }
                                const fetchedAt = Date.now();
                                merged.vaultFetchedAt = fetchedAt;
                                if (req.result === undefined) {
                                    newlyAddedCount++;
                                }
                                try {
                                    store.put(merged);
                                    fetchStore.put({ imageId: id, fetchedAt });
                                } catch (e) {
                                    if (e.name === 'QuotaExceededError') {
                                        quotaHit = true;
                                    }
                                }
                            };
                            req.onerror = () => { };
                        } catch (e) {
                            if (e.name === 'QuotaExceededError') {
                                quotaHit = true;
                                break;
                            }
                        }
                    }
                }
            }

            tx.oncomplete = () => {
                if (quotaHit) {
                    console.warn('Vault storage nearly full. Some items may not have been saved.');
                    info.textContent = '⚠️ Vault storage nearly full! Consider clearing old seen images.';
                }
                resolve(newlyAddedCount);
            };
            tx.onabort = () => {
                if (tx.error?.name === 'QuotaExceededError') {
                    console.warn('IndexedDB quota exceeded on transaction');
                    info.textContent = '⚠️ Vault storage full! Clear seen images to free space.';
                    resolve(newlyAddedCount); // don't reject — gracefully continue
                } else {
                    reject(tx.error);
                }
            };
            tx.onerror = () => {
                if (tx.error?.name === 'QuotaExceededError') {
                    resolve(newlyAddedCount);
                } else {
                    reject(tx.error);
                }
            };
        } catch (e) {
            reject(e);
        }
    });
}

function writeFastVaultChunk(db, images) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(["images", "fetch_index"], "readwrite");
        const store = tx.objectStore("images");
        const fetchStore = tx.objectStore("fetch_index");
        let savedCount = 0;

        for (const img of images) {
            if (!img) continue;
            if (!img.imageId) img.imageId = getItemPrimaryId(img);
            if (!img.imageId) continue;
            try {
                const fetchedAt = Date.now();
                img.vaultFetchedAt = fetchedAt;
                store.put(img);
                fetchStore.put({ imageId: img.imageId, fetchedAt });
                savedCount++;
            } catch (e) {
                if (e.name !== 'QuotaExceededError') console.warn('Vault fast save item failed:', e);
            }
        }

        tx.oncomplete = () => resolve({ savedCount, quotaHit: false });
        tx.onabort = () => {
            if (tx.error?.name === 'QuotaExceededError') resolve({ savedCount, quotaHit: true });
            else reject(tx.error);
        };
        tx.onerror = () => {
            if (tx.error?.name === 'QuotaExceededError') resolve({ savedCount, quotaHit: true });
            else reject(tx.error);
        };
    });
}

async function fastSaveToVaultDB(images) {
    const db = await openVaultDB();
    let savedCount = 0;

    for (let offset = 0; offset < images.length; offset += VAULT_WRITE_CHUNK_SIZE) {
        const chunk = images.slice(offset, offset + VAULT_WRITE_CHUNK_SIZE);
        const result = await writeFastVaultChunk(db, chunk);
        savedCount += result.savedCount;
        if (result.quotaHit) {
            console.warn('IndexedDB quota exceeded on fast save');
            info.textContent = '⚠️ Vault storage full! Clear seen images to free space.';
            break;
        }
        if (offset + VAULT_WRITE_CHUNK_SIZE < images.length) {
            await new Promise(resolve => setTimeout(resolve, VAULT_WRITE_YIELD_MS));
        }
    }

    return savedCount;
}

function queueVaultSave(images, options = {}) {
    const saver = options.fast ? fastSaveToVaultDB : saveToVaultDB;
    const saveJob = vaultWriteQueue.then(() => saver(images));
    vaultWriteQueue = saveJob.catch(() => { });
    return saveJob;
}

function setChromeLocalAsync(values) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(values, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve();
        });
    });
}

// Multi-worker scrapes must commit queue progress in one ordered lane. Without
// this, an older storage snapshot can finish last and resurrect removed terms.
function markQueuedTermCompleted(term) {
    const writeJob = scraperProgressWriteQueue.then(async () => {
        scrapeHistory[term] = Date.now();
        if (customQueue.includes(term)) {
            customQueue = customQueue.filter(item => item !== term);
        }

        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await setChromeLocalAsync({
                    scrapeHistory: { ...scrapeHistory },
                    customQueue: [...customQueue]
                });
                return;
            } catch (error) {
                lastError = error;
                if (attempt < 2) {
                    await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 200)));
                }
            }
        }
        throw lastError || new Error('Could not save scraper queue progress');
    });

    scraperProgressWriteQueue = writeJob.catch(() => undefined);
    return writeJob;
}

// ============ LIKED PROFILES STORE ============
// Dedicated storage for fully liked users' profile info, separate from the image vault.
// Schema: { siteId, username, displayName, bio, imageDescriptions, pfpUrl, pfpHistory: [{url, detectedAt}], firstLikedAt, lastCheckedAt }
let likedProfiles = {}; // siteId -> profile object (in-memory cache)

function asLikedProfileDescriptionArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
}

function mergeLikedProfileDescriptions(existingDescriptions, newDescriptions) {
    const seen = new Set();
    const merged = [];

    [...asLikedProfileDescriptionArray(existingDescriptions), ...asLikedProfileDescriptionArray(newDescriptions)].forEach(desc => {
        const cleaned = String(desc || '').replace(/\s+/g, ' ').trim();
        const key = cleaned.toLowerCase();
        if (!cleaned || seen.has(key)) return;
        seen.add(key);
        merged.push(cleaned);
    });

    return merged.slice(0, 250);
}

function addFullyLikedScrapeTerm(terms, seen, value) {
    const term = String(value || '').replace(/\s+/g, ' ').trim();
    const key = term.toLowerCase();
    if (!term || term.length >= 200 || seen.has(key)) return;
    seen.add(key);
    terms.push(term);
}

function addFullyLikedScrapeText(terms, seen, value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return;

    addFullyLikedScrapeTerm(terms, seen, text);
    text.split(/[\s,.;:!?()[\]{}"'`“”‘’|/\\<>]+/).forEach(piece => {
        if (piece.length >= 3) addFullyLikedScrapeTerm(terms, seen, piece);
    });
}

function getFullyLikedScrapeTerms() {
    const terms = [];
    const seen = new Set();
    const sources = getFollowedScrapeSources();

    Object.values(fullyLikedImages || {}).forEach(img => {
        if (sources.usernames) {
            addFullyLikedScrapeText(terms, seen, img?.grid?.subdomain);
            addFullyLikedScrapeText(terms, seen, img?.perma_subdomain);
            addFullyLikedScrapeText(terms, seen, img?.userName);
        }
        if (sources.bio) {
            addFullyLikedScrapeText(terms, seen, img?.gridName);
        }
        if (sources.imageDescriptions) {
            addFullyLikedScrapeText(terms, seen, img?.description);
        }
    });

    Object.values(likedProfiles || {}).forEach(profile => {
        if (sources.usernames) {
            addFullyLikedScrapeText(terms, seen, profile?.username);
            addFullyLikedScrapeText(terms, seen, profile?.displayName);
        }
        if (sources.bio) {
            addFullyLikedScrapeText(terms, seen, profile?.bio);
        }
        if (sources.imageDescriptions) {
            asLikedProfileDescriptionArray(profile?.imageDescriptions).forEach(desc => addFullyLikedScrapeText(terms, seen, desc));
        }
    });

    return terms;
}

function getFollowedScrapeSources() {
    return {
        usernames: appSettings.followedScrapeUsernames === true,
        bio: appSettings.followedScrapeBioDescriptions !== false,
        imageDescriptions: appSettings.followedScrapeImageDescriptions !== false
    };
}

function hasEnabledFollowedScrapeSources(sources = getFollowedScrapeSources()) {
    return Boolean(sources.usernames || sources.bio || sources.imageDescriptions);
}

function hasEnabledFollowedScrapeInputs(sources = getFollowedScrapeSources()) {
    return hasEnabledFollowedScrapeSources(sources) || appSettings.followedScrapeRepostedUsers === true;
}

function firstFollowingText(...values) {
    for (const value of values) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text) return text;
    }
    return '';
}

function followingProfileCandidates(item) {
    if (!item || typeof item !== 'object') return [];
    return [
        item,
        item.user,
        item.profile,
        item.grid,
        item.site,
        item.following,
        item.followingUser,
        item.target,
        item.targetUser,
        item.relationship,
        item.relationship?.target,
        item.relationship?.user,
        item.data
    ].filter(candidate => candidate && typeof candidate === 'object');
}

function normalizeFollowingProfileForScrape(item) {
    const candidates = followingProfileCandidates(item);
    if (candidates.length === 0) return null;

    const siteId = firstFollowingText(
        ...candidates.map(c => c.siteId),
        ...candidates.map(c => c.site_id),
        ...candidates.map(c => c.siteID),
        ...candidates.map(c => c.site?.id),
        ...candidates.map(c => c.profile?.siteId),
        ...candidates.map(c => c.grid?.siteId)
    );
    const username = firstFollowingText(
        ...candidates.map(c => c.siteSubDomain),
        ...candidates.map(c => c.site_subdomain),
        ...candidates.map(c => c.subdomain),
        ...candidates.map(c => c.perma_subdomain),
        ...candidates.map(c => c.site?.subdomain),
        ...candidates.map(c => c.profile?.siteSubDomain),
        ...candidates.map(c => c.username),
        ...candidates.map(c => c.handle)
    );
    const displayName = firstFollowingText(
        ...candidates.map(c => c.userName),
        ...candidates.map(c => c.displayName),
        ...candidates.map(c => c.display_name),
        ...candidates.map(c => c.fullName),
        ...candidates.map(c => c.name),
        ...candidates.map(c => c.site?.name)
    );
    const bio = firstFollowingText(
        ...candidates.map(c => c.gridName),
        ...candidates.map(c => c.grid_name),
        ...candidates.map(c => c.bio),
        ...candidates.map(c => c.description),
        ...candidates.map(c => c.about),
        ...candidates.map(c => c.site?.description)
    );

    if (!siteId && !username) return null;
    return { siteId: siteId || username, username, displayName, bio };
}

function normalizeRepostedUserForScrape(item) {
    const media = item?.media || item?.image || item;
    if (!media || typeof media !== 'object') return null;

    const siteId = firstFollowingText(media.site_id, media.siteId, media.grid?.siteId, media.site?.id);
    const username = firstFollowingText(media.perma_subdomain, media.siteSubDomain, media.subdomain, media.grid?.subdomain, media.site?.subdomain);
    const displayName = firstFollowingText(media.userName, media.user_name, media.displayName, media.name, media.site?.name);
    const bio = firstFollowingText(media.grid_name, media.gridName, media.bio, media.description, media.site?.description);

    if (!siteId && !username) return null;
    return { siteId: siteId || username, username, displayName, bio };
}

async function fetchSiteCollectionIdForScrape(profile, signal, deadlineMs) {
    if (Date.now() > deadlineMs) return '';
    const cached = siteIdToCollectionId[String(profile.siteId || '')];
    if (cached && cached !== 'none') return cached;
    if (cached === 'none') return '';

    const urls = [];
    if (profile.siteId) urls.push(`https://vsco.co/api/2.0/sites/${encodeURIComponent(profile.siteId)}`);
    if (profile.username) urls.push(`https://vsco.co/api/2.0/sites?subdomain=${encodeURIComponent(profile.username)}`);

    for (const url of urls) {
        const { data } = await fetchWithRetry(url, signal, `Followed repost site ${profile.username || profile.siteId}`, {
            silentAuth: true,
            timeoutMs: OPTIONAL_API_TIMEOUT_MS,
            maxRetries: 1
        });
        const site = data?.site || (Array.isArray(data?.sites) ? data.sites[0] : null);
        const collectionId = site?.site_collection_id || site?.siteCollectionId || '';
        if (collectionId) {
            if (profile.siteId) {
                siteIdToCollectionId[String(profile.siteId)] = collectionId;
                chrome.storage.local.set({ siteIdToCollectionId });
            }
            return collectionId;
        }
    }

    if (profile.siteId) {
        siteIdToCollectionId[String(profile.siteId)] = 'none';
        chrome.storage.local.set({ siteIdToCollectionId });
    }
    return '';
}

async function enrichRepostedUserBioForScrape(repostedUser, signal, deadlineMs) {
    if (!repostedUser?.username || repostedUser.bio || Date.now() > deadlineMs) return repostedUser;
    const { data } = await fetchWithRetry(`https://vsco.co/api/2.0/sites?subdomain=${encodeURIComponent(repostedUser.username)}`, signal, `Reposted user ${repostedUser.username}`, {
        silentAuth: true,
        timeoutMs: OPTIONAL_API_TIMEOUT_MS,
        maxRetries: 1
    });
    const site = Array.isArray(data?.sites) ? data.sites[0] : null;
    if (!site) return repostedUser;
    return {
        ...repostedUser,
        siteId: String(site.id || repostedUser.siteId || ''),
        username: site.subdomain || repostedUser.username,
        displayName: site.name || repostedUser.displayName,
        bio: site.description || repostedUser.bio
    };
}

async function addFollowedRepostedUserTerms(profile, terms, seen, sources, signal, deadlineMs) {
    if (appSettings.followedScrapeRepostedUsers !== true || Date.now() > deadlineMs) return true;
    const collectionId = await fetchSiteCollectionIdForScrape(profile, signal, deadlineMs);
    if (!collectionId || Date.now() > deadlineMs) return Date.now() <= deadlineMs;

    const { data } = await fetchWithRetry(`https://vsco.co/api/2.0/collections/${encodeURIComponent(collectionId)}/reposts?page=1&size=${FOLLOWING_REPOST_PAGE_SIZE}`, signal, `Followed reposts ${profile.username || profile.siteId}`, {
        silentAuth: true,
        timeoutMs: OPTIONAL_API_TIMEOUT_MS,
        maxRetries: 1
    });
    const rawItems = Array.isArray(data?.CollectionItems) ? data.CollectionItems : [];
    const repostedUsers = [];
    const userKeys = new Set();

    rawItems.forEach(item => {
        const reposted = normalizeRepostedUserForScrape(item);
        if (!reposted) return;
        const key = String(reposted.siteId || reposted.username).toLowerCase();
        if (!key || userKeys.has(key)) return;
        userKeys.add(key);
        repostedUsers.push(reposted);
    });

    let detailFetches = 0;
    for (let reposted of repostedUsers) {
        if (Date.now() > deadlineMs) return false;
        if (sources.bio && !reposted.bio && detailFetches < MAX_REPOSTED_SITE_DETAIL_FETCHES) {
            detailFetches++;
            reposted = await enrichRepostedUserBioForScrape(reposted, signal, deadlineMs);
        }
        addFullyLikedScrapeText(terms, seen, reposted.username);
        addFullyLikedScrapeText(terms, seen, reposted.displayName);
        if (sources.bio) addFullyLikedScrapeText(terms, seen, reposted.bio);
    }

    return Date.now() <= deadlineMs;
}

function extractFollowingItemsForScrape(data) {
    const directArrays = [
        data?.results,
        data?.users,
        data?.following,
        data?.follows,
        data?.relationships,
        data?.data,
        data?.data?.results,
        data?.data?.users,
        data?.data?.following,
        data?.data?.follows
    ].filter(Array.isArray);

    if (directArrays.length > 0) {
        const directItems = directArrays.flat();
        if (directItems.some(item => normalizeFollowingProfileForScrape(item))) return directItems;
    }

    const found = [];
    const visit = (value, depth = 0) => {
        if (!value || depth > 4) return;
        if (Array.isArray(value)) {
            const profileLikeCount = value.filter(item => normalizeFollowingProfileForScrape(item)).length;
            if (profileLikeCount > 0) {
                found.push(...value);
                return;
            }
            value.forEach(item => visit(item, depth + 1));
            return;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(child => visit(child, depth + 1));
        }
    };

    visit(data);
    return found;
}

function getRandomFollowingPages() {
    const pages = Array.from({ length: MAX_FOLLOWING_PAGES }, (_, page) => page);
    for (let i = pages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pages[i], pages[j]] = [pages[j], pages[i]];
    }
    return pages;
}

async function fetchFollowingProfilesForScrape(signal, deadlineMs = Date.now() + FOLLOWING_PRELOAD_TIME_BUDGET_MS) {
    const endpointBuilders = [
        page => `https://vsco.co/api/2.0/users/me/following?page=${page}&size=${FOLLOWING_PAGE_SIZE}`,
        page => `https://vsco.co/api/2.0/follows?page=${page}&size=${FOLLOWING_PAGE_SIZE}`
    ];

    for (const buildUrl of endpointBuilders) {
        if (Date.now() > deadlineMs) break;
        const profiles = [];
        const seen = new Set();
        const pages = getRandomFollowingPages();

        for (const page of pages) {
            if (Date.now() > deadlineMs) break;
            const { data, error } = await fetchWithRetry(buildUrl(page), signal, `Following p${page}`, {
                silentAuth: true,
                timeoutMs: Math.min(OPTIONAL_API_TIMEOUT_MS, Math.max(1000, deadlineMs - Date.now())),
                maxRetries: 1
            });
            if (error === 'auth') break;
            if (error || !data) break;

            const items = extractFollowingItemsForScrape(data);
            if (items.length === 0) break;

            let addedThisPage = 0;
            items.forEach(item => {
                const profile = normalizeFollowingProfileForScrape(item);
                if (!profile) return;
                const key = String(profile.siteId || profile.username).toLowerCase();
                if (!key || seen.has(key)) return;
                seen.add(key);
                profiles.push(profile);
                addedThisPage++;
            });

            if (addedThisPage === 0) break;
        }

        if (profiles.length > 0) return { profiles, authError: false };
    }

    return { profiles: [], authError: false };
}

async function enrichFollowingProfileForScrape(profile, terms, seen, sources, includeDetails, includeDescriptions, signal, deadlineMs) {
    if (Date.now() > deadlineMs) return false;
    let enriched = { ...profile };

    if (includeDetails && sources.bio && profile.username && !profile.bio) {
        const { data } = await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(profile.username)}&page=0&size=5`, signal, `Profile bio ${profile.username}`, {
            silentAuth: true,
            timeoutMs: OPTIONAL_API_TIMEOUT_MS,
            maxRetries: 1
        });
        const grids = data?.results || data?.grids || [];
        const match = grids.find(g => {
            const sameSite = profile.siteId && String(g.siteId) === String(profile.siteId);
            const sameUser = profile.username && String(g.siteSubDomain || '').toLowerCase() === String(profile.username).toLowerCase();
            return sameSite || sameUser;
        });
        if (match) {
            enriched = {
                ...enriched,
                siteId: String(match.siteId || enriched.siteId),
                username: match.siteSubDomain || enriched.username,
                displayName: match.userName || enriched.displayName,
                bio: match.gridName || enriched.bio
            };
        }
    }

    if (sources.usernames) {
        addFullyLikedScrapeText(terms, seen, enriched.username);
        addFullyLikedScrapeText(terms, seen, enriched.displayName);
    }
    if (sources.bio) {
        addFullyLikedScrapeText(terms, seen, enriched.bio);
    }

    if (!includeDescriptions || !enriched.siteId || Date.now() > deadlineMs) return Date.now() <= deadlineMs;

    const rawItems = await fetchProfileMedia3(enriched.siteId, signal, deadlineMs, enriched.username);
    if (rawItems.length) {

        const toSave = [];
        rawItems.forEach(item => {
            const img = { ...(item.image || item) };
            if (!img) return;
            if (!img.imageId && img._id) img.imageId = img._id;
            if (!img.imageId && img.id) img.imageId = img.id;
            if (!img.imageId) return;

            if (!img.grid) img.grid = { siteId: enriched.siteId, subdomain: enriched.username };
            img.sourceQuery = `Followed profile: ${enriched.username || enriched.siteId}`;
            if (img.description) addFullyLikedScrapeText(terms, seen, img.description);
            toSave.push(img);
        });

        if (toSave.length > 0) {
            await saveToVaultDB(toSave);
            masterScrapeCount += toSave.length;
        }
    }
    return Date.now() <= deadlineMs;
}

// 3.0 returns { media: [{ type, image }], next_cursor }. Keep enrichment on
// this endpoint so descriptions, dates, EXIF and location fields share one
// stable response shape with image discovery.
let profileMediaRequestChain = Promise.resolve();
let profileMediaLastRequestAt = 0;

function enqueueProfileMediaRequest(task, signal) {
    const run = profileMediaRequestChain.then(async () => {
        if (signal?.aborted) throw makeAbortError();
        const waitMs = Math.max(0, PROFILE_MEDIA_REQUEST_MIN_INTERVAL_MS - (Date.now() - profileMediaLastRequestAt));
        await waitForRequestDelay(waitMs, signal);
        if (signal?.aborted) throw makeAbortError();
        profileMediaLastRequestAt = Date.now();
        return task();
    });
    profileMediaRequestChain = run.catch(() => undefined);
    return run;
}

async function fetchProfileMedia3(siteId, signal, deadlineMs = Date.now() + OPTIONAL_API_TIMEOUT_MS, label = siteId, maxPages = PROFILE_MEDIA_MAX_PAGES) {
    const items = [];
    let cursor = '';
    for (let page = 0; page < maxPages && Date.now() <= deadlineMs; page++) {
        const params = new URLSearchParams({ site_id: String(siteId), limit: '10' });
        if (cursor) params.set('cursor', cursor);
        const { data, error } = await enqueueProfileMediaRequest(
            () => fetchWithRetry(
                `https://vsco.co/api/3.0/medias/profile?${params.toString()}`,
                signal,
                `Profile media ${label}`,
                { silentAuth: true, timeoutMs: OPTIONAL_API_TIMEOUT_MS, maxRetries: 1 }
            ),
            signal
        );
        if (error || !data) break;
        const pageItems = Array.isArray(data.media) ? data.media : [];
        items.push(...pageItems);
        const next = String(data.next_cursor || '');
        if (!next || next === cursor || pageItems.length === 0) break;
        cursor = next;
    }
    return items;
}

async function addFollowedImageDescriptionDiagnosticTerms(profile, group, signal, deadlineMs) {
    if (!profile?.siteId || Date.now() > deadlineMs) return true;
    const rawItems = await fetchProfileMedia3(profile.siteId, signal, deadlineMs, profile.username || profile.siteId);
    if (rawItems.length) {
        rawItems.slice(0, 25).forEach(item => {
            const img = item.image || item;
            addDiagnosticTextTerms(group, img?.description);
        });
    }
    return Date.now() <= deadlineMs;
}

async function getFollowedScrapeTerms(signal) {
    const sources = getFollowedScrapeSources();
    if (!hasEnabledFollowedScrapeInputs(sources)) {
        return { terms: [], authError: false, disabled: true };
    }
    const deadlineMs = Date.now() + (appSettings.followedScrapeRepostedUsers ? FOLLOWING_REPOST_TIME_BUDGET_MS : FOLLOWING_PRELOAD_TIME_BUDGET_MS);
    const { profiles, authError } = await fetchFollowingProfilesForScrape(signal, deadlineMs);
    if (authError || profiles.length === 0) return { terms: [], authError };

    const terms = [];
    const seen = new Set();
    const repostProfileKeys = new Set(
        shuffleArray(profiles.slice())
            .slice(0, MAX_FOLLOWING_REPOST_PROFILES)
            .map(profile => String(profile.siteId || profile.username || '').toLowerCase())
            .filter(Boolean)
    );

    for (let i = 0; i < profiles.length; i++) {
        if (Date.now() > deadlineMs) break;
        const profile = profiles[i];
        const shouldFetchRichProfile = i < MAX_FOLLOWING_SCRAPE_TERM_PROFILES;
        const hasTime = await enrichFollowingProfileForScrape(profile, terms, seen, sources, shouldFetchRichProfile, sources.imageDescriptions && shouldFetchRichProfile, signal, deadlineMs);
        if (!hasTime) break;
        const repostProfileKey = String(profile.siteId || profile.username || '').toLowerCase();
        if (repostProfileKeys.has(repostProfileKey)) {
            const hasRepostTime = await addFollowedRepostedUserTerms(profile, terms, seen, sources, signal, deadlineMs);
            if (!hasRepostTime) break;
        }
    }

    return { terms, authError: false };
}

async function loadLikedProfiles() {
    try {
        const db = await openVaultDB();
        const tx = db.transaction("liked_profiles", "readonly");
        const req = tx.objectStore("liked_profiles").getAll();
        return new Promise((resolve) => {
            req.onsuccess = () => {
                (req.result || []).forEach(p => { likedProfiles[p.siteId] = p; });
                resolve();
            };
            req.onerror = () => resolve();
        });
    } catch (e) {
        console.error('loadLikedProfiles error:', e);
    }
}

async function saveLikedProfile(profile) {
    try {
        likedProfiles[profile.siteId] = profile;
        const db = await openVaultDB();
        const tx = db.transaction("liked_profiles", "readwrite");
        tx.objectStore("liked_profiles").put(profile);
        return new Promise((resolve) => {
            tx.oncomplete = resolve;
            tx.onerror = () => resolve();
        });
    } catch (e) {
        console.error('saveLikedProfile error:', e);
    }
}

async function deleteLikedProfile(siteId) {
    try {
        delete likedProfiles[siteId];
        const db = await openVaultDB();
        const tx = db.transaction("liked_profiles", "readwrite");
        tx.objectStore("liked_profiles").delete(siteId);
        return new Promise((resolve) => {
            tx.oncomplete = resolve;
            tx.onerror = () => resolve();
        });
    } catch (e) {
        console.error('deleteLikedProfile error:', e);
    }
}

// Fetch profile info from VSCO API and save to liked_profiles store
async function fetchAndSaveLikedProfile(siteId, knownImg) {
    const sid = String(siteId);
    const existing = likedProfiles[sid];
    const now = Date.now();

    let username = knownImg?.grid?.subdomain || knownImg?.perma_subdomain || existing?.username || 'unknown';
    let displayName = knownImg?.userName || existing?.displayName || '';
    let bio = knownImg?.gridName || existing?.bio || '';
    let imageDescriptions = mergeLikedProfileDescriptions(existing?.imageDescriptions, [knownImg?.description]);
    let pfpUrl = '';

    // One lightweight site snapshot provides the PFP and profile identity fields.
    try {
        const snapshot = await fetchSiteSnapshotById(sid, username === 'unknown' ? '' : username);
        if (snapshot) {
            pfpUrl = snapshot.profileImageUrl || '';
            if (snapshot.subdomain) username = snapshot.subdomain;
            if (!displayName && snapshot.displayName) displayName = snapshot.displayName;
            if (!bio && snapshot.description) bio = snapshot.description;
        }
    } catch (e) { /* best effort */ }

    // Liking/backfilling may seed the first baseline, but must not replace an
    // older comparison baseline before an explicit PFP scan can compare it.
    let pfpHistory = existing?.pfpHistory || [];
    if (pfpUrl) {
        seedPfpBaselineIfMissing(sid, pfpUrl);
        pfpCache[sid] = pfpUrl;

        if (pfpHistory.length === 0) {
            pfpHistory.push({ url: pfpUrl, detectedAt: now });
        }
    }

    const storedPfpUrl = existing?.pfpUrl || savedPfps[sid] || pfpUrl || '';

    const profile = {
        siteId: sid,
        username,
        displayName,
        bio,
        imageDescriptions,
        pfpUrl: storedPfpUrl,
        pfpHistory,
        firstLikedAt: existing?.firstLikedAt || now,
        lastDescriptionScrapeAt: existing?.lastDescriptionScrapeAt || 0,
        lastCheckedAt: now
    };

    await saveLikedProfile(profile);
    return profile;
}

function updateFullyLikedSiteIds() {
    fullyLikedSiteIds.clear();
    fullyLikedCache = null; // Invalidate sort cache instantly
    Object.values(fullyLikedImages).forEach(img => {
        if (img.grid?.siteId) fullyLikedSiteIds.add(String(img.grid.siteId));
    });
}

function getDiscoveredSiteIdFromItem(item) {
    const value = item?.siteId || item?.site_id || item?.grid?.siteId || item?.site?.siteId || item?.site?.id;
    if (value === undefined || value === null) return '';
    const siteId = String(value).trim();
    if (!siteId || siteId === 'undefined' || siteId === 'null') return '';
    return siteId;
}

function addLimitedUniqueValue(list, value, limit = 40) {
    const text = String(value || '').trim();
    if (!text) return list || [];
    const next = Array.isArray(list) ? list.slice() : [];
    if (!next.includes(text)) next.unshift(text);
    return next.slice(0, limit);
}

function collectDiscoveredSiteIds(items, source = 'search', query = '') {
    if (!Array.isArray(items) || items.length === 0) return { added: 0, updated: 0 };

    const now = Date.now();
    let added = 0;
    let updated = 0;

    items.forEach(item => {
        const siteId = getDiscoveredSiteIdFromItem(item);
        if (!siteId) return;

        const existing = discoveredSiteIds[siteId] || {};
        const username = item?.siteSubDomain || item?.perma_subdomain || item?.grid?.subdomain || item?.site?.subdomain || existing.username || '';
        const displayName = item?.userName || item?.displayName || item?.site?.name || existing.displayName || '';
        const bio = item?.gridName || item?.grid_name || item?.bio || item?.description || existing.bio || '';
        const imageId = item?.imageId || item?._id || item?.id || item?.media_id || existing.lastImageId || '';
        const rawProfileImage = item?.site_profile_image_url || item?.gridImage || item?.responsive_url || existing.profileImage || '';
        const profileImage = isVscoDefaultAvatarUrl(rawProfileImage) ? '' : rawProfileImage;
        const numericSiteId = Number(siteId);

        discoveredSiteIds[siteId] = {
            ...existing,
            siteId,
            siteIdNumber: Number.isFinite(numericSiteId) ? numericSiteId : existing.siteIdNumber || null,
            username,
            displayName,
            bio,
            lastImageId: imageId,
            profileImage,
            profileUrl: username ? `https://vsco.co/${username}` : existing.profileUrl || '',
            firstSeenAt: existing.firstSeenAt || now,
            lastSeenAt: now,
            seenCount: (existing.seenCount || 0) + 1,
            sources: addLimitedUniqueValue(existing.sources, source, 20),
            queries: addLimitedUniqueValue(existing.queries, query, 80)
        };

        if (existing.siteId) updated++;
        else added++;
    });

    if (added || updated) {
        try {
            chrome.storage.local.set({ discoveredSiteIds });
        } catch (error) {
            // Keep the complete in-memory session result, but persist a compact
            // recent subset when the browser storage quota is reached.
            const compact = {};
            Object.values(discoveredSiteIds)
                .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
                .slice(0, 5000)
                .forEach(row => {
                    compact[row.siteId] = {
                        siteId: row.siteId,
                        siteIdNumber: row.siteIdNumber,
                        username: row.username,
                        displayName: row.displayName,
                        bio: row.bio,
                        profileImage: row.profileImage,
                        profileUrl: row.profileUrl,
                        firstSeenAt: row.firstSeenAt,
                        lastSeenAt: row.lastSeenAt,
                        seenCount: row.seenCount
                    };
                });
            try { chrome.storage.local.set({ discoveredSiteIds: compact }); }
            catch (compactError) { console.warn('Could not persist discovered site IDs after quota limit', compactError); }
            console.warn('Discovered site ID persistence compacted after storage quota', error);
        }
    }

    return { added, updated };
}

function deferDiscoveredSiteIdCollection(items, source = 'search', query = '') {
    const run = () => collectDiscoveredSiteIds(items, source, query);
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, { timeout: 3000 });
    } else {
        setTimeout(run, 0);
    }
}

function getSortedDiscoveredSiteIds() {
    return Object.values(discoveredSiteIds || {})
        .filter(row => row?.siteId)
        .sort((a, b) => {
            const aNum = Number(a.siteId);
            const bNum = Number(b.siteId);
            if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
            return String(a.siteId).localeCompare(String(b.siteId));
        });
}

function exportDiscoveredSiteIds() {
    const rows = getSortedDiscoveredSiteIds();
    const numericRows = rows.filter(row => Number.isFinite(Number(row.siteId)));
    const minSiteId = numericRows.length ? numericRows[0].siteId : null;
    const maxSiteId = numericRows.length ? numericRows[numericRows.length - 1].siteId : null;
    const payload = {
        metadata: {
            version: '1.0',
            exportedAt: Date.now(),
            count: rows.length,
            minSiteId,
            maxSiteId
        },
        siteIds: rows
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VSCO_Site_IDs_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (siteIdsBtn) {
        siteIdsBtn.textContent = `💾 ${rows.length}`;
        setTimeout(() => { siteIdsBtn.textContent = '💾 Site IDs'; }, 3000);
    }
    info.textContent = `Exported ${rows.length.toLocaleString()} discovered site IDs${maxSiteId ? ` · highest ${maxSiteId}` : ''}.`;
}

chrome.storage.local.get(['permanentSeenIds', 'scrapeHistory', 'customQueue', 'challengeStoredResults', 'reviewQueue', 'fullyLikedImages', 'likedQueries', 'siteIdToCollectionId', 'appSettings', 'savedPfps', 'discoveredSiteIds', 'siteEdgeState'], async (res) => {
    // Load hidden IDs from IndexedDB first (unlimited storage, no 5MB quota)
    await loadHiddenIdsFromDB();
    // Load liked profiles from dedicated IndexedDB store
    await loadLikedProfiles();

    if (res.savedPfps) savedPfps = res.savedPfps;

    // Migrate any leftover IDs from old chrome.storage.local into IDB, then remove
    if (res.permanentSeenIds && res.permanentSeenIds.length > 0) {
        let migrated = 0;
        res.permanentSeenIds.forEach(id => {
            const sid = String(id);
            if (!permanentSeenIds.has(sid)) {
                permanentSeenIds.add(sid);
                migrated++;
            }
        });
        if (migrated > 0) {
            console.log(`Migrating ${migrated} hidden IDs from chrome.storage.local to IndexedDB...`);
            await saveHiddenIdsToDB();
        }
        chrome.storage.local.remove('permanentSeenIds');
    }

    if (res.scrapeHistory) scrapeHistory = res.scrapeHistory;
    if (res.customQueue) customQueue = res.customQueue;
    if (res.reviewQueue) reviewQueue = res.reviewQueue;
    if (res.fullyLikedImages) {
        fullyLikedImages = res.fullyLikedImages;
        updateFullyLikedSiteIds();
    }
    if (res.likedQueries) res.likedQueries.forEach(q => likedQueries.add(q));
    if (res.siteIdToCollectionId) siteIdToCollectionId = res.siteIdToCollectionId;
    if (res.discoveredSiteIds) discoveredSiteIds = res.discoveredSiteIds;
    if (res.siteEdgeState) siteEdgeState = normalizeSiteEdgeState(res.siteEdgeState);
    appSettings = normalizeAppSettings(res.appSettings);
    if (pfpWorkerCountInput) pfpWorkerCountInput.value = String(appSettings.pfpScanWorkers);
    syncExifGpsToggleUI();

    // Fast-path: count old storage items if available
    if (res.challengeStoredResults) {
        masterScrapeCount += res.challengeStoredResults.length;
    }

    // Get vault count (don't load all 11M+ keys into memory)
    try {
        const vaultCount = await loadVaultObjectIdsFromDB();
        masterScrapeCount = vaultCount;
        console.log(`Vault contains ${vaultCount.toLocaleString()} images. Hidden IDs: ${permanentSeenIds.size.toLocaleString()}`);
    } catch (e) {
        console.error("Failed to count IndexedDB keys:", e);
    }

    // Migration from old storage
    if (res.challengeStoredResults && res.challengeStoredResults.length > 0) {
        console.log("Migrating vault from chrome.storage.local to IndexedDB...");
        try {
            await saveToVaultDB(res.challengeStoredResults);
            chrome.storage.local.remove('challengeStoredResults');
            console.log("Migration complete!");
        } catch (e) {
            console.error("Migration failed:", e);
        }
    }

    // Backfill liked_profiles for any existing fully-liked users missing from the store.
    // Phase 1: Seed from local vault data (no API calls, instant).
    // Phase 2: Enrich with API calls in the background for anything still missing.
    if (fullyLikedSiteIds.size > 0) {
        const missingIds = new Set();
        fullyLikedSiteIds.forEach(sid => {
            if (!likedProfiles[sid]) missingIds.add(sid);
        });
        if (missingIds.size > 0) {
            console.log(`Backfilling ${missingIds.size} liked profiles from local vault...`);

            // Phase 1: Scan vault for profile data we already have locally
            try {
                const db = await openVaultDB();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readonly');
                    const req = tx.objectStore('images').openCursor();
                    const seeded = {}; // siteId -> {username, pfpUrl, latestUpload}
                    req.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (!cursor) {
                            resolve(seeded);
                            return;
                        }
                        const item = cursor.value;
                        const sid = String(item.grid?.siteId || item.siteId || item.site_id);
                        if (sid && missingIds.has(sid)) {
                            if (!seeded[sid]) {
                                seeded[sid] = { username: '', pfpUrl: '', latestUpload: 0 };
                            }
                            const s = seeded[sid];
                            const sub = item.grid?.subdomain || item.perma_subdomain || '';
                            if (sub && (!s.username || s.username === 'unknown')) s.username = sub;

                            const t = getTimestamp(item);
                            if (t > s.latestUpload) {
                                s.latestUpload = t;
                                // Use PFP from latest upload (most current)
                                if (item.site_profile_image_url) {
                                    s.pfpUrl = normalize(item.site_profile_image_url);
                                }
                            }
                        }
                        cursor.continue();
                    };
                    req.onerror = () => reject(req.error);
                }).then(async (seeded) => {
                    const now = Date.now();
                    for (const sid of Object.keys(seeded)) {
                        const s = seeded[sid];
                        const pfpHistory = [];
                        if (s.pfpUrl) pfpHistory.push({ url: s.pfpUrl, detectedAt: now });
                        // Also check savedPfps for a baseline
                        if (savedPfps[sid] && savedPfps[sid] !== s.pfpUrl) {
                            pfpHistory.unshift({ url: savedPfps[sid], detectedAt: now });
                            if (!s.pfpUrl) s.pfpUrl = savedPfps[sid];
                        }
                        await saveLikedProfile({
                            siteId: sid,
                            username: s.username || 'unknown',
                            displayName: '',
                            bio: '',
                            imageDescriptions: [],
                            pfpUrl: s.pfpUrl,
                            pfpHistory,
                            firstLikedAt: now,
                            lastCheckedAt: now
                        });
                        missingIds.delete(sid);
                    }
                    console.log(`Seeded ${Object.keys(seeded).length} profiles from vault. ${missingIds.size} still need API calls.`);
                });
            } catch (e) {
                console.warn('Vault backfill scan failed:', e);
            }

            // Phase 2: For any remaining (no vault data at all), fetch from API in background
            if (missingIds.size > 0) {
                setTimeout(async () => {
                    console.log(`Enriching ${missingIds.size} profiles via API...`);
                    for (const sid of missingIds) {
                        const knownImg = Object.values(fullyLikedImages).find(img => String(img.grid?.siteId) === sid) || { grid: { siteId: sid } };
                        try {
                            await fetchAndSaveLikedProfile(sid, knownImg);
                        } catch (e) {
                            console.warn('Backfill failed for', sid, e);
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    console.log(`API backfill complete.`);
                }, 3000);
            }
        }
    }

    // Check URL params for specific views
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');
    if (viewParam === 'review') {
        showReviewQueue();
    } else if (viewParam === 'liked') {
        showFullyLiked();
    }
});


const profileCache = {}; // siteId -> media[]

// ============ AUTO-PFP STATE ============
let autoPfpEnabled = false;
let autoPfpQueue = [];       // cards waiting to be fetched
let autoPfpProcessing = false;
let autoPfpObserver = null;  // IntersectionObserver instance
let autoPfpAbort = null;     // AbortController for cancelling PFP fetches
let profilePrefetchQueue = [];
let profilePrefetchProcessing = false;
let profilePrefetchObserver = null;
let profilePrefetchAbort = null;
let profilePrefetchQueuedSites = new Set();
const profilePrefetchCache = {}; // siteId -> [{...media}]
const profilePrefetchPending = {}; // siteId -> Promise<media[]>

// ============ GLOBAL MAP STATE ============
let headerMap = null;
let headerMapMarkers = [];
let headerMapPinCount = 0;

// ============ PATTERN MATCHING ============
// Supports wildcards (* = any chars, ? = single char), boolean (AND, OR, NOT), "exact phrase"
// Examples: "*son", "jo*", "?ohn", "john AND doe", "john OR jane", "NOT smith", '"exact match"'

// Detect if a query uses pattern syntax → auto-enable client-side filtering
function hasPatternSyntax(query) {
    const q = query.trim();
    return /[*?]/.test(q) ||                    // wildcards
        /\s+AND\s+/i.test(q) ||              // AND
        /\s+OR\s+/i.test(q) ||               // OR
        /^NOT\s+/i.test(q) ||                // NOT prefix
        (q.startsWith('"') && q.endsWith('"')) || // "quoted exact"
        /[,\n;]/.test(q);                    // simple multi-term separators
}

function splitMultiQueryTerms(query) {
    return query
        .split(/(?:\s+OR\s+|[\n,;]+)/i)
        .map(part => part.trim())
        .filter(Boolean);
}

// Extract API queries from a pattern query.
// Returns an ARRAY of queries — each one becomes a separate API call (up to 10k each).
// OR → separate API calls (to maximize result count)
// AND → single combined query (API returns results matching both)
// e.g. "beach AND sunset" → ["beach sunset"]
// e.g. "beach OR sunset" → ["beach", "sunset"]
// e.g. "👙 beach OR 👙 pool OR 👙 summer" → ["👙 beach", "👙 pool", "👙 summer"]
// e.g. "NOT boring" → ["boring"]
// e.g. "*son" → ["son"]
// e.g. '"exact phrase"' → ["exact phrase"]
function extractApiQueries(query) {
    const q = query.trim();

    // "quoted exact" — just strip quotes
    if (q.startsWith('"') && q.endsWith('"') && q.length > 2) {
        return [q.slice(1, -1)];
    }

    const simpleMultiTerms = splitMultiQueryTerms(q);
    if (simpleMultiTerms.length > 1 && !/\s+AND\s+/i.test(q) && !/^NOT\s+/i.test(q) && !/[*?]/.test(q)) {
        return [...new Set(simpleMultiTerms)];
    }

    // Split on OR first — each OR branch becomes a separate API call
    const orBranches = q.split(/\s+OR\s+/i).map(b => b.trim()).filter(b => b.length > 0);

    const queries = orBranches.map(branch => {
        // Within each OR branch, AND terms get combined into one query
        let terms = branch
            .split(/\s+AND\s+/i)
            .map(t => t.trim())
            .map(t => t.replace(/^NOT\s+/i, ''))
            .map(t => t.replace(/[*?]/g, ''))
            .map(t => t.trim())
            .filter(t => t.length > 0);
        return terms.join(' ');
    }).filter(q => q.length > 0);

    return [...new Set(queries)];
}

function matchesPattern(text, pattern) {
    text = text.toLowerCase();
    pattern = pattern.toLowerCase().trim();
    if (!pattern) return false;

    // "Quoted exact phrase" — must contain the exact phrase as substring
    if (pattern.startsWith('"') && pattern.endsWith('"') && pattern.length > 2) {
        const phrase = pattern.slice(1, -1);
        return text.includes(phrase);
    }

    // Boolean OR — split on " OR " (case-insensitive in pattern, already lowered)
    if (pattern.includes(' or ')) {
        return pattern.split(/\s+or\s+/).some(p => matchesPattern(text, p.trim()));
    }

    // Boolean AND — split on " AND "
    if (pattern.includes(' and ')) {
        return pattern.split(/\s+and\s+/).every(p => matchesPattern(text, p.trim()));
    }

    // Boolean NOT — prefix "NOT "
    if (pattern.startsWith('not ')) {
        return !matchesPattern(text, pattern.slice(4).trim());
    }

    // Wildcard matching: convert glob pattern to regex
    // * = one or more characters, ? = exactly one character
    // Searches within the text with word boundary awareness
    if (pattern.includes('*') || pattern.includes('?')) {
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\?/g, '\x00')
            .replace(/\*/g, '.+')
            .replace(/\x00/g, '.');
        return new RegExp(escaped).test(text);
    }

    // Default: word-boundary-aware match for multi-word terms, substring for single words
    if (pattern.includes(' ')) {
        // Multi-word: use word boundaries to avoid partial matches
        try {
            const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
        } catch (e) {
            return text.includes(pattern);
        }
    }
    return text.includes(pattern);
}

function getGridSearchFieldMode(searchType) {
    if (gridFieldFilter?.value) return gridFieldFilter.value;
    return searchType === 'bio' ? 'bio' : 'people';
}

function getGridSearchFieldLabel(fieldMode) {
    const labels = {
        people: 'name',
        username: 'username',
        bio: 'bio',
        domain: 'domain',
        siteId: 'site ID',
        all: 'all fields'
    };
    return labels[fieldMode] || 'name';
}

function getGridSearchFieldValues(person) {
    return {
        people: [person.userName || '', person.displayName || ''],
        username: [person.siteSubDomain || '', person.perma_subdomain || '', person.subdomain || ''],
        bio: [person.gridName || '', person.bio || '', person.description || ''],
        domain: [person.siteDomain || ''],
        siteId: [person.siteId || '', person.site_id || '']
    };
}

// Test a grid/person record against a pattern using the selected client-side field.
function personMatchesFilter(person, pattern, searchType) {
    const fieldMode = getGridSearchFieldMode(searchType);
    const fields = getGridSearchFieldValues(person);
    const values = fieldMode === 'all'
        ? Object.values(fields).flat()
        : fields[fieldMode] || fields.people;

    return values.some(value => matchesPattern(String(value || ''), pattern));
}

// ============ IMAGE SEARCH FILTER ============

function getDisplayResults() {
    if (aspectFilterMode === 'vertical') {
        const matches = allResults.filter(item => item?._aspectMeasured === true && item?._isTallVertical === true);
        if (matches.length > 0) return matches;
        return allResults.filter(item => item?._aspectMeasured !== true).slice(0, PAGE_SIZE);
    }
    if (aspectFilterMode === 'horizontal') {
        const matches = allResults.filter(item => item?._aspectMeasured === true && item?._isWideHorizontal === true);
        if (matches.length > 0) return matches;
        return allResults.filter(item => item?._aspectMeasured !== true).slice(0, PAGE_SIZE);
    }
    return allResults;
}

function filterByAspectSnapshot(items) {
    if (aspectFilterMode === 'vertical') {
        const matches = items.filter(item => item?._aspectMeasured === true && item?._isTallVertical === true);
        return matches.length > 0 ? matches : items.filter(item => item?._aspectMeasured !== true);
    }
    if (aspectFilterMode === 'horizontal') {
        const matches = items.filter(item => item?._aspectMeasured === true && item?._isWideHorizontal === true);
        return matches.length > 0 ? matches : items.filter(item => item?._aspectMeasured !== true);
    }
    return items;
}

function markImageAspect(item, width, height, card = null) {
    const w = Number(width);
    const h = Number(height);
    if (!item || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

    item._naturalWidth = w;
    item._naturalHeight = h;
    item._aspectRatio = w / h;
    item._aspectTallness = h / w;
    item._isTallVertical = item._aspectTallness >= TALL_VERTICAL_ASPECT_THRESHOLD;
    item._isWideHorizontal = item._aspectRatio >= WIDE_HORIZONTAL_ASPECT_THRESHOLD;
    item._aspectMeasured = true;

    if (card) {
        card.dataset.aspectChecked = '1';
        card.dataset.aspectTallVertical = item._isTallVertical ? '1' : '0';
        card.dataset.aspectWideHorizontal = item._isWideHorizontal ? '1' : '0';
        card.dataset.aspectLabel = `${w}x${h} · ${item._aspectTallness.toFixed(2)} tallness`;
    }
}

function trackCardImageAspect(card, item) {
    const imgEl = card?.querySelector?.('.card-img');
    if (!imgEl || !item) return;

    const record = () => markImageAspect(item, imgEl.naturalWidth, imgEl.naturalHeight, card);
    if (imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
        record();
    } else {
        imgEl.addEventListener('load', record, { once: true });
    }
}

function trackPersonCardImageAspect(card, person) {
    const imgEls = [...(card?.querySelectorAll?.('.person-main-img') || [])];
    if (!imgEls.length || !person) return;

    const record = () => {
        let measured = 0;
        let tallest = 0;
        let widest = 0;
        let bestTallWidth = 0;
        let bestTallHeight = 0;

        imgEls.forEach(imgEl => {
            const w = Number(imgEl.naturalWidth);
            const h = Number(imgEl.naturalHeight);
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
            measured++;
            const tallness = h / w;
            const wideness = w / h;
            if (tallness > tallest) {
                tallest = tallness;
                bestTallWidth = w;
                bestTallHeight = h;
            }
            if (wideness > widest) widest = wideness;
        });

        if (!measured) return;
        person._naturalWidth = bestTallWidth;
        person._naturalHeight = bestTallHeight;
        person._aspectRatio = bestTallHeight ? bestTallWidth / bestTallHeight : 0;
        person._aspectTallness = tallest;
        person._isTallVertical = tallest >= TALL_VERTICAL_ASPECT_THRESHOLD;
        person._isWideHorizontal = widest >= WIDE_HORIZONTAL_ASPECT_THRESHOLD;
        person._aspectMeasured = true;

        card.dataset.aspectChecked = '1';
        card.dataset.aspectTallVertical = person._isTallVertical ? '1' : '0';
        card.dataset.aspectWideHorizontal = person._isWideHorizontal ? '1' : '0';
        card.dataset.aspectLabel = `${bestTallWidth}x${bestTallHeight} · ${tallest.toFixed(2)} tallness`;
    };

    imgEls.forEach(imgEl => {
        if (imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
            record();
        } else {
            imgEl.addEventListener('load', record, { once: true });
        }
    });
}

function getTotalPages() {
    const display = getDisplayResults();
    return Math.max(1, Math.ceil(display.length / PAGE_SIZE));
}

function clampCurrentPage() {
    currentPage = Math.min(Math.max(0, currentPage), getTotalPages() - 1);
}

function getCurrentPageItems() {
    const display = getDisplayResults();
    const count = Math.max(displayedCount || PAGE_SIZE, PAGE_SIZE);
    return display.slice(0, count);
}

function getCurrentPageVisibleCount(pageItems = getCurrentPageItems()) {
    if (!exifGpsFilterOnly) return pageItems.length;
    return pageItems.reduce((count, item) => count + (itemHasExifGpsMetadata(item) ? 1 : 0), 0);
}

function resetPagination() {
    currentPage = 0;
    displayedCount = PAGE_SIZE;
}

// ============ HELPERS ============
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalize(url) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return "https:" + url;
    return "https://" + url;
}

function getVscoImageId(item) {
    const candidates = [
        item?.imageId,
        item?._id,
        item?.id,
        item?.media_id,
        item?.gridImageId,
        item?.gridImage?.imageId,
        item?.gridImage?._id,
        item?.gridImage?.id
    ];
    for (const value of candidates) {
        const id = String(value || '').trim();
        if (!id || id === 'undefined' || id === 'null') continue;
        return id;
    }
    return '';
}

function getVscoDisplayImageUrl(item, fallbackUrl = '') {
    // Search responses already include a resized CDN image. Prefer it for display;
    // i.vsco.co originals are heavier and may be blocked even when the API succeeds.
    const responsiveUrl = normalize(fallbackUrl || item?.responsive_url || item?.image_url || item?.site_profile_image_url || '');
    if (responsiveUrl) return responsiveUrl;
    const imageId = getVscoImageId(item);
    if (imageId) return `https://i.vsco.co/${imageId}`;
    return '';
}

function loadImageWithFallback(imgEl, candidates) {
    if (!imgEl) return;
    const urls = [...new Set((candidates || []).map(normalize).filter(Boolean))];
    if (!urls.length) return;

    let index = 0;
    const tryNext = () => {
        index++;
        if (index < urls.length) {
            imgEl.src = urls[index];
            return;
        }
        imgEl.removeEventListener('error', tryNext);
        imgEl.dataset.imageFailed = 'true';
    };

    imgEl.addEventListener('error', tryNext);
    imgEl.src = urls[0];
}

const vscoAssetCache = new Map();
const vscoAssetPending = new Map();

function getGpsFromExif(exif) {
    if (!exif) return null;
    if (exif.GPSLatitude && Array.isArray(exif.GPSLatitude) && exif.GPSLatitude.length === 3 &&
        exif.GPSLongitude && Array.isArray(exif.GPSLongitude) && exif.GPSLongitude.length === 3 &&
        exif.GPSLatitudeRef && exif.GPSLongitudeRef) {
        const lat = convertDMSToDD(exif.GPSLatitude[0], exif.GPSLatitude[1], exif.GPSLatitude[2], exif.GPSLatitudeRef);
        const lng = convertDMSToDD(exif.GPSLongitude[0], exif.GPSLongitude[1], exif.GPSLongitude[2], exif.GPSLongitudeRef);
        if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            return { lat, lng, exif };
        }
    }
    return null;
}

async function fetchVscoAsset(imageId) {
    const id = extractVscoImageId(imageId);
    if (!id) return null;
    if (vscoAssetCache.has(id)) return vscoAssetCache.get(id);
    if (vscoAssetPending.has(id)) return vscoAssetPending.get(id);

    const pending = (async () => {
        const url = `https://i.vsco.co/${id}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const buf = await resp.arrayBuffer();
        const exif = EXIF.readFromBinaryFile(buf);
        const gps = getGpsFromExif(exif);
        const asset = { imageId: id, url: resp.url || url, exif: exif || null, gps: gps || null };
        vscoAssetCache.set(id, asset);
        return asset;
    })().catch(e => {
        console.warn('VSCO asset fetch error for', id, e);
        return null;
    }).finally(() => {
        vscoAssetPending.delete(id);
    });

    vscoAssetPending.set(id, pending);
    return pending;
}

async function loadVscoImageIntoElement(imgEl, item, fallbackUrl = '') {
    if (!imgEl) return null;
    const imageId = getVscoImageId(item);
    if (!imageId) {
        const fallback = normalize(fallbackUrl || item?.responsive_url || item?.image_url || item?.site_profile_image_url || '');
        if (fallback) imgEl.src = fallback;
        return null;
    }

    imgEl.dataset.vscoImageId = imageId;
    loadImageWithFallback(imgEl, [
        getVscoDisplayImageUrl(item, fallbackUrl),
        `https://i.vsco.co/${imageId}`
    ]);
    imgEl.style.opacity = '1';

    if (!appSettings.gpsEnabled || !exifGpsFilterOnly) {
        return null;
    }

    const asset = await fetchVscoAsset(imageId);
    if (!asset) {
        imgEl.src = getVscoDisplayImageUrl(item, fallbackUrl);
        imgEl.style.opacity = '1';
        return null;
    }

    if (asset.gps && item && typeof item === 'object') {
        attachExifGpsToItem(item, asset.gps, asset.url);
        const card = imgEl.closest('.card');
        if (card) {
            card.dataset.hasExifGps = 'true';
            addExifGpsBadge(card, asset.gps);
            updateExifGpsCardVisibility(card);
        }
    }
    updateInfo();

    return asset;
}

function addIdentityId(ids, value) {
    if (value === undefined || value === null) return;
    const id = String(value).trim();
    if (!id || id === 'undefined' || id === 'null') return;
    ids.add(id);
}

function getItemIdentityIds(item, options = {}) {
    const includeSiteId = options.includeSiteId !== false;
    const ids = new Set();
    addIdentityId(ids, item?.imageId);
    addIdentityId(ids, item?._id);
    addIdentityId(ids, item?.id);
    addIdentityId(ids, item?.media_id);
    addIdentityId(ids, item?.mediaId);
    addIdentityId(ids, item?.image?.imageId);
    addIdentityId(ids, item?.image?._id);
    addIdentityId(ids, item?.image?.id);
    addIdentityId(ids, item?.media?.imageId);
    addIdentityId(ids, item?.media?._id);
    addIdentityId(ids, item?.media?.id);

    if (includeSiteId) {
        addIdentityId(ids, item?.grid?.siteId);
        addIdentityId(ids, item?.siteId);
        addIdentityId(ids, item?.site_id);
        addIdentityId(ids, item?.site?.siteId);
        addIdentityId(ids, item?.site?.id);
    }

    return [...ids];
}

function getItemPrimaryId(item) {
    return getItemIdentityIds(item, { includeSiteId: false })[0] || '';
}

function getItemSiteId(item) {
    const value = item?.grid?.siteId || item?.siteId || item?.site_id || item?.site?.siteId || item?.site?.id;
    if (value === undefined || value === null) return '';
    const siteId = String(value).trim();
    if (!siteId || siteId === 'undefined' || siteId === 'null') return '';
    return siteId;
}

function getItemUsername(item) {
    return item?.grid?.subdomain || item?.perma_subdomain || item?.userName || item?.siteSubDomain || item?.site?.subdomain || 'unknown';
}

function getItemProfilePicUrl(item) {
    const url = item?.site_profile_image_url || (item?.isProfile ? item?.responsive_url : '') || '';
    return url ? normalize(url) : '';
}

function isHiddenItem(item) {
    return getItemIdentityIds(item).some(id => permanentSeenIds.has(id));
}

function markItemHidden(item) {
    getItemIdentityIds(item).forEach(id => permanentSeenIds.add(id));
}

function getTimestamp(item) {
    // Normal image-search results are not guaranteed to put the media ObjectId
    // in the same field. Find a real ObjectId first instead of parsing any
    // arbitrary id as hexadecimal and accidentally leaving the API order intact.
    for (const id of getItemIdentityIds(item, { includeSiteId: false })) {
        if (!/^[0-9a-f]{24}$/i.test(id)) continue;
        const ts = parseInt(id.slice(0, 8), 16);
        if (Number.isFinite(ts) && ts > 0) return ts * 1000;
    }

    const raw = item?.upload_date ?? item?.uploadDate ?? item?.published_at ??
        item?.publishedAt ?? item?.created_at ?? item?.createdAt ?? item?.timestamp ?? 0;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 100000000000 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(String(raw || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function compareNewestUpload(a, b) {
    const timestampDifference = getTimestamp(b) - getTimestamp(a);
    if (timestampDifference) return timestampDifference;
    return getItemPrimaryId(b).localeCompare(getItemPrimaryId(a));
}

function getProfilePicTimestamp(item) {
    const site = item?.site || {};
    const url = item.site_profile_image_url || item.responsive_url || site.profile_image || site.responsive_url || '';
    if (!url) return 0;
    const parts = url.split('/');
    const last = parts[parts.length - 1];
    if (/^[0-9a-f]{24}$/.test(last)) {
        const ts = parseInt(last.slice(0, 8), 16);
        if (!isNaN(ts) && ts > 1e9) return ts * 1000;
    }
    return 0;
}

function formatTimeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (hrs < 24) return `${hrs}h`;
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
}

// ============ GLOBAL HEADER MAP ============

function initHeaderMap() {
    if (headerMap) return; // already initialized
    const mapEl = document.getElementById('header-map');
    if (!mapEl) return;

    mapEl.classList.add('visible');
    L.Icon.Default.imagePath = 'images/';

    headerMap = L.map(mapEl, { zoomControl: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
        maxZoom: 19
    }).addTo(headerMap);

    // Click to toggle expanded
    mapEl.addEventListener('click', (e) => {
        // Don't toggle if clicking a popup or marker
        if (e.target.closest('.leaflet-popup') || e.target.closest('.leaflet-marker-icon')) return;
        mapEl.classList.toggle('expanded');
        // Add/remove zoom control based on expanded state
        if (mapEl.classList.contains('expanded')) {
            L.control.zoom({ position: 'topright' }).addTo(headerMap);
        } else {
            mapEl.querySelectorAll('.leaflet-control-zoom').forEach(z => z.remove());
        }
        setTimeout(() => headerMap.invalidateSize(), 350);
    });

    setTimeout(() => headerMap.invalidateSize(), 150);
}

function showHeaderMap() {
    const mapEl = document.getElementById('header-map');
    if (mapEl) mapEl.classList.add('visible');
    if (headerMap) setTimeout(() => headerMap.invalidateSize(), 100);
}

function hideHeaderMap() {
    const mapEl = document.getElementById('header-map');
    if (mapEl) mapEl.classList.remove('visible');
}

function clearHeaderMap() {
    if (!headerMap) return;
    headerMapMarkers.forEach(m => headerMap.removeLayer(m));
    headerMapMarkers = [];
    headerMapPinCount = 0;
    updateMapPinCount();
}

function updateMapPinCount() {
    const mapEl = document.getElementById('header-map');
    if (!mapEl) return;
    let badge = mapEl.querySelector('.map-pin-count');
    if (headerMapPinCount === 0) {
        if (badge) badge.remove();
        return;
    }
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'map-pin-count';
        mapEl.appendChild(badge);
    }
    badge.textContent = `📍 ${headerMapPinCount} pins`;
}

// ============ EXIF GPS EXTRACTION ============
// Converts EXIF DMS (Degrees/Minutes/Seconds) + ref (N/S/E/W) to decimal degrees
function convertDMSToDD(d, m, s, ref) {
    d = Number(d) || 0;
    m = Number(m) || 0;
    s = Number(s) || 0;
    let dd = d + m / 60 + s / 3600;
    ref = String(ref).toUpperCase();
    if (ref === 'S' || ref === 'W') dd = -dd;
    return dd;
}

// Fetch original image from i.vsco.co and extract EXIF GPS
async function fetchExifGPS(imageId) {
    try {
        const asset = await fetchVscoAsset(imageId);
        return asset?.gps || null;
    } catch (e) {
        console.warn('EXIF fetch error for', imageId, e);
        return null;
    }
}

const exifGpsCheckedImageIds = new Set();
const exifGpsPendingByImageId = new Map();
let exifGpsCardObserver = null;
let exifGpsScanSource = null;
let exifGpsScanIndex = 0;
let exifGpsScanRunning = false;
let exifGpsScanRefreshTimer = null;

function extractVscoImageId(value) {
    const match = String(value || '').match(/([a-f0-9]{24})/i);
    return match ? match[1].toLowerCase() : '';
}

function addExifGpsBadge(card, result) {
    if (!appSettings.gpsEnabled) return;
    if (!card || card.querySelector('.exif-gps-badge')) return;
    const imgWrap = card.querySelector('.card-img-wrap');
    if (!imgWrap) return;

    const badge = document.createElement('div');
    badge.className = 'card-overlay exif-gps-badge';
    badge.style.top = '46px';
    badge.style.left = '8px';
    badge.style.right = 'auto';
    badge.style.zIndex = '6';

    const label = document.createElement('span');
    label.className = 'time-badge';
    label.style.background = 'rgba(230, 126, 34, 0.95)';
    label.style.borderColor = 'rgba(255, 255, 255, 0.25)';
    label.textContent = '📍 GPS';
    if (result && typeof result.lat === 'number' && typeof result.lng === 'number') {
        label.title = `${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
    }

    badge.appendChild(label);
    imgWrap.appendChild(badge);
}

function buildExifGpsDetails(result, imageUrl = '') {
    if (!result || typeof result.lat !== 'number' || typeof result.lng !== 'number') return null;
    return {
        source: 'i.vsco.co',
        detectedAt: new Date().toISOString(),
        imageUrl: imageUrl || '',
        lat: result.lat,
        lng: result.lng,
        location_coords: { lat: result.lat, lng: result.lng },
        exif: result.exif || null
    };
}

function attachExifGpsToItem(item, result, imageUrl = '') {
    if (!item) return null;
    const details = buildExifGpsDetails(result, imageUrl);
    if (!details) return item;

    item.hasExifGps = true;
    item.exifGps = details;
    item.location_coords = details.location_coords;
    item.has_location = true;
    item.exifdata = details.exif || item.exifdata || item.exifData || null;
    item.exif = details.exif || item.exif || null;
    item.metadata = {
        ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
        hasExifGps: true,
        exifGps: details,
        exifdata: details.exif || null,
        location_coords: details.location_coords
    };
    return item;
}

function getExifGpsScanSourceItems() {
    if (mode === 'challenge') return currentVaultRawItems;
    if (mode === 'people' || mode === 'bio') return lastPeopleResults;
    if (Array.isArray(lastSearchResults) && lastSearchResults.length > 0) return lastSearchResults;
    return allResults;
}

function scheduleExifGpsFilteredRefresh() {
    return;
}

async function inspectDataItemForExifGps(item) {
    if (!appSettings.gpsEnabled) return null;
    return item?.exifGps || null;
}

async function requestExifGpsBackgroundScan(force = false) {
    if (!appSettings.gpsEnabled) return;
    return;
}

function updateExifGpsCardVisibility(card) {
    if (!card) return;
    if (!appSettings.gpsEnabled || !exifGpsFilterOnly) {
        card.style.display = '';
        card.dataset.exifGpsHidden = '0';
        return;
    }

    const hasGps = card.dataset.hasExifGps === 'true' || hasLocationMetadata(card._imgData) || card._imgData?.hasExifGps === true;
    if (hasGps && card._imgData) card._imgData.hasExifGps = true;
    card.style.display = hasGps ? '' : 'none';
    card.dataset.exifGpsHidden = hasGps ? '0' : '1';
    card.dataset.hasExifGps = hasGps ? 'true' : 'false';
}

function inspectCardForExifGps(card) {
    if (!card) return null;
    if (!appSettings.gpsEnabled) {
        updateExifGpsCardVisibility(card);
        return null;
    }
    updateExifGpsCardVisibility(card);
    return card._imgData?.exifGps || null;
}

function processExifGpsNode(node) {
    if (!appSettings.gpsEnabled) return;
    if (!(node instanceof Element)) return;
    if (node.matches('.card')) {
        inspectCardForExifGps(node);
        return;
    }

    if (node.matches('img.card-img')) {
        const card = node.closest('.card');
        if (card) inspectCardForExifGps(card);
        return;
    }

    node.querySelectorAll?.('.card').forEach(card => inspectCardForExifGps(card));
}

function initExifGpsCardMonitoring() {
    const root = document.getElementById('grid');
    if (!root) return;

    if (!exifGpsCardObserver) {
        exifGpsCardObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(processExifGpsNode);
            }
        });
        exifGpsCardObserver.observe(root, { childList: true, subtree: true });
    }

    root.querySelectorAll('.card').forEach(card => inspectCardForExifGps(card));
}

function maybePrefetchVisibleExifGpsCards() {
    return;
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initExifGpsCardMonitoring, { once: true });
} else {
    initExifGpsCardMonitoring();
}

// Add a single marker to the header map
function addPinToMap(lat, lng, img, sub) {
    if (!headerMap) return;
    const imgUrl = getVscoDisplayImageUrl(img, img.responsive_url || '');
    const phone = img.image_meta?.model || '';
    const preset = img.preset?.short_name || '';
    const uploaded = img.upload_date ? formatTimeAgo(img.upload_date) : '';
    const permalink = img.permalink || 'https://vsco.co/' + sub;

    const marker = L.marker([lat, lng]);
    marker.bindPopup(`
        <div class="map-popup">
            <a href="${escapeHtml(permalink)}" target="_blank">
                ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" style="max-width:160px;max-height:160px;border-radius:6px;display:block;">` : ''}
            </a>
            <div style="margin-top:4px;font-size:11px;color:#333;">
                <b>@${escapeHtml(sub)}</b>
            </div>
            <div style="font-size:10px;color:#666;">
                ${phone ? `📱 ${escapeHtml(phone)}` : ''}${preset ? ` · 🎨 ${escapeHtml(preset)}` : ''}${uploaded ? ` · ⏰ ${uploaded}` : ''}
            </div>
        </div>
    `, { maxWidth: 180 });
    marker.addTo(headerMap);
    headerMapMarkers.push(marker);
    headerMapPinCount++;
    updateMapPinCount();

    // Fit bounds to include all markers
    const bounds = L.latLngBounds(headerMapMarkers.map(m => m.getLatLng()));
    headerMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
    console.log(`📍 @${sub}: pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
}

// Parse location_coords — could be various formats:
// "lat,lng" string, [lat,lng] array, {lat,lng} object, or large ints needing conversion
function parseLocationCoords(coords) {
    if (!coords) return null;

    let lat, lng;

    if (typeof coords === 'string') {
        // "40.7128,-74.0060" or "40.7128, -74.0060"
        const parts = coords.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            lat = parts[0]; lng = parts[1];
        }
    } else if (Array.isArray(coords) && coords.length === 2) {
        lat = Number(coords[0]); lng = Number(coords[1]);
    } else if (typeof coords === 'object') {
        lat = Number(coords.lat || coords.latitude || coords[0]);
        lng = Number(coords.lng || coords.longitude || coords.lon || coords[1]);
    }

    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;

    // Handle microdegrees — if values are huge, they need dividing
    const absLat = Math.abs(lat), absLng = Math.abs(lng);
    if (absLat > 90 || absLng > 180) {
        // Try common scalings
        if (absLat > 1e6) { lat /= 1e7; lng /= 1e7; }
        else if (absLat > 1e4) { lat /= 1e6; lng /= 1e6; }
        else if (absLat > 180) { lat /= 1e5; lng /= 1e5; }
    }

    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && lat !== 0 && lng !== 0) {
        return { lat, lng };
    }
    return null;
}

// For a profile's media, extract locations and add pins to map
// 1. Try location_coords from the API (no extra fetch needed)
// 2. Fallback: fetch original JPEG from i.vsco.co and read EXIF GPS
async function extractAndMapLocations(media, sub) {
    if (!headerMap) initHeaderMap();
    if (!headerMap) return;

    const located = media.filter(m => m.has_location);
    if (located.length === 0) return;

    console.log(`Map @${sub}: ${located.length} images with has_location`);

    let coordsFound = 0;
    let needExif = [];

    // First pass: try location_coords from the API
    for (const img of located) {
        const parsed = parseLocationCoords(img.location_coords);
        if (parsed) {
            addPinToMap(parsed.lat, parsed.lng, img, sub);
            coordsFound++;
        } else {
            needExif.push(img);
        }
    }

    if (coordsFound > 0) {
        console.log(`Map @${sub}: ${coordsFound} pins from location_coords`);
    }

    // Second pass: EXIF fallback for images without coords in API
    for (const img of needExif) {
        let imageId = img._id || img.id;
        if (!imageId && img.responsive_url) {
            const match = img.responsive_url.match(/([a-f0-9]{24})/);
            if (match) imageId = match[1];
        }
        if (!imageId) continue;

        fetchExifGPS(imageId).then(result => {
            if (!result) return;
            addPinToMap(result.lat, result.lng, img, sub);
        });
    }
}

// ============ FETCH ============

function makeAbortError() {
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    return error;
}

function waitForRequestDelay(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(makeAbortError());

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(makeAbortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function getRetryAfterMs(resp) {
    const value = resp?.headers?.get('Retry-After');
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(value);
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function addBackoffJitter(ms) {
    const jitter = Math.floor(Math.random() * Math.max(500, Math.min(ms * 0.35, 5000)));
    return Math.min(ms + jitter, MAX_BACKOFF_MS);
}

function isGridSearchRequest(url) {
    return String(url).includes('/api/2.0/search/grids?');
}

function isHeavySearchRequest(url) {
    const value = String(url);
    return isGridSearchRequest(value)
        || (value.includes('/api/2.0/search/images?') && /[?&]size=10000(?:&|$)/.test(value));
}

function applyScraperRuntimePressure() {
    const now = Date.now();
    if (now - lastScraperLongTaskAt > 5000 && scraperLongTaskPressure > 0) {
        scraperLongTaskPressure = Math.max(0, scraperLongTaskPressure - 100);
    }

    const memory = performance?.memory;
    const heapRatio = memory?.jsHeapSizeLimit
        ? memory.usedJSHeapSize / memory.jsHeapSizeLimit
        : 0;
    if (heapRatio >= 0.82) {
        activeHeavySearchConcurrency = 1;
        adaptiveSearchGapMs = Math.max(adaptiveSearchGapMs, 1000);
    } else if (heapRatio >= 0.70) {
        activeHeavySearchConcurrency = Math.min(activeHeavySearchConcurrency, 2);
        adaptiveSearchGapMs = Math.max(adaptiveSearchGapMs, 400);
    } else if (heapRatio >= 0.58 || scraperLongTaskPressure >= 500) {
        activeHeavySearchConcurrency = Math.min(activeHeavySearchConcurrency, 3);
        adaptiveSearchGapMs = Math.max(adaptiveSearchGapMs, 150);
    }

    return heapRatio;
}

function getScraperTuningLabel() {
    const memory = performance?.memory;
    const heapPercent = memory?.jsHeapSizeLimit
        ? Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
        : null;
    return `${SCRAPER_CONCURRENCY} workers · ${activeHeavySearchConcurrency}/${HEAVY_SEARCH_MAX_CONCURRENCY} API lanes${heapPercent === null ? '' : ` · heap ${heapPercent}%`}`;
}

// AIMD-style pool: start with three lanes, ramp to four after clean successes,
// and cut concurrency immediately when VSCO returns 429.
function fetchWithGridPacing(url, fetchOptions, signal) {
    if (!isHeavySearchRequest(url)) return fetch(url, fetchOptions);

    applyScraperRuntimePressure();
    const laneCountAtSchedule = Math.max(1, activeHeavySearchConcurrency);
    const laneIndex = heavySearchLaneCursor++ % laneCountAtSchedule;
    const request = heavySearchRequestChains[laneIndex].then(async () => {
        // Recheck after every wait because another in-flight lane may extend the
        // shared cooldown while this request is queued.
        while (true) {
            const waitUntil = Math.max(nextGridRequestAt, gridRateLimitUntil);
            const waitMs = Math.max(0, waitUntil - Date.now());
            if (waitMs <= 0) break;
            await waitForRequestDelay(waitMs, signal);
        }

        const normalGap = GRID_REQUEST_MIN_INTERVAL_MS
            + Math.floor(Math.random() * GRID_REQUEST_JITTER_MS)
            + adaptiveSearchGapMs;
        nextGridRequestAt = Date.now() + normalGap;
        const resp = await fetch(url, fetchOptions);
        if (resp.status === 429) {
            const previousConcurrency = activeHeavySearchConcurrency;
            const retryMs = Math.max(getRetryAfterMs(resp), INITIAL_BACKOFF_MS);
            gridRateLimitUntil = Math.max(gridRateLimitUntil, Date.now() + retryMs);
            adaptiveSearchGapMs = Math.min(Math.max(1000, Math.round(adaptiveSearchGapMs * 1.7)), 10000);
            activeHeavySearchConcurrency = Math.max(1, activeHeavySearchConcurrency - 1);
            heavySearchSuccessStreak = 0;
            if (activeHeavySearchConcurrency !== previousConcurrency) {
                console.warn(`[adaptive search] 429: ${previousConcurrency} → ${activeHeavySearchConcurrency} heavy lanes`);
            }
        } else if (resp.ok && adaptiveSearchGapMs > 0) {
            adaptiveSearchGapMs = Math.max(0, Math.round(adaptiveSearchGapMs * 0.82) - 100);
            heavySearchSuccessStreak++;
            if (heavySearchSuccessStreak >= HEAVY_SEARCH_SUCCESS_RAMP) {
                const previousConcurrency = activeHeavySearchConcurrency;
                activeHeavySearchConcurrency = Math.min(HEAVY_SEARCH_MAX_CONCURRENCY, activeHeavySearchConcurrency + 1);
                heavySearchSuccessStreak = 0;
                if (activeHeavySearchConcurrency !== previousConcurrency) {
                    console.log(`[adaptive search] clean streak: ${previousConcurrency} → ${activeHeavySearchConcurrency} heavy lanes`);
                }
            }
        } else if (resp.ok) {
            heavySearchSuccessStreak++;
            if (heavySearchSuccessStreak >= HEAVY_SEARCH_SUCCESS_RAMP) {
                const previousConcurrency = activeHeavySearchConcurrency;
                activeHeavySearchConcurrency = Math.min(HEAVY_SEARCH_MAX_CONCURRENCY, activeHeavySearchConcurrency + 1);
                heavySearchSuccessStreak = 0;
                if (activeHeavySearchConcurrency !== previousConcurrency) {
                    console.log(`[adaptive search] clean streak: ${previousConcurrency} → ${activeHeavySearchConcurrency} heavy lanes`);
                }
            }
        }
        return resp;
    });

    heavySearchRequestChains[laneIndex] = request.catch(() => undefined);
    return request;
}

async function fetchWithRetry(url, signal, label = 'API', options = {}) {
    let lastError = null;
    let lastErrorCode = 'network';
    const maxRetries = options.maxRetries ?? MAX_RETRIES;
    const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        let timeout = null;
        let timedOut = false;
        let externalAbortHandler = null;
        try {
            const controller = new AbortController();
            timeout = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
            if (signal) {
                externalAbortHandler = () => controller.abort();
                if (signal.aborted) controller.abort();
                else signal.addEventListener('abort', externalAbortHandler, { once: true });
            }

            // Foreground searches are interactive and must not wait behind the
            // scraper's pacing queue. Scraper callers intentionally omit this
            // flag and continue through the adaptive heavy-search limiter.
            const resp = options.foregroundFast
                ? await fetch(url, {
                    credentials: 'include',
                    signal: controller.signal
                })
                : await fetchWithGridPacing(url, {
                credentials: 'include',
                signal: controller.signal
            }, controller.signal);

            if (resp.status === 401 || resp.status === 403) {
                console.warn(`${label}: Auth error (${resp.status}) — are you logged into VSCO?`);
                if (!options.silentAuth) {
                    info.textContent = `⚠️ Not logged in to VSCO! Please log in at vsco.co and try again.`;
                }
                return { data: null, error: 'auth' };
            }
            if (resp.status === 429) {
                lastErrorCode = 'rate_limited';
                const exponential = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
                const backoff = addBackoffJitter(Math.max(getRetryAfterMs(resp), currentBackoffMs, exponential));
                currentBackoffMs = Math.min(Math.max(currentBackoffMs * 1.7, backoff), MAX_BACKOFF_MS);
                if (isHeavySearchRequest(url)) {
                    gridRateLimitUntil = Math.max(gridRateLimitUntil, Date.now() + backoff);
                }
                console.warn(`${label}: Rate limited (429). Retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`);
                if (attempt < maxRetries - 1) await waitForRequestDelay(backoff, signal);
                continue;
            }
            if (!resp.ok) {
                console.warn(`${label}: HTTP ${resp.status}`);
                if (resp.status >= 500 && attempt < maxRetries - 1) {
                    lastErrorCode = `http_${resp.status}`;
                    const waitMs = addBackoffJitter(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
                    await waitForRequestDelay(waitMs, signal);
                    continue;
                }
                return { data: null, error: `http_${resp.status}` };
            }
            // Success — gradually reduce backoff
            currentBackoffMs = Math.max(INITIAL_BACKOFF_MS, currentBackoffMs * 0.8);
            const data = await resp.json();
            return { data, error: null };
        } catch (e) {
            if (e.name === 'AbortError') {
                if (signal?.aborted) return { data: null, error: 'aborted' };
                if (!timedOut) return { data: null, error: 'aborted' };
                lastError = e;
                lastErrorCode = 'timeout';
                console.warn(`${label}: Timed out after ${timeoutMs}ms (attempt ${attempt + 1}/${maxRetries})`);
                if (attempt < maxRetries - 1) {
                    const waitMs = addBackoffJitter(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
                    await waitForRequestDelay(waitMs, signal);
                }
                continue;
            }
            lastError = e;
            lastErrorCode = 'network';
            console.warn(`${label}: Attempt ${attempt + 1} failed:`, e.message);
            if (attempt < maxRetries - 1) {
                const waitMs = addBackoffJitter(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
                await waitForRequestDelay(waitMs, signal);
            }
        } finally {
            if (timeout) clearTimeout(timeout);
            if (signal && externalAbortHandler) signal.removeEventListener('abort', externalAbortHandler);
        }
    }
    console.error(`${label}: All ${maxRetries} attempts failed (${lastErrorCode})`, lastError);
    return { data: null, error: lastErrorCode };
}

async function fetchQuery(query, size = FOREGROUND_SEARCH_RESULT_LIMIT, signal, options = {}) {
    const url = `https://vsco.co/api/2.0/search/images?query=${encodeURIComponent(query)}&size=${size}`;
    const startedAt = performance.now();
    const { data, error } = await fetchWithRetry(url, signal, `Images "${query}"`, options);
    console.log(`[search timing] fetch+json "${query}": ${Math.round(performance.now() - startedAt)}ms`);
    if (error === 'auth') return { results: [], authError: true };
    const total = [data?.total, data?.total_count, data?.totalResults, data?.count].map(Number).find(Number.isFinite);
    return { results: data?.results || [], total: total ?? null, authError: false, rateLimited: error === 'rate_limited', error };
}

async function fetchPeople(query, signal, maxPages = 1, options = {}, pageSize = GRID_SEARCH_RESULT_LIMIT) {
    let allResults = [];
    let authError = false;
    let rateLimited = false;
    for (let page = 0; page < maxPages; page++) {
        const url = `https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(query)}&page=${page}&size=${pageSize}`;
        const { data, error } = await fetchWithRetry(url, signal, `People "${query}" p${page}`, options);
        if (error === 'auth') return { results: allResults, authError: true };
        if (error === 'aborted') break;
        if (error === 'rate_limited') {
            rateLimited = true;
            break;
        }
        if (error) return { results: allResults, authError, rateLimited, error };
        const results = data?.results || data?.grids || [];
        if (results.length === 0) break; // no more pages
        allResults = allResults.concat(results);
        if (results.length < pageSize) break; // partial page = last page
    }
    return { results: allResults, authError, rateLimited, error: null };
}

// Add items, dedupe. Returns count added.
function addDedupe(items) {
    let added = 0;
    for (const item of items) {
        const id = getItemPrimaryId(item);
        const key = String(id);
        if (!key || seenIds.has(key)) continue;
        if (mode !== 'fully-liked') {
            if (isHiddenItem(item)) continue; // Never show previously hidden images/users
            if (item.grid?.siteId && fullyLikedSiteIds.has(String(item.grid.siteId))) continue; // Filter out fully liked users
        }
        seenIds.add(key);
        allResults.push(item);
        added++;
    }
    return added;
}

// ============ PFP BUTTON (per card) ============
const pfpCache = {}; // siteId -> pfp URL (persists across searches)
const pfpPendingRequests = {}; // siteId -> Promise<string>
const siteSnapshotCache = {}; // subdomain -> lightweight sites API snapshot
const siteSnapshotPending = {};
const siteSnapshotByIdCache = {}; // siteId -> the same snapshot, reused by Updates expansion
const siteSnapshotByIdPending = {};

function getSubdomainFromCardOrItem(card, itemImg) {
    const direct = itemImg?.grid?.subdomain || itemImg?.siteSubDomain || itemImg?.perma_subdomain || itemImg?.subdomain || card?._sub || '';
    if (direct) return String(direct).trim().replace(/^@/, '').toLowerCase();
    const profileUrl = card?._profileUrl || '';
    const match = profileUrl.match(/vsco\.co\/([^/?#]+)/i);
    return match ? match[1].trim().replace(/^@/, '').toLowerCase() : '';
}

function getPrimarySiteFromSnapshot(data) {
    return Array.isArray(data?.sites) && data.sites[0] ? data.sites[0] : null;
}

function normalizeSiteImageUrl(value) {
    return normalize(String(value || '').trim());
}

function getOriginalVscoImageUrl(value, fallbackId = '') {
    const imageId = extractVscoImageId(value) || extractVscoImageId(fallbackId);
    return imageId ? `https://i.vsco.co/${imageId}` : normalizeSiteImageUrl(value);
}

function getSiteDisplayName(site, fallback = '') {
    return String(site?.name || site?.site_title || site?.display_name || fallback || '').trim();
}

function extractSiteLinks(site) {
    const links = [];
    const add = (label, url) => {
        const href = String(url || '').trim();
        if (!href) return;
        links.push({ label, href: normalize(href) });
    };

    add(site?.externalLinkDisplayText || 'External', site?.externalLink);
    add('Share', site?.share_link);
    add('Collection', site?.collection_share_link);

    if (site?.links && typeof site.links === 'object') {
        Object.entries(site.links).forEach(([label, value]) => {
            if (typeof value === 'string') {
                add(label, value);
            } else if (value && typeof value === 'object') {
                add(value.label || value.name || label, value.url || value.href || value.link);
            }
        });
    }

    return links.filter((link, index, arr) =>
        link.href && arr.findIndex(other => other.href === link.href) === index
    );
}

function buildSiteSnapshot(site, fallbackSubdomain = '', fallbackSiteId = '') {
    if (!site || typeof site !== 'object') return null;
    const subdomain = String(site.subdomain || fallbackSubdomain || '').trim().replace(/^@/, '').toLowerCase();
    const siteId = String(site.id || site.siteId || fallbackSiteId || '').trim();
    const profileImageId = String(site.profile_image_id || site.profileImageId
        || extractVscoImageId(site.profile_image || site.profileImage || site.profile_image_url) || '').trim();
    const recent = getRecentlyPublishedDetails(site.recently_published);
    const recentImageId = String(recent.id || extractVscoImageId(recent.url) || extractVscoImageId(site.recently_published) || '').trim();

    return {
        site,
        subdomain,
        displayName: getSiteDisplayName(site, subdomain || fallbackSubdomain),
        profileImageUrl: getOriginalVscoImageUrl(
            site.profile_image || site.profileImage || site.profile_image_url || site.responsive_url || '',
            profileImageId
        ),
        profileImageId,
        recentImageUrl: getOriginalVscoImageUrl(recent.url || '', recentImageId),
        recentImageId,
        recentImageTimestamp: recent.timestamp || 0,
        description: site.description || '',
        links: extractSiteLinks(site),
        siteId
    };
}

function cacheSiteSnapshot(snapshot) {
    if (!snapshot) return null;
    if (snapshot.subdomain) siteSnapshotCache[String(snapshot.subdomain).toLowerCase()] = snapshot;
    if (snapshot.siteId) siteSnapshotByIdCache[String(snapshot.siteId)] = snapshot;
    return snapshot;
}

async function fetchSiteSnapshotBySubdomain(subdomain) {
    const sub = String(subdomain || '').trim().replace(/^@/, '').toLowerCase();
    if (!sub) return null;
    if (siteSnapshotCache[sub] !== undefined) return siteSnapshotCache[sub];
    if (siteSnapshotPending[sub]) return siteSnapshotPending[sub];

    siteSnapshotPending[sub] = (async () => {
        try {
            const resp = await fetch(`https://vsco.co/api/2.0/sites?subdomain=${encodeURIComponent(sub)}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            if (!resp.ok) {
                siteSnapshotCache[sub] = null;
                return null;
            }
            const site = getPrimarySiteFromSnapshot(await resp.json());
            return cacheSiteSnapshot(buildSiteSnapshot(site, sub));
        } catch (e) {
            siteSnapshotCache[sub] = null;
            return null;
        } finally {
            delete siteSnapshotPending[sub];
        }
    })();

    return siteSnapshotPending[sub];
}

async function fetchSiteSnapshotById(siteId, fallbackSubdomain = '') {
    const sid = String(siteId || '').trim();
    if (!sid) return fetchSiteSnapshotBySubdomain(fallbackSubdomain);
    if (siteSnapshotByIdCache[sid] !== undefined) return siteSnapshotByIdCache[sid];
    if (siteSnapshotByIdPending[sid]) return siteSnapshotByIdPending[sid];

    siteSnapshotByIdPending[sid] = (async () => {
        try {
            const resp = await fetch(`https://vsco.co/api/2.0/sites/${encodeURIComponent(sid)}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            if (!resp.ok) {
                siteSnapshotByIdCache[sid] = null;
                return null;
            }
            const data = await resp.json();
            return cacheSiteSnapshot(buildSiteSnapshot(data?.site || data, fallbackSubdomain, sid));
        } catch (e) {
            siteSnapshotByIdCache[sid] = null;
            return null;
        } finally {
            delete siteSnapshotByIdPending[sid];
        }
    })();

    return siteSnapshotByIdPending[sid];
}

async function fetchSiteProfilePic(siteId, subdomain = '') {
    if (pfpCache[siteId] !== undefined) return pfpCache[siteId];
    if (pfpPendingRequests[siteId]) return pfpPendingRequests[siteId];

    pfpPendingRequests[siteId] = (async () => {
        try {
            if (subdomain) {
                const snapshot = await fetchSiteSnapshotBySubdomain(subdomain);
                const pfpUrl = snapshot?.profileImageUrl || '';
                pfpCache[siteId] = pfpUrl;
                seedPfpBaselineIfMissing(siteId, pfpUrl);
                return pfpUrl;
            }
            const snapshot = await fetchSiteSnapshotById(siteId);
            pfpCache[siteId] = snapshot?.profileImageUrl || '';
            seedPfpBaselineIfMissing(siteId, pfpCache[siteId]);
            return pfpCache[siteId];
        } catch (e) {
            pfpCache[siteId] = '';
            return '';
        } finally {
            delete pfpPendingRequests[siteId];
        }
    })();

    return pfpPendingRequests[siteId];
}

// Called when user clicks the pfp button on a card
async function handlePfpClick(btn, card, siteId) {
    if (btn.classList.contains('loading')) return;

    // If already showing pfp, toggle back to original
    if (card.classList.contains('pfp-loaded')) {
        const imgEl = card.querySelector('.card-img');
        if (imgEl && card._originalUrl) {
            imgEl.src = card._originalUrl;
            card.classList.remove('pfp-loaded');
            btn.textContent = '👤';
        }
        return;
    }

    // Check cache first
    if (pfpCache[siteId]) {
        const imgEl = card.querySelector('.card-img');
        if (imgEl) {
            imgEl.src = pfpCache[siteId];
            card.classList.add('pfp-loaded');
            btn.textContent = '🖼';
        }
        return;
    }

    // Fetch
    btn.classList.add('loading');
    btn.textContent = '⏳';
    const pfpUrl = await fetchSiteProfilePic(siteId, getSubdomainFromCardOrItem(card, card._imgData));
    btn.classList.remove('loading');

    if (pfpUrl) {
        const imgEl = card.querySelector('.card-img');
        if (imgEl) {
            imgEl.src = pfpUrl;
            card.classList.add('pfp-loaded');
            btn.textContent = '🖼';
        }
    } else {
        btn.textContent = '❌';
        setTimeout(() => { btn.textContent = '👤'; }, 1500);
    }
}

// ============ AUTO-PFP QUEUE ============

function initAutoPfpObserver() {
    if (autoPfpObserver) autoPfpObserver.disconnect();
    autoPfpObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!autoPfpEnabled) continue;
            const card = entry.target;
            const siteId = card._siteId;
            if (!siteId) continue;

            if (entry.isIntersecting && !card._autoPfpQueued && !card.classList.contains('pfp-loaded')) {
                card._autoPfpQueued = true;
                autoPfpQueue.push(card);
                processAutoPfpQueue();
            }
        }
    }, { rootMargin: `${PFP_VIEWPORT_MARGIN}px` }); // pre-fetch well before card scrolls into view
}

async function processAutoPfpQueue() {
    if (autoPfpProcessing || !autoPfpEnabled) return;
    autoPfpProcessing = true;
    autoPfpAbort = new AbortController();

    while (autoPfpQueue.length > 0 && autoPfpEnabled && !autoPfpAbort.signal.aborted) {
        const card = autoPfpQueue.shift();
        const siteId = card._siteId;
        if (!siteId || card.classList.contains('dual-view')) continue;

        // Check if card is still near viewport (generous range to allow pre-fetching)
        const rect = card.getBoundingClientRect();
        const inView = rect.bottom > -1000 && rect.top < window.innerHeight + PFP_VISIBILITY_RANGE;
        if (!inView) {
            card._autoPfpQueued = false; // allow re-queue if scrolled back
            continue;
        }

        // Check cache first — no delay needed
        if (pfpCache[siteId]) {
            addDualView(card, pfpCache[siteId]);
            continue;
        }

        // Fetch with delay
        const pfpUrl = await fetchSiteProfilePic(siteId, getSubdomainFromCardOrItem(card, card._imgData));

        if (pfpUrl) {
            addDualView(card, pfpUrl);
        }

        // Delay before next fetch to avoid rate limiting
        if (autoPfpQueue.length > 0 && autoPfpEnabled) {
            await new Promise(r => setTimeout(r, AUTO_PFP_DELAY_MS));
        }
    }

    autoPfpProcessing = false;
}

function addDualView(card, pfpUrl) {
    if (card.classList.contains('dual-view')) return;
    const pfpWrap = document.createElement('div');
    pfpWrap.className = 'card-pfp-wrap';
    pfpWrap.style.cursor = 'pointer';
    pfpWrap.innerHTML = `<img class="card-pfp-img" src="${escapeHtml(pfpUrl)}" loading="lazy">`;
    // Insert after card-img-wrap
    card.querySelector('.card-img-wrap').after(pfpWrap);
    card.classList.add('dual-view', 'pfp-loaded');

    // Click on pfp side opens profile
    pfpWrap.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(card._profileUrl, '_blank');
    });
    pfpWrap.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            window.open(card._profileUrl, '_blank');
        }
    });
}

function removeDualView(card) {
    const pfpWrap = card.querySelector('.card-pfp-wrap');
    if (pfpWrap) pfpWrap.remove();
    card.classList.remove('dual-view', 'pfp-loaded');
    // Restore original image in case it was toggled manually before
    const imgEl = card.querySelector('.card-img');
    if (imgEl && card._originalUrl) imgEl.src = card._originalUrl;
    card._autoPfpQueued = false;
}

function stopAutoPfp() {
    autoPfpQueue = [];
    autoPfpProcessing = false;
    if (autoPfpAbort) { autoPfpAbort.abort(); autoPfpAbort = null; }
}

function toggleAutoPfp() {
    autoPfpEnabled = !autoPfpEnabled;
    const btn = document.querySelector('.auto-pfp-btn');
    if (btn) btn.classList.toggle('active', autoPfpEnabled);

    grid.classList.toggle('grid-dual-pfp', autoPfpEnabled);

    if (autoPfpEnabled) {
        // Observe all existing cards that haven't been fetched yet
        initAutoPfpObserver(); // always re-init to ensure clean state
        document.querySelectorAll('.card').forEach(card => {
            if (card._siteId && !card.classList.contains('dual-view') && !card._autoPfpQueued) {
                autoPfpObserver.observe(card);
            }
        });
    } else {
        stopAutoPfp();
        if (autoPfpObserver) { autoPfpObserver.disconnect(); autoPfpObserver = null; }
        // Remove all dual-view states
        document.querySelectorAll('.card.dual-view').forEach(removeDualView);
    }
}

// ============ RENDER ============
function renderBatch(items) {
    for (const img of items) {
        const imageId = getVscoImageId(img);
        const fallbackUrl = img.responsive_url || img.image_url || img.site_profile_image_url || '';
        let url = imageId ? '' : getVscoDisplayImageUrl(img, fallbackUrl);
        let NeedsAsyncPfp = false;
        const siteId = img.grid?.siteId;

        if (img.isRepost && appSettings.showOriginalPosterPfpInReposts && siteId) {
            let cachedPfp = pfpCache[siteId];
            if (cachedPfp) {
                url = cachedPfp;
            } else {
                url = '';
                NeedsAsyncPfp = true;
            }
        }

        if (!url && !NeedsAsyncPfp && !imageId) continue;

        const card = document.createElement("div");
        card.className = "card";

        const cardImageId = imageId || img.imageId || img._id;
        const sub = img.grid?.subdomain || '';
        const showingFetchedTime = mode === 'challenge' && vaultPageState?.dateMode === 'fetched';
        const cardTimestamp = showingFetchedTime
            ? Number(img.vaultFetchedAt || 0)
            : getTimestamp(img);
        const time = cardTimestamp
            ? `${showingFetchedTime ? 'Fetched ' : ''}${formatTimeAgo(cardTimestamp)}`
            : '';

        const pfpTs = getProfilePicTimestamp(img);
        const pfpTime = pfpTs ? formatTimeAgo(pfpTs) : '';
        const sourceQuery = img.sourceQuery || '';

        const isFullyLiked = fullyLikedImages[cardImageId] !== undefined;

        let actionBtnHtml = `
          <button class="fully-like-btn like-btn ${isFullyLiked ? 'liked' : ''}" title="Fully Like">
            ${isFullyLiked ? '❤️' : '🤍'}
          </button>
          ${siteId ? `<button class="card-reposts-btn" title="View User Reposts">🔁</button>` : ''}
        `;

        const isProfile = img.isProfile === true;
        const descHtml = (!isProfile && img.description) ? `<div style="position:absolute; bottom:0; left:0; width:100%; background:rgba(0,0,0,0.7); font-size:12px; padding:8px; box-sizing:border-box; color:#fff; z-index:5; pointer-events:none;">${escapeHtml(img.description)}</div>` : '';

        const symbol = isProfile ? '👤' : (img.isRepost ? '🔁' : '🖼️');

        card.innerHTML = `
      <div class="card-img-wrap" style="cursor:pointer;">
        ${NeedsAsyncPfp || cardImageId ? `<img class="card-img" style="opacity:0;" src="" loading="lazy">` : `<img class="card-img" src="${escapeHtml(url)}" loading="lazy">`}
        <div class="card-hover-symbol">${symbol}</div>
        ${time ? `<div class="card-overlay"><span class="time-badge">${escapeHtml(time)}</span></div>` : ''}
        ${sourceQuery ? `<div class="card-overlay" style="top:8px; right:8px; left:auto;"><span class="time-badge" style="background:rgba(51,51,51,0.85); border-color: rgba(255,255,255,0.1);" title="Matched Query">🔍 ${escapeHtml(sourceQuery)}</span></div>` : ''}
        ${descHtml}
      </div>
      ${actionBtnHtml}
      ${siteId ? `<button class="pfp-toggle-btn" title="Show profile pic">👤</button>` : ''}
    `;

        if (appSettings.gpsEnabled && itemHasExifGpsMetadata(img)) {
            addExifGpsBadge(card, img.exifGps || img);
        }

        if (NeedsAsyncPfp) {
            const imgEl = card.querySelector('.card-img');
            fetchSiteProfilePic(siteId, getSubdomainFromCardOrItem(card, img)).then(pfpUrl => {
                if (pfpUrl) {
                    imgEl.src = pfpUrl;
                    imgEl.style.opacity = '1';
                }
            }).catch(() => { });
        }

        // Store original URL, profile link, and siteId for toggling
        card._originalUrl = url;
        card._profileUrl = sub ? `https://vsco.co/${sub}` : '';
        card._imageUrl = `https://vsco.co/${sub}/media/${imageId}`;
        card._siteId = siteId;
        card._profileSourceQuery = sourceQuery;
        card._imgData = img;

        // Image clicks go to the creator's VSCO profile. If a result has no
        // username, fall back to its specific media page.
        const imgWrap = card.querySelector('.card-img-wrap');
        imgWrap.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const destination = card._profileUrl || card._imageUrl;
            if (destination) window.open(destination, '_blank');
        });
        imgWrap.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                const destination = card._profileUrl || card._imageUrl;
                if (destination) window.open(destination, '_blank');
            }
        });

        if (imageId) {
            const imgEl = card.querySelector('.card-img');
            loadVscoImageIntoElement(imgEl, img, fallbackUrl).catch(() => { });
        }

        // Pfp button click (still works as toggle)
        const pfpBtn = card.querySelector('.pfp-toggle-btn');
        if (pfpBtn && siteId) {
            pfpBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handlePfpClick(pfpBtn, card, siteId);
            });
        }

        // Like buttons
        const fullyLikeBtn = card.querySelector('.fully-like-btn');
        if (fullyLikeBtn) {
            fullyLikeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (fullyLikedImages[imageId]) {
                    const unlikedSiteId = String(img.grid?.siteId || '');
                    delete fullyLikedImages[imageId];
                    updateFullyLikedSiteIds();
                    fullyLikeBtn.classList.remove('liked');
                    fullyLikeBtn.textContent = '🤍';
                    // Remove profile if no more liked images from this user
                    if (unlikedSiteId && !fullyLikedSiteIds.has(unlikedSiteId)) {
                        deleteLikedProfile(unlikedSiteId);
                    }
                } else {
                    fullyLikedImages[imageId] = img;
                    updateFullyLikedSiteIds();
                    fullyLikeBtn.classList.add('liked');
                    fullyLikeBtn.textContent = '❤️';

                    autoScrapeFullyLikedUser(img.grid?.siteId, img);
                    if (img.grid?.siteId) fetchAndSaveLikedProfile(img.grid.siteId, img);
                }
                chrome.storage.local.set({ fullyLikedImages });
            });
        }

        const repostsBtn = card.querySelector('.card-reposts-btn');
        if (repostsBtn && siteId) {
            repostsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (mode === 'fully-liked') {
                    handleInlineRepostsExpand(card, siteId);
                } else {
                    showSingleUserRepostsFeed(siteId);
                }
            });
        }

        grid.appendChild(card);

        // Track for highly accurate virtual scroll hiding
        card._imgData = img;
        trackCardImageAspect(card, img);
        updateExifGpsCardVisibility(card);
        autoHideObserver.observe(card);

        // Auto-pfp: observe this card if enabled
        if (autoPfpEnabled && siteId && autoPfpObserver) {
            autoPfpObserver.observe(card);
        }

        if ((mode === 'search' || mode === 'people' || mode === 'bio') && siteId && profilePrefetchObserver) {
            profilePrefetchObserver.observe(card);
        }
    }
}

function renderNew() {
    const display = getDisplayResults();
    const pageItems = getCurrentPageItems();
    grid.innerHTML = '';
    renderBatch(pageItems);
    renderPageControls();
    updateInfo();
}

function appendResultItems(items) {
    if (!items.length) return;
    renderBatch(items);
    renderPageControls();
    updateInfo();
}

function updateInfo() {
    const display = getDisplayResults();
    if (display.length === 0 && allResults.length === 0) return;
    const showingFetchedTime = mode === 'challenge' && vaultPageState?.dateMode === 'fetched';
    const newestTimestamp = display.length > 0
        ? (showingFetchedTime ? Number(display[0]?.vaultFetchedAt || 0) : getTimestamp(display[0]))
        : 0;
    const newest = newestTimestamp ? formatTimeAgo(newestTimestamp) : '—';
    const newestLabel = showingFetchedTime ? 'Latest fetch' : 'Newest';
    const total = allResults.length;
    const shown = display.length;
    const gpsKnown = appSettings.gpsEnabled && exifGpsFilterOnly
        ? getCurrentPageItems().filter(item => itemHasExifGpsMetadata(item)).length
        : 0;
    let tallKnown = 0;
    let wideKnown = 0;
    let unknownAspect = total;
    if (aspectFilterMode !== 'all') {
        tallKnown = allResults.filter(item => item?._isTallVertical === true).length;
        wideKnown = allResults.filter(item => item?._isWideHorizontal === true).length;
        unknownAspect = allResults.filter(item => item?._aspectMeasured !== true).length;
    }
    const pageShown = getCurrentPageVisibleCount();
    const totalLabel = `Total results: ${(lastSearchApiTotal ?? total).toLocaleString()}${lastSearchApiTotal != null && lastSearchApiTotal !== total ? ` · ${total.toLocaleString()} fetched` : ''}`;
    const aspectLabel = aspectFilterMode !== 'all'
        ? ` · Tall: ${tallKnown.toLocaleString()} loaded · Wide: ${wideKnown.toLocaleString()} loaded · Unknown: ${unknownAspect.toLocaleString()} · ${aspectFilterMode} filter on`
        : '';
    if (hasPatternSyntax(lastSearchQuery) && shown !== total) {
        info.textContent = `🔥 ${totalLabel} · ${pageShown.toLocaleString()} shown (${shown.toLocaleString()} current matches) · GPS: ${gpsKnown.toLocaleString()}${aspectLabel} · ${newestLabel}: ${newest}`;
    } else {
        info.textContent = `🔥 ${totalLabel} · ${pageShown.toLocaleString()} shown · GPS: ${gpsKnown.toLocaleString()}${aspectLabel} · ${newestLabel}: ${newest}`;
    }
}

function renderPageControls() {
    document.querySelectorAll('.page-controls-bar').forEach(el => el.remove());
    const display = getDisplayResults();
    if (display.length === 0) return;

    const bar = document.createElement('div');
    bar.className = 'page-controls-bar sort-bar';
    bar.innerHTML = `
        <button class="sort-btn ${aspectFilterMode === 'vertical' ? 'active' : ''}" data-aspect-filter="vertical" title="Show loaded images with height/width at least 16:9">↕ Tall 9:16</button>
        <button class="sort-btn ${aspectFilterMode === 'horizontal' ? 'active' : ''}" data-aspect-filter="horizontal" title="Show loaded images with width/height at least 16:9">↔ Wide 16:9</button>
        <span class="sort-divider"></span>
        <span class="sort-label">${Math.min(displayedCount, display.length).toLocaleString()} / ${display.length.toLocaleString()} loaded</span>
    `;
    bar.querySelectorAll('[data-aspect-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            aspectFilterMode = aspectFilterMode === btn.dataset.aspectFilter ? 'all' : btn.dataset.aspectFilter;
            currentPage = 0;
            displayedCount = PAGE_SIZE;
            renderNew();
        });
    });
    grid.before(bar);
}

function loadMoreResults() {
    if (mode === 'people' || mode === 'bio') {
        if (displayedCount >= lastPeopleFilteredCount) return;
        const now = Date.now();
        if (now - lastLoadMoreAt < 600) return;
        lastLoadMoreAt = now;
        displayedCount = Math.min(displayedCount + PAGE_SIZE, lastPeopleFilteredCount);
        void rerenderPeopleResults();
        return;
    }
    const sourceLength = getDisplayResults().length;
    if (displayedCount >= sourceLength) {
        if (mode === 'challenge' && vaultPageState?.hasMore && !vaultPageLoadInProgress) {
            void loadOlderVaultPage();
        }
        return;
    }
    const now = Date.now();
    if (now - lastLoadMoreAt < 600) return;
    lastLoadMoreAt = now;
    const previousCount = displayedCount;
    displayedCount = Math.min(displayedCount + PAGE_SIZE, sourceLength);
    const display = getDisplayResults();
    appendResultItems(display.slice(previousCount, displayedCount));
}

// ============ AUTO-PFP TOGGLE BUTTON ============

function renderAutoPfpToggle() {
    // Remove existing
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    const bar = document.createElement('div');
    bar.className = 'auto-pfp-bar';
    bar.innerHTML = `
        <button class="sort-btn auto-pfp-btn ${autoPfpEnabled ? 'active' : ''}">👤 Auto PFP</button>
    `;
    bar.querySelector('.auto-pfp-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleAutoPfp();
    });
    grid.before(bar);
}

// ============ SEARCH ============
async function search(query) {
    const searchStartedAt = performance.now();
    if (activeSearchController) activeSearchController.abort();
    const searchController = new AbortController();
    activeSearchController = searchController;
    const signal = searchController.signal;
    mode = null;
    fetching = false;
    forYouMode = false;
    partitionExpansionRunning = false;
    partitionExpansionStopRequested = false;
    imageExpansionAvailable = false;
    gridExpansionAvailable = false;
    localResultSearchQuery = '';
    localResultMaxAgeDays = 0;
    lastSearchApiTotal = null;

    seenIds.clear();
    allResults = [];
    resetPagination();
    grid.innerHTML = '';

    // Reset auto-pfp queue on new search but keep enabled state
    stopAutoPfp();
    stopProfilePrefetch();
    initProfilePrefetchObserver();
    if (autoPfpEnabled) initAutoPfpObserver();

    mode = 'search';
    lastSearchQuery = query.trim();
    browseBtn.textContent = "🌐 Live Feed";
    challengeBtn.textContent = "⏳ Scraper";
    if (scraperUi) scraperUi.style.display = 'none';
    grid.style.display = ""; // Reset block display from review view
    grid.classList.remove('review-queue-active');
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());
    clearHeaderMap();
    hideHeaderMap();
    const isPattern = hasPatternSyntax(query.trim());
    const apiQueries = isPattern ? extractApiQueries(query.trim()) : [query.trim()];
    info.textContent = apiQueries.length > 1
        ? `Searching ${apiQueries.length} queries in parallel...`
        : `Searching "${apiQueries[0]}"${isPattern ? ' (filtering...)' : ''}...`;

    const requestOptions = { foregroundFast: true, maxRetries: 1, timeoutMs: 10000 };
    const promises = apiQueries.map(q => fetchQuery(q, FOREGROUND_SEARCH_RESULT_LIMIT, signal, requestOptions));
    const resultSets = await Promise.all(promises);
    if (signal.aborted || activeSearchController !== searchController) return;
    const reportedTotals = resultSets.map(result => result.total).filter(Number.isFinite);
    lastSearchApiTotal = reportedTotals.length ? reportedTotals.reduce((sum, value) => sum + value, 0) : null;
    console.log(`[search timing] all fetches done: ${Math.round(performance.now() - searchStartedAt)}ms`);
    let anyAuthError = false;
    const dedupeStartedAt = performance.now();
    resultSets.forEach((res, i) => {
        if (res.authError) anyAuthError = true;
        deferDiscoveredSiteIdCollection(res.results, 'image-search', apiQueries[i]);
        const added = addDedupe(res.results);
        console.log(`Search "${apiQueries[i]}": ${res.results.length} fetched, ${added} new`);
    });
    console.log(`[search timing] dedupe/filter done: ${Math.round(performance.now() - dedupeStartedAt)}ms`);
    if (anyAuthError && allResults.length === 0) {
        grid.innerHTML = '<div class="status">⚠️ Not logged in to VSCO. Please <a href="https://vsco.co" target="_blank" style="color:#667eea">log in</a> and try again.</div>';
        if (activeSearchController === searchController) activeSearchController = null;
        return;
    }
    console.log(`Total: ${allResults.length} unique results`);

    lastSearchResults = allResults.slice();
    const renderStartedAt = performance.now();
    rerenderSearchResults();
    console.log(`[search timing] first render done: ${Math.round(performance.now() - renderStartedAt)}ms, total ${Math.round(performance.now() - searchStartedAt)}ms`);

    if (allResults.length === 0) {
        grid.innerHTML = '<div class="status">No results found. Try a different search or make sure you\'re logged into VSCO.</div>';
    }
    if (activeSearchController === searchController) activeSearchController = null;
}

// ============ 72H CHALLENGE ============
const CHALLENGE_EMOJIS = [
    '🍑', '👙', '🔥', '💋', '😍', '🥵', '😈', '🫦', '💦', '🍒',
    '✨', '💅', '💄', '🤳', '🪞', '❤️', '💖', '👅', '🌶️', '🩷',
    '🦋', '🌸', '🧚', '💃', '👸', '🫶', '💕', '🥰', '😘', '🤤',
    '☀️', '🌊', '🏖️', '🩱', '🍓', '🍹', '🌺', '💎', '🪩', '💗',
    '🤍', '🥺', '🥳', '👯‍♀️', '🥂', '🍾', '🎀', '🧸', '🤎', '🖤',
    '💫', '⚡️', '🌟', '❄️', '☃️', '⛄️', '🏄‍♀️', '🏄🏼‍♀️', '🏄🏽‍♀️',
    '😚', '😋', '😜', '😝', '😛', '🤪', '🤭', '🤫', '🫢',
    '🫣', '🫠', '🤧', '😵‍💫', '🤯', '🤠', '😎', '🤓', '🧐'
];

const CHALLENGE_TERMS = [
    '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014',
    '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024',
    '05', '06', '07', '08', '09', '10', '11', '12', '13', '14',
    '15', '16', '17', '18', '19', '20', '21', '22', '23', '24',
    'ig', 'ig:', 'ig-', '@', 'insta', 'instagram', 'instagram:',
    'tt', 'tt:', 'tt-', 'tiktok', 'tik tok', 'tiktok:',
    'snap', 'snap:', 'snap-', 'snapchat', 'snp', 'sc:', 'sc',
    'tb', 'throwback', 'summer', 'winter', 'fall', 'spring',
    'friends', 'dump', 'photodump', 'life', 'me', 'love', 'happy',
    'vibe', 'vibes', 'mood', 'aesthetic', 'art', 'nature', 'travel',
    'film', 'vintage', 'retro', 'y2k', 'cute', 'pretty', 'beautiful',
    'girls', 'boys', 'outfit', 'fit', 'ootd', 'fashion', 'style',
    'miami', 'la', 'nyc', 'london', 'paris', 'tokyo', 'cali', 'florida',
    'beach', 'pool', 'sun', 'sunset', 'sunrise', 'sky', 'clouds',
    'food', 'coffee', 'cafe', 'matcha', 'gym', 'workout', 'fitness',
    'music', 'concert', 'festival', 'party', 'club', 'night', 'weekend'
];

const CHALLENGE_NAMES = ["amelia", "olivia", "isla", "ava", "mia", "lily", "evie", "sophia", "grace", "ruby", "isabella", "chloe", "scarlett", "aria", "maya", "harper", "stella", "luna", "violet", "aurora", "hazel", "zoey", "penelope", "eleanor", "layla", "nora", "mila", "ellie", "lucy", "piper", "willow", "mya", "sydney", "kendall", "paige", "brooke", "morgan", "peyton", "taylor", "mackenzie", "madison", "riley", "avery", "hailey", "kaylee", "brianna", "kylie", "sienna", "jade", "brooklyn", "mary", "anna", "emma", "elizabeth", "minnie", "margaret", "ida", "alice", "bertha", "sarah", "annie", "clara", "ella", "florence", "cora", "martha", "laura", "nellie", "grace", "carrie", "maude", "mabel", "bessie", "jennie", "gertrude", "julia", "hattie", "edith", "mattie", "rose", "catherine", "lillian", "ada", "lillie", "helen", "jessie", "louise", "ethel", "lula", "myrtle", "eva", "frances", "lena", "lucy", "edna", "maggie", "pearl", "daisy", "fannie", "josephine", "dora", "rosa", "katherine", "agnes", "marie", "nora", "may", "mamie", "blanche", "stella", "ellen", "nancy", "effie", "sallie", "nettie", "della", "lizzie", "flora", "susie", "maud", "mae", "etta", "harriet", "sadie", "caroline", "katie", "lydia", "elsie", "kate", "susan", "mollie", "alma", "addie", "georgia", "eliza", "lulu", "nannie", "lottie", "amanda", "belle", "charlotte", "rebecca", "ruth", "viola", "olive", "amelia", "hannah", "jane", "virginia", "emily", "matilda", "irene", "kathryn", "esther", "willie", "henrietta", "ollie", "amy", "rachel", "sara", "estella", "theresa", "augusta", "ora", "pauline", "josie", "lola", "sophia", "leona", "anne", "mildred", "ann", "beulah", "callie", "lou", "delia", "eleanor", "barbara", "iva", "louisa", "maria", "mayme", "evelyn", "estelle", "nina", "betty", "marion", "bettie", "dorothy", "luella", "inez", "lela", "rosie", "allie", "millie", "janie", "cornelia", "victoria", "ruby", "winifred", "alta", "celia", "christine", "beatrice", "birdie", "harriett", "mable", "myra", "sophie", "tillie", "isabel", "sylvia", "carolyn", "isabelle", "leila", "sally", "ina", "essie", "bertie", "nell", "alberta", "katharine", "lora", "rena", "mina", "rhoda", "mathilda", "abbie", "eula", "dollie", "hettie", "eunice", "fanny", "ola", "lenora", "adelaide", "christina", "lelia", "nelle", "sue", "johanna", "lilly", "lucinda", "minerva", "lettie", "roxie", "cynthia", "helena", "hilda", "hulda", "bernice", "genevieve", "jean", "cordelia", "marian", "francis", "jeanette", "adeline", "gussie", "leah", "lois", "lura", "mittie", "hallie", "isabella", "olga", "phoebe", "teresa", "hester", "lida", "lina", "marguerite", "winnie", "claudia", "vera", "cecelia", "bess", "emilie", "john", "rosetta", "verna", "myrtie", "cecilia", "elva", "olivia", "ophelia", "georgie", "elnora", "violet", "adele", "lily", "linnie", "loretta", "madge", "polly", "virgie", "eugenia", "lucile", "lucille", "mabelle", "rosalie", "kittie", "meta", "angie", "dessie", "georgiana", "lila", "regina", "selma", "wilhelmina", "bridget", "lilla", "malinda", "vina", "freda", "gertie", "jeannette", "louella", "mandy", "roberta", "cassie", "corinne", "ivy", "melissa", "lyda", "naomi", "norma", "bell", "margie", "nona", "zella", "dovie", "elvira", "erma", "irma", "leota", "william", "artie", "blanch", "charity", "janet", "lorena", "lucretia", "orpha", "alvina", "annette", "catharine", "elma", "geneva", "lee", "leora", "lona", "miriam", "zora", "linda", "octavia", "sudie", "zula", "adella", "alpha", "frieda", "george", "joanna", "leonora", "priscilla", "tennie", "angeline", "docia", "ettie", "flossie", "hanna", "letha", "minta", "retta", "rosella", "adah", "berta", "elisabeth", "elise", "goldie", "leola", "margret", "adaline", "floy", "idella", "juanita", "lenna", "lucie", "missouri", "nola", "zoe", "eda", "isabell", "james", "julie", "letitia", "madeline", "malissa", "mariah", "pattie", "vivian", "almeda", "aurelia", "claire", "dolly", "hazel", "jannie", "kathleen", "kathrine", "lavinia", "marietta", "melvina", "ona", "pinkie", "samantha", "susanna", "chloe", "donnie", "elsa", "gladys", "matie", "pearle", "vesta", "vinnie", "antoinette", "clementine", "edythe", "harriette", "libbie", "lilian", "lue", "lutie", "magdalena", "meda", "rita", "tena", "zelma", "adelia", "annetta", "antonia", "dona", "elizebeth", "georgianna", "gracie", "iona", "lessie", "leta", "liza", "mertie", "molly", "neva", "oma", "alida", "alva", "cecile", "cleo", "donna", "ellie", "ernestine", "evie", "frankie", "helene", "minna", "myrta", "prudence", "queen", "rilla", "savannah", "tessie", "tina", "agatha", "america", "anita", "arminta", "dorothea", "ira", "luvenia", "marjorie", "maybelle", "mellie", "nan", "pearlie", "sidney", "velma", "clare", "constance", "dixie", "ila", "iola", "jimmie", "louvenia", "lucia", "ludie", "luna", "metta", "patsy", "phebe", "sophronia", "adda", "avis", "betsy", "bonnie", "cecil", "cordie", "emmaline", "ethelyn", "hortense", "june", "louie", "lovie", "marcella", "melinda", "mona", "odessa", "veronica", "aimee", "annabel", "ava", "bella", "carolina", "cathrine", "christena", "clyde", "dena", "dolores", "eleanore", "elmira", "fay", "frank", "jenny", "kizzie", "lonnie", "loula", "magdalene", "mettie", "mintie", "peggy", "reba", "serena", "vida", "zada", "abigail", "celestine", "celina", "claudie", "clemmie", "connie", "daisie", "deborah", "dessa", "easter", "eddie", "emelia", "emmie", "imogene", "india", "jeanne", "joan", "lenore", "liddie", "lotta", "mame", "nevada", "rachael", "sina", "willa", "aline", "beryl", "charles", "daisey", "dorcas", "edmonia", "effa", "eldora", "eloise", "emmer", "era", "gena", "henry", "iris", "izora", "lennie", "lissie", "mallie", "malvina", "mathilde", "mazie", "queenie", "robert", "rosina", "salome", "theodora", "therese", "vena", "wanda", "wilda", "altha", "anastasia", "besse", "bird", "birtie", "clarissa", "claude", "delilah", "diana", "emelie", "erna", "fern", "florida", "frona", "hilma", "joseph", "juliet", "leonie", "lugenia", "mammie", "manda", "manerva", "manie", "nella", "paulina", "philomena", "rae", "selina", "sena", "theodosia", "tommie", "una", "vernie", "adela", "althea", "amalia", "amber", "angelina", "annabelle", "anner", "arie", "clarice", "corda", "corrie", "dell", "dellar", "donie", "dora", "doris", "elda", "elinor", "emeline", "emilia", "esta", "estell", "etha", "fred", "hope", "indiana", "ione", "jettie", "johnnie", "josiephine", "kitty", "lavina", "leda", "letta", "mahala", "marcia", "margarette", "maudie", "maye", "norah", "oda", "patty", "paula", "permelia", "rosalia", "roxanna", "sula", "vada", "winnifred", "adline", "almira", "alvena", "arizona", "becky", "bennie", "bernadette", "camille", "cordia", "corine", "dicie", "dove", "drusilla", "elena", "elenora", "elmina", "ethyl", "evalyn", "evelina", "faye", "huldah", "idell", "inga", "irena", "jewell", "kattie", "lavenia", "leslie", "lovina", "lulie", "magnolia", "margeret", "margery", "media", "millicent", "nena", "ocie", "orilla", "osie", "pansy", "ray", "rosia", "rowena", "shirley", "tabitha", "thomas", "verdie", "walter", "zetta", "zoa", "zona", "albertina", "albina", "alyce", "amie", "angela", "annis", "carol", "carra", "clarence", "clarinda", "delphia", "dillie", "doshie", "drucilla", "etna", "eugenie", "eulalia", "eve", "felicia", "florance", "fronie", "geraldine", "gina", "glenna", "grayce", "hedwig", "jessica", "jossie", "katheryn", "katy", "lea", "leanna", "leitha", "leone", "lidie", "loma", "lular", "magdalen", "maymie", "minervia", "muriel", "neppie", "olie", "onie", "osa", "otelia", "paralee", "patience", "rella", "rillie", "rosanna", "theo", "tilda", "tishie", "tressa", "viva", "yetta", "zena", "zola", "abby", "aileen", "alba", "alda", "alla", "alverta", "ara", "ardelia", "ardella", "arrie", "arvilla", "augustine", "aurora", "bama", "bena", "byrd", "calla", "camilla", "carey", "carlotta", "celestia", "cherry", "cinda", "classie", "claudine", "clemie", "clifford", "clyda", "creola", "debbie", "dee", "dinah", "doshia", "ednah", "edyth", "eleanora", "electa", "eola", "erie", "eudora", "euphemia", "evalena", "evaline", "faith", "fidelia", "freddie", "golda", "harry", "helma", "hermine", "hessie", "ivah", "janette", "jennette", "joella", "kathryne", "lacy", "lanie", "lauretta", "leana", "leatha", "leo", "liller", "lillis", "louetta", "madie", "mai", "martina", "maryann", "melva", "mena", "mercedes", "merle", "mima", "minda", "monica", "nealie", "netta", "nolia", "nonie", "odelia", "ottilie", "phyllis", "robbie", "sabina", "sada", "sammie", "suzanne", "sybilla", "thea", "tressie", "vallie", "venie", "viney", "wilhelmine", "winona", "zelda", "zilpha", "adelle", "adina", "adrienne", "albertine", "alys", "ana", "araminta", "arthur", "birtha", "bulah", "caddie", "celie", "charlotta", "clair", "concepcion", "cordella", "corrine", "delila", "delphine", "dosha", "edgar", "elaine", "elisa", "ellar", "elmire", "elvina", "ena", "estie", "etter", "fronnie", "genie", "georgina", "glenn", "gracia", "guadalupe", "gwendolyn", "hassie", "honora", "icy", "isa", "isadora", "jesse", "jewel", "joe", "johannah", "juana", "judith", "judy", "junie", "lavonia", "lella", "lemma", "letty", "linna", "littie", "lollie", "lorene", "louis", "love", "lovisa", "lucina", "lynn", "madora", "mahalia", "manervia", "manuela", "margarett", "margaretta", "margarita", "marilla", "mignon", "mozella", "natalie", "nelia", "nolie", "omie", "opal", "ossie", "ottie", "ottilia", "parthenia", "penelope", "pinkey", "pollie", "rennie", "reta", "roena", "rosalee", "roseanna", "ruthie", "sabra", "sannie", "selena", "sibyl", "tella", "tempie", "tennessee", "teressa", "texas", "theda", "thelma", "thursa", "ula", "vannie", "verona", "vertie", "wilma", "adell", "aggie", "alcie", "alfreda", "alicia", "allene", "almyra", "anastacia", "andrea", "archie", "aria", "arminda", "audrey", "aura", "avie", "berdie", "buena", "calista", "cammie", "cara", "celesta", "celeste", "chaney", "chanie", "charlie", "charlottie", "chrissie", "christene", "christiana", "cleora", "clora", "coralie", "dana", "dave", "david", "dayse", "dean", "delfina", "deliah", "delina", "delle", "dicy", "donia", "dulcie", "earl", "edward", "edwina", "ela", "eleonora", "elta", "elvie", "elza", "elzada", "emaline", "ester", "eulah", "eulalie", "euna"];

const CHALLENGE_CITIES = [
    "tokyo", "delhi", "shanghai", "dhaka", "sao paulo", "mexico city", "cairo", "beijing", "mumbai", "osaka", "chongqing", "karachi", "kinshasa", "lagos", "istanbul", "buenos aires", "kolkata", "manila", "guangzhou", "tianjin", "lahore", "rio de janeiro", "bogota", "shenzhen", "lima", "paris", "bangkok", "seoul", "nagoya", "hyderabad", "london", "tehran", "chicago", "chengdu", "nanjing", "wuhan", "ho chi minh city", "luanda", "ahmedabad", "kuala lumpur", "new york", "los angeles", "toronto", "madrid", "barcelona", "rome", "berlin", "amsterdam", "sydney", "melbourne"
];

const CHALLENGE_EXTRA = [
    'julians', 'apollo', 'hayes', 'foirage', 'juilans', 'polloo', 'pollooo', 'hoco', 'eventful', 'face card', 'rent free', 'ur favorite', 'your fav', '10/10', 'unbothered', 'main character', 'obsessed', 'villain era', 'too good for u', 'your loss', 'catch me if u can', 'always winning', 'stay mad', 'untouchable', 'period', 'slay', 'ate', 'ate and left no crumbs', 'mother', 'serving', 'iconic', 'it girl', 'drafts', 'from the drafts', 'just because', 'oops', 'camera roll', 'photo dump', 'lighting was good', 'bored', 'idk', 'felt cute', 'might delete', 'random', 'spontaneous', 'messy hair', 'no makeup', 'natural', 'angel', 'angelic', 'princess', 'cherry', 'sweet', 'doll', 'dolled up', 'pretty in pink', 'coquette', 'balletcore', 'fairy', 'ethereal', 'soft', 'lover girl', 'dreamy', 'about last night', 'gno', 'out out', 'blurred nights', 'city girls', 'vip', 'after hours', 'midnight', 'moonlight', 'glow', 'golden hour', 'gains', 'gym rat', 'vitamin d', 'vitamin sea', 'out of office', 'heat wave', 'sunkissed', 'tan lines', 'bikini szn', 'poolside', 'summer vibes', 'island girl', 'tropical', 'sweat', 'pump', 'vibes', 'mood', 'era', 'energy', 'valid', 'real', 'literally', 'tbh', 'iykyk', 'pov', 'npc', 'delulu', 'solulu', 'roman empire', '🎀🩰🤍🦢', '💅🏼💋🍷🥀', '🌺🥥🌊☀️', '👼🏼✨🍒🔥', '🧚‍♀️✨🍄', '🖤⛓️🕷️', '🦋💙🌊', '🥺👉👈', '🫶🏼✨', '🧿🤍', '🥂✨', '📸🤍', 'soft launch', 'hard launch', 'dump', 'life lately', 'recent', 'archive', 'core', 'aesthetic', 'muse', 'diva', 'flawless', 'not taking questions', 'mind your business', 'in my own lane', 'peaked', 'glowing', 'unmatched', 'one of one', 'limited edition', 'rare', 'top tier', 'wifey', 'baddie', 'sugar', 'spice', 'everything nice', 'xoxo', 'kisses', 'sweet as honey', 'heartbreaker', 'trouble', 'rebel', 'good girl', 'bad habits', 'late night drive', 'passenger princess', 'matcha', 'iced coffee', 'pilates', 'hot girl walk', 'self care', 'skincare', 'golden', 'sunshine', 'moonchild', 'starboy', 'stargirl',
    'chaya', 'shira', 'tamar', 'yael', 'miri', 'rivka', 'rachel', 'sarah', 'leah', 'miriam', 'batya', 'talia', 'hannah', 'shoshana', 'ayala', 'noa', 'maya', 'avigail', 'devorah', 'ester', 'yehudit',
    'nora', 'emma', 'sofie', 'linnea', 'olivia', 'emilie', 'ida', 'mathilde', 'thea', 'amalie', 'vilde', 'ingrid', 'mia', 'aurora', 'astrid', 'tuva', 'siri', 'malin', 'marit', 'alice', 'maja', 'elsa', 'freja', 'ebba', 'selma', 'alma', 'wilma', 'lilly', 'vera', 'ellen', 'ellinor', 'marta', 'elias', 'agnes', 'clara', 'juliette', 'moa', 'saga', 'linn',
    'pretty privilege', '10s across the board', 'lethal', 'certified', 'not a want but a need', 'museum quality', 'art', 'masterpiece', 'that girl', 'dream girl', 'fantasy', 'hallucination', 'unreal', 'surreal', 'brain empty', 'just vibes', 'whatever', 'anyway', 'scraps', 'leftovers', 'deleted later', 'unseen', 'bts', 'angel energy', 'heaven sent', 'divine', 'princess treatment', 'spoiled', 'sweet tooth', 'bad influence', 'troublemaker', 'too bad', 'heartless', 'cold', 'ice', 'out of focus', 'no sleep', 'oh', 'um', 'hm', 'wow', 'x', 'xx', 'bonita', 'chula', 'princesa', 'mi amor', 'bella', 'linda', 'mami', 'fuego', 'loca', 'soft era', 'lucky girl syndrome', 'plot twist', 'let me cook', 'mothering', 'serving face', 'face card lethal', 'no filter', 'pure', 'raw', 'candid', 'stuck in my head', 'rent is due', 'eviction notice', 'obsess over me', 'look at me', 'eyes on me', 'center of attention', 'wallflower who', 'gossip', 'rumors', 'whispers', 'loud', 'quiet luxury', 'old money', 'new money', 'rich spirit', 'blessed', 'favored', 'golden', 'honey', 'sugar coating', 'bittersweet', 'toxic', 'red flag', 'green flag', 'beige flag', 'delusional', 'delulu is the solulu', 'girl math', 'boy math', 'girl dinner', 'treat yourself', 'spa day', 'reset', 'sunday reset', 'glow up', 'level up', 'untouchable era', 'peace', 'zen', 'chaos', 'organized chaos', 'mess', 'hot mess', 'hot girl summer', 'sad girl autumn', 'feral girl fall', 'winter arc', 'spring awakening', 'blooming', 'blossoming', 'wilted', 'thriving', 'surviving', 'barely breathing', 'breathless', 'gasp', 'in my lane', 'focused', 'unbothered queen', 'icon', 'legend', 'my lore', 'canon event', 'character development', 'plot armor', 'main character energy', 'side quest', 'npc behavior', 'glitch in the matrix', 'simulation', 'awake', 'daydream', 'lucid', 'vivid', 'blurry', 'focus', 'paparazzi', 'smiles', 'tears', 'sweat', 'magic', 'illusion', 'cherry cola', 'matcha latte', 'martini', 'cheers', 'afterparty', 'bounce back', 'barbie', 'bratz', 'dollhouse', 'game over', 'top secret', 'leaked', 'exposed', 'cancelled', 'season 2', 'finale', 'premiere', 'pilot', 'episode', '✨🧚‍♀️🤍', '🦋✨☁️', '🍒💋🍷', '🖤⛓️🕷️', '🥺👉👈', '💅🏼✨💖', '🌺🥥🌊', '👼🏼✨🕊️', 'diosa', 'bichota', 'la queso', 'devoró', 'reinota', 'potra', 'modo diabla', 'bellaquita', 'flow cabron', 'sin filtro', 'chula', 'mami', 'bellísima', 'que liiinda', 'hermosa', 'biscoito', 'biscoiteira', 'gostosa', 'patroa', 'entregou tudo', 'perfeita', 'maravilhosa', 'bem menininha', 'gatona', 'deusa', 'gata', 'perfeição', 'la frappe', 'bombe', 'bg', 'pépite', 'incroyable', 'fais la meuf', 'canon', 'trop belle', 'pazzesca', 'bona', 'dea', 'stupenda', 'bellissima', 'che figa', '존예', '여신', '인생샷', '꾸안꾸', 'selca', 'jon-ye', 'yeoshin', 'insaeng-shot', 'ulzzang', 'hunnyeo', '盛れた', '優勝', '天才', 'moreta', 'yuushou', 'tensai', 'jidori', 'kawaii', 'gyaru', 'красотка', 'богиня', 'эстетика', 'krasotka', 'boginya', 'estetika', 'ganda', 'dyosa', 'kabog', 'pak', 'awra', 'dalagang pilipina', 'mashallah', 'hayati', 'amar', 'habibti', 'yalla', 'gönnen', 'wild', 'krass', 'maschine', 'gottlos', 'hübsche', 'muy top', 'me creo mucho', 'y la queso', 'punto y final', 'ni modo', 'soporta', 'la patrona', 'dueña', 'chika', 'ragazza', 'meuf', 'goce', 'poderosa', 'braba', 'intocable', 'reina', 'rainha', 'princesse', 'principessa', 'princesa', 'senorita', 'kraliçe', 'güzel', 'harika', 'şahane', 'preciosa', 'divina', 'impecable', 'sin rival', 'bikini', 'swim', 'swimwear', 'swimsuit', 'poolside', 'pool day', 'beach day', 'beach bum', 'sandy', 'sunkissed', 'tan lines', 'no tan lines', 'tanning', 'baking', 'roasting', 'melting', 'heat wave', 'too hot', 'sweaty', 'sweat', 'post workout', 'sauna', 'shower', 'towel', 'fresh out the shower', 'bedtime', 'sleepy', 'waking up', 'morning', 'nighties', 'pjs', 'lingerie', 'lace', 'undies', 'bare', 'skin', 'body', 'bodyodyody', 'bawdy', 'figure', 'waist', 'abs', 'glutes', 'gains', 'pump', 'clothing optional', 'less is more', 'peeling it off', 'stripping', 'naked', 'nudie', 'nude', 'spicy', 'exclusive', 'tease', 'teasing', 'naughty', 'bad girl', 'trouble', 'link in bio', 'onlyfans', 'of', 'fansly', 'patreon', 'vip', 'uncensored', 'uncut', 'raw', 'natural', 'no bra', 'braless', 'free the nipple', 'sheer', 'see through', 'wet', 'soaked', 'dripping', '💦', '🍑', '🍒', '👙', '🥵', '😈', '👅', 'ropa interior', 'traje de baño', 'bronceada', 'cuerpazo', 'calor', 'sudando', 'desnuda', 'en la cama', 'biquíni', 'praia', 'bronze', 'corpo', 'gostosa', 'caliente', 'fuego', 'desnudo', 'sin ropa', 'poca ropa', 'en cueros', 'pelotas', 'maillot', 'bronzage', 'nu', 'nue', 'nuda', 'spogliata', 'bagno', 'doccia', 'letto', 'nackt', 'ausgezogen', 'bikiniszn', 'hot girl summer', 'body checking', 'physique', 'curves', 'slim thick', 'hourglass', 'thick', 'thicc', 'cake', 'dump truck', 'assets', 'cleavage', 'booty', 'ass', 'tits', 'boobs', 'cheeky', 'thong', 'g string', 'micro bikini', 'scanty', 'revealing', 'skin out', 'flesh', 'birthday suit', 'undressed', 'unbuttoned', 'unzipped', 'slipping off', 'falling off', 'barely there', 'minimalist', 'link in bio', '🔗', '🌶️', 'backup', 'finsta', 'main account', 'do not disturb', 'dnd', 'out of office', 'ooo', 'mentally here', 'island time', 'need a vacation', 'take me back', 'my element', 'water baby', 'mermaid', 'siren', 'sweet dreams', 'good morning', 'goodnight', 'late night', 'after hours', 'night owl', 'insomnia', 'can’t sleep', 'your favorite view', 'the view', 'pov', 'just a reminder', 'in case you forgot', 'face card', 'body card', 'not yours', 'untouchable', 'rare', '1 of 1', 'limited edition', 'lost files', 'drafts', 'unreleased', 'from the vault', 'deleted later', 'might delete', 'catch me if u can', 'too fast', 'out of reach', 'obsessed', 'stay mad', 'cry about it', 'sorry not sorry', 'brb', 'afk', 'offline', 'living', 'thriving', 'unbothered', 'hi', 'me again', 'yup', 'anyways', 'whatever', 'blah blah', 'oops', 'my bad', 'innocent', 'angel', 'angel energy', 'heaven sent', 'good girl', 'trouble', 'bad habit', 'addicting', 'toxic', 'red flag', 'pretty privilege', 'princess', 'princess treatment', 'spoil me', 'brat', 'doll', 'barbie', 'scorpio', 'leo', 'gemini', 'libra', 'taurus', 'virgo', '♋️', '♏️', '♌️', '♒️', '♓️', '11:11', '777', '888', '444', 'angel numbers', 'manifesting', 'blessed', 'lucky', 'lucky girl', 'soft', 'delicate', 'fragile', 'handle with care', 'fragile ego', 'ego boost', 'stroke my ego', 'worship', 'muse', 'art', 'masterpiece', 'gallery', 'exhibit a', 'study me', 'pay attention', 'eyes here', 'focus', 'distraction', 'heartbreaker', 'soul snatcher', 'lethal', 'danger', 'warning', 'hazard', 'too hot to handle', 'burning up', 'fever', 'chills', 'goosebumps', 'sweat', 'glow', 'glowing', 'shiny', 'glazed', '🍒', '🍑', '🍓', '💦', '💧', '🛁', '🚿', '🧼', '👙', '🌴', '🌺', '🥥', '☀️', '🌊', '🥂', '🍾', '🤍', '🖤', '🥀', '💋', '💄', '👼🏼', '😈', '🐈‍⬛', '🎀', '🧸', 'xoxo', 'kisses', 'mwah', 'besos', 'amor', 'mi vida', 'la toxica', 'diabla', 'teasing', 'just a taste', 'appetizer', 'main course', 'dessert', 'craving', 'thirsty', 'quench', 'hydration', 'drink water'

];

function generateRandomTerms() {
    const terms = [];
    for (let i = 0; i <= 20; i++) terms.push(i.toString());
    const chars = 'abcdefghijklmnopqrstuvwxyz!?@#$%&*';
    for (let i = 0; i < 20; i++) {
        let str = '';
        const len = Math.floor(Math.random() * 3) + 1;
        for (let j = 0; j < len; j++) str += chars.charAt(Math.floor(Math.random() * chars.length));
        terms.push(str);
    }
    return terms;
}

function shuffleArray(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function refreshPfpSourceTermOptions() {
    if (!pfpSourceTermList) return;
    const terms = Object.keys(scrapeHistory || {})
        .filter(term => String(term || '').trim())
        .sort((a, b) => (scrapeHistory[b] || 0) - (scrapeHistory[a] || 0))
        .slice(0, 2000);
    pfpSourceTermList.innerHTML = terms
        .map(term => `<option value="${escapeHtml(term)}"></option>`)
        .join('');
}

function toggleScraperUi() {
    if (mode === 'challenge') {
        mode = null;
        fetching = false;
        challengeBtn.textContent = "⏳ Scraper";
        scraperUi.style.display = 'none';
        stopProfilePrefetch();
        return;
    }

    mode = 'challenge';
    browseBtn.textContent = "🌐 Live Feed";
    challengeBtn.textContent = "⏹ Stop Scraper";
    scraperUi.style.display = 'flex';
    refreshPfpSourceTermOptions();
    grid.style.display = ""; // Reset block display from review view
    grid.classList.remove('review-queue-active');
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());
    hideHeaderMap();
    stopProfilePrefetch();

    // Default to the current local day.
    if (!tmStart.value) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setMinutes(start.getMinutes() - start.getTimezoneOffset());

        const end = new Date();
        end.setHours(23, 59, 0, 0);
        end.setMinutes(end.getMinutes() - end.getTimezoneOffset());

        tmStart.value = start.toISOString().slice(0, 16);
        tmEnd.value = end.toISOString().slice(0, 16);
    }

    // Load existing
    allResults = [];
    resetPagination();
    grid.innerHTML = '';
    seenIds.clear();

    stopAutoPfp();
    if (autoPfpEnabled) initAutoPfpObserver();

    info.textContent = `Scraper mode ready. Local vault has ${masterScrapeCount.toLocaleString()} images. Select timeframe and click Start or Filter Local.`;
}

function stopScraper() {
    if (scraperState === 'running') scraperState = 'stopping';
    fetching = false;
    if (scraperAbort) { scraperAbort.abort(); scraperAbort = null; }
    if (startScrapeBtn) {
        startScrapeBtn.textContent = 'Start';
        startScrapeBtn.classList.remove('btn-start-running');
    }
    if (mode === 'challenge') {
        info.textContent = `Scraping paused/finished.`;
    }
    scraperState = 'idle';
}

function applyVaultFiltersAndSort(preservePagination = false) {
    allResults = [];
    seenIds.clear();
    const vaultTimestamp = item => vaultPageState?.dateMode === 'fetched'
        ? Number(item?.vaultFetchedAt || 0)
        : getTimestamp(item);

    currentVaultRawItems.forEach(img => {
        const id = getItemPrimaryId(img);
        if (!id) return;
        if (!showHiddenItemsTemporarily && isHiddenItem(img)) return;
        if (img.grid?.siteId && fullyLikedSiteIds.has(String(img.grid.siteId))) return;
        if (seenIds.has(String(id))) return; // prevent exact db dupes
        seenIds.add(String(id));

        // A scrape profile has isProfile explicitly set to true.
        const isProfile = img.isProfile === true;

        if (vaultFilterMode === 'images' && isProfile) return;
        if (vaultFilterMode === 'profiles' && !isProfile) return;

        // Register exactly the PFP represented by this saved Vault row before
        // any live sites-endpoint check. Existing baselines are never replaced.
        const vaultSiteId = getItemSiteId(img);
        const vaultPfpUrl = getItemProfilePicUrl(img);
        if (vaultSiteId && vaultPfpUrl) seedPfpBaselineIfMissing(vaultSiteId, vaultPfpUrl);

        allResults.push(img);
    });

    if (vaultSortMode === 'newest') {
        allResults.sort((a, b) => vaultTimestamp(b) - vaultTimestamp(a));
    } else if (vaultSortMode === 'pfp-newest') {
        allResults.sort((a, b) => getProfilePicTimestamp(b) - getProfilePicTimestamp(a));
    } else if (vaultSortMode === 'oldest') {
        allResults.sort((a, b) => vaultTimestamp(a) - vaultTimestamp(b));
    } else if (vaultSortMode === 'random') {
        for (let i = allResults.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allResults[i], allResults[j]] = [allResults[j], allResults[i]];
        }
    } else if (vaultSortMode === 'grouped') {
        allResults.sort((a, b) => {
            const siteA = a.grid?.siteId || 0;
            const siteB = b.grid?.siteId || 0;
            if (siteA !== siteB) return siteA - siteB;
            return vaultTimestamp(b) - vaultTimestamp(a);
        });
    }

    grid.innerHTML = '';
    if (preservePagination) {
        currentPage = 0;
        displayedCount = Math.min(Math.max(displayedCount || PAGE_SIZE, PAGE_SIZE), allResults.length);
    } else {
        resetPagination();
    }
    document.querySelectorAll('.vault-controls-bar').forEach(el => el.remove());
    renderVaultControls();

    // Enable the dual view CSS grid styling if any card requires it
    grid.classList.toggle('grid-dual-pfp', autoPfpEnabled);

    renderNew();
}

function renderVaultControls() {
    if (mode !== 'challenge' || currentVaultRawItems.length === 0) return;
    const bar = document.createElement("div");
    bar.className = "vault-controls-bar sort-bar";
    bar.innerHTML = `
      <span class="sort-label">Show:</span>
      <button class="sort-btn ${vaultFilterMode === 'all' ? 'active' : ''}" data-vfilter="all">All</button>
      <button class="sort-btn ${vaultFilterMode === 'images' ? 'active' : ''}" data-vfilter="images">🖼 Images</button>
      <button class="sort-btn ${vaultFilterMode === 'profiles' ? 'active' : ''}" data-vfilter="profiles">👤 Profiles</button>
      <span class="sort-divider"></span>
      <label class="vault-toggle exif-gps-toggle ${exifGpsFilterOnly ? 'active' : ''}">
        <input type="checkbox" id="vault-filter-exifgps" ${exifGpsFilterOnly ? 'checked' : ''} ${appSettings.gpsEnabled ? '' : 'disabled'}>
        <span>📍 Has EXIF GPS</span>
      </label>
      <label class="vault-toggle ${showHiddenItemsTemporarily ? 'active' : ''}" title="Temporarily reveal hidden images and users without changing saved hidden IDs">
        <input type="checkbox" id="vault-show-hidden" ${showHiddenItemsTemporarily ? 'checked' : ''}>
        <span>👁 Show Hidden</span>
      </label>
      <span class="sort-divider"></span>
      <span class="sort-label">Sort:</span>
      <button class="sort-btn ${vaultSortMode === 'newest' ? 'active' : ''}" data-vsort="newest">📷 Newest</button>
      <button class="sort-btn ${vaultSortMode === 'oldest' ? 'active' : ''}" data-vsort="oldest">🕰 Oldest</button>
      <button class="sort-btn ${vaultSortMode === 'grouped' ? 'active' : ''}" data-vsort="grouped">📂 Group by User</button>
      <button class="sort-btn ${vaultSortMode === 'random' ? 'active' : ''}" data-vsort="random">🔀 Random</button>
      ${vaultPageState?.hasMore ? `<span class="sort-divider"></span><button class="sort-btn" id="vault-load-older" ${vaultPageLoadInProgress ? 'disabled' : ''}>${vaultPageLoadInProgress ? 'Loading…' : `⬇ Load ${FILTER_LOCAL_PAGE_SIZE.toLocaleString()} older`}</button>` : ''}
    `;
    bar.querySelectorAll('button[data-vfilter]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            vaultFilterMode = btn.dataset.vfilter;
            applyVaultFiltersAndSort();
        });
    });
    bar.querySelectorAll('button[data-vsort]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            vaultSortMode = btn.dataset.vsort;
            applyVaultFiltersAndSort();
        });
    });
    const exifGpsToggle = bar.querySelector('#vault-filter-exifgps');
    if (exifGpsToggle) {
        exifGpsToggle.addEventListener('change', () => {
            setExifGpsFilterOnly(exifGpsToggle.checked);
            applyVaultFiltersAndSort();
        });
    }
    const showHiddenToggle = bar.querySelector('#vault-show-hidden');
    if (showHiddenToggle) {
        showHiddenToggle.addEventListener('change', () => {
            showHiddenItemsTemporarily = showHiddenToggle.checked;
            applyVaultFiltersAndSort();
            info.textContent = showHiddenItemsTemporarily
                ? `Temporarily showing hidden items. Saved hidden IDs are unchanged.`
                : `Hidden items are hidden again. Saved hidden IDs are unchanged.`;
        });
    }
    const loadOlderBtn = bar.querySelector('#vault-load-older');
    if (loadOlderBtn) loadOlderBtn.addEventListener('click', loadOlderVaultPage);
    grid.before(bar);
}

async function loadOlderVaultPage() {
    if (!vaultPageState?.hasMore || vaultPageLoadInProgress) return;
    vaultPageLoadInProgress = true;
    const previousLoaded = currentVaultRawItems.length;
    const loadOlderBtn = document.getElementById('vault-load-older');
    if (loadOlderBtn) {
        loadOlderBtn.disabled = true;
        loadOlderBtn.textContent = 'Loading…';
    }
    info.textContent = `Loading the next ${FILTER_LOCAL_PAGE_SIZE.toLocaleString()} older Vault items…`;

    try {
        const pageLoader = vaultPageState.dateMode === 'fetched' ? fetchVaultFetchedPage : fetchVaultRangePage;
        const page = await pageLoader(vaultPageState.startTime, vaultPageState.endTime, vaultPageState.nextKey, FILTER_LOCAL_PAGE_SIZE);
        const existingIds = new Set(currentVaultRawItems.map(getItemPrimaryId).filter(Boolean).map(String));
        for (const item of page.items) {
            const id = String(getItemPrimaryId(item) || '');
            if (!id || existingIds.has(id)) continue;
            existingIds.add(id);
            if (typeof item.hasExifGps !== 'boolean') item.hasExifGps = hasExifGpsData(item);
            currentVaultRawItems.push(item);
        }
        vaultPageState.nextKey = page.nextKey;
        vaultPageState.hasMore = page.hasMore;
    } catch (error) {
        console.error('[Filter] Failed to load older Vault page:', error);
        vaultPageLoadInProgress = false;
        applyVaultFiltersAndSort(true);
        info.textContent = `⚠️ Could not load older Vault items: ${error?.message || error}`;
        return;
    } finally {
        vaultPageLoadInProgress = false;
    }

    applyVaultFiltersAndSort(true);
    const added = currentVaultRawItems.length - previousLoaded;
    info.textContent = `Loaded ${added.toLocaleString()} older items · ${currentVaultRawItems.length.toLocaleString()} loaded from the selected range${vaultPageState.hasMore ? ' · more available' : ' · end of range'}.`;
}

async function filterLocalDb() {
    stopScraper();
    mode = 'challenge';
    vaultSortMode = 'random';
    const startTime = tmStart.value ? new Date(tmStart.value).getTime() : 0;
    const endTime = tmEnd.value ? new Date(tmEnd.value).getTime() : 8640000000000000;
    const dateMode = vaultDateMode?.value === 'fetched' ? 'fetched' : 'created';

    if (startTime && endTime && startTime > endTime) {
        info.textContent = '⚠️ Start date must be before end date. Please fix the time range.';
        return;
    }

    console.log(`[Filter] Time range: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);
    console.log(`[Filter] permanentSeenIds size: ${permanentSeenIds.size}`);

    info.textContent = `Loading ${FILTER_LOCAL_PAGE_SIZE.toLocaleString()} Vault items by ${dateMode === 'fetched' ? 'fetch time' : 'creation time'}, then shuffling…`;
    filterLocalBtn.disabled = true;
    const filterStartedAt = performance.now();
    let page;
    try {
        const pageLoader = dateMode === 'fetched' ? fetchVaultFetchedPage : fetchVaultRangePage;
        page = await pageLoader(startTime, endTime, null, FILTER_LOCAL_PAGE_SIZE);
    } catch (error) {
        console.error('[Filter] Vault page failed:', error);
        info.textContent = `⚠️ Could not filter the local Vault: ${error?.message || error}`;
        return;
    } finally {
        filterLocalBtn.disabled = false;
    }

    currentVaultRawItems = page.items;
    vaultPageState = {
        startTime,
        endTime,
        dateMode,
        nextKey: page.nextKey,
        hasMore: page.hasMore
    };
    currentVaultRawItems.forEach(img => {
        if (typeof img.hasExifGps !== 'boolean') {
            img.hasExifGps = hasExifGpsData(img);
        }
    });

    console.log(`[Filter] Raw items from DB in time range: ${currentVaultRawItems.length}`);
    if (currentVaultRawItems.length > 0) {
        const timestamps = currentVaultRawItems.slice(0, 5).map(img => {
            const ts = dateMode === 'fetched' ? Number(img.vaultFetchedAt || 0) : getTimestamp(img);
            return { id: img.imageId?.slice(0, 12), ts, date: new Date(ts).toISOString() };
        });
        console.log(`[Filter] Sample ${dateMode} timestamps:`, timestamps);
    }

    applyVaultFiltersAndSort();

    const hiddenCount = currentVaultRawItems.length - allResults.length;
    const elapsedMs = Math.round(performance.now() - filterStartedAt);
    info.textContent = `Filtered Local Vault by ${dateMode === 'fetched' ? 'fetch time' : 'creation time'} in ${elapsedMs.toLocaleString()}ms: ${allResults.length.toLocaleString()} loaded${hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}${vaultPageState.hasMore ? ' · older items available' : ' · end of selected range'}. Hidden total: ${permanentSeenIds.size}. Vault total: ${masterScrapeCount.toLocaleString()}`;
}

function addDiagnosticTextTerms(group, value) {
    const before = group.terms.length;
    addFullyLikedScrapeText(group.terms, group.seen, value);
    return group.terms.length - before;
}

function createDiagnosticGroup(label) {
    return { label, terms: [], seen: new Set() };
}

function sampleDiagnosticTerms(terms, limit = 12) {
    return shuffleArray(terms.filter(term => String(term || '').trim().length >= 2)).slice(0, limit);
}

function countRecentDiagnosticItems(items, startTime, endTime, timestampGetter) {
    const seen = new Set();
    let recent = 0;
    let total = 0;
    items.forEach(item => {
        const id = getItemPrimaryId(item) || item?.siteId || item?.siteSubDomain || item?.responsive_url || JSON.stringify(item).slice(0, 80);
        const key = String(id || '');
        if (!key || seen.has(key)) return;
        seen.add(key);
        total++;
        const ts = timestampGetter(item);
        if (ts >= startTime && ts <= endTime) recent++;
    });
    return { total, recent };
}

async function buildScrapeDiagnosticGroups(signal, deadlineMs) {
    const groups = [];
    const sources = getFollowedScrapeSources();

    const localUsernames = createDiagnosticGroup('Saved liked usernames/names');
    const localBio = createDiagnosticGroup('Saved liked bios/names');
    const localDescriptions = createDiagnosticGroup('Saved liked image descriptions');

    Object.values(fullyLikedImages || {}).forEach(img => {
        addDiagnosticTextTerms(localUsernames, img?.grid?.subdomain);
        addDiagnosticTextTerms(localUsernames, img?.perma_subdomain);
        addDiagnosticTextTerms(localUsernames, img?.userName);
        addDiagnosticTextTerms(localBio, img?.gridName);
        addDiagnosticTextTerms(localDescriptions, img?.description);
    });
    Object.values(likedProfiles || {}).forEach(profile => {
        addDiagnosticTextTerms(localUsernames, profile?.username);
        addDiagnosticTextTerms(localUsernames, profile?.displayName);
        addDiagnosticTextTerms(localBio, profile?.bio);
        asLikedProfileDescriptionArray(profile?.imageDescriptions).forEach(desc => addDiagnosticTextTerms(localDescriptions, desc));
    });

    [localUsernames, localBio, localDescriptions].forEach(group => {
        if (group.terms.length > 0) groups.push(group);
    });

    if (hasEnabledFollowedScrapeInputs(sources) && Date.now() < deadlineMs) {
        const { profiles } = await fetchFollowingProfilesForScrape(signal, Math.min(deadlineMs, Date.now() + FOLLOWING_REPOST_TIME_BUDGET_MS));
        const sampledProfiles = shuffleArray(profiles).slice(0, 24);

        if (sources.usernames) {
            const group = createDiagnosticGroup('Followed usernames/names');
            sampledProfiles.forEach(profile => {
                addDiagnosticTextTerms(group, profile.username);
                addDiagnosticTextTerms(group, profile.displayName);
            });
            if (group.terms.length > 0) groups.push(group);
        }

        if (sources.bio) {
            const group = createDiagnosticGroup('Followed bios');
            sampledProfiles.forEach(profile => addDiagnosticTextTerms(group, profile.bio));
            if (group.terms.length > 0) groups.push(group);
        }

        if (sources.imageDescriptions) {
            const group = createDiagnosticGroup('Followed recent image descriptions');
            const detailProfiles = sampledProfiles.slice(0, 5);
            for (const profile of detailProfiles) {
                if (Date.now() > deadlineMs) break;
                await addFollowedImageDescriptionDiagnosticTerms(profile, group, signal, deadlineMs);
            }
            if (group.terms.length > 0) groups.push(group);
        }

        if (appSettings.followedScrapeRepostedUsers === true) {
            const group = createDiagnosticGroup('People reposted by followed users');
            const repostProfiles = sampledProfiles.slice(0, MAX_FOLLOWING_REPOST_PROFILES);
            for (const profile of repostProfiles) {
                if (Date.now() > deadlineMs) break;
                await addFollowedRepostedUserTerms(profile, group.terms, group.seen, { usernames: true, bio: sources.bio, imageDescriptions: false }, signal, deadlineMs);
            }
            if (group.terms.length > 0) groups.push(group);
        }
    }

    return groups;
}

async function runScrapeSourceDiagnostic() {
    if (scraperState === 'running') {
        info.textContent = 'Stop the scraper before testing sources.';
        return;
    }

    const startTime = tmStart.value ? new Date(tmStart.value).getTime() : 0;
    const endTime = tmEnd.value ? new Date(tmEnd.value).getTime() : 8640000000000000;
    if (startTime && endTime && startTime > endTime) {
        info.textContent = '⚠️ Start date must be before end date. Please fix the time range.';
        return;
    }

    const controller = new AbortController();
    const deadlineMs = Date.now() + 30000;
    const requestOptions = { timeoutMs: 10000, maxRetries: 1, silentAuth: true };

    sourceTestBtn.disabled = true;
    sourceTestBtn.textContent = 'Testing...';
    info.textContent = 'Testing scrape sources on the selected date range...';
    scrapeStats.innerHTML = 'Sampling terms and counting recent results...';

    try {
        const groups = await buildScrapeDiagnosticGroups(controller.signal, deadlineMs);
        const activeGroups = groups
            .map(group => ({ ...group, sample: sampleDiagnosticTerms(group.terms) }))
            .filter(group => group.sample.length > 0)
            .slice(0, 8);

        if (activeGroups.length === 0) {
            scrapeStats.innerHTML = 'No source terms available for the current settings.';
            return;
        }

        const rows = [];
        for (const group of activeGroups) {
            let imageTotal = 0;
            let imageRecent = 0;
            let profileTotal = 0;
            let profileRecent = 0;
            let authError = false;

            for (const term of group.sample) {
                if (Date.now() > deadlineMs) break;
                const [imageRes, peopleRes] = await Promise.all([
                    fetchQuery(term, 200, controller.signal, requestOptions),
                    fetchPeople(term, controller.signal, 1, requestOptions)
                ]);
                if (imageRes.authError || peopleRes.authError) authError = true;

                const imageCounts = countRecentDiagnosticItems(imageRes.results || [], startTime, endTime, getTimestamp);
                const peopleCounts = countRecentDiagnosticItems(peopleRes.results || [], startTime, endTime, getPersonTimestamp);
                imageTotal += imageCounts.total;
                imageRecent += imageCounts.recent;
                profileTotal += peopleCounts.total;
                profileRecent += peopleCounts.recent;
            }

            rows.push({
                label: group.label,
                sampled: group.sample.length,
                available: group.terms.length,
                imageTotal,
                imageRecent,
                profileTotal,
                profileRecent,
                totalRecent: imageRecent + profileRecent,
                authError,
                examples: group.sample.slice(0, 4)
            });
        }

        rows.sort((a, b) => b.totalRecent - a.totalRecent || (b.imageTotal + b.profileTotal) - (a.imageTotal + a.profileTotal));
        const dateLabel = `${new Date(startTime || 0).toLocaleString()} → ${endTime === 8640000000000000 ? 'any future' : new Date(endTime).toLocaleString()}`;
        scrapeStats.innerHTML = `
            <div style="width:100%; overflow:auto;">
              <div style="margin-bottom:8px;"><b>Source effectiveness sample</b> · date range: ${escapeHtml(dateLabel)} · terms per source: up to 12</div>
              <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead>
                  <tr style="color:#aaa; text-align:left;">
                    <th style="padding:6px; border-bottom:1px solid #333;">Source</th>
                    <th style="padding:6px; border-bottom:1px solid #333;">Recent</th>
                    <th style="padding:6px; border-bottom:1px solid #333;">Images</th>
                    <th style="padding:6px; border-bottom:1px solid #333;">Profiles</th>
                    <th style="padding:6px; border-bottom:1px solid #333;">Terms</th>
                    <th style="padding:6px; border-bottom:1px solid #333;">Examples</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(row => `
                    <tr>
                      <td style="padding:6px; border-bottom:1px solid #222;">${escapeHtml(row.label)}${row.authError ? ' ⚠️' : ''}</td>
                      <td style="padding:6px; border-bottom:1px solid #222;"><b>${row.totalRecent.toLocaleString()}</b></td>
                      <td style="padding:6px; border-bottom:1px solid #222;">${row.imageRecent.toLocaleString()} recent / ${row.imageTotal.toLocaleString()} checked</td>
                      <td style="padding:6px; border-bottom:1px solid #222;">${row.profileRecent.toLocaleString()} recent / ${row.profileTotal.toLocaleString()} checked</td>
                      <td style="padding:6px; border-bottom:1px solid #222;">${row.sampled}/${row.available.toLocaleString()}</td>
                      <td style="padding:6px; border-bottom:1px solid #222; color:#aaa;">${escapeHtml(row.examples.join(', '))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
        `;
        info.textContent = `Tested ${rows.length} source groups. Best recent source: ${rows[0]?.label || 'none'} (${(rows[0]?.totalRecent || 0).toLocaleString()} recent hits).`;
    } catch (e) {
        console.error('Source diagnostic failed:', e);
        scrapeStats.innerHTML = `Source test failed: ${escapeHtml(e?.message || String(e))}`;
        info.textContent = 'Source test failed.';
    } finally {
        sourceTestBtn.disabled = false;
        sourceTestBtn.textContent = '🧪 Test Sources';
    }
}

async function runScraper(e) {
    const isSilent = (e === true);
    if (scraperState === 'running') {
        stopScraper();
        return;
    }
    if (scraperState === 'stopping') return; // wait for previous run to finish stopping
    scraperState = 'running';
    fetching = true;
    scraperAbort = new AbortController();
    scraperSessionIds.clear();
    currentBackoffMs = INITIAL_BACKOFF_MS;
    activeHeavySearchConcurrency = HEAVY_SEARCH_INITIAL_CONCURRENCY;
    heavySearchSuccessStreak = 0;
    applyScraperRuntimePressure();
    startScrapeBtn.textContent = 'Stop';
    startScrapeBtn.classList.add('btn-start-running');

    const startTime = tmStart.value ? new Date(tmStart.value).getTime() : 0;
    const endTime = tmEnd.value ? new Date(tmEnd.value).getTime() : 8640000000000000;

    if (startTime && endTime && startTime > endTime) {
        info.textContent = '⚠️ Start date must be before end date. Please fix the time range.';
        stopScraper();
        return;
    }

    if (mode === 'challenge' && !isSilent) {
        info.textContent = `Starting scraper without loading local vault first...`;
    }

    if (mode === 'challenge' && !isSilent) {
        info.textContent = 'Loading followed-account scrape terms briefly...';
    }
    const followedTermRes = await getFollowedScrapeTerms(scraperAbort?.signal);
    if (mode === 'challenge' && !isSilent) {
        info.textContent = followedTermRes.disabled
            ? 'Followed-account scraping is turned off. Starting scrape...'
            : `Loaded ${followedTermRes.terms.length.toLocaleString()} followed-account terms. Starting scrape...`;
    }

    const allowFallbackTerms = hasEnabledFollowedScrapeInputs();
    let searchQueue = [];

    if (allowFallbackTerms) {
        if (!followedTermRes.disabled) {
            followedTermRes.terms.forEach(q => { if (!searchQueue.includes(q)) searchQueue.push(q); });
        }
        const hasFollowedTerms = searchQueue.length > 0;
        if (!hasFollowedTerms) {
            getFullyLikedScrapeTerms().forEach(q => { if (!searchQueue.includes(q)) searchQueue.push(q); });
        }
        if (!hasFollowedTerms) {
            const baseQueue = [
                ...CHALLENGE_TERMS,
                ...CHALLENGE_NAMES,
                ...CHALLENGE_EXTRA,
                ...CHALLENGE_CITIES,
                ...generateRandomTerms()
            ].sort(() => Math.random() - 0.5);

            baseQueue.forEach(q => {
                if (!searchQueue.includes(q) && !scrapeHistory[q]) {
                    searchQueue.push(q);
                }
            });
        }
    } else {
        customQueue.forEach(q => { if (!searchQueue.includes(q)) searchQueue.push(q); });
    }

    if (searchQueue.length === 0) {
        info.textContent = 'No queue terms available. Add custom queue terms or turn on a follow-source toggle.';
        stopScraper();
        return;
    }

    searchQueue = shuffleArray(searchQueue);

    if (mode === 'challenge') renderAutoPfpToggle();

    let stats = { imgApi: 0, peopleApi: 0, queries: {}, started: 0, processed: 0, queuedForSave: 0, saved: 0 };
    let totalAddedThisRun = 0;
    let authFailed = false;
    let rateLimitFailed = false;
    let requestFailed = false;
    let queueIndex = 0;

    const processScrapeQuery = async (q) => {
        if (!fetching || scraperState !== 'running') return;
        stats.started++;
        if (mode === 'challenge') {
            info.textContent = `Background Scrape: "${q}"... (Started ${stats.started}/${searchQueue.length}, Done ${stats.processed}, ${getScraperTuningLabel()}, Vault size: ${masterScrapeCount.toLocaleString()})`;
        }

        const signal = scraperAbort?.signal;

        const requestOptions = { timeoutMs: 12000, maxRetries: 1 };
        const resultJobs = [];
        const scrapeDescriptions = appSettings.scraperTargetDescriptions !== false || appSettings.scraperTargetProfileBio === false;
        const scrapeProfiles = appSettings.scraperTargetProfileBio === true;

        if (scrapeDescriptions) {
            resultJobs.push(async () => ({ type: 'images', res: await fetchQuery(q, SCRAPER_QUERY_SIZE, signal, requestOptions) }));
        }

        if (scrapeProfiles) {
            const gridRequestOptions = { ...requestOptions, timeoutMs: API_TIMEOUT_MS, maxRetries: MAX_RETRIES };
            resultJobs.push(async () => ({ type: 'people', res: await fetchPeople(q, signal, 1, gridRequestOptions, SCRAPER_QUERY_SIZE) }));
        }

        stats.queries[q] = { imgCount: 0, peopleCount: 0 };
        let queuedForQuery = 0;
        const querySaveJobs = [];

        const saveScrapeItems = (items) => {
            let newImagesToSave = [];
            for (const img of items) {
                if (!img.sourceQuery) img.sourceQuery = q;
                const id = img.imageId;
                if (!id) continue;
                if (scraperSessionIds.has(id)) continue;
                scraperSessionIds.add(id);
                newImagesToSave.push(img);
            }

            if (newImagesToSave.length === 0) return 0;

            stats.queuedForSave += newImagesToSave.length;
            const saveJob = queueVaultSave(newImagesToSave, { fast: true }).then(savedCount => {
                masterScrapeCount += savedCount;
                totalAddedThisRun += savedCount;
                stats.saved += savedCount;
                if (mode === 'challenge' && scraperState === 'running') {
                    scrapeStats.innerHTML = `${getScraperTuningLabel()} | Started: <b>${stats.started}</b> | Done: <b>${stats.processed}</b> | Save queue: <b>${Math.max(0, stats.queuedForSave - stats.saved).toLocaleString()}</b> | Saved: <b>${stats.saved.toLocaleString()}</b>`;
                }
            }).catch(e => console.error("IDB save error:", e));
            querySaveJobs.push(saveJob);

            return newImagesToSave.length;
        };

        for (const runJob of resultJobs) {
            const { type, res } = await runJob();

            if (!fetching || scraperState !== 'running') break;
            if (res.authError) {
                authFailed = true;
                fetching = false;
                info.textContent = `⚠️ Not logged in to VSCO. Please log in at vsco.co and restart the scraper.`;
                break;
            }
            if (res.rateLimited) {
                rateLimitFailed = true;
                fetching = false;
                scraperAbort?.abort();
                info.textContent = '⚠️ VSCO kept rate limiting after retries. Scraper stopped for cooldown; restart it later to continue the remaining queue.';
                break;
            }
            if (res.error && res.error !== 'aborted') {
                requestFailed = true;
                fetching = false;
                scraperAbort?.abort();
                info.textContent = `⚠️ VSCO request failed after retries (${res.error}). Scraper stopped without consuming the queued term.`;
                break;
            }

            if (type === 'images') {
                const imageResults = res.results || [];
                stats.queries[q].imgCount = imageResults.length;
                stats.imgApi += imageResults.length;
                queuedForQuery += saveScrapeItems(imageResults);
            } else {
                const peopleImages = [];
                for (const p of (res.results || [])) {
                    if (!p?.gridImageId || typeof p.gridImageId !== 'string' || !p.responsive_url) continue;
                    peopleImages.push({
                        imageId: p.gridImageId,
                        responsive_url: p.responsive_url,
                        site_profile_image_url: getPersonProfilePicUrl(p) || '',
                        description: p.gridName || p.userName,
                        upload_date: getPersonTimestamp(p),
                        isProfile: true,
                        grid: { siteId: p.siteId, subdomain: p.siteSubDomain },
                        sourceQuery: q
                    });
                }

                stats.queries[q].peopleCount = peopleImages.length;
                stats.peopleApi += peopleImages.length;
                queuedForQuery += saveScrapeItems(peopleImages);
            }

            if (mode === 'challenge') {
                scrapeStats.innerHTML = `${getScraperTuningLabel()} | Active: <b>${Math.max(0, stats.started - stats.processed)}</b> | Last Queued: <b>${escapeHtml(q)} (+${queuedForQuery})</b> | Done: <b>${stats.processed}/${searchQueue.length}</b> | Save queue: <b>${Math.max(0, stats.queuedForSave - stats.saved).toLocaleString()}</b> | Hits - Img: <b>${stats.imgApi}</b> Prof: <b>${stats.peopleApi}</b>`;
            }
        }

        // Apply backpressure so the next 10k payload does not arrive while
        // this term is still saturating IndexedDB and the renderer process.
        await Promise.all(querySaveJobs);

        // Only consume a queued term after its requests completed. A term that
        // hits auth/rate-limit/abort remains available for a later retry.
        if (fetching && scraperState === 'running' && !authFailed && !rateLimitFailed && !requestFailed) {
            try {
                await markQueuedTermCompleted(q);
            } catch (error) {
                requestFailed = true;
                fetching = false;
                scraperAbort?.abort();
                console.error('Failed to persist completed scraper term:', q, error);
                info.textContent = `⚠️ Scraped "${q}" but could not save queue progress. Scraper stopped to avoid repeating completed terms.`;
            }
        }

        stats.processed++;

        if (mode === 'challenge') {
            scrapeStats.innerHTML = `${getScraperTuningLabel()} | Last Done: <b>${escapeHtml(q)} (+${queuedForQuery} queued)</b> | Done: <b>${stats.processed}/${searchQueue.length}</b> | Save queue: <b>${Math.max(0, stats.queuedForSave - stats.saved).toLocaleString()}</b> | Hits - Img: <b>${stats.imgApi}</b> Prof: <b>${stats.peopleApi}</b>`;
        }

    };

    const workerCount = Math.min(SCRAPER_CONCURRENCY, searchQueue.length);
    const workers = Array.from({ length: workerCount }, async (_, workerId) => {
        if (workerId > 0) {
            await new Promise(r => setTimeout(r, SCRAPER_WORKER_STAGGER_MS * workerId));
        }
        while (fetching && scraperState === 'running') {
            const q = searchQueue[queueIndex++];
            if (!q) break;
            await processScrapeQuery(q);
        }
    });

    try {
        await Promise.all(workers);
    } catch (e) {
        console.error("Scraper worker failed:", e);
        if (mode === 'challenge') {
            info.textContent = `Scraper hit an error and stopped: ${e?.message || e}`;
        }
    }

    fetching = false;
    scraperState = 'idle';
    scraperAbort = null;
    startScrapeBtn.textContent = 'Start';
    startScrapeBtn.classList.remove('btn-start-running');
    if (mode === 'challenge') {
        if (authFailed) {
            info.textContent = `⚠️ Not logged in to VSCO. Please log in at vsco.co and restart the scraper.`;
        } else if (rateLimitFailed) {
            info.textContent = `⚠️ VSCO kept rate limiting after retries. Scraper stopped for cooldown; restart it later to continue.`;
        } else if (requestFailed) {
            info.textContent = `⚠️ A VSCO request failed after retries. Scraper stopped without consuming the queued term.`;
        } else {
            const pendingSaves = Math.max(0, stats.queuedForSave - stats.saved);
            info.textContent = `Scraping paused/finished. Queued ${stats.queuedForSave.toLocaleString()} items; saved ${stats.saved.toLocaleString()} so far${pendingSaves ? ` (${pendingSaves.toLocaleString()} still writing)` : ''}. Click Filter Local to view.`;
        }
    }
}

startScrapeBtn.addEventListener('click', runScraper);
if (sourceTestBtn) sourceTestBtn.addEventListener('click', runScrapeSourceDiagnostic);
filterLocalBtn.addEventListener('click', filterLocalDb);
clearSeenBtn.addEventListener('click', async (e) => {
    // Shift+click = unhide all
    if (e.shiftKey) {
        if (!confirm(`Unhide ALL ${permanentSeenIds.size.toLocaleString()} previously hidden images? They will reappear in scraper results.`)) return;
        permanentSeenIds.clear();
        await saveHiddenIdsToDB();
        chrome.storage.local.remove('permanentSeenIds');
        info.textContent = `All images unhidden! Click Filter Local to reload.`;
        return;
    }

    // Only hide what was ACTUALLY physically intersected/scrolled past on the screen
    let displayedImages = [];
    document.querySelectorAll('.card').forEach(card => {
        const bounds = card.getBoundingClientRect();
        // If the top of the card hasn't passed the bottom of the visible screen window, it's scrolled past or on screen
        if (bounds.top < window.innerHeight && card._imgData) {
            displayedImages.push(card._imgData);
        }
    });

    // Safely fallback if images are tiny
    if (displayedImages.length === 0 && displayedCount > 0) {
        displayedImages = allResults.slice(0, Math.min(10, displayedCount));
    }

    if (displayedImages.length === 0) return;

    if (!confirm(`Hide the ${displayedImages.length.toLocaleString()} images you scrolled past?\n\n(Only images that actually entered your screen will be hidden)\n\nShift+click this button to UNHIDE all ${permanentSeenIds.size.toLocaleString()} hidden images.`)) return;

    displayedImages.forEach(img => markItemHidden(img));

    info.textContent = `Saving ${displayedImages.length.toLocaleString()} hidden images...`;
    await saveHiddenIdsToDB();

    if (mode === 'challenge' && currentVaultRawItems && currentVaultRawItems.length > 0) {
        applyVaultFiltersAndSort();
    } else {
        allResults = allResults.filter(img => !isHiddenItem(img));
        grid.innerHTML = '';
        resetPagination();
        renderNew();
    }
    info.textContent = `${displayedImages.length.toLocaleString()} physically viewed images hidden. (Shift+click X to unhide all)`;
});

let vaultStatsSortMode = 'recent';
let vaultStatsFilterMode = 'unseen';
let vaultStatsPage = 1;

async function renderVaultStats() {
    stopScraper();
    mode = 'challenge';
    info.textContent = `Calculating Vault Stats...`;

    const recentStartTime = tmStart.value ? new Date(tmStart.value).getTime() : 0;
    const recentEndTime = tmEnd.value ? new Date(tmEnd.value).getTime() : 8640000000000000;

    // Always scan the whole DB for total stats, while "Recent" uses the selected scraper date range.
    const startTime = 0;
    const endTime = 8640000000000000;
    const termStats = await getVaultStatsFromDB(startTime, endTime, vaultStatsFilterMode, recentStartTime, recentEndTime);

    const renderUi = () => {
        let sortedTerms = Object.keys(termStats);
        if (vaultStatsSortMode === 'recent') {
            sortedTerms.sort((a, b) => (termStats[b].recent - termStats[a].recent) || (termStats[b].total - termStats[a].total));
        } else if (vaultStatsSortMode === 'count') {
            sortedTerms.sort((a, b) => termStats[b].total - termStats[a].total);
        } else if (vaultStatsSortMode === 'new') {
            sortedTerms.sort((a, b) => (termStats[b].newest - termStats[a].newest) || ((scrapeHistory[b] || 0) - (scrapeHistory[a] || 0)));
        } else {
            sortedTerms.sort((a, b) => a.localeCompare(b));
        }

        let filterLabel = 'Unseen Images';
        if (vaultStatsFilterMode === 'seen') filterLabel = 'Seen/Hidden Images';
        if (vaultStatsFilterMode === 'both') filterLabel = 'All Images';
        if (vaultStatsFilterMode === 'liked') filterLabel = 'Fully Liked Images';

        const ITEMS_PER_PAGE = 300;
        const totalPages = Math.max(1, Math.ceil(sortedTerms.length / ITEMS_PER_PAGE));
        if (vaultStatsPage > totalPages) vaultStatsPage = totalPages;

        const startIndex = (vaultStatsPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const paginatedTerms = sortedTerms.slice(startIndex, endIndex);
        const recentLabel = `${recentStartTime ? new Date(recentStartTime).toLocaleString() : 'all time'} → ${recentEndTime === 8640000000000000 ? 'any future' : new Date(recentEndTime).toLocaleString()}`;
        const totals = Object.values(termStats).reduce((acc, stat) => {
            acc.total += stat.total;
            acc.recent += stat.recent;
            acc.images += stat.images;
            acc.profiles += stat.profiles;
            return acc;
        }, { total: 0, recent: 0, images: 0, profiles: 0 });

        grid.innerHTML = `
        <div style="padding: 24px; max-width: 1000px; margin: 0 auto; background: #1a1a1a; border-radius: 16px; border: 1px solid #333; box-shadow: 0 10px 40px rgba(0,0,0,0.5); width: 100%; grid-column: 1 / -1; display: flex; flex-direction: column; gap: 20px;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap: wrap; gap: 16px;">
                <h2 style="margin:0; font-size: 24px;">Vault Stats <span style="font-size:14px; color:#888; font-weight:normal;">(${filterLabel})</span></h2>
                <div class="sort-bar" style="margin:0; padding:0; flex-wrap:wrap; display:flex; gap:8px;">
                    <span class="sort-label">Show:</span>
                    <button class="sort-btn ${vaultStatsFilterMode === 'unseen' ? 'active' : ''}" id="vstats-filter-unseen" style="padding: 6px 12px !important; font-size: 12px !important;">🙈 Unseen</button>
                    <button class="sort-btn ${vaultStatsFilterMode === 'seen' ? 'active' : ''}" id="vstats-filter-seen" style="padding: 6px 12px !important; font-size: 12px !important;">👀 Seen</button>
                    <button class="sort-btn ${vaultStatsFilterMode === 'both' ? 'active' : ''}" id="vstats-filter-both" style="padding: 6px 12px !important; font-size: 12px !important;">🌎 Both</button>
                    <button class="sort-btn ${vaultStatsFilterMode === 'liked' ? 'active' : ''}" id="vstats-filter-liked" style="padding: 6px 12px !important; font-size: 12px !important;">❤️ Liked</button>
                    <span class="sort-divider"></span>
                    <span class="sort-label">Sort:</span>
                    <button class="sort-btn ${vaultStatsSortMode === 'recent' ? 'active' : ''}" id="vstats-sort-recent" style="padding: 6px 12px !important; font-size: 12px !important;">⚡ Recent</button>
                    <button class="sort-btn ${vaultStatsSortMode === 'count' ? 'active' : ''}" id="vstats-sort-count" style="padding: 6px 12px !important; font-size: 12px !important;">🔢 Total</button>
                    <button class="sort-btn ${vaultStatsSortMode === 'new' ? 'active' : ''}" id="vstats-sort-new" style="padding: 6px 12px !important; font-size: 12px !important;">🗓️ Newest</button>
                    <button class="sort-btn ${vaultStatsSortMode === 'alpha' ? 'active' : ''}" id="vstats-sort-alpha" style="padding: 6px 12px !important; font-size: 12px !important;">🔤 A-Z</button>
                </div>
            </div>
            
            <p style="color:#aaa; font-size:14px; margin:0;">Using already-scraped vault data. Recent range: <strong style="color:#fff;">${escapeHtml(recentLabel)}</strong>. Recent: <strong style="color:#fff;">${totals.recent.toLocaleString()}</strong> / Total: <strong style="color:#fff;">${totals.total.toLocaleString()}</strong> · Images: ${totals.images.toLocaleString()} · Profiles: ${totals.profiles.toLocaleString()}.</p>
            
            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px; margin-top: 4px;">
                ${paginatedTerms.map(q => {
                    const stat = termStats[q] || { total: 0, recent: 0, images: 0, profiles: 0, newest: 0 };
                    const newestLabel = stat.newest ? formatTimeAgo(stat.newest) : '—';
                    return `
                    <div class="term-stat-item" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: #222; border-radius: 12px; border: 1px solid #333; transition: all 0.2s;">
                        
                        <div style="display:flex; flex-direction:column; min-width:0; flex:1; gap: 5px;">
                            <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                                <span style="font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; color:#fff;" title="${escapeHtml(q)}">${escapeHtml(q)}</span>
                                <span style="background:#111; border: 1px solid #444; color:#aaa; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:20px;">${stat.total.toLocaleString()} total</span>
                                <span style="background:rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.35); color:#6ee7b7; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:20px;">${stat.recent.toLocaleString()} recent</span>
                            </div>
                            <div style="color:#888; font-size:11px;">Images ${stat.images.toLocaleString()} · Profiles ${stat.profiles.toLocaleString()} · Newest ${escapeHtml(newestLabel)} · Last scrape ${scrapeHistory[q] ? escapeHtml(formatTimeAgo(scrapeHistory[q])) : '—'}</div>
                        </div>
                        
                        <div style="display:flex; gap:6px; flex-shrink:0;">
                             <button class="stat-q-btn stat-add-btn sort-btn" data-term="${escapeHtml(q)}" title="Add to Scrape Queue" style="padding:4px 10px !important; font-size:11px !important; border-radius:6px;">➕ Queue</button>
                             <button class="stat-q-btn stat-filter-btn sort-btn" data-term="${escapeHtml(q)}" title="Filter Vault by Term" style="padding:4px 10px !important; font-size:11px !important; border-radius:6px; background: rgba(37,99,235,0.2) !important; color: #60a5fa !important; border-color: rgba(37,99,235,0.4) !important;">🔍 View</button>
                             <button class="stat-q-btn stat-pfp-btn sort-btn" data-term="${escapeHtml(q)}" title="Check profile-picture changes for users scraped by this term" style="padding:4px 10px !important; font-size:11px !important; border-radius:6px; background:rgba(142,68,173,0.24) !important; color:#d8b4fe !important; border-color:rgba(168,85,247,0.45) !important;">🖼 PFPs</button>
                        </div>
                    </div>
                `}).join('')}
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 20px; border-top: 1px solid #333;">
                <button id="vstats-prev" class="sort-btn" style="padding: 8px 16px !important;" ${vaultStatsPage === 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>⬅️ Prev</button>
                <div style="color: #aaa; font-size: 14px;">Page <strong style="color: #fff;">${vaultStatsPage}</strong> of ${totalPages} <span style="color:#666; font-size:12px;">(Showing ${startIndex + 1} - ${Math.min(endIndex, sortedTerms.length)} of ${sortedTerms.length} terms)</span></div>
                <button id="vstats-next" class="sort-btn" style="padding: 8px 16px !important;" ${vaultStatsPage >= totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>Next ➡️</button>
            </div>
        </div>`;

        document.getElementById('vstats-sort-recent').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsSortMode = 'recent'; renderUi(); });
        document.getElementById('vstats-sort-count').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsSortMode = 'count'; renderUi(); });
        document.getElementById('vstats-sort-new').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsSortMode = 'new'; renderUi(); });
        document.getElementById('vstats-sort-alpha').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsSortMode = 'alpha'; renderUi(); });

        document.getElementById('vstats-filter-unseen').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsFilterMode = 'unseen'; renderVaultStats(); });
        document.getElementById('vstats-filter-seen').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsFilterMode = 'seen'; renderVaultStats(); });
        document.getElementById('vstats-filter-both').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsFilterMode = 'both'; renderVaultStats(); });
        document.getElementById('vstats-filter-liked').addEventListener('click', () => { vaultStatsPage = 1; vaultStatsFilterMode = 'liked'; renderVaultStats(); });

        if (document.getElementById('vstats-prev')) {
            document.getElementById('vstats-prev').addEventListener('click', () => {
                if (vaultStatsPage > 1) { vaultStatsPage--; renderUi(); window.scrollTo(0, 0); }
            });
        }
        if (document.getElementById('vstats-next')) {
            document.getElementById('vstats-next').addEventListener('click', () => {
                if (vaultStatsPage < totalPages) { vaultStatsPage++; renderUi(); window.scrollTo(0, 0); }
            });
        }

        document.querySelectorAll('.stat-add-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const term = e.currentTarget.getAttribute('data-term');
                if (!customQueue.includes(term)) {
                    customQueue.push(term);
                    chrome.storage.local.set({ customQueue });
                }
                const originalText = btn.innerHTML;
                btn.innerHTML = '✅ Added';
                btn.style.background = '#059669';
                btn.style.color = '#fff';
                btn.style.pointerEvents = 'none';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = '';
                    btn.style.color = '';
                    btn.style.pointerEvents = 'auto';
                }, 1500);
            });
        });

        document.querySelectorAll('.stat-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const term = e.currentTarget.getAttribute('data-term');
                filterLocalByTerm(term);
            });
        });

        document.querySelectorAll('.stat-pfp-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const term = e.currentTarget.getAttribute('data-term');
                runSourceTermPfpScan(term);
            });
        });

        info.textContent = `Showing Vault Stats. Total unique terms: ${sortedTerms.length}`;
    };

    renderUi();
}

async function filterLocalByTerm(term) {
    const startTime = 0;
    const endTime = 8640000000000000;

    info.textContent = `Loading newest ${FILTER_LOCAL_MAX_RESULTS.toLocaleString()} matching Vault items...`;
    vaultPageState = null;
    currentVaultRawItems = await fetchFilteredVault(startTime, endTime, term, null);

    applyVaultFiltersAndSort();

    info.textContent = `Filtered by Term: "${term}" - showing newest ${allResults.length.toLocaleString()} matching images. (Total in vault: ${masterScrapeCount.toLocaleString()})`;
}

// ============ VAULT EXPORT / IMPORT ============

async function exportVault() {
    exportVaultBtn.textContent = 'Preparing...';
    try {
        let localData = {};
        await new Promise(r => chrome.storage.local.get(null, res => { localData = res; r(); }));

        const fileHandle = await window.showSaveFilePicker({
            suggestedName: `VSCO_Vault_Backup_${new Date().toISOString().split('T')[0]}.json`,
            types: [{ description: 'JSON Database Backup', accept: { 'application/json': ['.json'] } }]
        });

        const writable = await fileHandle.createWritable();

        // Write header and local storage
        await writable.write(`{"metadata":{"version":"1.0","exportedAt":${Date.now()}},"localStorage":${JSON.stringify(localData)},"indexedDB":[\n`);

        let counter = 0;
        let isFirst = true;
        let lastKey = null;
        let hasMore = true;
        const BATCH_SIZE = 10000;

        while (hasMore) {
            const batch = await new Promise(async (resolve, reject) => {
                try {
                    const db = await openVaultDB();
                    const tx = db.transaction('images', 'readonly');
                    const store = tx.objectStore('images');

                    let req;
                    if (lastKey !== null) {
                        req = store.getAll(IDBKeyRange.lowerBound(lastKey, true), BATCH_SIZE);
                    } else {
                        req = store.getAll(null, BATCH_SIZE);
                    }

                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                } catch (err) {
                    reject(err);
                }
            });

            if (!batch || batch.length === 0) {
                hasMore = false;
                break;
            }

            const lastItem = batch[batch.length - 1];
            lastKey = lastItem.imageId || lastItem._id || lastItem.id;

            let batchStr = "";
            for (const item of batch) {
                if (!isFirst) batchStr += ',\n';
                batchStr += JSON.stringify(item);
                isFirst = false;
                counter++;
            }

            await writable.write(batchStr);
            if (counter % 50000 === 0 || counter % BATCH_SIZE === 0) {
                exportVaultBtn.textContent = `Saving: ${counter.toLocaleString()}`;
            }
        }

        await writable.write(`\n]}`);
        await writable.close();

        exportVaultBtn.textContent = '💾 Appended successfully!';
        setTimeout(() => exportVaultBtn.textContent = '💾 Export', 4000);
    } catch (e) {
        // Fallback for browsers without File System Access API
        if (e.name === 'TypeError' && !window.showSaveFilePicker) {
            try {
                exportVaultBtn.textContent = 'Preparing fallback...';
                const db = await openVaultDB();
                const allItems = await new Promise((resolve, reject) => {
                    const tx = db.transaction('images', 'readonly');
                    const req = tx.objectStore('images').getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                let localData = {};
                await new Promise(r => chrome.storage.local.get(null, res => { localData = res; r(); }));
                const blob = new Blob([JSON.stringify({ metadata: { version: "1.0", exportedAt: Date.now() }, localStorage: localData, indexedDB: allItems })], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `VSCO_Vault_Backup_${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                exportVaultBtn.textContent = '💾 Downloaded!';
                setTimeout(() => exportVaultBtn.textContent = '💾 Export', 4000);
            } catch (fallbackErr) {
                console.error("Fallback export failed:", fallbackErr);
                exportVaultBtn.textContent = 'Error!';
                setTimeout(() => exportVaultBtn.textContent = '💾 Export', 3000);
            }
        } else if (e.name !== 'AbortError') {
            console.error("Export failed:", e);
            exportVaultBtn.textContent = 'Error!';
            setTimeout(() => exportVaultBtn.textContent = '💾 Export', 3000);
        } else {
            exportVaultBtn.textContent = '💾 Export';
        }
    }
}

function importVault() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        importVaultBtn.textContent = 'Reading...';

        try {
            const stream = file.stream();
            const reader = stream.getReader();
            const decoder = new TextDecoder();

            let buffer = '';
            let isFirstLine = true;
            let count = 0;
            let pendingItems = [];

            const db = await openVaultDB();

            const flushToDB = async () => {
                if (pendingItems.length === 0) return;
                const tx = db.transaction('images', 'readwrite');
                const store = tx.objectStore('images');

                await new Promise((resolve, reject) => {
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                    for (const item of pendingItems) {
                        try { store.put(item); } catch (e) { }
                    }
                });
                pendingItems = [];
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Decode with {stream: true} to preserve partial multi-byte chars properly
                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');

                // Keep the last partial line in buffer
                buffer = lines.pop();

                for (let line of lines) {
                    if (isFirstLine) {
                        isFirstLine = false;
                        const idx = line.lastIndexOf(',"indexedDB":[');
                        if (idx > -1) {
                            try {
                                const headerStr = line.substring(0, idx) + '}';
                                const headerData = JSON.parse(headerStr);
                                if (headerData.localStorage) {
                                    await new Promise(r => chrome.storage.local.set(headerData.localStorage, r));
                                }
                            } catch (err) {
                                console.warn("Header parse failed:", err);
                            }
                        } else {
                            // fallback for old unformatted files or small files
                            if (file.size < 500 * 1024 * 1024) {
                                const text = await file.text();
                                const data = JSON.parse(text);
                                if (data.localStorage) await new Promise(r => chrome.storage.local.set(data.localStorage, r));
                                const tx = db.transaction('images', 'readwrite');
                                const store = tx.objectStore('images');
                                for (let item of data.indexedDB || []) store.put(item);
                                return new Promise((r, reject) => {
                                    tx.oncomplete = () => {
                                        importVaultBtn.textContent = '📂 Done!';
                                        alert("Vault Imported!");
                                        setTimeout(() => location.reload(), 1500);
                                        r();
                                    };
                                    tx.onerror = reject;
                                });
                            }
                        }
                        continue;
                    }

                    line = line.trim();
                    if (line.endsWith(',')) line = line.substring(0, line.length - 1);
                    if (line.endsWith(']}')) line = line.substring(0, line.length - 2);
                    if (line.startsWith(',')) line = line.substring(1);

                    if (line.startsWith('{') && line.endsWith('}')) {
                        try {
                            pendingItems.push(JSON.parse(line));
                            count++;
                            if (pendingItems.length >= 10000) {
                                importVaultBtn.textContent = `Importing (${count.toLocaleString()})...`;
                                await flushToDB();
                            }
                        } catch (err) {
                            // parse error, skip silently
                        }
                    }
                }
            }

            // Flush remaining buffer
            if (buffer) {
                let line = buffer.trim();
                if (line.endsWith(',')) line = line.substring(0, line.length - 1);
                if (line.endsWith(']}')) line = line.substring(0, line.length - 2);
                if (line.startsWith(',')) line = line.substring(1);

                if (line.startsWith('{') && line.endsWith('}')) {
                    try {
                        pendingItems.push(JSON.parse(line));
                        count++;
                    } catch (err) { }
                }
            }

            await flushToDB();

            importVaultBtn.textContent = '📂 Done!';
            alert(`Vault Successfully Imported! Loaded ${count.toLocaleString()} images.`);
            setTimeout(() => location.reload(), 1500);

        } catch (err) {
            console.error("Import error:", err);
            alert("Import failed: " + err.message);
            importVaultBtn.textContent = '📂 Import';
        }
    };
    input.click();
}

if (exportVaultBtn) exportVaultBtn.addEventListener('click', exportVault);
if (importVaultBtn) importVaultBtn.addEventListener('click', importVault);
if (globalExifGpsFilter) {
    globalExifGpsFilter.addEventListener('change', () => {
        setExifGpsFilterOnly(globalExifGpsFilter.checked);
        if (mode === 'challenge' && currentVaultRawItems && currentVaultRawItems.length > 0) {
            applyVaultFiltersAndSort();
        } else if ((mode === 'people' || mode === 'bio') && lastPeopleResults.length > 0) {
            void rerenderPeopleResults();
        } else if (mode === 'search' && lastSearchResults.length > 0) {
            void rerenderSearchResults();
        }
    });
}
syncExifGpsToggleUI();

if (vaultStatsBtn) vaultStatsBtn.addEventListener('click', renderVaultStats);
if (pfpSourceTermBtn) pfpSourceTermBtn.addEventListener('click', () => {
    const term = (pfpSourceTermInput?.value || '').trim();
    if (term) runSourceTermPfpScan(term);
});
if (pfpSourceTermInput) pfpSourceTermInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const term = (pfpSourceTermInput.value || '').trim();
        if (term) runSourceTermPfpScan(term);
    }
});
if (shownPfpBtn) shownPfpBtn.addEventListener('click', runCurrentVaultPfpScan);
if (pfpWorkerCountInput) pfpWorkerCountInput.addEventListener('change', () => {
    const workers = Math.max(1, Math.min(128, Number.parseInt(pfpWorkerCountInput.value, 10) || 32));
    pfpWorkerCountInput.value = String(workers);
    appSettings.pfpScanWorkers = workers;
    chrome.storage.local.set({ appSettings });
});

// Local Database Search
async function doLocalSearch() {
    const query = (localSearchInput.value || '').trim().toLowerCase();
    if (!query) return;

    stopScraper();
    mode = 'challenge';
    const startTime = tmStart.value ? new Date(tmStart.value).getTime() : 0;
    const endTime = tmEnd.value ? new Date(tmEnd.value).getTime() : 8640000000000000; // max date value

    info.textContent = `Loading newest ${FILTER_LOCAL_MAX_RESULTS.toLocaleString()} matching Vault items...`;
    vaultPageState = null;
    currentVaultRawItems = await fetchFilteredVault(startTime, endTime, null, query);

    applyVaultFiltersAndSort();

    info.textContent = `Local Search: "${query}" - showing newest ${allResults.length.toLocaleString()} matching images in timeframe.`;
}

if (localSearchBtn) localSearchBtn.addEventListener('click', doLocalSearch);
if (localSearchInput) localSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        doLocalSearch();
    }
});

// Term Queue Manager
function renderTermQueue() {
    stopScraper();
    mode = 'challenge';

    const baseTerms = new Set([
        ...CHALLENGE_EMOJIS, ...CHALLENGE_TERMS, ...CHALLENGE_NAMES, ...CHALLENGE_EXTRA, ...CHALLENGE_CITIES
    ]);

    let allTermsMap = {};
    baseTerms.forEach(t => allTermsMap[t] = scrapeHistory[t] || 0);

    Object.keys(scrapeHistory).forEach(t => allTermsMap[t] = scrapeHistory[t]);

    const sortedTerms = Object.keys(allTermsMap).sort((a, b) => allTermsMap[a] - allTermsMap[b]);

    const activeList = customQueue.map(q => `<span style="background:#f39c12;color:#fff;padding:2px 6px;border-radius:4px;margin-right:4px;display:inline-block;margin-bottom:4px;">${escapeHtml(q)}</span>`).join('');

    grid.innerHTML = '<div style="padding: 20px; max-width: 800px; margin: 0 auto; background: #fff; border-radius: 8px;">' +
        '<h2 style="margin-top:0;">Scrape Queue & History</h2>' +
        '<p style="color:#666;">View when search terms were last scraped. Click any pill below to push it to the very front of the Scraping Queue!</p>' +
        '<div style="margin-bottom: 20px; display: flex; gap: 8px;">' +
        '<input type="text" id="queue-custom-term" placeholder="Type queries to scrape, separated by commas..." style="padding:8px; border:1px solid #ccc; border-radius:4px; flex: 1;">' +
        '<button id="add-queue-btn" style="background:#000;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">Add</button>' +
        '<button id="clear-queue-btn" style="background:#ff4444;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;">Clear</button>' +
        '</div>' +
        '<div style="margin-bottom: 20px; border: 1px solid #eee; padding: 12px; border-radius: 8px; background: #fafafa;">' +
        '<div style="margin-bottom: 20px; border: 1px solid #eee; padding: 12px; border-radius: 8px; background: #fafafa;">' +
        '<h4 style="margin: 0 0 10px 0;">Bulk Generators</h4>' +
        '<div style="display: flex; gap: 8px; flex-wrap: wrap;">' +
        '<button id="bulk-az-sep-btn" style="background:#3498db;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">A-Z (Separate)</button>' +
        '<button id="bulk-az-com-btn" style="background:#2980b9;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">A-Z (Combined)</button>' +
        '<button id="bulk-100-sep-btn" style="background:#2ecc71;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">1-100 (Separate)</button>' +
        '<button id="bulk-100-com-btn" style="background:#27ae60;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">1-100 (Combined)</button>' +
        '</div>' +
        '<h4 style="margin: 10px 0;">Custom Randomizer</h4>' +
        '<div style="margin-bottom: 8px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; background: #ebebeb; padding: 12px; border-radius: 6px; border: 1px solid #ddd;">' +
        `<label><input type="checkbox" id="rand-pool-lat" ${termQueueRandPool.lat ? 'checked' : ''}> Latin</label>` +
        `<label><input type="checkbox" id="rand-pool-cyr" ${termQueueRandPool.cyr ? 'checked' : ''}> Cyrillic</label>` +
        `<label><input type="checkbox" id="rand-pool-grk" ${termQueueRandPool.grk ? 'checked' : ''}> Greek</label>` +
        `<label><input type="checkbox" id="rand-pool-ara" ${termQueueRandPool.ara ? 'checked' : ''}> Arabic</label>` +
        `<label><input type="checkbox" id="rand-pool-heb" ${termQueueRandPool.heb ? 'checked' : ''}> Hebrew</label>` +
        `<label><input type="checkbox" id="rand-pool-num" ${termQueueRandPool.num ? 'checked' : ''}> Numbers</label>` +
        `<label><input type="checkbox" id="rand-pool-emo" ${termQueueRandPool.emo ? 'checked' : ''}> Emojis</label>` +
        '<div style="width: 1px; height: 20px; background: #ccc; margin: 0 4px;"></div>' +
        `<label>Length: <input type="number" id="rand-len-input" value="${termQueueRandLength}" min="1" max="100" style="width: 50px; padding: 2px 4px; border: 1px solid #ccc; border-radius: 4px;"></label>` +
        `<label style="cursor: pointer;"><input type="checkbox" id="rand-pair-space-chk" ${termQueueRandSpace ? 'checked' : ''}> Add Spaces</label>` +
        '<button id="bulk-rand-custom-btn" style="background:#8e44ad;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;margin-left:auto;">🎲 Generate</button>' +
        '</div></div>' +
        `<div style="margin-bottom: 20px; line-height:1.5;"><b>Currently Queued First (${customQueue.length}):</b><br>${activeList || '<i style="color:#aaa;">None, will use random mix.</i>'}</div><hr>` +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;">' +
        sortedTerms.map(q => {
            const timeStr = allTermsMap[q] ? new Date(allTermsMap[q]).toLocaleString() : 'Never Scraped';
            const isQueued = customQueue.includes(q);
            return `<div class="term-queue-item" data-term="${escapeHtml(q)}" style="padding: 6px 12px; border-radius: 12px; border: ${isQueued ? '2px solid #000' : '1px solid #ddd'}; background: ${allTermsMap[q] ? '#f0f0f0' : '#ffebeb'}; cursor: pointer; display: flex; flex-direction: column; gap: 4px; box-shadow: ${isQueued ? '0 0 5px rgba(0,0,0,0.2)' : 'none'};">
                <span style="font-weight:bold;font-size:14px;">${escapeHtml(q)}</span>
                <span style="font-size: 10px; color: #666;">${escapeHtml(timeStr)}</span>
            </div>`;
        }).join('') +
        '</div></div>';

    const queueCustomTermInput = document.getElementById('queue-custom-term');
    const addQueuedTerms = () => {
        const addedTerms = addCustomQueueTerms(queueCustomTermInput.value);
        if (addedTerms.length > 0) {
            chrome.storage.local.set({ customQueue }, renderTermQueue);
        }
    };

    document.getElementById('add-queue-btn').addEventListener('click', addQueuedTerms);
    queueCustomTermInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addQueuedTerms();
        }
    });

    document.getElementById('clear-queue-btn').addEventListener('click', () => {
        customQueue = [];
        chrome.storage.local.set({ customQueue }, renderTermQueue);
    });

    // Bulk Generators
    document.getElementById('bulk-az-sep-btn').addEventListener('click', () => {
        const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i));
        customQueue.push(...letters.filter(l => !customQueue.includes(l)));
        chrome.storage.local.set({ customQueue }, renderTermQueue);
    });

    document.getElementById('bulk-az-com-btn').addEventListener('click', () => {
        const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).join(' ');
        if (!customQueue.includes(letters)) {
            customQueue.push(letters);
            chrome.storage.local.set({ customQueue }, renderTermQueue);
        }
    });

    document.getElementById('bulk-100-sep-btn').addEventListener('click', () => {
        const nums = Array.from({ length: 100 }, (_, i) => String(i + 1));
        customQueue.push(...nums.filter(n => !customQueue.includes(n)));
        chrome.storage.local.set({ customQueue }, renderTermQueue);
    });

    document.getElementById('bulk-100-com-btn').addEventListener('click', () => {
        const nums = Array.from({ length: 100 }, (_, i) => String(i + 1)).join(' ');
        if (!customQueue.includes(nums)) {
            customQueue.push(nums);
            chrome.storage.local.set({ customQueue }, renderTermQueue);
        }
    });

    const alphabets = {
        latin: "abcdefghijklmnopqrstuvwxyz".split(''),
        cyrillic: "абвгдеёжзийклмнопрстуфхцчшщъыьэюя".split(''),
        greek: "αβγδεζηθικλμνξοπρστυφχψω".split(''),
        arabic: "ابتثجحخدذرزسشصضطظعغفقكلمنهوي".split(''),
        hebrew: "אבגדהוזחטיכלמנסעפצקרשת".split(''),
        numbers: "0123456789".split('')
    };

    document.getElementById('rand-pair-space-chk').addEventListener('change', (e) => {
        termQueueRandSpace = e.target.checked;
    });

    const lenInput = document.getElementById('rand-len-input');
    lenInput.addEventListener('change', (e) => {
        termQueueRandLength = Math.max(1, parseInt(e.target.value) || 1);
    });

    const poolIds = ['lat', 'cyr', 'grk', 'ara', 'heb', 'num', 'emo'];
    poolIds.forEach(id => {
        document.getElementById(`rand-pool-${id}`).addEventListener('change', (e) => {
            termQueueRandPool[id] = e.target.checked;
        });
    });

    document.getElementById('bulk-rand-custom-btn').addEventListener('click', () => {
        let pool = [];
        if (termQueueRandPool.lat) pool.push(...alphabets.latin);
        if (termQueueRandPool.cyr) pool.push(...alphabets.cyrillic);
        if (termQueueRandPool.grk) pool.push(...alphabets.greek);
        if (termQueueRandPool.ara) pool.push(...alphabets.arabic);
        if (termQueueRandPool.heb) pool.push(...alphabets.hebrew);
        if (termQueueRandPool.num) pool.push(...alphabets.numbers);
        if (termQueueRandPool.emo) pool.push(...CHALLENGE_EMOJIS);

        if (pool.length === 0) {
            alert("Please select at least one character pool!");
            return;
        }

        let resultChars = [];
        for (let i = 0; i < termQueueRandLength; i++) {
            resultChars.push(pool[Math.floor(Math.random() * pool.length)]);
        }

        const sep = termQueueRandSpace ? " " : "";
        const randStr = resultChars.join(sep);

        if (!customQueue.includes(randStr)) {
            customQueue.push(randStr);
            chrome.storage.local.set({ customQueue }, renderTermQueue);
        }
    });

    document.querySelectorAll('.term-queue-item').forEach(el => {
        el.addEventListener('click', (e) => {
            const val = e.currentTarget.getAttribute('data-term');
            if (customQueue.includes(val)) {
                customQueue = customQueue.filter(item => item !== val);
            } else {
                customQueue.push(val);
            }
            chrome.storage.local.set({ customQueue }, renderTermQueue);
        });
    });

    info.textContent = `Showing Term Queue & History. Tracks ${sortedTerms.length} terms across all time.`;
}

if (termQueueBtn) termQueueBtn.addEventListener('click', renderTermQueue);

// ============ LIVE FEED ============
// Fires ALL feed queries in parallel, dedupes, sorts by timestamp.
// Then on scroll, can fire another round with different queries.
let feedRound = 0;

async function startFeed() {
    if (mode === 'feed') {
        mode = null;
        fetching = false;
        browseBtn.textContent = "🌐 Live Feed";
        challengeBtn.textContent = "⏳ Scraper";
        if (scraperUi) scraperUi.style.display = 'none';
        return;
    }

    mode = null;
    fetching = false;

    seenIds.clear();
    allResults = [];
    resetPagination();
    feedRound = 0;
    grid.innerHTML = '';

    // Reset auto-pfp queue on new feed but keep enabled state
    stopAutoPfp();
    stopProfilePrefetch();
    if (autoPfpEnabled) initAutoPfpObserver();

    mode = 'feed';
    browseBtn.textContent = "⏹ Stop";
    challengeBtn.textContent = "⏳ Scraper";
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());
    clearHeaderMap();
    hideHeaderMap();

    await fetchFeedRound();
}

async function fetchFeedRound() {
    if (fetching || mode !== 'feed') return;
    fetching = true;

    const queries = FEED_QUERIES;
    info.textContent = `Loading feed... (${queries.length} parallel searches)`;

    console.log(`Feed round ${feedRound}: firing ${queries.length} queries in parallel`);

    // Fire all queries in parallel
    const promises = queries.map(q => fetchQuery(q));
    const results = await Promise.all(promises);

    if (mode !== 'feed') { fetching = false; return; } // stopped while fetching

    let totalAdded = 0;
    results.forEach((res, i) => {
        const added = addDedupe(res.results);
        totalAdded += added;
        console.log(`Feed "${queries[i]}": ${res.results.length} fetched, ${added} new `);
    });

    console.log(`Feed round ${feedRound}: +${totalAdded} new, ${allResults.length} total unique`);

    // Sort by MongoDB timestamp (newest first)
    allResults.sort((a, b) => getTimestamp(b) - getTimestamp(a));

    // Re-render from scratch since sort changed
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());
    grid.innerHTML = '';
    resetPagination();
    renderAutoPfpToggle();
    renderNew();
    updateInfo();

    feedRound++;
    fetching = false;
}

// ============ RANDOM ============
const HOT_GIRL_EMOJIS = [
    '🍑', '👙', '🔥', '💋', '😍', '🥵', '😈', '🫦', '💦', '🍒',
    '✨', '💅', '💄', '🤳', '🪞', '❤️', '💖', '👅', '🌶️', '🩷',
    '🦋', '🌸', '🧚', '💃', '👸', '🫶', '💕', '🥰', '😘', '🤤',
    '☀️', '🌊', '🏖️', '🩱', '🍓', '🍹', '🌺', '💎', '🪩', '💗'
];

async function tryLuck() {
    const count = 2; // always 2 emojis
    const shuffled = [...HOT_GIRL_EMOJIS].sort(() => Math.random() - 0.5);
    const q = shuffled.slice(0, count).join('');
    queryInput.value = q;
    await search(q);
}

// ============ PEOPLE / BIO SEARCH ============

let peopleSortBy = 'upload'; // 'upload' = gridImageId, 'pfp' = gridImage ObjectId, 'site-high'/'site-low' = numeric siteId
let deepMode = false; // when true: click = 3.0 fetch + info bar + map pins. when false: click = open vsco page
let exactMode = false; // when true: client-side filter to only exact substring matches
let lastSearchQuery = ''; // the query used for the current people/bio search

// Extract timestamp from gridImageId (MongoDB ObjectId — most recent image upload)
function getPersonTimestamp(person) {
    const site = person?.site || {};
    const id = person.gridImageId || person.recentlyPublishedId || person.recently_published || site.recently_published || '';
    if (typeof id === 'string' && id.length >= 8) {
        const ts = parseInt(id.slice(0, 8), 16);
        if (!isNaN(ts)) return ts * 1000;
    }
    const dateValue = person.recentlyPublishedAt || person.upload_date || 0;
    const dateNumber = Number(dateValue);
    if (Number.isFinite(dateNumber) && dateNumber > 0) {
        return dateNumber > 100000000000 ? dateNumber : dateNumber * 1000;
    }
    return 0;
}

function getPersonSortTimestamp(person) {
    return peopleSortBy === 'pfp' ? getProfilePicTimestamp(person) : getPersonTimestamp(person);
}

function getPersonSiteIdNumber(person) {
    const value = Number(person?.siteId || person?.site_id || person?.site?.id);
    return Number.isFinite(value) ? value : 0;
}

function getPersonLatestImageCandidates(person) {
    const site = person?.site || {};
    const recent = person?.recently_published || null;
    const recentDetails = getRecentlyPublishedDetails(recent);
    const explicitRecentCandidates = [
        person?.latestUploadUrl,
        person?.recentlyPublishedUrl,
        recentDetails.url,
        recent?.responsive_url,
        recent?.image?.responsive_url,
        recent?.image_url,
        recent?.url,
        person?.responsive_url,
        site.recently_published
    ];
    const candidates = explicitRecentCandidates
        .filter(value => value && !isVscoDefaultAvatarUrl(value))
        .map(normalize);

    const recentImageId = getVscoImageId(recent) || person?.gridImageId || '';
    if (recentImageId) candidates.push(`https://i.vsco.co/${recentImageId}`);

    return [...new Set(candidates.filter(Boolean))];
}

function getPersonLatestImageUrl(person) {
    const candidates = getPersonLatestImageCandidates(person);
    if (candidates.length) return candidates[0];

    if (person?.sourceType === 'site-edge') return '';
    return '';
}

function getPersonProfilePicUrl(person) {
    const site = person?.site || {};
    const gridImageValue = String(person?.gridImage || '');
    if (gridImageValue) {
        const url = normalize(gridImageValue.startsWith('http') || gridImageValue.startsWith('//') ? gridImageValue : 'img.vsco.co/' + gridImageValue);
        return isVscoDefaultAvatarUrl(url) ? '' : url;
    }

    const rawProfileId = person?.profileImageId || site.profile_image_id || '';
    const directProfile = rawProfileId
        ? `https://i.vsco.co/${rawProfileId}`
        : normalize(person?.profileImage || person?.site_profile_image_url || person?.profile_image_url || site.profile_image || '');
    if (directProfile && !isVscoDefaultAvatarUrl(directProfile)) return directProfile;

    const responsive = normalize(person?.responsive_url || site.responsive_url || '');
    if (!responsive || isVscoDefaultAvatarUrl(responsive)) return '';

    const latest = getPersonLatestImageUrl(person);
    const hasExplicitRecent = Boolean(person?.recently_published || person?.recentlyPublishedUrl || person?.recentlyPublishedId);
    if (hasExplicitRecent && latest && responsive === latest) return '';

    return responsive;
}

function sortPeopleResults(results) {
    if (peopleSortBy === 'site-high') {
        results.sort((a, b) => getPersonSiteIdNumber(b) - getPersonSiteIdNumber(a));
    } else if (peopleSortBy === 'site-low') {
        results.sort((a, b) => getPersonSiteIdNumber(a) - getPersonSiteIdNumber(b));
    } else {
        results.sort((a, b) => getPersonSortTimestamp(b) - getPersonSortTimestamp(a));
    }
}

function getPeopleSortLabel() {
    if (peopleSortBy === 'pfp') return '🖼 pfp';
    if (peopleSortBy === 'site-high') return 'site ID high';
    if (peopleSortBy === 'site-low') return 'site ID low';
    return '📷 upload';
}

// Shared renderer for people/bio results
// showBio: if true, show gridName prominently (bio search mode)
function renderPeopleResults(results, showBio, target = grid) {
    for (const person of results) {
        const site = person?.site || {};
        const sub = person.siteSubDomain || site.subdomain || '';
        const name = person.userName || site.name || sub;
        const bio = person.gridName || site.description || '';
        const time = formatTimeAgo(getPersonSortTimestamp(person));
        const siteId = person.siteId || person.site_id || site.id;

        const profilePic = getPersonProfilePicUrl(person);
        if (siteId && profilePic) seedPfpBaselineIfMissing(siteId, profilePic);
        const latestImage = getPersonLatestImageUrl(person);
        const hasProfilePic = Boolean(profilePic && !isVscoDefaultAvatarUrl(profilePic));
        const hasLatestImage = Boolean(latestImage && !isVscoDefaultAvatarUrl(latestImage));
        const showSplitImages = hasProfilePic && hasLatestImage && profilePic !== latestImage;
        const singleDisplayImage = hasLatestImage ? latestImage : (hasProfilePic ? profilePic : '');

        const domain = person.siteDomain || site.domain || '';
        const card = document.createElement("div");
        card.className = "person-card";

        const initial = escapeHtml((name || sub).charAt(0).toUpperCase());
        card.innerHTML = `
        <div class="person-header">
            ${showSplitImages
                ? `<div class="person-image-wrap person-image-split">
                    <img class="person-main-img person-pfp-large" src="${escapeHtml(profilePic)}" loading="lazy" alt="${escapeHtml(name)} profile picture">
                    <img class="person-main-img" src="${escapeHtml(latestImage)}" loading="lazy" alt="${escapeHtml(name)} recent image">
                  </div>`
                : singleDisplayImage
                    ? `<div class="person-image-wrap"><img class="person-main-img" src="${escapeHtml(singleDisplayImage)}" loading="lazy" alt="${escapeHtml(name)}"></div>`
                : `<div class="person-avatar-placeholder">${initial}</div>`
            }
    <div class="person-bottom">
        ${hasProfilePic
                ? `<img class="person-pfp" src="${escapeHtml(profilePic)}" loading="lazy" alt="${escapeHtml(name)}">`
                : `<div class="person-pfp-placeholder">${initial}</div>`}
        <div class="person-info">
            <div class="person-name">${escapeHtml(name)}</div>
            <div class="person-handle">@${escapeHtml(sub)}${domain && domain !== sub ? ` · ${escapeHtml(domain)}` : ''}${time ? ` · ${time}` : ''}</div>
            ${siteId ? `<div class="person-site-id">site ID: ${escapeHtml(String(siteId))}</div>` : ''}
            ${bio ? `<div class="person-bio">${escapeHtml(bio)}</div>` : ''}
            ${site.collection_share_link || site.grid_album_id || site.share_link ? `<div class="person-following-links">
              ${site.share_link ? `<a href="${escapeHtml(site.share_link)}" target="_blank" rel="noopener">profile</a>` : ''}
              ${site.collection_share_link ? `<a href="${escapeHtml(site.collection_share_link)}" target="_blank" rel="noopener">reposts</a>` : ''}
              ${site.grid_album_id && siteId ? `<button type="button" class="person-expand-media">media</button>` : ''}
            </div>` : ''}
        </div>
    </div>
      </div>
        `;

        const latestCandidates = getPersonLatestImageCandidates(person);
        const profileCandidates = [profilePic, ...latestCandidates];
        card.querySelectorAll('.person-main-img').forEach(imgEl => {
            loadImageWithFallback(
                imgEl,
                imgEl.classList.contains('person-pfp-large') ? profileCandidates : latestCandidates
            );
        });
        const smallPfp = card.querySelector('.person-pfp');
        if (smallPfp) loadImageWithFallback(smallPfp, profileCandidates);

        // Store data on card
        card._siteId = siteId;
        card._sub = sub;
        card._profileSourceQuery = lastSearchQuery || '';

        // Click handler depends on deepMode
        const header = card.querySelector('.person-header');
        header.style.cursor = 'pointer';
        header.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Deep mode OFF — just open their page
            if (!deepMode) {
                window.open(`https://vsco.co/${sub}`, '_blank');
                return;
            }

            // Deep mode ON — 3.0 fetch + info bar + map
            if (card._fetching) return;

            if (card.classList.contains('expanded')) {
                window.open(`https://vsco.co/${sub}`, '_blank');
                return;
            }

            if (!siteId) {
                window.open(`https://vsco.co/${sub}`, '_blank');
                return;
            }

            if (card._profileLoaded) {
                expandProfileCard(card);
            } else if (!card._fetching) {
                card._fetching = true;
                const loader = document.createElement('div');
                loader.className = 'profile-expand';
                loader.innerHTML = '<div class="profile-loading">Loading profile...</div>';
                card.appendChild(loader);
                card.classList.add('expanded');

                fetchProfile(siteId).then(media => {
                    card._profileLoaded = true;
                    card._profileMedia = media;
                    card._fetching = false;
                    loader.remove();
                    card.classList.remove('expanded');
                    expandProfileCard(card);
                    extractAndMapLocations(media, sub);
                });
            }
        });

        const mediaButton = card.querySelector('.person-expand-media');
        mediaButton?.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!siteId || card._fetching) return;
            if (!card._profileLoaded) {
                card._fetching = true;
                mediaButton.textContent = 'loading…';
                try {
                    card._profileMedia = await fetchProfile(siteId);
                    card._profileLoaded = true;
                } finally {
                    card._fetching = false;
                    mediaButton.textContent = 'media';
                }
            }
            expandProfileCard(card);
        });

        const isFullyLiked = fullyLikedImages[siteId] !== undefined || fullyLikedSiteIds.has(siteId);

        // Add like button overlay directly to the person card image
        const likeBtnWrap = document.createElement("div");
        likeBtnWrap.innerHTML = `
          <button class="fully-like-btn like-btn ${isFullyLiked ? 'liked' : ''}" title="Fully Like" style="opacity: 1;">
            ${isFullyLiked ? '❤️' : '🤍'}
          </button>
        `;
        const likeBtn = likeBtnWrap.firstElementChild;
        likeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (fullyLikedSiteIds.has(siteId)) {
                // To unlike, we need to purge all their images from fullyLikedImages
                Object.keys(fullyLikedImages).forEach(k => {
                    if (fullyLikedImages[k].grid?.siteId === siteId) {
                        delete fullyLikedImages[k];
                    }
                });
                updateFullyLikedSiteIds();
                likeBtn.classList.remove('liked');
                likeBtn.textContent = '🤍';
                deleteLikedProfile(siteId);
            } else {
                // Mock an image payload solely to store the siteId info easily
                const mockImage = { imageId: siteId, grid: { siteId, subdomain: sub } };
                fullyLikedImages[siteId] = mockImage;
                updateFullyLikedSiteIds();
                likeBtn.classList.add('liked');
                likeBtn.textContent = '❤️';
                autoScrapeFullyLikedUser(siteId, mockImage);
                fetchAndSaveLikedProfile(siteId, mockImage);
            }
            chrome.storage.local.set({ fullyLikedImages });
        });

        // Append the like button over the main image area
        const imgWrap = card.querySelector('.person-image-wrap') || card.querySelector('.person-avatar-placeholder');
        if (imgWrap) {
            imgWrap.style.position = 'relative';
            imgWrap.appendChild(likeBtn);
        }

        if ((mode === 'people' || mode === 'bio') && siteId && profilePrefetchObserver) {
            profilePrefetchObserver.observe(card);
        }


        target.appendChild(card);
        if (aspectFilterMode !== 'all') {
            trackPersonCardImageAspect(card, person);
        }
    }
}

// Store last people/bio results so we can re-sort without re-fetching
let lastPeopleResults = [];
let lastPeopleSearchType = 'people';
let gridPartitionRawMode = false;
let gridExpansionAvailable = false;

async function rerenderPeopleResults() {
    if (mode === 'site-edge') {
        rerenderSiteEdgeResults();
        return;
    }

    const isBio = lastPeopleSearchType === 'bio';
    const fieldMode = getGridSearchFieldMode(lastPeopleSearchType);
    let filtered = lastPeopleResults;

    // Trust the grid-search API's result set. Only the explicit Filter control
    // applies client-side matching; field selection and pattern text do not
    // silently narrow returned profiles.
    const localTerms = getPartitionBaseTerms(localResultSearchQuery);
    const shouldFilter = !gridPartitionRawMode && exactMode && (lastSearchQuery || (forYouMode && localTerms.length));
    if (shouldFilter) {
        console.log(`Filtering ${filtered.length} results with pattern "${lastSearchQuery}" (field: ${fieldMode})`);
        filtered = filtered.filter(p => personMatchesFilter(p, lastSearchQuery, lastPeopleSearchType));
        console.log(`After filter: ${filtered.length} results`);
    }

    if (exifGpsFilterOnly) {
        info.textContent = `Checking EXIF GPS on ${filtered.length.toLocaleString()} ${isBio ? 'bios' : 'people'}...`;
        filtered = filterItemsByExifGps(filtered, 'people');
        console.log(`EXIF GPS filter kept ${filtered.length} ${isBio ? 'bios' : 'people'} results`);
    }

    if (localTerms.length) {
        filtered = filtered.filter(person => {
            if (forYouMode && exactMode) {
                const fields = getGridSearchFieldValues(person);
                delete fields.siteId;
                return Object.values(fields).flat()
                    .some(value => matchesPattern(String(value || ''), localResultSearchQuery));
            }
            return partitionRecordMatchesTerms(person, localTerms);
        });
    }
    if (forYouMode) filtered = filtered.filter(forYouResultPassesAge);
    filtered = filtered.filter(person => partitionResultPassesAge(person, 'grid'));

    filtered = filterByAspectSnapshot(filtered);
    if (forYouMode) sortForYouProfiles(filtered);
    else sortPeopleResults(filtered);
    displayedCount = Math.min(Math.max(displayedCount || PAGE_SIZE, PAGE_SIZE), filtered.length);
    const visibleCount = displayedCount;
    const visible = filtered.slice(0, visibleCount);
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    grid.innerHTML = '';
    renderSortToggle();
    renderForYouControls();
    renderPeopleResults(visible, isBio);
    const sortLabel = getPeopleSortLabel();
    const emoji = isBio ? '📝' : '👤';
    const total = lastPeopleResults.length;
    const shown = filtered.length;
    lastPeopleFilteredCount = shown;
    const localLabel = localTerms.length ? ` · within "${localResultSearchQuery}"` : '';
    const activeAgeDays = forYouMode ? forYouJob.maxAgeDays : localResultMaxAgeDays;
    const ageLabel = activeAgeDays ? ` · age ${formatAgeLimit(activeAgeDays)}` : '';
    const countText = (shouldFilter || localTerms.length || activeAgeDays) && shown !== total ? `${shown}/${total}` : `${shown}`;
    const loadedLabel = shown > visibleCount ? ` · ${visibleCount.toLocaleString()} loaded` : '';
    const filterLabel = hasPatternSyntax(lastSearchQuery || localResultSearchQuery) ? ' · pattern' : ' · filter';
    const fieldLabel = getGridSearchFieldLabel(fieldMode);
    const aspectLabel = aspectFilterMode !== 'all' ? ` · ${aspectFilterMode === 'vertical' ? 'Tall 9:16' : 'Wide 16:9'} on` : '';
    info.textContent = `${emoji} ${countText} ${isBio ? 'bios' : 'people'} found${loadedLabel} · field ${fieldLabel} · sorted by ${sortLabel}${shouldFilter ? filterLabel : ''}${localLabel}${ageLabel}${aspectLabel}`;
}

function renderSortToggle() {
    const bar = document.createElement("div");
    bar.className = "sort-bar";
    const isSiteEdge = mode === 'site-edge';
    const followingOnly = lastPeopleResults.some(person => person.followingSource || person.site);
    bar.innerHTML = `
      <span class="sort-label">Sort by:</span>
      <button class="sort-btn ${peopleSortBy === 'upload' ? 'active' : ''}" data-sort="upload" ${followingOnly ? 'disabled title="Following baseline has no upload timestamp"' : ''}>📷 Recent Upload</button>
      <button class="sort-btn ${peopleSortBy === 'pfp' ? 'active' : ''}" data-sort="pfp">🖼 Recent PFP</button>
      <button class="sort-btn ${peopleSortBy === 'site-high' ? 'active' : ''}" data-sort="site-high">ID High</button>
      <button class="sort-btn ${peopleSortBy === 'site-low' ? 'active' : ''}" data-sort="site-low">ID Low</button>
      ${isSiteEdge ? '' : `
        <span class="sort-divider"></span>
        <button class="sort-btn exact-btn ${exactMode ? 'active' : ''}" data-action="exact" title="Filter results · supports * ? AND OR NOT">🎯 Filter</button>
        <button class="sort-btn deep-btn ${deepMode ? 'active' : ''}" data-action="deep">🔬 Deep</button>
        ${lastSearchQuery && lastPeopleResults.length ? (partitionExpansionRunning
            ? '<button class="sort-btn partition-stop-btn" data-action="partition-stop">⏹ Stop Expansion</button>'
            : `<label class="partition-budget-label">Partitions <input class="partition-budget" type="number" min="1" max="500" value="${partitionSearchBudget}" title="Maximum expansion searches"></label>
               <label>Match <select class="partition-match-mode" title="Choose how expanded results are admitted"><option value="related" ${partitionMatchMode === 'related' ? 'selected' : ''}>Related</option><option value="strict" ${partitionMatchMode === 'strict' ? 'selected' : ''}>Original term</option></select></label>
               <button class="sort-btn grid-partition-btn" data-action="grid-partition" title="Expand this People/Bio search using terms discovered in matching profiles">🧩 Expand Grid</button>`)
            : ''}
        ${gridExpansionAvailable ? `
          <span class="sort-divider"></span>
          <input class="partition-result-search" type="search" value="${escapeHtml(localResultSearchQuery)}" placeholder="Search within expanded results…" title="Search locally across every field in the expanded grid results">
          <select class="partition-result-age" title="Hide expanded grid results older than this age">
            ${renderPartitionAgeOptions()}
          </select>
          <button class="sort-btn partition-result-clear" ${localResultSearchQuery || localResultMaxAgeDays ? '' : 'disabled'}>Clear</button>
        ` : ''}
        <span class="sort-divider"></span>
        <button class="sort-btn ${aspectFilterMode === 'vertical' ? 'active' : ''}" data-aspect-filter="vertical" title="Show images with height/width at least 16:9">↕ Tall 9:16</button>
        <button class="sort-btn ${aspectFilterMode === 'horizontal' ? 'active' : ''}" data-aspect-filter="horizontal" title="Show images with width/height at least 16:9">↔ Wide 16:9</button>
      `}
      ${renderPartitionMonitor()}
    `;
    bar.querySelectorAll('.sort-btn[data-sort]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (btn.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            peopleSortBy = btn.dataset.sort;
            void rerenderPeopleResults();
        });
    });
    bar.querySelectorAll('[data-aspect-filter]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            aspectFilterMode = aspectFilterMode === btn.dataset.aspectFilter ? 'all' : btn.dataset.aspectFilter;
            void rerenderPeopleResults();
        });
    });
    bar.querySelector('.exact-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exactMode = !exactMode;
        e.target.classList.toggle('active', exactMode);
        void rerenderPeopleResults();
    });
    bar.querySelector('.deep-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deepMode = !deepMode;
        e.target.classList.toggle('active', deepMode);
        if (deepMode) {
            initHeaderMap();
            showHeaderMap();
        } else {
            hideHeaderMap();
        }
    });
    bar.querySelector('.grid-partition-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void runGridPartitionSearch();
    });
    bar.querySelector('.partition-stop-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        stopPartitionExpansion();
    });
    bar.querySelector('.partition-budget')?.addEventListener('input', (event) => {
        partitionSearchBudget = Math.max(1, Math.min(500, Number.parseInt(event.target.value, 10) || PARTITION_SEARCH_DEFAULT_QUERIES));
    });
    bar.querySelector('.partition-budget')?.addEventListener('change', (event) => { event.target.value = partitionSearchBudget; });
    bar.querySelector('.partition-match-mode')?.addEventListener('change', (event) => {
        partitionMatchMode = event.target.value === 'strict' ? 'strict' : 'related';
    });
    const localInput = bar.querySelector('.partition-result-search');
    localInput?.addEventListener('input', (event) => {
        localResultSearchQuery = event.target.value;
        void rerenderPeopleResults().then(() => {
            const nextInput = document.querySelector('.partition-result-search');
            nextInput?.focus();
            nextInput?.setSelectionRange(localResultSearchQuery.length, localResultSearchQuery.length);
        });
    });
    bar.querySelector('.partition-result-age')?.addEventListener('change', (event) => {
        localResultMaxAgeDays = Number(event.target.value) || 0;
        void rerenderPeopleResults();
    });
    bar.querySelector('.partition-result-clear')?.addEventListener('click', () => {
        localResultSearchQuery = '';
        localResultMaxAgeDays = 0;
        void rerenderPeopleResults();
    });
    grid.before(bar);
}

function getGridPartitionValues(person) {
    const fields = getGridSearchFieldValues(person);
    delete fields.siteId;
    return Object.values(fields).flat();
}

function gridResultContainsTerms(person, terms) {
    if (!terms?.length) return false;
    const fields = getGridSearchFieldValues(person);
    delete fields.siteId;
    return Object.values(fields)
        .flat()
        .some(value => terms.some(term => normalizePartitionText(value).includes(term)));
}

function gridResultContainsQuery(person, query) {
    return gridResultContainsTerms(person, getPartitionBaseTerms(query));
}

function getGridPartitionKey(person) {
    return String(person?.siteId || person?.site_id || '').trim();
}

async function runGridPartitionSearch() {
    if ((mode !== 'people' && mode !== 'bio') || !lastSearchQuery || !lastPeopleResults.length) return;
    if (activeSearchController) activeSearchController.abort();
    const controller = new AbortController();
    activeSearchController = controller;
    partitionExpansionRunning = true;
    partitionExpansionStopRequested = false;
    const maxQueries = partitionSearchBudget;
    await rerenderPeopleResults();
    const base = lastSearchQuery.trim();
    const baseTerms = getPartitionBaseTerms(base);
    const searchType = lastPeopleSearchType;
    gridPartitionRawMode = true;
    const merged = new Map();
    for (const person of lastPeopleResults) {
        const key = getGridPartitionKey(person);
        if (key) merged.set(key, person);
    }
    const seedCount = merged.size;

    const baseTokens = new Set(baseTerms.flatMap(term => extractPartitionTokens(term)));
    const candidateScores = new Map();
    const queuedQueries = [];
    const queuedQuerySet = new Set();
    const completedQueries = new Set();
    const partitionStats = [];
    beginPartitionMonitor('profiles', seedCount);

    const addCandidateTokens = (items) => {
        for (const person of items || []) {
            const matchingTerms = partitionMatchMode === 'related'
                ? baseTerms
                : baseTerms.filter(term => gridResultContainsTerms(person, [term]));
            if (!matchingTerms.length) continue;
            for (const term of matchingTerms) {
            for (const value of getGridPartitionValues(person)) {
                    for (const token of extractPartitionTokens(value)) {
                        if (baseTokens.has(token) || PARTITION_SEARCH_STOP_WORDS.has(token)) continue;
                        const key = JSON.stringify([term, token]);
                        const current = candidateScores.get(key) || { term, token, score: 0 };
                        current.score++;
                        candidateScores.set(key, current);
                    }
                }
            }
        }
    };

    const queueCandidateQueries = () => {
        const ranked = [...candidateScores.values()]
            .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
            .slice(0, PARTITION_SEARCH_MAX_CANDIDATES);
        for (const { term, token } of ranked) {
            for (const query of [`${term} ${token}`, `${token} ${term}`]) {
                const normalizedQuery = normalizePartitionText(query);
                if (baseTerms.some(baseTerm => normalizedQuery === baseTerm) || queuedQuerySet.has(normalizedQuery) || completedQueries.has(normalizedQuery)) continue;
                queuedQuerySet.add(normalizedQuery);
                queuedQueries.push(query);
            }
        }
        updatePartitionMonitor({ candidateCount: candidateScores.size, queued: queuedQueries.length });
    };

    addCandidateTokens(lastPeopleResults);
    queueCandidateQueries();
    let emptyStreak = 0;
    let index = 0;
    info.textContent = `🧩 Expand grid: queued ${queuedQueries.length} follow-up queries from ${lastPeopleResults.length.toLocaleString()} fetched profiles…`;

    while (index < queuedQueries.length && partitionStats.length < maxQueries && !partitionExpansionStopRequested) {
        if (activeSearchController !== controller) return;
        const query = queuedQueries[index++];
        const normalizedQuery = normalizePartitionText(query);
        completedQueries.add(normalizedQuery);
        const startedAt = performance.now();
        const response = await fetchPeople(query, controller.signal, 1, {
            foregroundFast: true,
            maxRetries: 1,
            timeoutMs: 10000
        });
        let exactCount = 0;
        let newExact = 0;
        for (const person of response.results || []) {
            const anchor = getPartitionAnchorToken(query, baseTerms);
            const gridText = normalizePartitionText(getGridPartitionValues(person).join(' '));
            if (partitionMatchMode === 'related' ? (anchor && !gridText.includes(anchor)) : !gridResultContainsTerms(person, baseTerms)) continue;
            const key = getGridPartitionKey(person);
            if (!key) continue;
            exactCount++;
            if (!merged.has(key)) newExact++;
            merged.set(key, person);
        }
        addCandidateTokens(response.results);
        queueCandidateQueries();
        const zeroReason = classifyPartitionResult(response, exactCount, newExact);
        partitionStats.push({ query, returned: response.results?.length || 0, exact: exactCount, added: newExact, zeroReason, error: zeroReason !== 'none' ? zeroReason : null, ms: Math.round(performance.now() - startedAt) });
        updatePartitionMonitor({ completed: partitionStats.length, requests: partitionStats.length, returned: (partitionMonitor?.returned || 0) + (response.results?.length || 0), accepted: (partitionMonitor?.accepted || 0) + exactCount, added: (partitionMonitor?.added || 0) + newExact, errors: (partitionMonitor?.errors || 0) + (zeroReason !== 'none' ? 1 : 0), emptyStreak: newExact === 0 ? emptyStreak + 1 : 0, query, zeroReason, rowReturned: response.results?.length || 0, rowAccepted: exactCount, rowAdded: newExact, rowError: zeroReason !== 'none' ? zeroReason : null, rowMs: Math.round(performance.now() - startedAt), queued: queuedQueries.length });
        emptyStreak = newExact === 0 ? emptyStreak + 1 : 0;
        info.textContent = `🧩 Expand grid: ${partitionStats.length}/${Math.min(queuedQueries.length, maxQueries)} partitions · ${merged.size.toLocaleString()} ${partitionMatchMode === 'related' ? 'related' : 'term-matched'} profiles · +${newExact} · ${queuedQueries.length - index} queued`;
        if (partitionMatchMode === 'strict' && partitionStats.length >= 12 && emptyStreak >= PARTITION_SEARCH_EMPTY_STOP) break;
    }

    if (activeSearchController !== controller) return;
    lastPeopleResults = [...merged.values()];
    gridExpansionAvailable = true;
    lastPeopleFilteredCount = lastPeopleResults.length;
    deferDiscoveredSiteIdCollection(lastPeopleResults, searchType === 'bio' ? 'bio-expand' : 'people-expand', base);
    const failed = partitionStats.filter(stat => stat.error).length;
    const added = Math.max(0, lastPeopleResults.length - seedCount);
    const stopped = partitionExpansionStopRequested;
    partitionExpansionRunning = false;
    partitionExpansionStopRequested = false;
    await rerenderPeopleResults();
    info.textContent = `${stopped ? '⏹ Expand grid stopped' : '🧩 Expand grid complete'} · ${lastPeopleResults.length.toLocaleString()} ${partitionMatchMode === 'related' ? 'related' : 'term-matched'} profiles · +${added} new · ${partitionStats.length} partitions${failed ? ` · ${failed} failed` : ''}`;
    console.table?.(partitionStats);
    activeSearchController = null;
}

async function searchGrids(query, searchType) {
    if (activeSearchController) activeSearchController.abort();
    const searchController = new AbortController();
    activeSearchController = searchController;
    const signal = searchController.signal;
    mode = null;
    fetching = false;
    partitionExpansionRunning = false;
    partitionExpansionStopRequested = false;
    gridPartitionRawMode = false;
    forYouMode = false;
    gridExpansionAvailable = false;
    localResultSearchQuery = '';
    localResultMaxAgeDays = 0;

    seenIds.clear();
    allResults = [];
    resetPagination();
    grid.innerHTML = '';
    // Remove any leftover sort bars
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    stopAutoPfp();
    stopProfilePrefetch();
    initProfilePrefetchObserver();

    const isBio = searchType === 'bio';
    mode = isBio ? 'bio' : 'people';
    lastPeopleSearchType = searchType;
    lastSearchQuery = query.trim();
    browseBtn.textContent = "🌐 Live Feed";
    challengeBtn.textContent = "⏳ Scraper";
    if (scraperUi) scraperUi.style.display = 'none';

    // Only show map if deep mode is on
    if (deepMode) {
        initHeaderMap();
        clearHeaderMap();
        showHeaderMap();
    } else {
        hideHeaderMap();
    }

    const trimmedQuery = query.trim();
    const isPattern = hasPatternSyntax(trimmedQuery);
    const apiQueries = isPattern ? extractApiQueries(trimmedQuery) : [trimmedQuery];
    info.textContent = apiQueries.length > 1
        ? `Searching ${isBio ? 'bios' : 'people'}: ${apiQueries.length} queries in parallel...`
        : `Searching ${isBio ? 'bios for' : 'people'} "${apiQueries[0]}"${isPattern ? ' (filtering...)' : ''}...`;

    const requestOptions = { foregroundFast: true, maxRetries: 1, timeoutMs: 10000 };
    const promises = apiQueries.map(q => fetchPeople(q, signal, 1, requestOptions));
    const resultSets = await Promise.all(promises);
    if (signal.aborted || activeSearchController !== searchController) return;
    // Combine and dedupe by siteSubDomain
    const seen = new Set();
    const results = [];
    let anyAuthError = false;
    let anyRateLimited = false;
    let anyRequestError = false;
    for (const res of resultSets) {
        if (res.authError) anyAuthError = true;
        if (res.rateLimited) anyRateLimited = true;
        if (res.error && res.error !== 'aborted' && res.error !== 'rate_limited') anyRequestError = true;
        for (const p of res.results) {
            const key = String(p.siteId || p.site_id || '');
            if (!key) {
                results.push(p);
                continue;
            }
            if (!seen.has(key)) {
                seen.add(key);
                results.push(p);
            }
        }
    }
    deferDiscoveredSiteIdCollection(results, isBio ? 'bio-search' : 'people-search', trimmedQuery);
    console.log(`${searchType} search: ${apiQueries.length} queries, ${results.length} unique results`);

    grid.innerHTML = '';
    if (results.length === 0) {
        lastPeopleFilteredCount = 0;
        const authMsg = anyAuthError ? ' ⚠️ You may need to <a href="https://vsco.co" target="_blank" style="color:#667eea">log in to VSCO</a>.' : '';
        const rateLimitMsg = anyRateLimited ? ' ⚠️ VSCO is rate limiting searches; the request was retried with backoff but did not recover. Wait before trying again.' : '';
        const requestErrorMsg = anyRequestError ? ' ⚠️ The VSCO request failed after retries; this is not a confirmed empty result.' : '';
        grid.innerHTML = `<div class="status">No results found. Try a different ${isBio ? 'bio term' : 'name'}.${authMsg}${rateLimitMsg}${requestErrorMsg}</div>`;
        info.textContent = '';
        if (activeSearchController === searchController) activeSearchController = null;
        return;
    }

    lastPeopleResults = results;
    await rerenderPeopleResults();
    if (activeSearchController === searchController) activeSearchController = null;
}

function followingDisplayProfilesFromRaw(profiles) {
    return profiles;
}

async function showFollowingBaseline() {
    let baseline;
    try { baseline = JSON.parse(localStorage.getItem('vsco_following_baseline_v1') || 'null'); } catch {}
    if (!baseline || !Array.isArray(baseline.rows)) return false;
    mode = 'people'; peopleSortBy = 'pfp'; lastSearchQuery = ''; lastPeopleSearchType = 'people';
    lastPeopleResults = followingDisplayProfilesFromRaw(baseline.rows);
    lastPeopleFilteredCount = lastPeopleResults.length; displayedCount = Math.min(PAGE_SIZE, lastPeopleResults.length);
    resetPagination(); await rerenderPeopleResults();
    info.textContent = `👥 ${lastPeopleResults.length.toLocaleString()} followed profiles · local baseline · sorted by ${getPeopleSortLabel()}`;
    return true;
}

async function loadFollowingGallery({ refresh = false } = {}) {
    if (!refresh && await showFollowingBaseline()) return;
    if (activeSearchController) activeSearchController.abort();
    const controller = new AbortController();
    activeSearchController = controller;
    mode = 'people';
    forYouMode = false;
    peopleSortBy = 'pfp';
    fetching = true;
    lastSearchQuery = '';
    lastPeopleSearchType = 'people';
    lastPeopleResults = [];
    allResults = [];
    seenIds.clear();
    resetPagination();
    grid.innerHTML = '';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    const profiles = [];
    const fetchedAt = Date.now();
    let responseTotal = null;
    for (let page = 1; page <= 500; page++) {
        if (controller.signal.aborted || activeSearchController !== controller) return;
        info.textContent = `👥 Loading Following page ${page}…`;
        const response = await fetch(`https://vsco.co/api/2.0/follows?page=${page}&size=100`, {
            credentials: 'include',
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`Following page ${page}: HTTP ${response.status}`);
        const data = await response.json();
        if (responseTotal == null && Number.isFinite(Number(data?.total))) responseTotal = Number(data.total);
        const items = Array.isArray(data?.results) ? data.results
            : Array.isArray(data?.follows) ? data.follows
            : Array.isArray(data?.users) ? data.users
            : Array.isArray(data?.following) ? data.following
            : [];
        if (!items.length) break;
        profiles.push(...items);
    }
    if (controller.signal.aborted || activeSearchController !== controller) return;
    // /follows returns relationship rows with the actual profile under
    // `site`. Keep those raw rows untouched; create only a display view for
    // the existing People card renderer.
    // Keep the complete upstream payload as a local baseline. The display
    // projection below is separate so later refreshes can diff raw fields.
    const followingBaseline = {
        version: 1,
        fetchedAt,
        total: responseTotal,
        count: profiles.length,
        pages: Math.ceil(profiles.length / 100),
        rows: profiles
    };
    let previousBaseline = null;
    try { previousBaseline = JSON.parse(localStorage.getItem('vsco_following_baseline_v1') || 'null'); } catch {}
    const previousBySiteId = new Map((previousBaseline?.rows || []).map(row => [String(row.site_id || row.site?.id || ''), row]));
    const changedFollowing = profiles.filter(row => {
        const old = previousBySiteId.get(String(row.site_id || row.site?.id || ''));
        return old && JSON.stringify(old.site || {}) !== JSON.stringify(row.site || {});
    });
    localStorage.setItem('vsco_following_baseline_v1', JSON.stringify(followingBaseline));
    if (globalThis.chrome?.storage?.local) {
        chrome.storage.local.set({ vsco_following_baseline_v1: followingBaseline });
    }

    const displayProfiles = followingDisplayProfilesFromRaw(profiles);
    lastPeopleResults = displayProfiles;
    lastPeopleFilteredCount = profiles.length;
    displayedCount = Math.min(PAGE_SIZE, profiles.length);
    await rerenderPeopleResults();
    info.textContent = `👥 ${profiles.length.toLocaleString()} followed profiles · ${changedFollowing.length} profile records changed · sorted by PFP`;
    fetching = false;
    activeSearchController = null;
}

// ============ FOLLOWING DISCOVERY / PERSONAL "FOR YOU" =========
let forYouMode = false;
let forYouPauseRequested = false;
let forYouController = null;
let forYouSource = 'following';
let forYouKind = 'profiles';
let forYouDisplayKind = 'profiles';
let forYouSort = 'newest';
let forYouJob = {
    status: 'idle',
    maxAgeDays: 365,
    maxQueries: 100,
    expansionPerTerm: 8,
    queue: [],
    cursor: 0,
    terms: [],
    logs: [],
    resultsBySiteId: new Map(),
    resultsByImageId: new Map(),
    startedAt: 0,
    updatedAt: 0
};

function resetForYouJob() {
    forYouPauseRequested = false;
    forYouJob = {
        status: 'idle', maxAgeDays: 365, maxQueries: 100, expansionPerTerm: 8, queue: [], cursor: 0,
        terms: [], logs: [], resultsBySiteId: new Map(), resultsByImageId: new Map(),
        startedAt: 0, updatedAt: 0
    };
}

function saveForYouCheckpoint() {
    localStorage.setItem('vsco_for_you_checkpoint_v1', JSON.stringify({
        status: forYouJob.status,
        source: forYouSource,
        kind: forYouKind,
        maxAgeDays: forYouJob.maxAgeDays,
        maxQueries: forYouJob.maxQueries,
        expansionPerTerm: forYouJob.expansionPerTerm,
        queue: forYouJob.queue,
        cursor: forYouJob.cursor,
        terms: forYouJob.terms,
        logs: forYouJob.logs.slice(-500),
        startedAt: forYouJob.startedAt,
        updatedAt: Date.now()
    }));
}

function readFollowingCorpusRows() {
    try {
        const baseline = JSON.parse(localStorage.getItem('vsco_following_baseline_v1') || 'null');
        return Array.isArray(baseline?.rows) ? baseline.rows : [];
    } catch {
        return [];
    }
}

function collectFollowingText(value, key = '', depth = 0, output = []) {
    if (depth > 4 || value == null) return output;
    const normalizedKey = String(key || '').toLowerCase();
    if (/id|url|image|avatar|timestamp|date|created|updated|time|count|page|cursor/.test(normalizedKey)) return output;
    if (typeof value === 'string') {
        const text = value.replace(/\s+/g, ' ').trim();
        if (text && text.length <= 500) output.push(text);
        return output;
    }
    if (Array.isArray(value)) {
        value.slice(0, 100).forEach(item => collectFollowingText(item, key, depth + 1, output));
        return output;
    }
    if (typeof value === 'object') {
        Object.entries(value).forEach(([childKey, child]) => collectFollowingText(child, childKey, depth + 1, output));
    }
    return output;
}

function analyzeFollowingCorpus(rows) {
    const terms = new Map();
    rows.forEach((row, profileIndex) => {
        const profile = normalizeFollowingProfileForScrape(row) || {};
        const textValues = [profile.username, profile.displayName, profile.bio];
        collectFollowingText(row.site || row, '', 0, textValues);
        const tokens = new Set(textValues.flatMap(value => extractPartitionTokens(value)));
        tokens.forEach(token => {
            if (PARTITION_SEARCH_STOP_WORDS.has(token) || token.length < 2) return;
            const entry = terms.get(token) || { term: token, profileCount: 0, score: 0, sampleProfiles: [] };
            entry.profileCount++;
            entry.score += 1 / Math.sqrt(profileIndex + 1);
            if (entry.sampleProfiles.length < 5 && profile.username) entry.sampleProfiles.push(profile.username);
            terms.set(token, entry);
        });
    });
    return [...terms.values()].sort((a, b) => b.profileCount - a.profileCount || b.score - a.score || a.term.localeCompare(b.term));
}

function analyzeFullyLikedCorpus() {
    const terms = new Map();
    const records = [
        ...Object.values(fullyLikedImages || {}),
        ...Object.values(likedProfiles || {})
    ];
    records.forEach((record, recordIndex) => {
        const textValues = [];
        collectFollowingText(record, '', 0, textValues);
        const tokens = new Set(textValues.flatMap(value => extractPartitionTokens(value)));
        tokens.forEach(token => {
            if (PARTITION_SEARCH_STOP_WORDS.has(token) || token.length < 2) return;
            const entry = terms.get(token) || { term: token, profileCount: 0, score: 0, sampleProfiles: [] };
            entry.profileCount++;
            entry.score += 1 / Math.sqrt(recordIndex + 1);
            if (entry.sampleProfiles.length < 5) entry.sampleProfiles.push(record?.grid?.subdomain || record?.username || 'liked');
            terms.set(token, entry);
        });
    });
    return [...terms.values()].sort((a, b) => b.profileCount - a.profileCount || b.score - a.score || a.term.localeCompare(b.term));
}

let fullyLikedMediaEnrichmentCache = (() => {
    try { return JSON.parse(localStorage.getItem('vsco_fully_liked_media_enrichment_v1') || '{}') || {}; }
    catch { return {}; }
})();

async function enrichFullyLikedMediaOnce(signal) {
    const siteIds = new Set();
    Object.values(fullyLikedImages || {}).forEach(item => {
        const siteId = item?.grid?.siteId || item?.site_id || item?.siteId;
        if (siteId) siteIds.add(String(siteId));
    });
    Object.values(likedProfiles || {}).forEach(profile => {
        if (profile?.siteId) siteIds.add(String(profile.siteId));
    });

    // Keep this deliberately bounded: enrichment is resumable through the
    // cache and should not turn a Fully Liked discovery start into a burst.
    let processed = 0;
    for (const siteId of siteIds) {
        if (signal?.aborted) break;
        if (fullyLikedMediaEnrichmentCache[siteId]?.complete) continue;
        if (processed >= 25) break;
        processed++;
        const media = await fetchProfileMedia3(siteId, signal, Date.now() + 12000, siteId, 1);
        const descriptions = media.map(item => item?.image?.description || item?.description).filter(Boolean);
        const profile = likedProfiles[siteId];
        if (profile && descriptions.length) {
            profile.imageDescriptions = mergeLikedProfileDescriptions(profile.imageDescriptions, descriptions);
            profile.lastDescriptionScrapeAt = Date.now();
            await saveLikedProfile(profile);
        }
        if (media.length) {
            const toSave = media.map(item => {
                const image = { ...(item?.image || item) };
                if (!image.imageId && image._id) image.imageId = image._id;
                if (!image.grid) image.grid = { siteId };
                image.sourceQuery = `Fully liked enrichment: ${siteId}`;
                return image;
            }).filter(item => item.imageId);
            if (toSave.length) await saveToVaultDB(toSave);
        }
        fullyLikedMediaEnrichmentCache[siteId] = { complete: true, fetchedAt: Date.now(), count: media.length };
        localStorage.setItem('vsco_fully_liked_media_enrichment_v1', JSON.stringify(fullyLikedMediaEnrichmentCache));
    }
}

function renderForYouControls() {
    document.querySelectorAll('.for-you-controls').forEach(el => el.remove());
    if (!forYouMode) return;
    const bar = document.createElement('div');
    bar.className = 'for-you-controls sort-bar';
    const running = forYouJob.status === 'running' || forYouJob.status === 'pausing';
    const hasJob = forYouJob.queue.length > 0;
    const resultProgress = forYouKind === 'both'
        ? `${forYouJob.resultsBySiteId.size.toLocaleString()} profiles + ${forYouJob.resultsByImageId.size.toLocaleString()} images`
        : `${(forYouKind === 'images' ? forYouJob.resultsByImageId.size : forYouJob.resultsBySiteId.size).toLocaleString()} ${forYouKind}`;
    bar.innerHTML = `
        <span class="sort-label">✨ Discovery</span>
        <select class="for-you-kind" title="Choose the discovery source and API targets">
            ${[
                ['following:profiles', 'Following → Profiles'],
                ['following:images', 'Following → Images'],
                ['following:both', 'Following → Both'],
                ['fully-liked:profiles', 'Fully Liked → Profiles'],
                ['fully-liked:images', 'Fully Liked → Images'],
                ['fully-liked:both', 'Fully Liked → Both']
            ].map(([value, label]) => `<option value="${value}" ${value === `${forYouSource}:${forYouKind}` ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        ${forYouKind === 'both' ? `<select class="for-you-display" title="Choose which combined result pool to display"><option value="profiles" ${forYouDisplayKind === 'profiles' ? 'selected' : ''}>Show Profiles</option><option value="images" ${forYouDisplayKind === 'images' ? 'selected' : ''}>Show Images</option></select>` : ''}
        <label>Sort <select class="for-you-sort" title="Sort the current discovery result pool"><option value="newest" ${forYouSort === 'newest' ? 'selected' : ''}>Newest</option><option value="oldest" ${forYouSort === 'oldest' ? 'selected' : ''}>Oldest</option><option value="score" ${forYouSort === 'score' ? 'selected' : ''}>Similarity score</option><option value="random" ${forYouSort === 'random' ? 'selected' : ''}>Random</option></select></label>
        <label>Age ≤ <select class="for-you-age">${[[0, 'Any'], ...AGE_FILTER_OPTIONS].map(([days, label]) => `<option value="${days}" ${forYouJob.maxAgeDays === days ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Searches <input class="for-you-budget" type="number" min="1" max="500" value="${forYouJob.maxQueries}"></label>
        <label>Follow-ups/term <input class="for-you-expansion-budget" type="number" min="0" max="30" value="${forYouJob.expansionPerTerm}"></label>
        <input class="for-you-local-search" type="search" value="${escapeHtml(localResultSearchQuery)}" placeholder="Filter discovery results…" title="Search across all semantic result fields; comma terms match any">
        <button class="sort-btn for-you-local-clear" ${localResultSearchQuery ? '' : 'disabled'}>Clear</button>
        ${running ? '<button class="sort-btn for-you-pause">⏸ Pause</button>' : `<button class="sort-btn for-you-start">${hasJob && forYouJob.cursor > 0 ? '▶ Resume' : '✨ Start'}</button>`}
        <span class="for-you-progress">${hasJob ? `${forYouJob.cursor}/${forYouJob.queue.length} terms · ${resultProgress}` : 'Analyzes the seed corpus before searching'}</span>
    `;
    bar.querySelector('.for-you-kind')?.addEventListener('change', event => {
        const [source, kind] = event.target.value.split(':');
        if (source === forYouSource && kind === forYouKind) return;
        if (forYouController) {
            forYouController.abort();
            forYouController = null;
            if (activeSearchController) activeSearchController = null;
        }
        forYouSource = source;
        forYouKind = kind;
        forYouDisplayKind = kind === 'images' ? 'images' : 'profiles';
        resetForYouJob();
        localResultSearchQuery = '';
        localResultMaxAgeDays = 0;
        lastPeopleResults = [];
        lastSearchResults = [];
        mode = forYouDisplayKind === 'images' ? 'search' : 'people';
        void (forYouDisplayKind === 'images' ? rerenderSearchResults() : rerenderPeopleResults());
    });
    bar.querySelector('.for-you-display')?.addEventListener('change', event => {
        forYouDisplayKind = event.target.value;
        mode = forYouDisplayKind === 'images' ? 'search' : 'people';
        localResultMaxAgeDays = forYouDisplayKind === 'images' ? forYouJob.maxAgeDays : 0;
        if (forYouDisplayKind === 'images') {
            lastSearchResults = [...forYouJob.resultsByImageId.values()];
            void rerenderSearchResults();
        } else {
            lastPeopleResults = [...forYouJob.resultsBySiteId.values()].filter(forYouResultPassesAge);
            void rerenderPeopleResults();
        }
    });
    bar.querySelector('.for-you-sort')?.addEventListener('change', event => {
        forYouSort = ['newest', 'oldest', 'score', 'random'].includes(event.target.value) ? event.target.value : 'newest';
        if (forYouDisplayKind === 'images') {
            lastSearchResults = sortForYouImages([...forYouJob.resultsByImageId.values()]);
            void rerenderSearchResults();
        } else {
            lastPeopleResults = sortForYouProfiles([...forYouJob.resultsBySiteId.values()].filter(forYouResultPassesAge));
            void rerenderPeopleResults();
        }
    });
    bar.querySelector('.for-you-age')?.addEventListener('change', event => {
        forYouJob.maxAgeDays = Number(event.target.value) || 0;
        localResultMaxAgeDays = forYouDisplayKind === 'images' ? forYouJob.maxAgeDays : 0;
        if (forYouDisplayKind === 'images') {
            lastSearchResults = [...forYouJob.resultsByImageId.values()];
            void rerenderSearchResults();
        } else {
            lastPeopleResults = [...forYouJob.resultsBySiteId.values()].filter(forYouResultPassesAge);
            void rerenderPeopleResults();
        }
    });
    bar.querySelector('.for-you-budget')?.addEventListener('change', event => {
        forYouJob.maxQueries = Math.max(1, Math.min(500, Number.parseInt(event.target.value, 10) || 100));
        event.target.value = forYouJob.maxQueries;
    });
    bar.querySelector('.for-you-expansion-budget')?.addEventListener('change', event => {
        forYouJob.expansionPerTerm = Math.max(0, Math.min(30, Number.parseInt(event.target.value, 10) || 0));
        event.target.value = forYouJob.expansionPerTerm;
    });
    const localInput = bar.querySelector('.for-you-local-search');
    localInput?.addEventListener('input', event => {
        localResultSearchQuery = event.target.value;
        const rerender = forYouDisplayKind === 'images' ? rerenderSearchResults() : rerenderPeopleResults();
        void Promise.resolve(rerender).then(() => {
            const nextInput = document.querySelector('.for-you-local-search');
            nextInput?.focus();
            nextInput?.setSelectionRange(localResultSearchQuery.length, localResultSearchQuery.length);
        });
    });
    bar.querySelector('.for-you-local-clear')?.addEventListener('click', () => {
        localResultSearchQuery = '';
        void (forYouDisplayKind === 'images' ? rerenderSearchResults() : rerenderPeopleResults());
    });
    bar.querySelector('.for-you-start')?.addEventListener('click', () => void runForYouDiscovery());
    bar.querySelector('.for-you-pause')?.addEventListener('click', () => {
        forYouPauseRequested = true;
        forYouJob.status = 'pausing';
        info.textContent = '⏸ Pausing after the current discovery search…';
        renderForYouControls();
    });
    grid.before(bar);
}

function forYouResultPassesAge(person) {
    if (!forYouJob.maxAgeDays) return true;
    const timestamp = getPersonTimestamp(person);
    if (!timestamp) return true;
    return timestamp >= Date.now() - forYouJob.maxAgeDays * 24 * 60 * 60 * 1000;
}

function rankForYouResult(person, termInfo, kind = 'profiles') {
    const timestamp = kind === 'images' ? getTimestamp(person) : getPersonTimestamp(person);
    const ageDays = timestamp ? Math.max(0, (Date.now() - timestamp) / 86400000) : 3650;
    return Math.round((100 / (ageDays + 30) + (termInfo?.profileCount || 0) * 0.25) * 100) / 100;
}

function sortForYouImages(items) {
    if (forYouSort === 'random') {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
    } else if (forYouSort === 'oldest') {
        items.sort((a, b) => getTimestamp(a) - getTimestamp(b));
    } else if (forYouSort === 'score') {
        items.sort((a, b) => (b._forYouScore || 0) - (a._forYouScore || 0));
    } else {
        items.sort((a, b) => getTimestamp(b) - getTimestamp(a));
    }
    return items;
}

function sortForYouProfiles(items) {
    if (forYouSort === 'random') {
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
    } else if (forYouSort === 'oldest') {
        items.sort((a, b) => getPersonTimestamp(a) - getPersonTimestamp(b));
    } else if (forYouSort === 'score') {
        items.sort((a, b) => (b._forYouScore || 0) - (a._forYouScore || 0));
    } else {
        items.sort((a, b) => getPersonTimestamp(b) - getPersonTimestamp(a));
    }
    return items;
}

async function runForYouTermExpansion(seedQuery, kind, signal, maxFollowups = 8) {
    const fetchSeed = kind === 'images'
        ? () => fetchQuery(seedQuery, FOREGROUND_SEARCH_RESULT_LIMIT, signal, { foregroundFast: true, maxRetries: 1, timeoutMs: 10000 })
        : () => fetchPeople(seedQuery, signal, 1, { foregroundFast: true, maxRetries: 1, timeoutMs: 10000 });
    const first = await fetchSeed();
    const results = [...(first.results || [])];
    const candidates = new Map();
    const queued = [];
    const queuedSet = new Set();
    const completed = new Set([normalizePartitionText(seedQuery)]);
    const baseTerms = getPartitionBaseTerms(seedQuery);

    const recordText = record => kind === 'images'
        ? partitionRecordSearchText(record)
        : getGridPartitionValues(record).join(' ');
    const recordMatches = (record, anchor = '') => {
        if (partitionMatchMode === 'related') {
            return !anchor || normalizePartitionText(recordText(record)).includes(anchor);
        }
        const text = normalizePartitionText(recordText(record));
        return baseTerms.some(term => text.includes(term));
    };
    const addCandidates = records => {
        for (const record of records || []) {
            if (!recordMatches(record)) continue;
            for (const token of extractPartitionTokens(recordText(record))) {
                if (baseTerms.includes(token)) continue;
                candidates.set(token, (candidates.get(token) || 0) + 1);
            }
        }
        [...candidates.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, maxFollowups * 2)
            .forEach(([token]) => {
                const query = `${seedQuery} ${token}`;
                const normalized = normalizePartitionText(query);
                if (!queuedSet.has(normalized) && !completed.has(normalized)) {
                    queuedSet.add(normalized);
                    queued.push(query);
                }
            });
    };

    addCandidates(results);
    const logs = [{ query: seedQuery, returned: results.length, seed: true, error: first.error || null }];
    let followups = 0;
    while (queued.length && followups < maxFollowups && !signal?.aborted) {
        const query = queued.shift();
        completed.add(normalizePartitionText(query));
        const response = await (kind === 'images'
            ? fetchQuery(query, FOREGROUND_SEARCH_RESULT_LIMIT, signal, { foregroundFast: true, maxRetries: 1, timeoutMs: 10000 })
            : fetchPeople(query, signal, 1, { foregroundFast: true, maxRetries: 1, timeoutMs: 10000 }));
        const anchor = getPartitionAnchorToken(query, baseTerms);
        const accepted = (response.results || []).filter(record => recordMatches(record, anchor));
        results.push(...accepted);
        addCandidates(response.results || []);
        logs.push({ query, returned: response.results?.length || 0, accepted: accepted.length, error: response.error || null });
        followups++;
    }
    return { results, searches: 1 + followups, logs, seedError: first.error || null };
}

async function runForYouImageDiscovery() {
    if (forYouJob.status === 'running' || forYouJob.status === 'pausing') return;
    forYouMode = true;
    mode = 'search';
    lastSearchQuery = '';
    localResultMaxAgeDays = forYouJob.maxAgeDays;
    if (!forYouJob.queue.length || forYouJob.cursor >= forYouJob.queue.length) {
        if (forYouSource === 'fully-liked') {
            await loadLikedProfiles();
            info.textContent = '❤️ Enriching Fully Liked profiles (cached and resumable)…';
            await enrichFullyLikedMediaOnce(forYouController);
        }
        let rows = forYouSource === 'following' ? readFollowingCorpusRows() : [];
        if (forYouSource === 'following' && !rows.length) {
            info.textContent = '👥 Loading Following so I can analyze the full corpus…';
            await loadFollowingGallery({ refresh: true });
            forYouMode = true;
            mode = 'search';
            rows = readFollowingCorpusRows();
        }
        const analyzed = forYouSource === 'following' ? analyzeFollowingCorpus(rows) : analyzeFullyLikedCorpus();
        if (!analyzed.length) {
            info.textContent = forYouSource === 'fully-liked'
                ? '❤️ Fully Like some images or profiles first so I can build the image discovery corpus.'
                : '⚠️ Could not load a Following corpus for image discovery.';
            renderForYouControls();
            return;
        }
        forYouJob.terms = analyzed.slice(0, 500);
        forYouJob.queue = analyzed.slice(0, forYouJob.maxQueries).map(entry => entry.term);
        forYouJob.cursor = 0;
        forYouJob.logs = [];
        forYouJob.resultsByImageId = new Map();
        forYouJob.resultsBySiteId = new Map();
        forYouJob.startedAt = Date.now();
        saveForYouCheckpoint();
        console.table?.(analyzed.slice(0, 100));
    }
    const controller = new AbortController();
    forYouController = controller;
    activeSearchController = controller;
    forYouPauseRequested = false;
    forYouJob.status = 'running';
    await rerenderSearchResults();
    while (forYouJob.cursor < forYouJob.queue.length) {
        const query = forYouJob.queue[forYouJob.cursor];
        const startedAt = performance.now();
        const expansion = await runForYouTermExpansion(query, 'images', controller.signal, forYouJob.expansionPerTerm);
        if (activeSearchController !== controller) return;
        const termInfo = forYouJob.terms.find(entry => entry.term === query);
        let added = 0;
        for (const item of expansion.results || []) {
            const imageId = String(item?.imageId || item?._id || item?.id || '').trim();
            if (!imageId) continue;
            const score = rankForYouResult(item, termInfo, 'images');
            const existing = forYouJob.resultsByImageId.get(imageId);
            if (!existing || score > (existing._forYouScore || 0)) {
                forYouJob.resultsByImageId.set(imageId, { ...item, _forYouScore: score, _forYouReason: query });
                if (!existing) added++;
            }
        }
        forYouJob.logs.push({ query, returned: expansion.results?.length || 0, added, searches: expansion.searches, expansion: expansion.logs, error: expansion.seedError || null, ms: Math.round(performance.now() - startedAt) });
        forYouJob.cursor++;
        saveForYouCheckpoint();
        lastSearchResults = [...forYouJob.resultsByImageId.values()];
        allResults = lastSearchResults.slice();
        await rerenderSearchResults();
        info.textContent = `✨ Image Discovery ${forYouJob.cursor}/${forYouJob.queue.length} · ${lastSearchResults.length.toLocaleString()} images · +${added} · ${expansion.searches} searches for ${query}`;
        if (forYouPauseRequested) break;
    }
    if (forYouController !== controller) return;
    const paused = forYouPauseRequested || forYouJob.cursor < forYouJob.queue.length;
    forYouJob.status = paused ? 'paused' : 'complete';
    forYouPauseRequested = false;
    forYouController = null;
    activeSearchController = null;
    saveForYouCheckpoint();
    renderForYouControls();
    info.textContent = `${paused ? '⏸ Image Discovery paused' : '✨ Image Discovery complete'} · ${lastSearchResults.length.toLocaleString()} images · ${forYouJob.cursor}/${forYouJob.queue.length} searches`;
    console.table?.(forYouJob.logs);
}

async function runForYouMixedDiscovery() {
    if (forYouJob.status === 'running' || forYouJob.status === 'pausing') return;
    if (activeSearchController) activeSearchController.abort();
    forYouMode = true;
    mode = forYouDisplayKind === 'images' ? 'search' : 'people';
    lastSearchQuery = '';
    localResultMaxAgeDays = forYouDisplayKind === 'images' ? forYouJob.maxAgeDays : 0;
    if (!forYouJob.queue.length || forYouJob.cursor >= forYouJob.queue.length) {
        if (forYouSource === 'fully-liked') {
            await loadLikedProfiles();
            info.textContent = '❤️ Enriching Fully Liked profiles (cached and resumable)…';
            await enrichFullyLikedMediaOnce(forYouController);
        }
        let rows = forYouSource === 'following' ? readFollowingCorpusRows() : [];
        if (forYouSource === 'following' && !rows.length) {
            info.textContent = '👥 Loading Following so I can analyze the full corpus…';
            await loadFollowingGallery({ refresh: true });
            forYouMode = true;
            rows = readFollowingCorpusRows();
        }
        const analyzed = forYouSource === 'following' ? analyzeFollowingCorpus(rows) : analyzeFullyLikedCorpus();
        if (!analyzed.length) {
            info.textContent = forYouSource === 'fully-liked'
                ? '❤️ Fully Like some images or profiles first so I can build the mixed discovery corpus.'
                : '⚠️ Could not load a Following corpus for mixed discovery.';
            renderForYouControls();
            return;
        }
        forYouJob.terms = analyzed.slice(0, 500);
        forYouJob.queue = analyzed.slice(0, forYouJob.maxQueries).map(entry => entry.term);
        forYouJob.cursor = 0;
        forYouJob.logs = [];
        forYouJob.resultsBySiteId = new Map();
        forYouJob.resultsByImageId = new Map();
        forYouJob.startedAt = Date.now();
        saveForYouCheckpoint();
        console.table?.(analyzed.slice(0, 100));
    }
    const controller = new AbortController();
    forYouController = controller;
    activeSearchController = controller;
    forYouPauseRequested = false;
    forYouJob.status = 'running';
    if (forYouDisplayKind === 'images') await rerenderSearchResults();
    else await rerenderPeopleResults();
    while (forYouJob.cursor < forYouJob.queue.length) {
        const query = forYouJob.queue[forYouJob.cursor];
        const startedAt = performance.now();
        const [profileExpansion, imageExpansion] = await Promise.all([
            runForYouTermExpansion(query, 'profiles', controller.signal, forYouJob.expansionPerTerm),
            runForYouTermExpansion(query, 'images', controller.signal, forYouJob.expansionPerTerm)
        ]);
        if (activeSearchController !== controller) return;
        const termInfo = forYouJob.terms.find(entry => entry.term === query);
        let addedProfiles = 0;
        let addedImages = 0;
        for (const person of profileExpansion.results || []) {
            const siteId = String(person?.siteId || person?.site_id || '').trim();
            if (!siteId) continue;
            const score = rankForYouResult(person, termInfo, 'profiles');
            const existing = forYouJob.resultsBySiteId.get(siteId);
            if (!existing || score > (existing._forYouScore || 0)) {
                forYouJob.resultsBySiteId.set(siteId, { ...person, _forYouScore: score, _forYouReason: query });
                if (!existing) addedProfiles++;
            }
        }
        for (const item of imageExpansion.results || []) {
            const imageId = String(item?.imageId || item?._id || item?.id || '').trim();
            if (!imageId) continue;
            const score = rankForYouResult(item, termInfo, 'images');
            const existing = forYouJob.resultsByImageId.get(imageId);
            if (!existing || score > (existing._forYouScore || 0)) {
                forYouJob.resultsByImageId.set(imageId, { ...item, _forYouScore: score, _forYouReason: query });
                if (!existing) addedImages++;
            }
        }
        forYouJob.logs.push({ query, profileReturned: profileExpansion.results?.length || 0, imageReturned: imageExpansion.results?.length || 0, profileSearches: profileExpansion.searches, imageSearches: imageExpansion.searches, addedProfiles, addedImages, profileError: profileExpansion.seedError || null, imageError: imageExpansion.seedError || null, expansion: { profiles: profileExpansion.logs, images: imageExpansion.logs }, ms: Math.round(performance.now() - startedAt) });
        forYouJob.cursor++;
        saveForYouCheckpoint();
        if (forYouDisplayKind === 'images') {
            lastSearchResults = [...forYouJob.resultsByImageId.values()];
            await rerenderSearchResults();
        } else {
            lastPeopleResults = [...forYouJob.resultsBySiteId.values()]
                .filter(forYouResultPassesAge)
                .sort((a, b) => (b._forYouScore || 0) - (a._forYouScore || 0));
            await rerenderPeopleResults();
        }
        info.textContent = `✨ Mixed Discovery ${forYouJob.cursor}/${forYouJob.queue.length} · ${forYouJob.resultsBySiteId.size.toLocaleString()} profiles + ${forYouJob.resultsByImageId.size.toLocaleString()} images · +${addedProfiles}/+${addedImages} · ${profileExpansion.searches}/${imageExpansion.searches} searches · ${query}`;
        if (forYouPauseRequested) break;
    }
    if (forYouController !== controller) return;
    const paused = forYouPauseRequested || forYouJob.cursor < forYouJob.queue.length;
    forYouJob.status = paused ? 'paused' : 'complete';
    forYouPauseRequested = false;
    forYouController = null;
    activeSearchController = null;
    saveForYouCheckpoint();
    renderForYouControls();
    info.textContent = `${paused ? '⏸ Mixed Discovery paused' : '✨ Mixed Discovery complete'} · ${forYouJob.resultsBySiteId.size.toLocaleString()} profiles + ${forYouJob.resultsByImageId.size.toLocaleString()} images · ${forYouJob.cursor}/${forYouJob.queue.length} searches`;
    console.table?.(forYouJob.logs);
}

async function runForYouDiscovery() {
    if (forYouKind === 'both') return runForYouMixedDiscovery();
    if (forYouKind === 'images') return runForYouImageDiscovery();
    if (forYouJob.status === 'running' || forYouJob.status === 'pausing') return;
    if (activeSearchController) activeSearchController.abort();
    forYouMode = true;
    mode = 'people';
    lastSearchQuery = '';
    if (!forYouJob.queue.length || forYouJob.cursor >= forYouJob.queue.length) {
        let rows = forYouSource === 'following' ? readFollowingCorpusRows() : [];
        if (forYouSource === 'following' && !rows.length) {
            info.textContent = '👥 Loading Following so I can analyze the full corpus…';
            await loadFollowingGallery({ refresh: true });
            forYouMode = true;
            mode = 'people';
            rows = readFollowingCorpusRows();
        }
        if (forYouSource === 'following' && !rows.length) {
            info.textContent = '⚠️ Could not load a Following baseline for discovery.';
            renderForYouControls();
            return;
        }
        if (forYouSource === 'fully-liked') {
            await loadLikedProfiles();
            info.textContent = '❤️ Enriching Fully Liked profiles (cached and resumable)…';
            await enrichFullyLikedMediaOnce(forYouController);
        }
        const analyzed = forYouSource === 'following' ? analyzeFollowingCorpus(rows) : analyzeFullyLikedCorpus();
        if (!analyzed.length) {
            info.textContent = '❤️ Fully Like some images or profiles first so I can build the discovery corpus.';
            renderForYouControls();
            return;
        }
        forYouJob.terms = analyzed.slice(0, 500);
        forYouJob.queue = analyzed.slice(0, forYouJob.maxQueries).map(entry => entry.term);
        forYouJob.cursor = 0;
        forYouJob.logs = [];
        forYouJob.resultsBySiteId = new Map();
        localResultSearchQuery = '';
        localResultMaxAgeDays = 0;
        forYouJob.startedAt = Date.now();
        saveForYouCheckpoint();
        console.table?.(analyzed.slice(0, 100));
    }
    const controller = new AbortController();
    forYouController = controller;
    activeSearchController = controller;
    forYouPauseRequested = false;
    forYouJob.status = 'running';
    await rerenderPeopleResults();
    while (forYouJob.cursor < forYouJob.queue.length) {
        const query = forYouJob.queue[forYouJob.cursor];
        const startedAt = performance.now();
        const expansion = await runForYouTermExpansion(query, 'profiles', controller.signal, forYouJob.expansionPerTerm);
        if (activeSearchController !== controller) return;
        const termInfo = forYouJob.terms.find(entry => entry.term === query);
        let recent = 0;
        let added = 0;
        for (const person of expansion.results || []) {
            recent++;
            const siteId = String(person?.siteId || person?.site_id || '').trim();
            if (!siteId) continue;
            const score = rankForYouResult(person, termInfo);
            const existing = forYouJob.resultsBySiteId.get(siteId);
            if (!existing || score > (existing._forYouScore || 0)) {
                forYouJob.resultsBySiteId.set(siteId, { ...person, _forYouScore: score, _forYouReason: query });
                if (!existing) added++;
            }
        }
        forYouJob.logs.push({ query, returned: expansion.results?.length || 0, recent, added, searches: expansion.searches, expansion: expansion.logs, error: expansion.seedError || null, ms: Math.round(performance.now() - startedAt) });
        forYouJob.cursor++;
        saveForYouCheckpoint();
        lastPeopleResults = [...forYouJob.resultsBySiteId.values()]
            .filter(forYouResultPassesAge)
            .sort((a, b) => (b._forYouScore || 0) - (a._forYouScore || 0));
        lastPeopleFilteredCount = lastPeopleResults.length;
        await rerenderPeopleResults();
        info.textContent = `✨ Discovery ${forYouJob.cursor}/${forYouJob.queue.length} · ${lastPeopleResults.length.toLocaleString()} recent profiles · +${added} · ${expansion.searches} searches for ${query}`;
        if (forYouPauseRequested) break;
    }
    if (forYouController !== controller) return;
    const paused = forYouPauseRequested || forYouJob.cursor < forYouJob.queue.length;
    forYouJob.status = paused ? 'paused' : 'complete';
    forYouPauseRequested = false;
    forYouController = null;
    activeSearchController = null;
    saveForYouCheckpoint();
    renderForYouControls();
    info.textContent = `${paused ? '⏸ Discovery paused' : '✨ Discovery complete'} · ${lastPeopleResults.length.toLocaleString()} recent profiles · ${forYouJob.cursor}/${forYouJob.queue.length} searches`;
    console.table?.(forYouJob.logs);
}

function handlePeopleSearch() {
    const q = queryInput.value.trim();
    if (!q) {
        queryInput.focus();
        queryInput.placeholder = "Type a name to search people... 👤";
        return;
    }
    if (gridFieldFilter && gridFieldFilter.value === 'bio') gridFieldFilter.value = 'people';
    searchGrids(q, 'people');
}

function handleBioSearch() {
    const q = queryInput.value.trim();
    if (!q) {
        queryInput.focus();
        queryInput.placeholder = "Type a keyword to search bios... 📝";
        return;
    }
    if (gridFieldFilter && gridFieldFilter.value === 'people') gridFieldFilter.value = 'bio';
    searchGrids(q, 'bio');
}

followingBtn?.addEventListener('click', () => {
    void loadFollowingGallery().catch(error => {
        fetching = false;
        info.textContent = `⚠️ Following load failed: ${error.message}`;
    });
});
document.getElementById('following-updates-btn')?.addEventListener('click', () => {
    void loadFollowingGallery({ refresh: true }).catch(error => {
        fetching = false;
        info.textContent = `⚠️ Following update failed: ${error.message}`;
    });
});
forYouBtn?.addEventListener('click', () => {
    forYouMode = true;
    mode = 'people';
    lastSearchQuery = '';
    lastPeopleSearchType = 'people';
    localResultSearchQuery = '';
    localResultMaxAgeDays = 0;
    if (!forYouJob.queue.length) {
        info.textContent = '✨ Following Discovery ready. It will analyze all followed-account terms before searching.';
    }
    renderForYouControls();
});

// ============ SITE PROFILE EXPAND ============

async function fetchProfile(siteId) {
    if (profileCache[siteId]) return profileCache[siteId];
    try {
        const url = `https://vsco.co/api/2.0/sites/${encodeURIComponent(siteId)}`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) return [];
        const data = await resp.json();
        const site = data?.site?.site || data?.site || data || {};
        const media = site.recently_published ? [{
            _id: getVscoImageId(site.recently_published) || '',
            responsive_url: site.recently_published,
            site_summary: site,
            image_meta: {}
        }] : [];
        profileCache[siteId] = media;
        return media;
    } catch (e) {
        console.error('Profile fetch error:', e);
        return [];
    }
}

// Called when user clicks to expand a card — show info bar only, no image grid
function expandProfileCard(card) {
    const media = card._profileMedia || [];
    const sub = card._sub;

    const panel = document.createElement('div');
    panel.className = 'profile-expand';
    card.appendChild(panel);
    card.classList.add('expanded');

    if (media.length === 0) {
        panel.innerHTML = '<div class="profile-loading">No images found</div>';
        return;
    }

    const phones = [...new Set(media.map(m => m.image_meta?.model).filter(Boolean))];
    const flashCount = media.filter(m => m.image_meta?.flash_mode && !m.image_meta.flash_mode.includes('Off')).length;
    const locCount = media.filter(m => m.has_location).length;
    const presets = [...new Set(media.map(m => m.preset?.short_name).filter(Boolean))];

    // Build compact info bar
    let tags = [];
    tags.push(`${media.length} photos`);
    phones.forEach(phone => {
        const count = media.filter(m => m.image_meta?.model === phone).length;
        tags.push(`📱 ${phone} (${count})`);
    });
    if (flashCount > 0) tags.push(`⚡ Flash (${flashCount})`);
    if (locCount > 0) tags.push(`📍 Location (${locCount})`);
    presets.forEach(p => {
        const count = media.filter(m => m.preset?.short_name === p).length;
        if (count >= 2) tags.push(`🎨 ${p} (${count})`);
    });

    panel.innerHTML = `<div class="profile-info-bar">
        ${tags.map(t => `<span class="info-tag">${escapeHtml(t)}</span>`).join('')}
        <a class="info-tag profile-link" href="https://vsco.co/${escapeHtml(sub)}" target="_blank">↗ Profile</a>
    </div>`;
}

// ============ SCROLL ============
let lastScrollY = 0;
let scrollUpStartY = 0;
let headerHidden = false;
const headerEl = document.querySelector('.header');

window.addEventListener('wheel', (e) => {
    if (e.deltaY > 0) lastUserScrollDownAt = Date.now();
}, { passive: true });

window.addEventListener('touchmove', () => {
    lastUserScrollDownAt = Date.now();
}, { passive: true });

window.addEventListener('keydown', (e) => {
    if (['PageDown', 'Space', 'ArrowDown', 'End'].includes(e.key)) {
        lastUserScrollDownAt = Date.now();
    }
});

window.addEventListener("scroll", () => {
    // Smart header: hide on scroll down, show on scroll up
    const currentScrollY = window.scrollY;
    const scrollingDown = currentScrollY > lastScrollY;
    if (scrollingDown) {
        scrollUpStartY = currentScrollY;
        if (currentScrollY > 120 && !headerHidden) {
            headerEl.classList.add('header-hidden');
            headerHidden = true;
        }
    } else if (currentScrollY < lastScrollY && headerHidden) {
        if ((scrollUpStartY - currentScrollY > 400) || currentScrollY < 120) {
            headerEl.classList.remove('header-hidden');
            headerHidden = false;
        }
    }
    lastScrollY = currentScrollY;

    if (
        scrollingDown &&
        Date.now() - lastUserScrollDownAt < 1000 &&
        currentScrollY > 200 &&
        window.innerHeight + currentScrollY >= document.documentElement.scrollHeight - SCROLL_THRESHOLD_PX
    ) {
        loadMoreResults();
    }
});

// ============ EVENTS ============
form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = queryInput.value.trim();
    if (q) search(q);
});

browseBtn.addEventListener("click", startFeed);
challengeBtn.addEventListener("click", toggleScraperUi);
luckBtn.addEventListener("click", tryLuck);
peopleBtn.addEventListener("click", handlePeopleSearch);
bioBtn.addEventListener("click", handleBioSearch);

// ============ REVIEW & LIKED VIEWS ============

async function showReviewQueue() {
    stopScraper();
    mode = 'review';

    grid.innerHTML = '';
    resetPagination();
    info.textContent = `Loading ${Object.keys(reviewQueue).length} profiles to review...`;
    hideHeaderMap();
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    if (Object.keys(reviewQueue).length === 0) {
        grid.style.display = "";
        grid.classList.remove('review-queue-active');
        grid.innerHTML = '<div class="status">Review queue is empty. Click 🤍 on images in the feed to add them here!</div>';
        return;
    }

    grid.style.display = "block"; // override css grid so blocks fill row
    grid.classList.add('review-queue-active');

    for (const siteId of Object.keys(reviewQueue)) {
        const item = reviewQueue[siteId];
        const block = document.createElement('div');
        block.className = 'review-block';

        let pfpUrl = await fetchSiteProfilePic(siteId, getSubdomainFromCardOrItem(null, item.originalImage));

        let matchFields = [];
        const qSearch = (item.originalImage.sourceQuery || '').toLowerCase();
        if (qSearch && qSearch !== 'random') {
            if (item.originalImage.description && item.originalImage.description.toLowerCase().includes(qSearch)) matchFields.push('Image Description');
            if (item.originalImage.gridName && item.originalImage.gridName.toLowerCase().includes(qSearch)) matchFields.push('Bio');
            if (item.originalImage.userName && item.originalImage.userName.toLowerCase().includes(qSearch)) matchFields.push('Name');
            if (item.originalImage.grid?.subdomain && item.originalImage.grid.subdomain.toLowerCase().includes(qSearch)) matchFields.push('Handle');
            if (matchFields.length === 0) matchFields.push('Other');
        } else if (qSearch === 'random') {
            matchFields.push('Random Search');
        }
        let matchField = matchFields.join(', ') || 'Unknown field';

        block.innerHTML = `
            <div class="review-header">
                <div style="display:flex; align-items:center; gap: 12px;">
                    ${pfpUrl ? `<img src="${pfpUrl}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: #333;">` : ''}
                    <div>
                        <h3 style="margin:0; font-size:18px;">@${escapeHtml(item.originalImage.grid?.subdomain || 'Unknown')}</h3>
                        <div style="font-size:12px; color:#888;">Matched search: ${escapeHtml(item.originalImage.sourceQuery || 'Unknown')} (in ${matchField})</div>
                    </div>
                </div>
                <div style="display:flex; gap: 8px;">
                    <a href="https://vsco.co/${escapeHtml(item.originalImage.grid?.subdomain || '')}" target="_blank" class="sort-btn" style="background: #2563eb !important; color: white !important; display: inline-flex; align-items: center; text-decoration: none;">↗ Go to VSCO</a>
                    <button class="dismiss-btn sort-btn" data-siteid="${siteId}" style="background: #e74c3c !important; color: white !important;">Mark as Reviewed (Hide)</button>
                </div>
            </div>
            <div class="review-grid" id="review-grid-${siteId}"></div>
        `;

        grid.appendChild(block);

        const reviewGrid = document.getElementById(`review-grid-${siteId}`);

        // Fetch recent 12 images
        let profileImages = [];
        try {
            const resp = await fetch(`https://vsco.co/api/3.0/medias/profile?site_id=${siteId}&limit=12`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                const media = data.media || [];
                profileImages = media.map(m => {
                    const img = m.image;
                    if (!img) return null;
                    return {
                        imageId: img._id,
                        responsive_url: img.responsive_url,
                        upload_date: img.upload_date,
                        description: img.description,
                        userName: item.originalImage.userName,
                        gridName: item.originalImage.gridName,
                        grid: { siteId: siteId, subdomain: item.originalImage.grid?.subdomain },
                        sourceQuery: item.originalImage.sourceQuery
                    };
                }).filter(Boolean);
            }
        } catch (e) {
            console.warn("Failed to fetch profile media for", siteId);
        }

        // Render original image first
        item.originalImage.isOriginalMatch = true;
        renderReviewImages([item.originalImage], reviewGrid, siteId, profileImages);

        // Exclude original to prevent dupe
        const newImages = profileImages.filter(img => img.imageId !== item.originalImage.imageId);
        renderReviewImages(newImages, reviewGrid, siteId, profileImages);

        block.querySelector('.dismiss-btn').addEventListener('click', () => {
            delete reviewQueue[siteId];
            chrome.storage.local.set({ reviewQueue });
            block.remove();

            // Mark entire user as seen
            permanentSeenIds.add(String(siteId));
            saveHiddenIdsToDB();

            if (Object.keys(reviewQueue).length === 0) {
                grid.style.display = "";
                grid.classList.remove('review-queue-active');
                grid.innerHTML = '<div class="status">Review queue is empty.</div>';
            }
        });
    }
    info.textContent = `Reviewing ${Object.keys(reviewQueue).length} profiles.`;
}

function renderReviewImages(images, container, siteId, prefetchedItems = null) {
    for (const img of images) {
        const imageId = getVscoImageId(img);
        const fallbackUrl = img.responsive_url || img.image_url || img.site_profile_image_url || '';
        let url = imageId ? '' : getVscoDisplayImageUrl(img, fallbackUrl);
        let NeedsAsyncPfp = false;
        const cardSiteId = img.grid?.siteId || siteId;

        if (img.isRepost && appSettings.showOriginalPosterPfpInReposts && cardSiteId) {
            let cachedPfp = pfpCache[cardSiteId];
            if (cachedPfp) {
                url = cachedPfp;
            } else {
                url = '';
                NeedsAsyncPfp = true;
            }
        }

        if (!url && !NeedsAsyncPfp && !imageId) continue;

        const card = document.createElement("div");
        card.className = "card";

        const time = formatTimeAgo(getTimestamp(img));
        const cardImageId = imageId || img.imageId || img._id;
        const isLiked = fullyLikedImages[cardImageId] !== undefined;

        const isProfile = img.isProfile === true;
        const descHtml = (!isProfile && img.description) ? `<div style="position:absolute; bottom:0; left:0; width:100%; background:rgba(0,0,0,0.7); font-size:12px; padding:8px; box-sizing:border-box; color:#fff; z-index:5; pointer-events:none;">${escapeHtml(img.description)}</div>` : '';
        const bottomOffset = (!isProfile && img.description) ? '35px' : '0';
        const symbol = isProfile ? '👤' : (img.isRepost ? '🔁' : '🖼️');

        card.innerHTML = `
          <div class="card-img-wrap" style="cursor:pointer;" title="Click to view full user profile">
            ${NeedsAsyncPfp || imageId ? `<img class="card-img" style="opacity:0;" src="" loading="lazy">` : `<img class="card-img" src="${escapeHtml(url)}" loading="lazy">`}
            <div class="card-hover-symbol" style="top:8px; bottom:auto; left:8px; right:auto;">🔍</div>
            <div class="card-hover-symbol">${symbol}</div>
            ${time ? `<div class="card-overlay"><span class="time-badge">${escapeHtml(time)}</span></div>` : ''}
            ${img.isOriginalMatch ? `<div class="card-overlay" style="top:auto; bottom:${bottomOffset};"><span class="time-badge" style="background:rgba(102,126,234,0.9)">Original Match</span></div>` : ''}
            ${descHtml}
          </div>
          <button class="fully-like-btn like-btn ${isLiked ? 'liked' : ''}" title="Fully Like">
            ${isLiked ? '❤️' : '🤍'}
          </button>
          ${cardSiteId ? `<button class="card-reposts-btn" title="View User Reposts" style="position:absolute; bottom:8px; left:8px; z-index:10; background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.2); border-radius:50%; width:30px; height:30px; font-size:14px; cursor:pointer;">🔁</button>` : ''}
        `;

        if (NeedsAsyncPfp) {
            const imgEl = card.querySelector('.card-img');
            fetchSiteProfilePic(cardSiteId, getSubdomainFromCardOrItem(card, img)).then(pfpUrl => {
                if (pfpUrl) {
                    imgEl.src = pfpUrl;
                    imgEl.style.opacity = '1';
                }
            }).catch(() => { });
        }

        const imgWrap = card.querySelector('.card-img-wrap');
        const imgUrl = `https://vsco.co/${img.grid?.subdomain}/media/${imageId}`;

        imgWrap.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.metaKey || e.ctrlKey || e.button === 1 || !cardSiteId) {
                window.open(imgUrl, '_blank');
            } else {
                handleInlineReviewExpand(card, img, cardSiteId);
            }
        });

        imgWrap.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                window.open(imgUrl, '_blank');
            }
        });

        if (imageId) {
            const imgEl = card.querySelector('.card-img');
            loadVscoImageIntoElement(imgEl, img, fallbackUrl).catch(() => { });
        }

        const repostsBtn = card.querySelector('.card-reposts-btn');
        if (repostsBtn && cardSiteId) {
            repostsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleInlineRepostsExpand(card, cardSiteId);
            });
        }

        const likeBtn = card.querySelector('.fully-like-btn');
        likeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (fullyLikedImages[imageId]) {
                const unlikedSid = String(img.grid?.siteId || '');
                delete fullyLikedImages[imageId];
                updateFullyLikedSiteIds();
                likeBtn.classList.remove('liked');
                likeBtn.textContent = '🤍';
                if (unlikedSid && !fullyLikedSiteIds.has(unlikedSid)) {
                    deleteLikedProfile(unlikedSid);
                }
            } else {
                fullyLikedImages[imageId] = img;
                updateFullyLikedSiteIds();
                likeBtn.classList.add('liked');
                likeBtn.textContent = '❤️';

                autoScrapeFullyLikedUser(img.grid?.siteId, img, prefetchedItems);
                if (img.grid?.siteId) fetchAndSaveLikedProfile(img.grid.siteId, img);
            }
            chrome.storage.local.set({ fullyLikedImages });
        });

        container.appendChild(card);
    }
}

async function handleInlineReviewExpand(card, itemImg, siteId) {
    if (card._inlineExpanded) {
        if (card.nextSibling && card.nextSibling.classList.contains('inline-review-container')) {
            card.nextSibling.remove();
        }
        card._inlineExpanded = false;
        card.style.display = '';
        return;
    }

    // Mark as expanded
    card._inlineExpanded = true;
    card.style.display = 'none';

    const isPfpMatchBorder = itemImg.isProfile === true;

    // Create inline container
    const inlineContainer = document.createElement("div");
    inlineContainer.className = "inline-review-container review-block";
    inlineContainer.style.gridColumn = "1 / -1";
    inlineContainer.style.border = isPfpMatchBorder ? "2px solid #ff69b4" : "2px solid #667eea";
    inlineContainer.style.borderRadius = "16px";
    inlineContainer.style.padding = "24px";
    inlineContainer.style.background = "#141414";
    inlineContainer.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5)";

    inlineContainer.innerHTML = '<div style="padding:20px; color:#aaa; font-size: 14px;">Loading profile...</div>';

    // Insert after current card
    card.parentNode.insertBefore(inlineContainer, card.nextSibling);

    try {
        const subdomain = getSubdomainFromCardOrItem(card, itemImg);
        const snapshot = mode === 'updates' && siteId
            ? await fetchSiteSnapshotById(siteId, subdomain)
            : await fetchSiteSnapshotBySubdomain(subdomain);
        if (!snapshot) {
            inlineContainer.innerHTML = '<div style="padding:20px; color:red;">Failed to load profile details</div>';
            return;
        }

        const items = [itemImg].filter(Boolean);
        const profileUrl = `https://vsco.co/${escapeHtml(snapshot.subdomain || subdomain || itemImg.grid?.subdomain || '')}`;
        const pfpUrl = snapshot.profileImageUrl || '';
        const recentUrl = snapshot.recentImageUrl || '';
        const description = snapshot.description || '';
        const linkHtml = (snapshot.links || []).map(link =>
            `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" class="sort-btn" style="background:#242424 !important; color:#ddd !important; display:inline-flex; align-items:center; text-decoration:none; border:1px solid #444;">${escapeHtml(link.label || 'Link')}</a>`
        ).join('');

        inlineContainer.innerHTML = `
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px;">
                <div style="min-width:0;">
                    <div style="font-size:20px; font-weight:800; color:#fff;">${escapeHtml(snapshot.displayName || snapshot.subdomain || subdomain || 'Unknown')}</div>
                    <div style="font-size:13px; color:#aaa;">@${escapeHtml(snapshot.subdomain || subdomain || 'unknown')}${snapshot.siteId ? ` · Site ID ${escapeHtml(String(snapshot.siteId))}` : ''}</div>
                    ${description ? `<div style="font-size:14px; color:#ddd; margin-top:8px; white-space:pre-wrap;">${escapeHtml(description)}</div>` : ''}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end;">${linkHtml}</div>
            </div>
            <div class="review-grid"></div>
            <div style="display:flex; justify-content:center; gap: 8px; margin-top: 16px;">
                <a href="${profileUrl}" target="_blank" class="sort-btn" style="background: #2563eb !important; color: white !important; display: inline-flex; align-items: center; text-decoration: none;">↗ Go to @${escapeHtml(snapshot.subdomain || subdomain || 'Unknown')} VSCO</a>
                <button class="dismiss-inline-btn sort-btn" style="background: #333 !important; color: white !important; border: 1px solid #555;">Collapse</button>
                ${!fullyLikedImages[itemImg.imageId || itemImg._id] ? `<button class="inline-fully-like-btn sort-btn" style="background: #e74c3c !important; color: white !important;">❤️ Fully Like</button>` : ''}
            </div>
        `;

        inlineContainer.querySelector('.dismiss-inline-btn').addEventListener('click', () => {
            inlineContainer.remove();
            card._inlineExpanded = false;
            card.style.display = '';
        });

        const fullyLikeAllBtn = inlineContainer.querySelector('.inline-fully-like-btn');
        if (fullyLikeAllBtn) {
            fullyLikeAllBtn.addEventListener('click', () => {
                const imageId = itemImg.imageId || itemImg._id;
                fullyLikedImages[imageId] = itemImg;
                updateFullyLikedSiteIds();
                chrome.storage.local.set({ fullyLikedImages });
                fullyLikeAllBtn.textContent = '❤️ Saved!';
                fullyLikeAllBtn.style.opacity = '0.5';
                fullyLikeAllBtn.style.pointerEvents = 'none';
            });
        }

        const reviewGrid = inlineContainer.querySelector('.review-grid');
        reviewGrid.style = 'display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px;';

        const isPfpMatch = itemImg.isProfile === true;
        itemImg.isOriginalMatch = true;
        itemImg._handled = true;

        // --- ROW 1 ---
        // Profile Pic Always First (Always created, badged if it's the match)
        const pfpImageId = snapshot.profileImageId || `pfp-${snapshot.siteId || siteId || subdomain}`;
        const isPfpLiked = fullyLikedImages[pfpImageId] !== undefined;
        const pfpCard = document.createElement("div");
        pfpCard.className = "card";
        pfpCard.innerHTML = `
          <div class="card-img-wrap" style="cursor:pointer; background:#111; display:flex; align-items:center; justify-content:center; height:100%; min-height:180px;">
            ${pfpUrl ? `<img class="card-img" src="${escapeHtml(pfpUrl)}" loading="lazy" style="object-fit:cover; width:100%; height:100%;">` : '<span style="font-size:42px;">👤</span>'}
            <div class="card-hover-symbol">👤</div>
            <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge" style="background:rgba(51,51,51,0.95); border: 1px solid #777;">Profile</span></div>
            ${isPfpMatch ? `<div class="card-overlay" style="top:auto; bottom:40px;"><span class="time-badge" style="background:rgba(102,126,234,0.95); border: 1px solid #fff;">Original Match</span></div>` : ''}
          </div>
          <button class="fully-like-btn like-btn ${isPfpLiked ? 'liked' : ''}" title="Fully Like">
            ${isPfpLiked ? '❤️' : '🤍'}
          </button>
        `;
        pfpCard.querySelector('.card-img-wrap').addEventListener('click', (e) => {
            e.preventDefault();
            window.open(`https://vsco.co/${snapshot.subdomain || subdomain || itemImg.grid?.subdomain || ''}`, '_blank');
        });
        const pfpLikeBtn = pfpCard.querySelector('.fully-like-btn');
        pfpLikeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (fullyLikedImages[pfpImageId]) {
                delete fullyLikedImages[pfpImageId];
                updateFullyLikedSiteIds();
                pfpLikeBtn.classList.remove('liked');
                pfpLikeBtn.textContent = '🤍';
            } else {
                fullyLikedImages[pfpImageId] = itemImg;
                updateFullyLikedSiteIds();
                pfpLikeBtn.classList.add('liked');
                pfpLikeBtn.textContent = '❤️';
            }
            chrome.storage.local.set({ fullyLikedImages });
        });
        reviewGrid.appendChild(pfpCard);

        const mapProfileImg = item => {
            const mImg = item.image || item;
            if (!mImg) return null;
            const mappedImageId = mImg._id || mImg.id || mImg.imageId;
            return {
                ...mImg,
                imageId: mappedImageId,
                responsive_url: mode === 'updates' && mappedImageId
                    ? getOriginalVscoImageUrl(mImg.responsive_url || mImg.site_profile_image_url || '', mappedImageId)
                    : mImg.responsive_url,
                grid: { siteId: snapshot.siteId || siteId, subdomain: snapshot.subdomain || subdomain || itemImg.grid?.subdomain },
                sourceQuery: itemImg.sourceQuery,
                isOriginalMatch: item.isOriginalMatch || mImg.isOriginalMatch,
                isProfile: item.isProfile || mImg.isProfile
            };
        };

        const renderBatchRow1 = [itemImg].map(item => {
            const mapped = mapProfileImg(item);
            if (mapped) mapped.isOriginalMatch = true;
            return mapped;
        }).filter(Boolean);
        renderReviewImages(renderBatchRow1, reviewGrid, siteId, items);

        if (recentUrl) {
            const recentCard = document.createElement("div");
            recentCard.className = "card";
            recentCard.innerHTML = `
              <div class="card-img-wrap" style="cursor:pointer; background:#111; display:flex; align-items:center; justify-content:center; height:100%; min-height:180px;">
                <img class="card-img" src="${escapeHtml(recentUrl)}" loading="lazy" style="object-fit:cover; width:100%; height:100%;">
                <div class="card-hover-symbol">↗</div>
                <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge" style="background:rgba(102,126,234,0.95); border: 1px solid #fff;">Recently Published</span></div>
              </div>
            `;
            recentCard.querySelector('.card-img-wrap').addEventListener('click', (e) => {
                e.preventDefault();
                window.open(recentUrl, '_blank');
            });
            reviewGrid.appendChild(recentCard);
        }

        if (mode === 'updates') {
            reviewGrid.querySelectorAll('.card-img').forEach(img => {
                img.style.objectFit = 'contain';
                img.style.background = '#111';
            });
        }

    } catch (e) {
        console.warn("Inline review fetch failed:", e);
        inlineContainer.innerHTML = '<div style="padding:20px; color:red;">Error loading profile</div>';
    }
}

async function handleInlineRepostsExpand(card, siteId, isStandalone = false) {
    if (!isStandalone) {
        if (card._inlineExpanded) {
            if (card.nextSibling && card.nextSibling.classList.contains('inline-review-container')) {
                card.nextSibling.remove();
            }
            card._inlineExpanded = false;
            return;
        }
        card._inlineExpanded = true;
    }

    const inlineContainer = document.createElement("div");
    inlineContainer.className = "inline-review-container review-block";
    inlineContainer.style.gridColumn = "1 / -1";
    inlineContainer.style.border = "2px solid #e67e22";
    inlineContainer.style.borderRadius = "16px";
    inlineContainer.style.padding = "24px";
    inlineContainer.style.background = "#141414";
    inlineContainer.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5)";

    if (isStandalone) {
        inlineContainer.style.marginBottom = "24px";
    }

    inlineContainer.innerHTML = '<div style="padding:20px; color:#aaa; font-size: 14px;">Looking up user collection...</div>';

    if (isStandalone) {
        card.parentNode.insertBefore(inlineContainer, card);
        card.remove();
    } else {
        card.parentNode.insertBefore(inlineContainer, card.nextSibling);
    }

    try {
        let cId = siteIdToCollectionId[siteId];
        if (!cId || cId === "none") {
            const resp = await fetch(`https://vsco.co/api/2.0/sites/${siteId}`);
            if (resp.ok) {
                const data = await resp.json();
                cId = data.site?.site_collection_id || "none";
                siteIdToCollectionId[siteId] = cId;
                chrome.storage.local.set({ siteIdToCollectionId });
            } else {
                cId = "none";
            }
        }

        if (cId === "none") {
            inlineContainer.innerHTML = '<div style="padding:20px; color:#aaa; font-size: 14px;">This user has no repost collection.</div>';
            return;
        }

        inlineContainer.innerHTML = '<div style="padding:20px; color:#aaa; font-size: 14px;">Extracting reposts...</div>';

        const repostResp = await fetch(`https://vsco.co/api/2.0/collections/${cId}/reposts?page=1&size=60`, { credentials: 'include' });
        if (!repostResp.ok) {
            inlineContainer.innerHTML = '<div style="padding:20px; color:red; font-size: 14px;">Failed to fetch reposts from VSCO.</div>';
            return;
        }

        const repostData = await repostResp.json();
        let items = [];
        if (repostData.CollectionItems) {
            items = repostData.CollectionItems.map(item => {
                if (!item.media) return null;
                const img = item.media;
                img.imageId = img._id || img.id;
                img.isRepost = true;
                img.reposterSiteId = siteId;
                img.upload_date = item.last_updated || img.upload_date;
                img.description = img.description || '';
                img.gridName = img.grid_name;
                img.userName = img.perma_subdomain;
                img.grid = { siteId: img.site_id || img.siteId, subdomain: img.perma_subdomain };
                return img;
            }).filter(Boolean);
        }

        items.sort((a, b) => (b.upload_date || 0) - (a.upload_date || 0));

        if (items.length === 0) {
            inlineContainer.innerHTML = '<div style="padding:20px; color:#aaa; font-size: 14px;">This user currently has no reposts.</div>';
            return;
        }

        inlineContainer.innerHTML = '';

        let username = "Unknown";
        if (fullyLikedCache) {
            const likedData = fullyLikedCache.find(img => String(img.grid?.siteId) === String(siteId));
            if (likedData) username = likedData.grid?.subdomain || likedData.userName || "Unknown";
        }

        const headerHTML = `
            <div class="review-header" style="justify-content:space-between;">
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:36px; height:36px; border-radius:50%; background:#222; display:flex; align-items:center; justify-content:center; border:2px solid #e67e22;">
                    <span style="font-size:16px;">🔁</span>
                </div>
                <h3 style="margin:0; font-size:18px; color:#fff;">@${escapeHtml(username)}'s Reposts (First ${items.length})</h3>
                ${!isStandalone ? `<button class="inline-close-btn" style="background:transparent; border:none; cursor:pointer; font-size:16px; margin-left:14px; color:#666;">Close</button>` : ''}
              </div>
              <button class="view-all-reposts-btn" style="background:#e67e22; border:none; border-radius:8px; padding:6px 14px; color:#fff; cursor:pointer;">View All Reposts ↗</button>
            </div>
        `;
        inlineContainer.insertAdjacentHTML('afterbegin', headerHTML);

        if (!isStandalone) {
            inlineContainer.querySelector('.inline-close-btn').addEventListener('click', () => {
                inlineContainer.remove();
                if (card) card._inlineExpanded = false;
            });
        }

        inlineContainer.querySelector('.view-all-reposts-btn').addEventListener('click', () => {
            showSingleUserRepostsFeed(siteId);
        });

        const reviewGrid = document.createElement("div");
        reviewGrid.className = "review-grid";
        reviewGrid.style = 'display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-top: 16px;';
        inlineContainer.appendChild(reviewGrid);

        const topReposts = items.slice(0, 9);
        let row1Images = topReposts.slice(0, 4);
        let row2Images = topReposts.slice(4, 9);

        let pfpUrl = await fetchSiteProfilePic(siteId);

        const pfpCard = document.createElement("div");
        pfpCard.className = "card";
        pfpCard.innerHTML = `
          <div class="card-img-wrap" style="cursor:pointer; background:#111; display:flex; align-items:center; justify-content:center; height:100%; min-height:180px;">
            ${pfpUrl ? `<img class="card-img" src="${escapeHtml(pfpUrl)}" loading="lazy" style="object-fit:cover; width:100%; height:100%;">` : '<span style="font-size:42px;">👤</span>'}
            <div class="card-hover-symbol">👤</div>
            <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge" style="background:rgba(230,126,34,0.95); border: 1px solid #fff;">Reposter</span></div>
          </div>
        `;
        pfpCard.querySelector('.card-img-wrap').addEventListener('click', (e) => {
            e.preventDefault();
            if (username !== "Unknown") window.open(`https://vsco.co/${escapeHtml(username)}`, '_blank');
        });
        reviewGrid.appendChild(pfpCard);

        const mapProfileImg = item => {
            const mImg = item.image || item;
            if (!mImg) return null;
            return {
                ...mImg,
                imageId: mImg._id || mImg.id || mImg.imageId,
                grid: { siteId: mImg.site_id || mImg.siteId, subdomain: mImg.perma_subdomain },
                sourceQuery: 'Repost',
                isRepost: true,
                reposterSiteId: siteId
            };
        };

        const renderBatchRow1 = row1Images.map(mapProfileImg).filter(Boolean);
        renderReviewImages(renderBatchRow1, reviewGrid, siteId, items);

        const renderBatchRow2 = row2Images.map(mapProfileImg).filter(Boolean);
        renderReviewImages(renderBatchRow2, reviewGrid, siteId, items);

    } catch (e) {
        console.warn("Inline repost fetch failed:", e);
        inlineContainer.innerHTML = '<div style="padding:20px; color:red;">Error loading reposts</div>';
    }
}

function showFullyLiked() {
    stopScraper();
    mode = 'fully-liked';

    grid.innerHTML = '';
    grid.style.display = "";
    grid.classList.remove('review-queue-active');

    resetPagination();
    info.textContent = `Loading ${Object.keys(fullyLikedImages).length} fully liked images...`;
    hideHeaderMap();
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    if (!fullyLikedCache) {
        const images = Object.values(fullyLikedImages);
        images.forEach(img => {
            if (img._ts === undefined) img._ts = getTimestamp(img);
        });
        images.sort((a, b) => b._ts - a._ts);
        fullyLikedCache = images;
    }
    const images = fullyLikedCache;

    if (images.length === 0) {
        grid.innerHTML = '<div class="status">No fully liked images yet.</div>';
        return;
    }

    allResults = [];
    seenIds.clear();
    addDedupe(images);
    resetPagination();
    renderNew();
    info.textContent = `Showing ${images.length} fully liked images.`;

    const actionBar = document.createElement('div');
    actionBar.className = 'sort-bar';
    actionBar.style.justifyContent = 'center';
    actionBar.innerHTML = `
        <button id="bulk-follow-btn" class="sort-btn" style="background: #3498db; color: white;">➕ Bulk Follow All Users (${fullyLikedSiteIds.size})</button>
        <button id="export-fully-liked-btn" class="sort-btn" style="background: #e67e22; color: white;">💾 Export Liked Data</button>
    `;

    const searchHeaderContainer = document.querySelector('.search-header-container');
    if (searchHeaderContainer) {
        searchHeaderContainer.appendChild(actionBar);
    } else {
        document.body.insertBefore(actionBar, grid);
    }

    setTimeout(() => {
        const btn = document.getElementById('bulk-follow-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                const siteIdsToFollow = Array.from(fullyLikedSiteIds);
                btn.textContent = 'Queuing follows...';
                btn.disabled = true;
                btn.style.opacity = '0.5';

                siteIdsToFollow.forEach(siteId => followUser(siteId));

                btn.textContent = `Queued ${siteIdsToFollow.length} users! ⏳`;
            });
        }

        const exportBtn = document.getElementById('export-fully-liked-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', async () => {
                exportBtn.textContent = 'Extracting DB...';
                try {
                    const db = await openVaultDB();
                    const users = {};
                    await new Promise((resolve, reject) => {
                        const tx = db.transaction('images', 'readonly');
                        const req = tx.objectStore('images').openCursor();
                        req.onsuccess = (e) => {
                            const cursor = e.target.result;
                            if (!cursor) {
                                resolve();
                                return;
                            }
                            const item = cursor.value;
                            const siteId = String(item.grid?.siteId);
                            if (siteId && fullyLikedSiteIds.has(siteId)) {
                                if (!users[siteId]) {
                                    users[siteId] = {
                                        siteId: siteId,
                                        username: item.grid?.subdomain || item.userName || item.perma_subdomain || 'unknown',
                                        images: []
                                    };
                                }
                                users[siteId].images.push(item);
                            }
                            cursor.continue();
                        };
                        req.onerror = () => reject(req.error);
                    });

                    const blob = new Blob([JSON.stringify({ fullyLikedProfiles: users }, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `VSCO_Fully_Liked_Data_${new Date().toISOString().split('T')[0]}.json`;
                    a.click();
                    URL.revokeObjectURL(url);

                    exportBtn.textContent = `✅ Exported ${Object.keys(users).length} Users!`;
                    setTimeout(() => exportBtn.textContent = '💾 Export Liked Data', 4000);
                } catch (e) {
                    console.error("Export liked data failed:", e);
                    exportBtn.textContent = 'Error!';
                    setTimeout(() => exportBtn.textContent = '💾 Export Liked Data', 3000);
                }
            });
        }
    }, 100);
}

async function showRepostsFeed() {
    stopScraper();
    mode = 'reposts';

    grid.innerHTML = '';
    grid.style.display = "flex";
    grid.style.flexDirection = "column";
    grid.classList.remove('review-queue-active');

    resetPagination();
    info.textContent = `Loading collections for ${fullyLikedSiteIds.size} fully liked users...`;
    hideHeaderMap();
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    if (fullyLikedSiteIds.size === 0) {
        grid.innerHTML = '<div class="status">No fully liked users yet.</div>';
        return;
    }

    const siteIds = Array.from(fullyLikedSiteIds).reverse();

    if (!fullyLikedCache) {
        const images = Object.values(fullyLikedImages);
        images.forEach(img => {
            if (img._ts === undefined) img._ts = getTimestamp(img);
        });
        images.sort((a, b) => b._ts - a._ts);
        fullyLikedCache = images;
    }

    const lazyObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const siteId = entry.target.dataset.siteId;
                obs.unobserve(entry.target);

                handleInlineRepostsExpand(entry.target, siteId, true);
            }
        });
    }, { rootMargin: "600px" });

    siteIds.forEach(siteId => {
        const dummyCard = document.createElement("div");
        dummyCard.className = "dummy-reposts-card";
        dummyCard.style.height = "250px";
        dummyCard.dataset.siteId = siteId;
        grid.appendChild(dummyCard);

        lazyObserver.observe(dummyCard);
    });

    if (mode === 'reposts') {
        info.textContent = `Scroll down to load newest fully liked user repost collections!`;
    }
}

// removed applyRepostsSortAndRender

// removed renderRepostsSortUI

async function showSingleUserRepostsFeed(siteId) {
    stopScraper();
    mode = 'single-user-reposts';

    grid.innerHTML = '';
    grid.style.display = "";
    grid.classList.remove('review-queue-active');

    resetPagination();
    info.textContent = `Loading single user reposts...`;
    hideHeaderMap();
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    singleUserRepostsState = {
        siteId: siteId,
        page: 1,
        hasMore: true,
        isLoading: false
    };

    allResults = [];
    seenIds.clear();

    await fetchNextSingleUserRepostsPage();
}

async function fetchNextSingleUserRepostsPage() {
    if (!singleUserRepostsState || !singleUserRepostsState.hasMore || singleUserRepostsState.isLoading) return;

    singleUserRepostsState.isLoading = true;
    info.textContent = `Streaming reposts page ${singleUserRepostsState.page}...`;

    const siteId = singleUserRepostsState.siteId;
    let cId = siteIdToCollectionId[siteId];

    if (!cId || cId === "none") {
        try {
            const resp = await fetch(`https://vsco.co/api/2.0/sites/${siteId}`);
            if (resp.ok) {
                const data = await resp.json();
                cId = data.site?.site_collection_id || "none";
                siteIdToCollectionId[siteId] = cId;
                chrome.storage.local.set({ siteIdToCollectionId });
            } else {
                cId = "none";
            }
        } catch (e) {
            cId = "none";
        }
    }

    if (cId === "none") {
        info.textContent = `This user has no repost collection.`;
        singleUserRepostsState.hasMore = false;
        singleUserRepostsState.isLoading = false;
        return;
    }

    try {
        const url = `https://vsco.co/api/2.0/collections/${cId}/reposts?page=${singleUserRepostsState.page}&size=60`;
        const resp = await fetch(url, { credentials: 'include' });
        if (resp.ok) {
            const data = await resp.json();
            if (data.CollectionItems && data.CollectionItems.length > 0) {
                let batchMedia = [];
                data.CollectionItems.forEach(item => {
                    if (item.media) {
                        const img = item.media;
                        img.imageId = img._id || img.id;
                        img.isRepost = true;
                        img.reposterSiteId = siteId;
                        img.upload_date = item.last_updated || img.upload_date;
                        img.description = img.description || '';
                        img.gridName = img.grid_name;
                        img.userName = img.perma_subdomain;
                        img.grid = { siteId: img.site_id || img.siteId, subdomain: img.perma_subdomain };

                        batchMedia.push(img);
                    }
                });

                addDedupe(batchMedia);
                renderNew();

                const loadedCount = document.querySelectorAll('.card').length;
                info.textContent = `Showing ${loadedCount} reposts for user (Page ${singleUserRepostsState.page})...`;
                singleUserRepostsState.page++;
            } else {
                singleUserRepostsState.hasMore = false;
                info.textContent = `End of reposts. Showing ${allResults.length} total for user.`;
            }
        } else {
            singleUserRepostsState.hasMore = false;
        }
    } catch (e) {
        singleUserRepostsState.hasMore = false;
    }

    singleUserRepostsState.isLoading = false;
}

function formatDateTimeLocalValue(timeMs) {
    const date = new Date(timeMs);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
}

async function showUpdatesFeed() {
    stopScraper();
    setScanPaused(false);
    mode = 'updates';

    grid.innerHTML = '';
    grid.style.display = '';
    grid.classList.remove('review-queue-active');

    resetPagination();
    hideHeaderMap();
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    const actionBar = document.createElement('div');
    actionBar.className = 'sort-bar';
    actionBar.id = 'updates-action-bar';
    actionBar.style.cssText = 'justify-content:center; flex-wrap:wrap; gap:8px;';
    const defaultRangeEnd = tmEnd?.value || formatDateTimeLocalValue(Date.now());
    const defaultRangeStart = tmStart?.value || formatDateTimeLocalValue(Date.now() - 72 * 60 * 60 * 1000);
    actionBar.innerHTML = `
        <button id="scan-start-btn" class="sort-btn" style="background:#e74c3c; color:#fff;">▶ Check Fully Liked PFPs</button>
        <button id="scan-pause-btn" class="sort-btn" style="display:none;">⏸ Pause</button>
        <button id="scan-all-updates" class="sort-btn" style="background:#555; color:#fff;">🌐 Full Vault Scan</button>
        <input id="vault-pfp-start" type="datetime-local" value="${escapeHtml(defaultRangeStart)}"
            style="background:#222; color:#fff; border:1px solid #555; border-radius:6px; padding:6px 10px; font-size:13px;">
        <span style="color:#aaa; font-size:12px;">to</span>
        <input id="vault-pfp-end" type="datetime-local" value="${escapeHtml(defaultRangeEnd)}"
            style="background:#222; color:#fff; border:1px solid #555; border-radius:6px; padding:6px 10px; font-size:13px;">
        <button id="scan-vault-range-pfps" class="sort-btn" style="background:#8e44ad; color:#fff;">🖼 Range PFP Check</button>
        <input id="manual-scan-input" type="text" placeholder="manual: site IDs or usernames..."
            style="background:#222; color:#fff; border:1px solid #555; border-radius:6px; padding:6px 10px; font-size:13px; min-width:220px;">
        <button id="scan-manual-updates" class="sort-btn" style="background:#27ae60; color:#fff;">▶ Scan These</button>
    `;

    const searchHeaderContainer = document.querySelector('.search-header-container');
    if (searchHeaderContainer) searchHeaderContainer.appendChild(actionBar);
    else document.body.insertBefore(actionBar, grid);

    document.getElementById('scan-start-btn').addEventListener('click', () => runUpdatesScan(true));
    document.getElementById('scan-all-updates').addEventListener('click', () => runUpdatesScan(false));
    document.getElementById('scan-vault-range-pfps').addEventListener('click', runVaultRangePfpScan);
    document.getElementById('scan-pause-btn').addEventListener('click', () => setScanPaused(!scanPaused));
    document.getElementById('scan-manual-updates').addEventListener('click', () => {
        const raw = document.getElementById('manual-scan-input').value.trim();
        if (raw) runManualScan(raw);
    });
    document.getElementById('manual-scan-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const raw = document.getElementById('manual-scan-input').value.trim();
            if (raw) runManualScan(raw);
        }
    });

    info.textContent = 'Loading fully liked profiles...';
    await refreshUpdatesData();

    // Show fully liked profiles immediately from memory, newest first.
    // Use the union of liked_profiles and fullyLikedImages so the Updates screen
    // still works even if the dedicated liked_profiles store has not backfilled yet.
    const profiles = getUpdatesProfiles().sort((a, b) => {
        const ta = a.pfpHistory?.at(-1)?.detectedAt || a.lastCheckedAt || 0;
        const tb = b.pfpHistory?.at(-1)?.detectedAt || b.lastCheckedAt || 0;
        return tb - ta;
    });

    if (profiles.length === 0) {
        info.textContent = 'No fully liked profiles yet.';
        return;
    }

    info.textContent = `${profiles.length} fully liked profiles — click a card to expand, or use the refresh button on a card to check one profile`;

    const frag = document.createDocumentFragment();
    for (const p of profiles) {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.updateProfileId = p.siteId;
        card.style.cssText = 'position:relative; cursor:pointer; border:1px solid #333;';
        card.title = `Open @${p.username || p.siteId}`;
        const originalPfpUrl = getOriginalVscoImageUrl(p.pfpUrl || '');
        const pfpSrc = escapeHtml(originalPfpUrl);
        const name = escapeHtml(p.username || p.siteId);
        const displayName = escapeHtml(p.displayName || '');
        const checkedAgo = formatUpdatesCheckedAgo(p.lastCheckedAt);
        const expandImg = {
            imageId: p.seedImageId || `profile-${p.siteId}`,
            isProfile: true,
            sourceQuery: 'Updates',
            userName: p.displayName || '',
            gridName: p.bio || '',
            site_profile_image_url: originalPfpUrl,
            grid: { siteId: p.siteId, subdomain: p.username || '' }
        };
        card.innerHTML = `
            <div class="updates-profile-media">
                ${pfpSrc
                    ? `<img class="updates-profile-img" src="${pfpSrc}" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">`
                    : `<div class="updates-profile-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:32px; background:#222;">👤</div>`}
            </div>
            <div class="updates-profile-badge" style="position:absolute; top:8px; left:8px; z-index:6; background:rgba(80,80,80,0.9); color:#fff; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:700;">Ready</div>
            <button class="updates-check-btn" title="Check this profile now" style="position:absolute; top:8px; right:8px; z-index:7; background:rgba(0,0,0,0.7); color:#fff; border:1px solid rgba(255,255,255,0.18); border-radius:999px; padding:6px 10px; font-size:12px; cursor:pointer;">🔄</button>
        `;
        card.innerHTML += `
            <div class="card-overlay" style="top:auto; bottom:0; left:0; width:100%; background:linear-gradient(transparent,rgba(0,0,0,0.85)); padding:8px 6px 6px; box-sizing:border-box; pointer-events:none;">
                <div style="font-size:12px; font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">@${name}</div>
                ${displayName ? `<div class="updates-profile-display" style="font-size:11px; color:#bbb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>` : `<div class="updates-profile-display" style="display:none;"></div>`}
                <div class="updates-profile-statusline" style="font-size:10px; color:#888;">${p.lastCheckedAt ? `Last checked ${checkedAgo}` : 'Not checked yet'}</div>
            </div>`;
        card.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.metaKey || e.ctrlKey) {
                window.open(`https://vsco.co/${p.username || ''}`, '_blank');
                return;
            }
            handleInlineReviewExpand(card, expandImg, p.siteId);
        });
        card.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                window.open(`https://vsco.co/${p.username || ''}`, '_blank');
            }
        });
        card.querySelector('.updates-check-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            runSingleUpdateCheck(p.siteId);
        });
        frag.appendChild(card);
    }
    grid.appendChild(frag);
}

async function refreshUpdatesData() {
    try {
        const res = await new Promise(resolve => {
            chrome.storage.local.get(['fullyLikedImages', 'savedPfps', 'appSettings'], resolve);
        });

        if (res.fullyLikedImages) {
            fullyLikedImages = res.fullyLikedImages;
            updateFullyLikedSiteIds();
        }
        if (res.savedPfps) savedPfps = res.savedPfps;
        appSettings = normalizeAppSettings(res.appSettings);

        likedProfiles = {};
        await loadLikedProfiles();
    } catch (e) {
        console.warn('refreshUpdatesData failed:', e);
    }
}

function getUpdatesProfiles() {
    if (fullyLikedSiteIds.size === 0 && Object.keys(fullyLikedImages).length > 0) {
        updateFullyLikedSiteIds();
    }

    const bySite = {};

    Object.values(likedProfiles).forEach(profile => {
        if (!profile?.siteId) return;
        bySite[String(profile.siteId)] = {
            siteId: String(profile.siteId),
            username: profile.username || 'unknown',
            displayName: profile.displayName || '',
            bio: profile.bio || '',
            pfpUrl: profile.pfpUrl || savedPfps[String(profile.siteId)] || '',
            pfpHistory: profile.pfpHistory || [],
            lastCheckedAt: profile.lastCheckedAt || 0,
            seedImageId: ''
        };
    });

    const latestLikedBySite = {};
    Object.values(fullyLikedImages).forEach(img => {
        const siteId = String(img?.grid?.siteId || '');
        if (!siteId) return;
        const ts = getTimestamp(img);
        if (!latestLikedBySite[siteId] || ts > latestLikedBySite[siteId]._ts) {
            latestLikedBySite[siteId] = { img, _ts: ts };
        }
    });

    fullyLikedSiteIds.forEach(rawSiteId => {
        const siteId = String(rawSiteId);
        const liked = latestLikedBySite[siteId]?.img;
        if (bySite[siteId]) {
            if (!bySite[siteId].seedImageId) {
                bySite[siteId].seedImageId = String(liked?.imageId || liked?._id || liked?.id || '');
            }
            if ((!bySite[siteId].username || bySite[siteId].username === 'unknown') && liked?.grid?.subdomain) {
                bySite[siteId].username = liked.grid.subdomain;
            }
            if (!bySite[siteId].displayName && liked?.userName) {
                bySite[siteId].displayName = liked.userName;
            }
            if (!bySite[siteId].bio && liked?.gridName) {
                bySite[siteId].bio = liked.gridName;
            }
            if (!bySite[siteId].pfpUrl && (savedPfps[siteId] || liked?.site_profile_image_url)) {
                bySite[siteId].pfpUrl = savedPfps[siteId] || normalize(liked?.site_profile_image_url || '');
            }
            return;
        }

        const username = liked?.grid?.subdomain || liked?.userName || liked?.perma_subdomain || 'unknown';
        const displayName = liked?.userName || '';
        const bio = liked?.gridName || '';
        const pfpUrl = savedPfps[siteId] || normalize(liked?.site_profile_image_url || '');
        const pfpHistory = pfpUrl ? [{ url: pfpUrl, detectedAt: 0 }] : [];

        bySite[siteId] = {
            siteId,
            username,
            displayName,
            bio,
            pfpUrl,
            pfpHistory,
            lastCheckedAt: 0,
            seedImageId: String(liked?.imageId || liked?._id || liked?.id || '')
        };
    });

    return Object.values(bySite);
}

function formatUpdatesCheckedAgo(ts) {
    if (!ts) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function getUpdatesProfileCard(siteId) {
    return Array.from(document.querySelectorAll('[data-update-profile-id]'))
        .find(card => card.dataset.updateProfileId === String(siteId)) || null;
}

function updateUpdatesProfileCard(siteId, userState, state, options = {}) {
    const card = getUpdatesProfileCard(siteId);
    if (!card) return;

    const media = card.querySelector('.updates-profile-media');
    const badge = card.querySelector('.updates-profile-badge');
    const statusLine = card.querySelector('.updates-profile-statusline');
    const displayEl = card.querySelector('.updates-profile-display');
    const currentPfp = options.newPfpUrl || userState.lastPfp || '';
    const previousPfp = options.previousPfp || '';
    const currentPfpDisplay = getOriginalVscoImageUrl(currentPfp);
    const previousPfpDisplay = getOriginalVscoImageUrl(previousPfp);

    if (media) {
        if (options.hasNewPfp && previousPfpDisplay && currentPfpDisplay && previousPfpDisplay !== currentPfpDisplay) {
            media.innerHTML = `
                <div style="display:grid; grid-template-columns:1fr 1fr; width:100%; height:100%;">
                    <div style="position:relative; min-width:0; overflow:hidden;">
                        <img class="updates-profile-img updates-profile-img-previous" src="${escapeHtml(previousPfpDisplay)}" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                        <span style="position:absolute; bottom:5px; left:5px; background:rgba(0,0,0,0.72); color:#ddd; padding:2px 5px; border-radius:5px; font-size:9px;">Before</span>
                    </div>
                    <div style="position:relative; min-width:0; overflow:hidden;">
                        <img class="updates-profile-img updates-profile-img-current" src="${escapeHtml(currentPfpDisplay)}" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">
                        <span style="position:absolute; bottom:5px; right:5px; background:rgba(231,76,60,0.88); color:#fff; padding:2px 5px; border-radius:5px; font-size:9px;">Now</span>
                    </div>
                </div>`;
        } else {
            media.innerHTML = currentPfpDisplay
                ? `<img class="updates-profile-img" src="${escapeHtml(currentPfpDisplay)}" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">`
                : `<div class="updates-profile-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:32px; background:#222;">👤</div>`;
        }
    }

    if (displayEl) {
        if (userState.displayName) {
            displayEl.style.display = '';
            displayEl.textContent = userState.displayName;
        } else {
            displayEl.style.display = 'none';
            displayEl.textContent = '';
        }
    }

    let badgeText = 'Ready';
    let badgeBg = 'rgba(80,80,80,0.9)';
    let statusText = userState.lastCheckedAt ? `Last checked ${formatUpdatesCheckedAgo(userState.lastCheckedAt)}` : 'Not checked yet';
    let borderColor = '#333';
    let opacity = '1';

    if (state === 'checking') {
        badgeText = 'Checking';
        badgeBg = 'rgba(245, 158, 11, 0.92)';
        statusText = options.statusText || 'Checking now...';
        borderColor = '#f59e0b';
        opacity = '0.9';
    } else if (state === 'updated') {
        const uploadsCount = options.uploadsCount || 0;
        const parts = [];
        if (options.hasNewPfp) parts.push('profile pic changed');
        if (uploadsCount > 0) parts.push(`${uploadsCount} new uploads`);
        parts.push(`checked ${formatUpdatesCheckedAgo(userState.lastCheckedAt)}`);
        badgeText = options.hasNewPfp ? 'PFP Changed' : uploadsCount > 0 ? `+${uploadsCount}` : 'Updated';
        badgeBg = options.hasNewPfp ? 'rgba(231, 76, 60, 0.94)' : 'rgba(46, 204, 113, 0.94)';
        statusText = options.statusText || parts.join(' · ');
        borderColor = options.hasNewPfp ? '#e74c3c' : '#2ecc71';
    } else if (state === 'checked') {
        badgeText = 'Checked';
        badgeBg = 'rgba(34, 197, 94, 0.88)';
        statusText = options.statusText || `Checked ${formatUpdatesCheckedAgo(userState.lastCheckedAt)}`;
        borderColor = '#22c55e';
    } else if (state === 'baseline') {
        badgeText = 'Baseline Saved';
        badgeBg = 'rgba(59, 130, 246, 0.9)';
        statusText = options.statusText || 'First PFP baseline initialized';
        borderColor = '#3b82f6';
    } else if (state === 'error') {
        badgeText = 'Error';
        badgeBg = 'rgba(231, 76, 60, 0.92)';
        statusText = options.statusText || 'Check failed';
        borderColor = '#e74c3c';
    }

    if (badge) {
        badge.textContent = badgeText;
        badge.style.background = badgeBg;
    }
    if (statusLine) statusLine.textContent = statusText;
    card.dataset.updateState = state;
    card.classList.toggle('updates-pfp-changed', state === 'updated' && options.hasNewPfp === true);
    card.style.border = `1px solid ${borderColor}`;
    card.style.opacity = opacity;
    if (state === 'updated' && options.hasNewPfp === true && card.parentElement === grid) {
        card.style.boxShadow = '0 0 0 2px rgba(231,76,60,0.75), 0 10px 28px rgba(231,76,60,0.24)';
        grid.prepend(card);
    } else if (state !== 'checking') {
        card.style.boxShadow = '';
    }
}

function updateUpdatesProgress(scanned, total, updatesFound, currentText = '', pfpOnly = false) {
    const label = pfpOnly ? 'PFP check' : 'Update scan';
    const parts = [`${label}: ${scanned}/${total}`];
    if (currentText) parts.push(currentText);
    if (updatesFound > 0) parts.push(`${updatesFound} found`);
    info.textContent = parts.join(' · ');
}

function buildUpdatesUserState(siteId) {
    const sid = String(siteId);
    const profile = getUpdatesProfiles().find(p => p.siteId === sid);
    if (!profile) return null;

    return {
        siteId: sid,
        username: profile.username || 'unknown',
        displayName: profile.displayName || '',
        bio: profile.bio || '',
        images: new Set(),
        latestUpload: 0,
        lastPfp: profile.pfpUrl || savedPfps[sid] || null,
        pfpHistory: profile.pfpHistory || [],
        lastCheckedAt: profile.lastCheckedAt || 0
    };
}

let updatesScanRunning = false;

async function runSingleUpdateCheck(siteId) {
    if (updatesScanRunning) {
        info.textContent = 'Another update check is already running.';
        return;
    }

    const userState = buildUpdatesUserState(siteId);
    if (!userState) {
        info.textContent = 'Could not find that fully liked profile.';
        return;
    }

    await runScanForUsers({ [String(siteId)]: userState }, { pfpOnly: true, keepExistingCards: true });
}

function buildVaultUserStateFromItem(users, item, startTime, endTime) {
    const siteId = getItemSiteId(item);
    if (!siteId) return;

    const existingProfile = likedProfiles[siteId];
    const timestamp = getTimestamp(item);
    const itemId = getItemPrimaryId(item);
    const itemPfpUrl = getItemProfilePicUrl(item);

    if (!users[siteId]) {
        const baselinePfp = existingProfile?.pfpUrl || savedPfps[siteId] || itemPfpUrl || null;
        users[siteId] = {
            siteId,
            username: getItemUsername(item),
            displayName: existingProfile?.displayName || item?.gridName || '',
            bio: existingProfile?.bio || '',
            images: new Set(),
            latestUpload: 0,
            lastPfp: baselinePfp,
            pfpHistory: baselinePfp ? [{ url: baselinePfp, detectedAt: timestamp || startTime || 0 }] : (existingProfile?.pfpHistory || []),
            lastCheckedAt: existingProfile?.lastCheckedAt || 0,
            rangeStart: startTime,
            rangeEnd: endTime,
            rangeItemCount: 0,
            rangePfpAt: 0
        };
    }

    const user = users[siteId];
    user.rangeItemCount++;
    if (itemId) user.images.add(itemId);

    if ((!user.username || user.username === 'unknown') && getItemUsername(item)) {
        user.username = getItemUsername(item);
    }
    if (!user.displayName && item?.gridName) {
        user.displayName = item.gridName;
    }

    if (timestamp > user.latestUpload) {
        user.latestUpload = timestamp;
    }

    if (itemPfpUrl && timestamp >= user.rangePfpAt) {
        user.rangePfpAt = timestamp;
        user.lastPfp = itemPfpUrl;
        user.pfpHistory = [{ url: itemPfpUrl, detectedAt: timestamp || startTime || 0 }];
    }
}

async function buildVaultRangeUsers(startTime, endTime) {
    const users = {};
    const db = await openVaultDB();

    await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readonly');
        const store = tx.objectStore('images');
        const lowerKey = timeToObjectIdPrefix(startTime || 0) + "0000000000000000";
        const upperKey = timeToObjectIdPrefix(endTime || 8640000000000000) + "ffffffffffffffff";
        const req = store.openCursor(IDBKeyRange.bound(lowerKey, upperKey));
        let scanned = 0;

        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return resolve();

            const item = cursor.value;
            buildVaultUserStateFromItem(users, item, startTime, endTime);
            scanned++;
            if (scanned % 2500 === 0) {
                info.textContent = `Reading vault range... ${Object.keys(users).length.toLocaleString()} users found`;
            }
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });

    return users;
}

function renderSourceTermPfpCards(users, sourceTerm) {
    mode = 'updates';
    fetching = false;
    challengeBtn.textContent = '⏳ Scraper';
    if (scraperUi) scraperUi.style.display = 'none';
    grid.innerHTML = '';
    grid.style.display = '';
    grid.classList.remove('review-queue-active');
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());
    hideHeaderMap();

    const fragment = document.createDocumentFragment();
    Object.values(users).forEach(userState => {
        const siteId = String(userState.siteId || '');
        const username = userState.username || siteId;
        const displayPfp = getOriginalVscoImageUrl(userState.lastPfp || '');
        const card = document.createElement('div');
        card.className = 'card source-term-pfp-card';
        card.dataset.updateProfileId = siteId;
        card.style.cssText = 'position:relative; cursor:pointer; border:1px solid #333;';
        card.title = `Open @${username}`;
        card.innerHTML = `
            <div class="updates-profile-media">
                ${displayPfp
                    ? `<img class="updates-profile-img" src="${escapeHtml(displayPfp)}" style="width:100%; height:100%; object-fit:cover; display:block;" loading="lazy">`
                    : `<div class="updates-profile-placeholder" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:32px; background:#222;">👤</div>`}
            </div>
            <div class="updates-profile-badge" style="position:absolute; top:8px; left:8px; z-index:6; background:rgba(80,80,80,0.9); color:#fff; padding:4px 8px; border-radius:999px; font-size:11px; font-weight:700;">Queued</div>
            <div class="card-overlay" style="top:auto; bottom:0; left:0; width:100%; background:linear-gradient(transparent,rgba(0,0,0,0.9)); padding:8px 6px 6px; box-sizing:border-box; pointer-events:none;">
                <div style="font-size:12px; font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">@${escapeHtml(username)}</div>
                <div class="updates-profile-display" style="font-size:11px; color:#bbb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;${userState.displayName ? '' : ' display:none;'}">${escapeHtml(userState.displayName || '')}</div>
                <div style="font-size:10px; color:#c4b5fd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">source: ${escapeHtml(sourceTerm)}</div>
                <div class="updates-profile-statusline" style="font-size:10px; color:#888;">Waiting to check</div>
            </div>`;
        card.addEventListener('click', () => window.open(`https://vsco.co/${encodeURIComponent(username)}`, '_blank'));
        fragment.appendChild(card);
    });
    grid.appendChild(fragment);
}

function normalizeStoredPfpValue(value) {
    if (!value) return '';
    if (typeof value === 'object') {
        value = value.site_profile_image_url || value.profile_image_url || value.profileImage ||
            value.responsive_url || value.url || value.src || '';
    }
    const url = String(value || '').trim();
    return url ? normalize(url) : '';
}

function getHistoricalVaultPfpUrl(item) {
    const candidates = [
        item?.site_profile_image_url,
        item?.profile_image_url,
        item?.profileImage,
        item?.grid?.site_profile_image_url,
        item?.grid?.profile_image_url,
        item?.grid?.profileImage,
        item?.image?.site_profile_image_url,
        item?.image?.profile_image_url,
        item?.metadata?.site_profile_image_url,
        item?.metadata?.profile_image_url,
        item?.metadata?.profileImage
    ];
    for (const candidate of candidates) {
        const url = normalizeStoredPfpValue(candidate);
        if (url && !isVscoDefaultAvatarUrl(url)) return url;
    }
    // Older saved People/Profile rows predate site_profile_image_url. Their
    // displayed PFP is stored in responsive_url and is already identified by
    // getItemProfilePicUrl when isProfile is true.
    return getItemProfilePicUrl(item);
}

function buildSourceTermPfpUsers(items) {
    const users = {};
    items.forEach(item => {
        const siteId = getItemSiteId(item);
        if (!siteId) return;
        const existingProfile = likedProfiles[siteId];
        const explicitPfp = getHistoricalVaultPfpUrl(item);
        if (!users[siteId]) {
            const baselinePfp = explicitPfp || savedPfps[siteId] || existingProfile?.pfpUrl || pfpCache[siteId] || null;
            users[siteId] = {
                siteId,
                username: getItemUsername(item),
                displayName: existingProfile?.displayName || item?.userName || '',
                bio: existingProfile?.bio || item?.gridName || '',
                images: new Set(),
                latestUpload: 0,
                lastPfp: baselinePfp,
                pfpHistory: existingProfile?.pfpHistory || (baselinePfp ? [{ url: baselinePfp, detectedAt: 0 }] : []),
                lastCheckedAt: existingProfile?.lastCheckedAt || 0,
                hasHistoricalPfpBaseline: Boolean(explicitPfp),
                hasStoredPfpBaseline: Boolean(baselinePfp)
            };
        }
        const user = users[siteId];
        if (explicitPfp && !user.hasHistoricalPfpBaseline) {
            user.lastPfp = explicitPfp;
            user.pfpHistory = [{ url: explicitPfp, detectedAt: getTimestamp(item) || 0 }];
            user.hasHistoricalPfpBaseline = true;
            user.hasStoredPfpBaseline = true;
        }
        if ((!user.username || user.username === 'unknown') && getItemUsername(item)) user.username = getItemUsername(item);
        if (!user.displayName && item?.userName) user.displayName = item.userName;
        if (!user.bio && item?.gridName) user.bio = item.gridName;
    });
    return users;
}

async function runSourceTermPfpScan(sourceTerm) {
    const term = String(sourceTerm || '').trim();
    if (!term || updatesScanRunning) return;

    const startTime = tmStart?.value ? new Date(tmStart.value).getTime() : 0;
    const endTime = tmEnd?.value ? new Date(tmEnd.value).getTime() : 4294967295000;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
        info.textContent = 'Pick a valid scraper start/end range before checking term PFPs.';
        return;
    }

    const rangeLabel = `${new Date(startTime).toLocaleString()} → ${new Date(endTime).toLocaleString()}`;
    info.textContent = `Loading Vault users scraped by "${term}" in the selected range...`;
    let items;
    try {
        items = await fetchFilteredVault(startTime, endTime, term, null, FILTER_LOCAL_MAX_RESULTS);
    } catch (e) {
        console.warn('[SourceTermPfpScan] failed to read Vault:', e);
        info.textContent = `Could not load Vault users for "${term}".`;
        return;
    }

    const users = buildSourceTermPfpUsers(items);
    const userCount = Object.keys(users).length;
    const storedBaselineCount = Object.values(users).filter(user => user.hasStoredPfpBaseline).length;
    const pfpIdBaselineCount = Object.values(users).filter(user => extractVscoImageId(user.lastPfp)).length;
    if (userCount === 0) {
        info.textContent = `No users with site IDs were found for source term "${term}".`;
        return;
    }

    renderSourceTermPfpCards(users, term);
    info.textContent = `Checking ${userCount.toLocaleString()} users scraped by "${term}" from ${rangeLabel} · ${pfpIdBaselineCount.toLocaleString()} PFP IDs registered (${storedBaselineCount.toLocaleString()} total baselines)...`;
    await runScanForUsers(users, {
        pfpOnly: true,
        keepExistingCards: true,
        scanLabel: `source "${term}"`
    });
}

async function runCurrentVaultPfpScan() {
    if (updatesScanRunning) return;
    if (mode !== 'challenge' || !Array.isArray(allResults) || allResults.length === 0) {
        info.textContent = 'Load or search Vault results first, then click Check Showing PFPs.';
        return;
    }

    const users = buildSourceTermPfpUsers(allResults);
    const userCount = Object.keys(users).length;
    const storedBaselineCount = Object.values(users).filter(user => user.hasStoredPfpBaseline).length;
    const pfpIdBaselineCount = Object.values(users).filter(user => extractVscoImageId(user.lastPfp)).length;
    if (userCount === 0) {
        info.textContent = 'The current Vault results do not contain any usable site IDs.';
        return;
    }

    renderSourceTermPfpCards(users, 'current Vault results');
    info.textContent = `Checking ${userCount.toLocaleString()} users from the current Vault results · ${pfpIdBaselineCount.toLocaleString()} PFP IDs registered (${storedBaselineCount.toLocaleString()} total baselines)...`;
    await runScanForUsers(users, {
        pfpOnly: true,
        keepExistingCards: true,
        scanLabel: 'current Vault results'
    });
}

async function runVaultRangePfpScan() {
    if (updatesScanRunning) {
        info.textContent = 'Another update check is already running.';
        return;
    }

    const startInput = document.getElementById('vault-pfp-start');
    const endInput = document.getElementById('vault-pfp-end');
    const startTime = startInput?.value ? new Date(startInput.value).getTime() : 0;
    const endTime = endInput?.value ? new Date(endInput.value).getTime() : 8640000000000000;

    if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
        info.textContent = 'Pick a valid start and end time for the vault range.';
        return;
    }
    if (startTime && endTime && startTime > endTime) {
        info.textContent = 'Start date must be before end date.';
        return;
    }

    if (tmStart && startInput?.value) tmStart.value = startInput.value;
    if (tmEnd && endInput?.value) tmEnd.value = endInput.value;

    info.textContent = 'Reading users from selected vault range...';
    let users;
    try {
        users = await buildVaultRangeUsers(startTime, endTime);
    } catch (e) {
        console.warn('[VaultRangePfpScan] failed to read vault range:', e);
        info.textContent = 'Could not read that vault range.';
        return;
    }
    const userCount = Object.keys(users).length;

    if (userCount === 0) {
        grid.innerHTML = '<div class="status">No vault users found in that time range.</div>';
        info.textContent = 'No vault users found in that time range.';
        return;
    }

    info.textContent = `Checking ${userCount.toLocaleString()} users from selected vault range for profile-pic changes...`;
    await runScanForUsers(users, { pfpOnly: true, keepExistingCards: false });
}

async function runUpdatesScan(onlyFullyLiked) {
    const pfpOnly = onlyFullyLiked ? true : !!appSettings.updatesOnlyCheckPfps;
    info.textContent = onlyFullyLiked
        ? `Preparing ${fullyLikedSiteIds.size} fully liked profiles for a quick PFP check...`
        : `Gathering local vault data...`;

    const users = {};

    if (onlyFullyLiked) {
        fullyLikedSiteIds.forEach(siteId => {
            const sid = String(siteId);
            const profile = likedProfiles[sid];
            let username = profile?.username || 'unknown';
            if (username === 'unknown' && fullyLikedCache) {
                const c = fullyLikedCache.find(x => String(x.grid?.siteId) === sid);
                if (c) username = c.grid?.subdomain || c.userName || 'unknown';
            }
            users[sid] = {
                siteId: sid, username,
                displayName: profile?.displayName || '', bio: profile?.bio || '',
                images: new Set(), latestUpload: 0,
                lastPfp: profile?.pfpUrl || savedPfps[sid] || null,
                pfpHistory: profile?.pfpHistory || [],
                lastCheckedAt: profile?.lastCheckedAt || 0
            };
        });
    } else {
        const localDb = await openVaultDB();
        await new Promise((resolve, reject) => {
            const tx = localDb.transaction('images', 'readonly');
            const req = tx.objectStore('images').openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) return resolve();
                const item = cursor.value;
                const siteId = String(item.grid?.siteId || item.siteId || item.site_id);
                if (siteId && siteId !== 'undefined' && siteId !== 'null') {
                    if (!users[siteId]) {
                        const existingProfile = likedProfiles[siteId];
                        users[siteId] = {
                            siteId, username: item.grid?.subdomain || item.userName || item.perma_subdomain || 'unknown',
                            displayName: existingProfile?.displayName || '',
                            bio: existingProfile?.bio || '',
                            images: new Set(),
                            latestUpload: 0,
                            lastPfp: existingProfile?.pfpUrl || savedPfps[siteId] || null,
                            pfpHistory: existingProfile?.pfpHistory || [],
                            lastCheckedAt: existingProfile?.lastCheckedAt || 0
                        };
                    }
                    if (!savedPfps[siteId] && item.site_profile_image_url)
                        users[siteId].lastPfp = normalize(item.site_profile_image_url);
                    users[siteId].images.add(item.imageId || item._id || item.id);
                    const t = getTimestamp(item);
                    if (t > users[siteId].latestUpload) {
                        users[siteId].latestUpload = t;
                        if (!savedPfps[siteId] && item.site_profile_image_url)
                            users[siteId].lastPfp = normalize(item.site_profile_image_url);
                    }
                }
                cursor.continue();
            };
            req.onerror = () => reject(req.error);
        });
    }

    if (Object.keys(users).length === 0) {
        info.textContent = `No users found to check.`;
        return;
    }
    await runScanForUsers(users, { pfpOnly, keepExistingCards: onlyFullyLiked });
}

async function runManualScan(rawInput) {
    const tokens = rawInput.split(/[\s,]+/).map(s => s.trim().replace(/^@/, '')).filter(Boolean);
    const users = {};
    for (const token of tokens) {
        let sid = /^\d+$/.test(token) ? token : null;
        if (!sid) {
            // resolve username -> siteId from in-memory likedProfiles
            const found = Object.values(likedProfiles).find(p => p.username === token);
            if (found) sid = String(found.siteId);
        }
        if (!sid) { console.warn('[ManualScan] unknown user:', token); continue; }
        const profile = likedProfiles[sid];
        users[sid] = {
            siteId: sid,
            username: profile?.username || token,
            displayName: profile?.displayName || '', bio: profile?.bio || '',
            images: new Set(), // no vault dedup in manual mode — that's fine
            latestUpload: 0,
            lastPfp: profile?.pfpUrl || savedPfps[sid] || null,
            pfpHistory: profile?.pfpHistory || [],
            lastCheckedAt: profile?.lastCheckedAt || 0
        };
    }
    if (Object.keys(users).length === 0) {
        info.textContent = `No recognised users in input.`;
        return;
    }
    await runScanForUsers(users);
}

async function runScanForUsers(users, options = {}) {
    const targetSiteIds = Object.keys(users);
    const pfpOnly = options.pfpOnly ?? !!appSettings.updatesOnlyCheckPfps;
    const configuredPfpWorkers = Math.max(1, Math.min(128,
        Number.parseInt(pfpWorkerCountInput?.value || appSettings.pfpScanWorkers, 10) || 32));
    const scanWorkerCount = pfpOnly ? Math.min(configuredPfpWorkers, targetSiteIds.length) : 1;
    const keepExistingCards = !!options.keepExistingCards;
    const scanLabel = String(options.scanLabel || '').trim();
    if (updatesScanRunning) return;
    updatesScanRunning = true;
    setScanPaused(false);

    // Show pause button, lock start buttons
    const startBtn = document.getElementById('scan-start-btn');
    const pauseBtn = document.getElementById('scan-pause-btn');
    const allBtn = document.getElementById('scan-all-updates');
    const rangeBtn = document.getElementById('scan-vault-range-pfps');
    const manualBtn = document.getElementById('scan-manual-updates');
    if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '0.4'; }
    if (allBtn) { allBtn.disabled = true; allBtn.style.opacity = '0.4'; }
    if (rangeBtn) { rangeBtn.disabled = true; rangeBtn.style.opacity = '0.4'; }
    if (manualBtn) { manualBtn.disabled = true; manualBtn.style.opacity = '0.4'; }
    if (pauseBtn) { pauseBtn.style.display = ''; }

    updateUpdatesProgress(0, targetSiteIds.length, 0,
        pfpOnly ? `turbo starting with ${scanWorkerCount} workers...` : 'starting...', pfpOnly);
    allResults = [];
    seenIds.clear();
    if (keepExistingCards && mode === 'updates') {
        grid.querySelectorAll('.inline-review-container.review-block').forEach(el => el.remove());
        targetSiteIds.forEach(siteId => updateUpdatesProfileCard(siteId, users[siteId], 'ready'));
    } else {
        grid.innerHTML = '';
    }

    let scanned = 0;
    let updatesFound = 0;
    const initialBaselineCount = targetSiteIds.filter(siteId => Boolean(users[siteId]?.lastPfp)).length;
    let comparedBaselineCount = 0;
    let initializedBaselineCount = 0;
    let rateLimitPauseUntil = 0;
    let rateLimitHits = 0;
    let firstRateLimitAt = null;
    const scanStartedAt = performance.now();
    const baseScanDelay = pfpOnly ? 0 : 2600;
    // scanDelay starts polite and bumps up whenever we hit a 429, stays elevated for rest of scan
    let scanDelay = baseScanDelay;

    function didProfilePicChange(previousUrl, nextUrl) {
        if (!previousUrl || !nextUrl) return false;
        if (previousUrl === nextUrl) return false;
        const previousImageId = extractVscoImageId(previousUrl);
        const nextImageId = extractVscoImageId(nextUrl);
        if (previousImageId && nextImageId) return previousImageId !== nextImageId;
        try {
            return new URL(previousUrl).pathname !== new URL(nextUrl).pathname;
        } catch (e) {
            return previousUrl !== nextUrl;
        }
    }

    function waitWithJitter(ms) {
        const jitter = pfpOnly ? 0 : Math.floor(Math.random() * 350);
        return new Promise(r => setTimeout(r, ms + jitter));
    }

    // Use the lightweight site-by-ID response for both the current profile pic
    // and its single recently_published item. Full scans can therefore detect
    // the latest upload without requesting a batch of profile media.
    async function fetchProfileSnapshot(siteId) {
        let backoff = Math.max(scanDelay * 2, 6000);

        for (let attempt = 0; attempt < 5; attempt++) {
            const now = Date.now();
            if (rateLimitPauseUntil > now) {
                await waitWithJitter(rateLimitPauseUntil - now);
            }

            const resp = await fetch(`https://vsco.co/api/2.0/sites/${encodeURIComponent(siteId)}`, {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            if (resp.status === 429) {
                rateLimitHits++;
                if (firstRateLimitAt === null) firstRateLimitAt = scanned;
                const retryAfter = resp.headers.get('Retry-After');
                const serverMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
                const waitMs = Math.max(serverMs, backoff);
                rateLimitPauseUntil = Date.now() + waitMs;
                scanDelay = Math.min(Math.max(Math.round(scanDelay * 1.5), baseScanDelay), 15000);
                updateUpdatesProgress(scanned, targetSiteIds.length, updatesFound,
                    `429 #${rateLimitHits} at ${scanned} completed · ${scanWorkerCount} workers · waiting ${Math.round(waitMs / 1000)}s`, pfpOnly);
                await waitWithJitter(waitMs);
                backoff = Math.min(Math.round(backoff * 1.8), 60000);
                continue;
            }
            if (resp.status === 401 || resp.status === 403) {
                return { media: [], pfpUrl: null, authError: true };
            }
            if (!resp.ok) {
                if (attempt < 2) {
                    await waitWithJitter(Math.max(scanDelay, 2000));
                    continue;
                }
                return null;
            }
            const data = await resp.json();
            const site = data?.site || data || {};
            const siteSnapshot = cacheSiteSnapshot(buildSiteSnapshot(site, '', siteId));
            const recentId = siteSnapshot?.recentImageId || '';
            const recentUrl = siteSnapshot?.recentImageUrl || '';
            const media = !pfpOnly && recentId ? [{
                imageId: recentId,
                _id: recentId,
                responsive_url: recentUrl,
                upload_date: siteSnapshot?.recentImageTimestamp || 0,
                description: site.description || ''
            }] : [];
            return {
                media,
                pfpUrl: siteSnapshot?.profileImageUrl || null,
                authError: false
            };
        }

        return null;
    }

    let scanCancelled = false;
    const scanSiteId = async (siteId) => {
        if (mode !== 'updates' || scanCancelled) return;

        await waitIfPaused();
        if (mode !== 'updates' || scanCancelled) return;

        const userState = users[siteId];
        updateUpdatesProfileCard(siteId, userState, 'checking', { statusText: `Checking @${userState.username || siteId}...` });
        updateUpdatesProgress(scanned, targetSiteIds.length, updatesFound, `checking @${userState.username || siteId}`, pfpOnly);
        try {
            const snapshot = await fetchProfileSnapshot(siteId);
            if (snapshot?.authError) {
                updateUpdatesProfileCard(siteId, userState, 'error', { statusText: 'VSCO login required' });
                info.textContent = `⚠️ Not logged in to VSCO. Please log in at vsco.co and try again.`;
                scanCancelled = true;
                return;
            }

            const fetchedMedia = snapshot?.media || [];
            const freshPfpUrl = snapshot?.pfpUrl || null;

            if (!snapshot || (fetchedMedia.length === 0 && !freshPfpUrl)) {
                userState.lastCheckedAt = Date.now();
                if (likedProfiles[siteId] || fullyLikedSiteIds.has(String(siteId))) {
                    const existingProfile = likedProfiles[siteId] || {};
                    await saveLikedProfile({
                        siteId: String(siteId),
                        username: userState.username || existingProfile.username || 'unknown',
                        displayName: userState.displayName || existingProfile.displayName || '',
                        bio: userState.bio || existingProfile.bio || '',
                        pfpUrl: userState.lastPfp || existingProfile.pfpUrl || '',
                        pfpHistory: userState.pfpHistory || existingProfile.pfpHistory || [],
                        firstLikedAt: existingProfile.firstLikedAt || userState.lastCheckedAt,
                        lastCheckedAt: userState.lastCheckedAt
                    });
                }
                updateUpdatesProfileCard(siteId, userState, 'checked', { statusText: `Checked ${formatUpdatesCheckedAgo(userState.lastCheckedAt)} · no media returned` });
                scanned++;
                updateUpdatesProgress(scanned, targetSiteIds.length, updatesFound, `checked @${userState.username || siteId}`, pfpOnly);
                if (scanDelay > 0) await waitWithJitter(scanDelay);
                return;
            }

            const checkedAt = Date.now();
            const previousPfp = userState.lastPfp || null;
            let hasNewPfp = false;
            const newPfpUrl = freshPfpUrl;

            if (newPfpUrl) {
                if (previousPfp) comparedBaselineCount++;
                else initializedBaselineCount++;
                hasNewPfp = didProfilePicChange(previousPfp, newPfpUrl);

                if (savedPfps[siteId] !== newPfpUrl) {
                    savedPfps[siteId] = newPfpUrl;
                    chrome.storage.local.set({ savedPfps });
                }

                userState.lastPfp = newPfpUrl;

                const history = Array.isArray(userState.pfpHistory) ? [...userState.pfpHistory] : [];
                if (hasNewPfp && previousPfp && !history.some(entry => entry?.url === previousPfp)) {
                    history.push({ url: previousPfp, detectedAt: userState.lastCheckedAt || 0 });
                }
                const lastEntry = history[history.length - 1];
                if (!lastEntry || lastEntry.url !== newPfpUrl) {
                    history.push({ url: newPfpUrl, detectedAt: checkedAt });
                }
                userState.pfpHistory = history;
            }

            userState.lastCheckedAt = checkedAt;

            if (likedProfiles[siteId] || fullyLikedSiteIds.has(String(siteId))) {
                const existingProfile = likedProfiles[siteId] || {};
                const historyToSave = (Array.isArray(userState.pfpHistory) && userState.pfpHistory.length > 0)
                    ? userState.pfpHistory
                    : (existingProfile.pfpHistory || []);
                await saveLikedProfile({
                    siteId: String(siteId),
                    username: userState.username || existingProfile.username || 'unknown',
                    displayName: userState.displayName || existingProfile.displayName || '',
                    bio: userState.bio || existingProfile.bio || '',
                    pfpUrl: userState.lastPfp || existingProfile.pfpUrl || '',
                    pfpHistory: historyToSave,
                    firstLikedAt: existingProfile.firstLikedAt || checkedAt,
                    lastCheckedAt: checkedAt
                });
            }

            const newUploads = [];
            if (!pfpOnly) {
                for (const img of fetchedMedia) {
                    const imgId = img.imageId || img._id || img.id;
                    if (!userState.images.has(imgId)) newUploads.push(img);
                }
            }

            if (hasNewPfp || newUploads.length > 0) {
                updatesFound++;
                updateUpdatesProfileCard(siteId, userState, 'updated', {
                    hasNewPfp,
                    newPfpUrl,
                    previousPfp,
                    uploadsCount: newUploads.length
                });
                renderUpdateBlock(userState, hasNewPfp, newPfpUrl, newUploads, previousPfp);
                if (newUploads.length > 0) {
                    for (const nu of newUploads) {
                        nu.grid = { siteId, subdomain: userState.username };
                        nu.sourceQuery = 'UpdateScan';
                    }
                    saveToVaultDB(newUploads);
                }
            } else {
                updateUpdatesProfileCard(siteId, userState, previousPfp ? 'checked' : 'baseline');
            }
        } catch (e) {
            console.warn('[UpdateScan] error for', siteId, e);
            updateUpdatesProfileCard(siteId, userState, 'error');
        }

        scanned++;
        updateUpdatesProgress(scanned, targetSiteIds.length, updatesFound, `checked @${userState.username || siteId}`, pfpOnly);
        if (scanDelay > 0) await waitWithJitter(scanDelay);
    };

    let nextTargetIndex = 0;
    const scanWorker = async () => {
        while (mode === 'updates' && !scanCancelled) {
            const index = nextTargetIndex++;
            if (index >= targetSiteIds.length) return;
            await scanSiteId(targetSiteIds[index]);
        }
    };
    await Promise.all(Array.from({ length: scanWorkerCount }, () => scanWorker()));

    // Restore buttons
    if (startBtn) { startBtn.disabled = false; startBtn.style.opacity = ''; }
    if (allBtn) { allBtn.disabled = false; allBtn.style.opacity = ''; }
    if (rangeBtn) { rangeBtn.disabled = false; rangeBtn.style.opacity = ''; }
    if (manualBtn) { manualBtn.disabled = false; manualBtn.style.opacity = ''; }
    if (pauseBtn) { pauseBtn.style.display = 'none'; }
    setScanPaused(false);

    if (mode === 'updates') {
        if (updatesFound === 0 && !keepExistingCards) {
            grid.innerHTML = '<div class="status">No new profile pics or uploads detected for the scanned users.</div>';
        }
        const scopeText = scanLabel ? ` for ${scanLabel}` : '';
        const changedHint = pfpOnly && updatesFound > 0 ? ' Changed PFPs are pinned first.' : '';
        const elapsedSeconds = Math.max(0.001, (performance.now() - scanStartedAt) / 1000);
        const finalBaselineCount = targetSiteIds.filter(siteId => Boolean(savedPfps[siteId] || users[siteId]?.lastPfp)).length;
        const baselineStats = pfpOnly
            ? ` Compared ${comparedBaselineCount}/${initialBaselineCount} existing baselines; initialized ${initializedBaselineCount} new; baseline coverage now ${finalBaselineCount}/${targetSiteIds.length}.`
            : '';
        const turboStats = pfpOnly
            ? ` ${scanWorkerCount} workers · ${elapsedSeconds.toFixed(1)}s · ${(scanned / elapsedSeconds).toFixed(1)} checks/s · 429s: ${rateLimitHits}${firstRateLimitAt === null ? '' : ` (first at ${firstRateLimitAt} completed)`}.`
            : '';
        info.textContent = updatesFound === 0
            ? `✅ Scan complete${scopeText}. Checked ${scanned} users, no updates found.${baselineStats}${turboStats}`
            : `✅ Scan complete${scopeText}. Checked ${scanned} users, found ${updatesFound} updates.${changedHint}${baselineStats}${turboStats}`;
    }
    updatesScanRunning = false;
}

function renderUpdateBlock(userState, hasNewPfp, newPfpUrl, newUploads, previousPfp = null) {
    if (mode !== 'updates') return;

    const displayPfp = newPfpUrl || userState.lastPfp || '';
    const displayPfpOriginal = getOriginalVscoImageUrl(displayPfp);

    const block = document.createElement("div");
    block.className = "inline-review-container review-block";
    block.style.gridColumn = "1 / -1";
    block.style.background = "#141414";
    block.style.border = "2px solid #3498db";
    block.style.borderRadius = "16px";
    block.style.padding = "24px";
    block.style.marginBottom = "24px";
    block.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5)";

    const titleBadges = [];
    if (hasNewPfp) titleBadges.push('<span style="background:#e74c3c; padding:4px 8px; border-radius:12px; font-size:12px;">👤 PFP Changed</span>');
    if (newUploads.length > 0) titleBadges.push(`<span style="background:#2ecc71; padding:4px 8px; border-radius:12px; font-size:12px;">📸 ${newUploads.length} New Images</span>`);

    // Build profile detail line (display name + bio from liked_profiles store)
    let profileDetailHtml = '';
    if (userState.displayName) {
        profileDetailHtml += `<span style="color:#ccc; font-size:14px;">${escapeHtml(userState.displayName)}</span>`;
    }
    if (userState.bio) {
        profileDetailHtml += `<span style="color:#888; font-size:13px; margin-left:8px;">${escapeHtml(userState.bio.substring(0, 100))}${userState.bio.length > 100 ? '...' : ''}</span>`;
    }

    // PFP history count
    const pfpHistoryCount = (userState.pfpHistory || []).length;
    const pfpHistoryBadge = pfpHistoryCount > 1 ? `<span style="background:#9b59b6; padding:4px 8px; border-radius:12px; font-size:12px;">${pfpHistoryCount} PFPs tracked</span>` : '';
    if (pfpHistoryBadge) titleBadges.push(pfpHistoryBadge);

    block.innerHTML = `
        <div class="review-header" style="justify-content:space-between; margin-bottom: 24px;">
          <div style="display:flex; align-items:center; gap:16px;">
            <div style="width:60px; height:60px; border-radius:50%; background:#222; overflow:hidden; border: 2px solid #fff; cursor: pointer;">
                ${displayPfpOriginal ? `<img src="${escapeHtml(displayPfpOriginal)}" style="width:100%; height:100%; object-fit:cover;">` : '<span style="font-size:24px; padding:18px;">👤</span>'}
            </div>
            <div>
              <h3 style="margin:0 0 8px 0; font-size:22px; color:#fff;">@${escapeHtml(userState.username)}</h3>
              ${profileDetailHtml ? `<div style="margin-bottom:6px;">${profileDetailHtml}</div>` : ''}
              <div style="display:flex; gap:8px; flex-wrap:wrap;">${titleBadges.join('')}</div>
            </div>
          </div>
          <a href="https://vsco.co/${escapeHtml(userState.username)}" target="_blank" class="sort-btn" style="background:#2563eb !important; color:#fff !important; text-decoration:none;">↗ Go to Profile</a>
        </div>
        <div class="review-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;"></div>
    `;

    const reviewGrid = block.querySelector('.review-grid');

    // Show PFP history (all tracked profile pics) when a PFP change is detected
    if (hasNewPfp) {
        const pfpHistory = userState.pfpHistory || [];
        // Show all historical PFPs (excluding the latest/current one) as faded cards
        const historicalPfps = pfpHistory.filter(h => h.url !== displayPfp);
        if (historicalPfps.length > 0) {
            historicalPfps.forEach((entry, idx) => {
                const pfpOldCard = document.createElement("div");
                pfpOldCard.className = "card";
                const dateStr = new Date(entry.detectedAt).toLocaleDateString();
                pfpOldCard.innerHTML = `
                  <div class="card-img-wrap" style="height:100%; min-height:180px; background:#111;">
                    <img class="card-img" src="${escapeHtml(getOriginalVscoImageUrl(entry.url))}" loading="lazy" style="opacity: 0.5;">
                    <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge" style="background:#333; color:#ccc;">PFP #${idx + 1} (${dateStr})</span></div>
                  </div>
                `;
                reviewGrid.appendChild(pfpOldCard);
            });
        } else if (previousPfp && previousPfp !== displayPfp) {
            // Fallback: show old vs new if no history entries yet
            const pfpOldCard = document.createElement("div");
            pfpOldCard.className = "card";
            pfpOldCard.innerHTML = `
              <div class="card-img-wrap" style="height:100%; min-height:180px; background:#111;">
                <img class="card-img" src="${escapeHtml(getOriginalVscoImageUrl(previousPfp))}" loading="lazy" style="opacity: 0.5;">
                <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge" style="background:#333; color:#ccc;">Previous Profile Pic</span></div>
              </div>
            `;
            reviewGrid.appendChild(pfpOldCard);
        }

        // Always show the current (new) PFP
        const pfpNewCard = document.createElement("div");
        pfpNewCard.className = "card";
        pfpNewCard.innerHTML = `
          <div class="card-img-wrap" style="height:100%; min-height:180px; background:#111; cursor:pointer;" onclick="window.open('https://vsco.co/${escapeHtml(userState.username)}', '_blank')">
            <img class="card-img" src="${escapeHtml(displayPfpOriginal)}" loading="lazy">
            <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge" style="background:#e74c3c;">New Profile Pic!</span></div>
          </div>
        `;
        reviewGrid.appendChild(pfpNewCard);
    }

    // Add new uploads to grid
    newUploads.forEach(img => {
        const el = document.createElement("div");
        el.className = "card";
        const imageId = getVscoImageId(img);
        const fallbackUrl = img.responsive_url || img.image_url || img.site_profile_image_url || '';
        const url = imageId ? '' : getVscoDisplayImageUrl(img, fallbackUrl);
        el.innerHTML = `
          <div class="card-img-wrap" style="cursor:pointer;">
            ${imageId ? `<img class="card-img" style="opacity:0;" src="" loading="lazy">` : `<img class="card-img" src="${escapeHtml(url)}" loading="lazy">`}
            <div class="card-overlay" style="top:auto; bottom:8px;"><span class="time-badge">${escapeHtml(formatTimeAgo(img.upload_date))}</span></div>
            <div class="card-overlay" style="top:8px; left:8px;"><span class="time-badge" style="background:#2ecc71;">NEW</span></div>
          </div>
        `;
        if (imageId) {
            const imgEl = el.querySelector('.card-img');
            loadVscoImageIntoElement(imgEl, img, fallbackUrl).catch(() => { });
        }
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(`https://vsco.co/${escapeHtml(userState.username)}/media/${img.imageId || img._id || img.id}`, '_blank');
        });
        reviewGrid.appendChild(el);
    });

    grid.appendChild(block);
}

if (document.getElementById("reposts-btn")) {
    document.getElementById("reposts-btn").addEventListener('click', showRepostsFeed);
}

if (document.getElementById("review-queue-btn")) {
    document.getElementById("review-queue-btn").addEventListener('click', () => {
        window.open(chrome.runtime.getURL("newtab.html?view=review"), "_blank");
    });
}
if (document.getElementById("fully-liked-btn")) {
    document.getElementById("fully-liked-btn").addEventListener('click', () => {
        window.open(chrome.runtime.getURL("newtab.html?view=liked"), "_blank");
    });
}
if (document.getElementById("updates-btn")) {
    document.getElementById("updates-btn").addEventListener('click', showUpdatesFeed);
}
if (socialMatchesBtn) {
    socialMatchesBtn.addEventListener('click', () => {
        window.open(chrome.runtime.getURL("popup.html"), "vscoSocialMatches", "width=440,height=640");
    });
}
if (siteIdsBtn) {
    siteIdsBtn.addEventListener('click', exportDiscoveredSiteIds);
}
if (siteEdgeBtn) {
    siteEdgeBtn.addEventListener('click', showSiteEdgeFinder);
}
if (gridFieldFilter) {
    gridFieldFilter.addEventListener('change', () => {
        if ((mode === 'people' || mode === 'bio') && lastPeopleResults.length > 0) {
            void rerenderPeopleResults();
        }
    });
}
if (document.getElementById("settings-btn")) {
    document.getElementById("settings-btn").addEventListener('click', showSettings);
}

let siteEdgeFinderAbort = null;
let siteEdgeResults = [];
const siteEdgeSeenIds = new Set();
let siteEdgeRenderTimer = null;
let siteEdgeSummaryTimer = null;
let siteEdgeLogBuffer = [];
let siteEdgeLogTimer = null;
let siteEdgeState = {
    currentEdge: null,
    highestExisting: null,
    lowestMissingAbove: null,
    checkedCount: 0,
    updatedAt: 0
};

function getSiteEdgeFinderHtml() {
    return `
        <div class="site-edge-panel" style="grid-column:1 / -1; margin: 0 0 18px; padding: 16px; background: #141414; border-radius: 12px; border: 1px solid #333; color: white;">
            <h2 style="margin:0 0 8px; font-size:20px;">Site ID Edge Finder</h2>
            <div style="color:#aaa; font-size:13px; line-height:1.5; margin-bottom:16px;">
                Saved probe cache. The edge updates when a higher existing site is found, and cached IDs are skipped before making a new request.
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:14px;">
                <div class="site-edge-stat"><span>Current edge guess</span><strong id="site-edge-current">...</strong></div>
                <div class="site-edge-stat"><span>Highest existing</span><strong id="site-edge-highest">...</strong></div>
                <div class="site-edge-stat"><span>Lowest missing above</span><strong id="site-edge-missing">...</strong></div>
                <div class="site-edge-stat"><span>Saved probes</span><strong id="site-edge-cache-count">...</strong></div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:12px;">
                <label style="display:block; font-size:12px; color:#aaa;">Start from username or site ID
                    <input id="site-edge-start" type="text" placeholder="saved edge, @user, or 333768904" autocomplete="off" style="width:100%; box-sizing:border-box; margin-top:6px; background:#222; color:#fff; border:1px solid #444; border-radius:6px; padding:10px;">
                </label>
                <label style="display:block; font-size:12px; color:#aaa;">Step
                    <input id="site-edge-step" type="number" min="1" step="1" value="1" style="width:100%; box-sizing:border-box; margin-top:6px; background:#222; color:#fff; border:1px solid #444; border-radius:6px; padding:10px;">
                </label>
                <label style="display:block; font-size:12px; color:#aaa;">Checks per click
                    <input id="site-edge-batch-count" type="number" min="1" max="1000" step="1" value="100" style="width:100%; box-sizing:border-box; margin-top:6px; background:#222; color:#fff; border:1px solid #444; border-radius:6px; padding:10px;">
                </label>
                <label style="display:block; font-size:12px; color:#aaa;">Parallel checks
                    <input id="site-edge-parallel-count" type="number" min="1" max="1000" step="1" value="100" style="width:100%; box-sizing:border-box; margin-top:6px; background:#222; color:#fff; border:1px solid #444; border-radius:6px; padding:10px;">
                </label>
                <label style="display:block; font-size:12px; color:#aaa;">Delay between bursts, ms
                    <input id="site-edge-delay" type="number" min="0" step="10" value="0" style="width:100%; box-sizing:border-box; margin-top:6px; background:#222; color:#fff; border:1px solid #444; border-radius:6px; padding:10px;">
                </label>
                <label style="display:block; font-size:12px; color:#aaa;">Request timeout, ms
                    <input id="site-edge-timeout" type="number" min="500" step="100" value="5000" style="width:100%; box-sizing:border-box; margin-top:6px; background:#222; color:#fff; border:1px solid #444; border-radius:6px; padding:10px;">
                </label>
                <label style="display:flex; align-items:center; gap:10px; color:#aaa; font-size:13px; padding-top:24px;">
                    <input id="site-edge-only-pfp" type="checkbox">
                    Only show profiles with media
                </label>
                <label style="display:flex; align-items:center; gap:10px; color:#aaa; font-size:13px; padding-top:24px;">
                    <input id="site-edge-use-cache" type="checkbox">
                    Use saved cache
                </label>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                <button type="button" id="site-edge-probe-up-btn" class="sort-btn">Probe Up</button>
                <button type="button" id="site-edge-probe-down-btn" class="sort-btn">Probe Down</button>
                <button type="button" id="site-edge-clear-btn" class="sort-btn">Clear Rendered</button>
                <button type="button" id="site-edge-stop-btn" class="sort-btn" disabled>Stop</button>
            </div>

            <div id="site-edge-status" style="font-size:13px; color:#aaa; min-height:20px; margin-bottom:10px;">Idle.</div>
            <div id="site-edge-log" style="max-height:160px; overflow:auto; background:#0c0c0c; border:1px solid #2a2a2a; border-radius:8px; padding:10px; font:12px/1.5 monospace; color:#ccc;"></div>
        </div>
        <div id="site-edge-results" style="display:contents;"></div>
    `;
}

function buildSiteEdgePersonFromSite(siteId, site) {
    const username = site?.siteSubDomain || site?.subdomain || site?.perma_subdomain || site?.siteDomain || '';
    const recent = site?.recently_published || null;
    const recentDetails = getRecentlyPublishedDetails(recent);
    const gridImage = site?.gridImage || '';
    const profileImage = site?.profileImage
        || site?.site_profile_image_url
        || site?.profile_image_url
        || site?.profile?.image
        || site?.profile?.image_url
        || site?.profile?.responsive_url
        || site?.avatar
        || site?.avatarUrl
        || site?.avatar_url
        || (site?.responsive_url && site?.responsive_url !== recentDetails.url ? site.responsive_url : '')
        || '';
    return {
        siteId: String(siteId),
        sourceType: 'site-edge',
        siteSubDomain: username,
        siteDomain: site?.siteDomain || site?.domain || '',
        userName: site?.userName || site?.name || username || `site ${siteId}`,
        gridName: site?.gridName || site?.description || site?.bio || '',
        gridImage,
        profileImage,
        gridImageId: site?.gridImageId || recentDetails.id || '',
        responsive_url: recentDetails.url || '',
        latestUploadUrl: recentDetails.url,
        latestUploadId: recentDetails.id,
        latestUploadAt: recentDetails.timestamp || 0,
        recently_published: recent || null,
        recentlyPublishedUrl: recentDetails.url,
        recentlyPublishedId: recentDetails.id,
        recentlyPublishedAt: recentDetails.timestamp || 0
    };
}

function getRecentlyPublishedDetails(recent) {
    if (typeof recent === 'string') {
        return { url: recent, id: '', timestamp: 0 };
    }

    const urlKeys = new Set([
        'responsive_url',
        'responsiveUrl',
        'image_url',
        'imageUrl',
        'url',
        'src',
        'permalink_image_url',
        'permalinkImageUrl',
        'thumbnail_url',
        'thumbnailUrl',
        'display_url',
        'displayUrl'
    ]);
    const idKeys = new Set([
        'imageId',
        'image_id',
        'mediaId',
        'media_id',
        '_id',
        'id'
    ]);
    const timestampKeys = new Set([
        'upload_date',
        'uploadDate',
        'published_at',
        'publishedAt',
        'created_at',
        'createdAt'
    ]);

    const queue = Array.isArray(recent) ? [...recent] : [recent];
    const seen = new Set();
    let firstId = '';
    let firstTimestamp = 0;

    while (queue.length) {
        const item = queue.shift();
        if (!item) continue;
        if (typeof item === 'string') {
            if (/^(https?:)?\/\//i.test(item)) return { url: item, id: firstId, timestamp: firstTimestamp };
            continue;
        }
        if (typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);

        for (const [key, value] of Object.entries(item)) {
            if (!firstId && idKeys.has(key) && value) firstId = String(value);
            if (!firstTimestamp && timestampKeys.has(key) && value) firstTimestamp = value;

            if (urlKeys.has(key) && typeof value === 'string' && value) {
                return { url: value, id: firstId, timestamp: firstTimestamp };
            }
        }

        for (const value of Object.values(item)) {
            if (Array.isArray(value)) queue.push(...value);
            else if (value && typeof value === 'object') queue.push(value);
        }
    }

    return { url: '', id: firstId, timestamp: firstTimestamp };
}

function isVscoDefaultAvatarUrl(url) {
    return String(url || '').includes('rassets.vsco.co/avatars/');
}

function siteEdgePersonHasPfp(person) {
    return Boolean(getPersonProfilePicUrl(person));
}

function siteEdgePersonHasMedia(person) {
    return Boolean(getPersonProfilePicUrl(person) || getPersonLatestImageUrl(person));
}

function siteEdgePersonToStoredProfile(person) {
    const siteId = String(person?.siteId || '');
    if (!siteId) return null;
    const pfpUrl = getPersonProfilePicUrl(person);
    const now = Date.now();
    return {
        siteId,
        siteIdNumber: Number.isFinite(Number(siteId)) ? Number(siteId) : null,
        username: person?.siteSubDomain || '',
        displayName: person?.userName || '',
        bio: person?.gridName || '',
        siteDomain: person?.siteDomain || '',
        gridImage: person?.gridImage || '',
        gridImageId: person?.gridImageId || '',
        profileImage: person?.profileImage || '',
        latestUploadUrl: person?.latestUploadUrl || person?.recentlyPublishedUrl || '',
        latestUploadId: person?.latestUploadId || person?.recentlyPublishedId || '',
        latestUploadAt: person?.latestUploadAt || person?.recentlyPublishedAt || 0,
        recentlyPublishedUrl: person?.recentlyPublishedUrl || person?.latestUploadUrl || '',
        pfpUrl,
        hasPfp: siteEdgePersonHasPfp(person),
        profileUrl: person?.siteSubDomain ? `https://vsco.co/${person.siteSubDomain}` : '',
        firstSeenAt: now,
        lastSeenAt: now,
        source: 'Site Edge'
    };
}

async function saveSiteEdgeProfile(person) {
    const profile = siteEdgePersonToStoredProfile(person);
    if (!profile) return;
    try {
        const db = await openVaultDB();
        const tx = db.transaction("site_edge_profiles", "readwrite");
        const store = tx.objectStore("site_edge_profiles");
        const existing = await new Promise(resolve => {
            const req = store.get(profile.siteId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
        store.put({
            ...existing,
            ...profile,
            firstSeenAt: existing?.firstSeenAt || profile.firstSeenAt,
            seenCount: (existing?.seenCount || 0) + 1,
            lastSeenAt: Date.now()
        });
        return new Promise(resolve => {
            tx.oncomplete = resolve;
            tx.onerror = () => {
                console.warn('Site Edge profile save transaction failed:', tx.error);
                resolve();
            };
        });
    } catch (e) {
        console.warn('Site Edge profile save failed:', e);
    }
}

function normalizeSiteEdgeState(value = {}) {
    const numericOrNull = (raw) => {
        const number = Number(raw);
        return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
    };
    return {
        currentEdge: numericOrNull(value.currentEdge),
        highestExisting: numericOrNull(value.highestExisting),
        lowestMissingAbove: numericOrNull(value.lowestMissingAbove),
        checkedCount: Number.isFinite(Number(value.checkedCount)) ? Math.max(0, Math.floor(Number(value.checkedCount))) : 0,
        updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0
    };
}

function getHighestDiscoveredSiteId() {
    return getSortedDiscoveredSiteIds()
        .map(row => Number(row.siteId))
        .filter(Number.isFinite)
        .pop() || null;
}

function getSiteEdgeStartId() {
    return siteEdgeState.currentEdge
        || siteEdgeState.highestExisting
        || getHighestDiscoveredSiteId()
        || 333768904;
}

function saveSiteEdgeState() {
    siteEdgeState = normalizeSiteEdgeState(siteEdgeState);
    siteEdgeState.updatedAt = Date.now();
    chrome.storage.local.set({ siteEdgeState });
}

function scheduleSiteEdgeStateSaveAndSummary() {
    if (siteEdgeSummaryTimer) return;
    siteEdgeSummaryTimer = setTimeout(() => {
        siteEdgeSummaryTimer = null;
        saveSiteEdgeState();
        updateSiteEdgeSummary();
    }, 500);
}

function updateSiteEdgeStateFromResult(result) {
    const siteId = Number(result?.siteId);
    if (!Number.isFinite(siteId) || siteId <= 0) return;

    if (result.exists) {
        if (!siteEdgeState.highestExisting || siteId > siteEdgeState.highestExisting) {
            siteEdgeState.highestExisting = siteId;
        }
        if (!siteEdgeState.currentEdge || siteId > siteEdgeState.currentEdge) {
            siteEdgeState.currentEdge = siteId;
        }
        if (siteEdgeState.lowestMissingAbove && siteEdgeState.lowestMissingAbove <= siteEdgeState.currentEdge) {
            siteEdgeState.lowestMissingAbove = null;
        }
    } else if (result.exists === false) {
        const edge = getSiteEdgeStartId();
        if (siteId > edge && (!siteEdgeState.lowestMissingAbove || siteId < siteEdgeState.lowestMissingAbove)) {
            siteEdgeState.lowestMissingAbove = siteId;
        }
    }

    scheduleSiteEdgeStateSaveAndSummary();
}

function siteEdgeProbeToResult(row) {
    if (!row) return null;
    return {
        siteId: String(row.siteId),
        exists: row.exists,
        via: row.via || 'cache',
        rateLimited: false,
        fromCache: true,
        person: row.person ? { ...row.person, sourceType: row.person.sourceType || 'site-edge' } : null,
        hasPfp: Boolean(row.hasPfp),
        label: `${row.siteId}: cached ${row.exists ? 'exists' : 'missing'}${row.person?.siteSubDomain ? ` (@${row.person.siteSubDomain})` : ''}${row.exists ? (row.hasPfp ? ' · pfp' : ' · no pfp') : ''}`
    };
}

async function readSiteEdgeProbe(siteId) {
    try {
        const db = await openVaultDB();
        const tx = db.transaction("site_edge_probes", "readonly");
        const store = tx.objectStore("site_edge_probes");
        return await new Promise(resolve => {
            const req = store.get(String(siteId));
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        console.warn('Site Edge probe read failed:', e);
        return null;
    }
}

async function saveSiteEdgeProbe(result) {
    if (!result?.siteId || result.rateLimited) return;
    try {
        const db = await openVaultDB();
        const tx = db.transaction("site_edge_probes", "readwrite");
        const store = tx.objectStore("site_edge_probes");
        const existing = await new Promise(resolve => {
            const req = store.get(String(result.siteId));
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
        const now = Date.now();
        store.put({
            ...existing,
            siteId: String(result.siteId),
            siteIdNumber: Number.isFinite(Number(result.siteId)) ? Number(result.siteId) : null,
            exists: result.exists === true,
            via: result.via || 'site',
            hasPfp: Boolean(result.hasPfp),
            person: result.person || null,
            firstCheckedAt: existing?.firstCheckedAt || now,
            checkedAt: now
        });
        await new Promise(resolve => {
            tx.oncomplete = resolve;
            tx.onerror = () => {
                console.warn('Site Edge probe save transaction failed:', tx.error);
                resolve();
            };
        });
    } catch (e) {
        console.warn('Site Edge probe save failed:', e);
    }
}

async function countSiteEdgeProbes() {
    try {
        const db = await openVaultDB();
        const tx = db.transaction("site_edge_probes", "readonly");
        const store = tx.objectStore("site_edge_probes");
        return await new Promise(resolve => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => resolve(0);
        });
    } catch (e) {
        return 0;
    }
}

async function loadSiteEdgeProbeStats() {
    try {
        const db = await openVaultDB();
        const tx = db.transaction("site_edge_probes", "readonly");
        const store = tx.objectStore("site_edge_probes");
        const rows = await new Promise(resolve => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        let highestExisting = siteEdgeState.highestExisting;
        let lowestMissingAbove = siteEdgeState.lowestMissingAbove;
        rows.forEach(row => {
            const id = Number(row.siteIdNumber || row.siteId);
            if (!Number.isFinite(id) || id <= 0) return;
            if (row.exists) {
                if (!highestExisting || id > highestExisting) highestExisting = id;
            }
        });
        if (lowestMissingAbove && highestExisting && lowestMissingAbove <= highestExisting) {
            lowestMissingAbove = null;
        }

        rows.forEach(row => {
            const id = Number(row.siteIdNumber || row.siteId);
            if (!Number.isFinite(id) || id <= 0 || row.exists) return;
            if (highestExisting && id > highestExisting && (!lowestMissingAbove || id < lowestMissingAbove)) {
                lowestMissingAbove = id;
            }
        });

        siteEdgeState.highestExisting = highestExisting;
        siteEdgeState.currentEdge = Math.max(siteEdgeState.currentEdge || 0, highestExisting || 0) || siteEdgeState.currentEdge;
        siteEdgeState.lowestMissingAbove = lowestMissingAbove;
        siteEdgeState.checkedCount = rows.length;
        saveSiteEdgeState();
    } catch (e) {
        console.warn('Site Edge probe stats load failed:', e);
    }
}

async function probeVscoSiteIdCached(siteId, options = {}) {
    if (options.useCache !== false) {
        const cached = await readSiteEdgeProbe(siteId);
        if (cached) return siteEdgeProbeToResult(cached);
    }

    const result = await probeVscoSiteId(siteId, options);
    if (!result.rateLimited) {
        saveSiteEdgeProbe(result).catch(e => console.warn('Site Edge probe save failed:', e));
        if (result.exists && result.person) {
            collectDiscoveredSiteIds([result.person], 'site-edge', String(siteId));
            saveSiteEdgeProfile(result.person).catch(e => console.warn('Site Edge profile save failed:', e));
        }
    }
    return result;
}

async function findNextUncachedSiteId(start, direction, step, signal) {
    let siteId = start;
    let skipped = 0;
    while (siteId > 0 && skipped < 10000) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const cached = await readSiteEdgeProbe(siteId);
        if (!cached) {
            if (skipped > 0) appendSiteEdgeLog(`Skipped ${skipped} saved probe${skipped === 1 ? '' : 's'}; next new ID is ${siteId}.`);
            return siteId;
        }
        skipped++;
        siteId += direction * step;
    }
    return siteId > 0 ? siteId : null;
}

async function findNextUncachedSiteIds(start, direction, step, count, signal) {
    const ids = [];
    let siteId = start;
    let skipped = 0;

    while (siteId > 0 && ids.length < count && skipped < 10000) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const cached = await readSiteEdgeProbe(siteId);
        if (cached) {
            skipped++;
        } else {
            ids.push(siteId);
        }
        siteId += direction * step;
    }

    if (skipped > 0) {
        appendSiteEdgeLog(`Skipped ${skipped} saved probe${skipped === 1 ? '' : 's'} before this burst.`);
    }

    return {
        ids,
        nextId: siteId > 0 ? siteId : null
    };
}

function addSiteEdgeResult(result) {
    if (mode !== 'site-edge' || !result?.exists || !result.person) return;
    const key = String(result.siteId || result.person.siteId || '');
    if (!key || siteEdgeSeenIds.has(key)) return;
    siteEdgeSeenIds.add(key);
    const person = {
        ...result.person,
        hasPfp: result.hasPfp === true || result.person?.hasPfp === true || siteEdgePersonHasPfp(result.person)
    };
    siteEdgeResults.push(person);
    collectDiscoveredSiteIds([result.person], 'site-edge', key);
    appendSiteEdgeResultCard(person);
}

function addSiteEdgeResultsBatch(results) {
    if (mode !== 'site-edge') return;
    const people = [];
    const discovered = [];

    for (const result of results) {
        if (!result?.exists || !result.person) continue;
        const key = String(result.siteId || result.person.siteId || '');
        if (!key || siteEdgeSeenIds.has(key)) continue;
        siteEdgeSeenIds.add(key);
        const person = {
            ...result.person,
            hasPfp: result.hasPfp === true || result.person?.hasPfp === true || siteEdgePersonHasPfp(result.person)
        };
        siteEdgeResults.push(person);
        people.push(person);
        discovered.push(result.person);
    }

    if (discovered.length) {
        collectDiscoveredSiteIds(discovered, 'site-edge', 'batch');
    }
    if (people.length) {
        appendSiteEdgeResultCards(people);
    } else {
        updateSiteEdgeInfo();
    }
}

function getVisibleSiteEdgeResults() {
    const { onlyPfp } = getSiteEdgeFinderEls();
    const filtered = onlyPfp?.checked
        ? siteEdgeResults.filter(person => person?.hasPfp === true || siteEdgePersonHasMedia(person))
        : [...siteEdgeResults];
    sortPeopleResults(filtered);
    return filtered;
}

function rerenderSiteEdgeResults() {
    if (siteEdgeRenderTimer) {
        clearTimeout(siteEdgeRenderTimer);
        siteEdgeRenderTimer = null;
    }
    if (mode !== 'site-edge') return;
    const target = document.getElementById('site-edge-results') || grid;
    target.innerHTML = '';
    const visible = getVisibleSiteEdgeResults();
    renderPeopleResults(visible, false, target);
    updateSiteEdgeInfo(visible.length);
}

function updateSiteEdgeInfo(visibleCount = null) {
    if (mode !== 'site-edge') return;
    const { onlyPfp } = getSiteEdgeFinderEls();
    const shown = visibleCount === null
        ? (onlyPfp?.checked ? siteEdgeResults.filter(person => person?.hasPfp === true || siteEdgePersonHasMedia(person)).length : siteEdgeResults.length)
        : visibleCount;
    const hidden = siteEdgeResults.length - shown;
    const hiddenText = hidden > 0 ? ` · ${hidden} hidden by profile-pic filter` : '';
    info.textContent = `Site ID Edge Finder · ${shown}/${siteEdgeResults.length} rendered profiles · sorted by ${getPeopleSortLabel()}${hiddenText}`;
}

function appendSiteEdgeResultCard(person) {
    if (mode !== 'site-edge') return;
    appendSiteEdgeResultCards([person]);
}

function appendSiteEdgeResultCards(people) {
    if (mode !== 'site-edge' || !people.length) return;
    const { onlyPfp } = getSiteEdgeFinderEls();
    const visiblePeople = onlyPfp?.checked
        ? people.filter(person => person?.hasPfp === true || siteEdgePersonHasMedia(person))
        : people;
    if (visiblePeople.length) {
        const target = document.getElementById('site-edge-results') || grid;
        renderPeopleResults(visiblePeople, false, target);
    }
    updateSiteEdgeInfo();
}

function getSiteEdgeFinderEls() {
    return {
        start: document.getElementById('site-edge-start'),
        step: document.getElementById('site-edge-step'),
        batchCount: document.getElementById('site-edge-batch-count'),
        parallelCount: document.getElementById('site-edge-parallel-count'),
        delay: document.getElementById('site-edge-delay'),
        timeout: document.getElementById('site-edge-timeout'),
        useCache: document.getElementById('site-edge-use-cache'),
        onlyPfp: document.getElementById('site-edge-only-pfp'),
        upBtn: document.getElementById('site-edge-probe-up-btn'),
        downBtn: document.getElementById('site-edge-probe-down-btn'),
        clearBtn: document.getElementById('site-edge-clear-btn'),
        stopBtn: document.getElementById('site-edge-stop-btn'),
        current: document.getElementById('site-edge-current'),
        highest: document.getElementById('site-edge-highest'),
        missing: document.getElementById('site-edge-missing'),
        cacheCount: document.getElementById('site-edge-cache-count'),
        status: document.getElementById('site-edge-status'),
        log: document.getElementById('site-edge-log')
    };
}

function setSiteEdgeStatus(text, isError = false) {
    const { status } = getSiteEdgeFinderEls();
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#f87171' : '#aaa';
}

function appendSiteEdgeLog(text) {
    const { log } = getSiteEdgeFinderEls();
    if (!log) return;
    const line = document.createElement('div');
    line.textContent = text;
    log.prepend(line);
    while (log.children.length > 80) log.removeChild(log.lastChild);
}

function appendSiteEdgeLogBuffered(text) {
    if (text) siteEdgeLogBuffer.push(text);
    if (siteEdgeLogTimer) return;
    const flush = () => {
        siteEdgeLogTimer = null;
        const { log } = getSiteEdgeFinderEls();
        if (!log) {
            siteEdgeLogBuffer = [];
            return;
        }
        const lines = siteEdgeLogBuffer.splice(0, 50);
        const fragment = document.createDocumentFragment();
        for (const text of lines.reverse()) {
            const line = document.createElement('div');
            line.textContent = text;
            fragment.appendChild(line);
        }
        log.prepend(fragment);
        while (log.children.length > 80) log.removeChild(log.lastChild);
        if (siteEdgeLogBuffer.length) {
            siteEdgeLogTimer = setTimeout(flush, 250);
        }
    };
    siteEdgeLogTimer = setTimeout(flush, 250);
}

async function updateSiteEdgeSummary() {
    const els = getSiteEdgeFinderEls();
    const fmt = (value) => value ? Number(value).toLocaleString() : 'Unknown';
    const startId = getSiteEdgeStartId();
    if (els.current) els.current.textContent = fmt(siteEdgeState.currentEdge || startId);
    if (els.highest) els.highest.textContent = fmt(siteEdgeState.highestExisting);
    if (els.missing) els.missing.textContent = fmt(siteEdgeState.lowestMissingAbove);
    if (els.cacheCount) {
        const count = await countSiteEdgeProbes();
        siteEdgeState.checkedCount = count;
        els.cacheCount.textContent = count.toLocaleString();
    }
}

function readPositiveSiteEdgeNumber(el, fallback) {
    const value = Number(String(el?.value || '').trim());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readNonNegativeSiteEdgeNumber(el, fallback) {
    const value = Number(String(el?.value || '').trim());
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function normalizeSiteEdgeStartToken(raw) {
    let token = String(raw || '').trim();
    if (!token) return '';
    token = token.replace(/^https?:\/\/(www\.)?vsco\.co\//i, '');
    token = token.replace(/^\/+|\/+$/g, '');
    token = token.split(/[/?#]/)[0] || token;
    token = token.replace(/^@+/, '').trim();
    return token;
}

function findKnownSiteEdgePersonByUsername(username) {
    const needle = String(username || '').toLowerCase();
    if (!needle) return null;

    const fromSiteEdge = siteEdgeResults.find(person =>
        String(person?.siteSubDomain || '').toLowerCase() === needle
        || String(person?.siteDomain || '').toLowerCase().replace(/^vsco\.co\//, '') === needle
    );
    if (fromSiteEdge?.siteId) return fromSiteEdge;

    const fromDiscovered = Object.values(discoveredSiteIds || {}).find(row =>
        String(row?.username || '').toLowerCase() === needle
        || String(row?.profileUrl || '').toLowerCase().endsWith(`/${needle}`)
    );
    if (fromDiscovered?.siteId) {
        return {
            siteId: fromDiscovered.siteId,
            siteSubDomain: fromDiscovered.username || username
        };
    }

    const fromLiked = Object.values(likedProfiles || {}).find(profile =>
        String(profile?.username || '').toLowerCase() === needle
    );
    if (fromLiked?.siteId) {
        return {
            siteId: fromLiked.siteId,
            siteSubDomain: fromLiked.username || username
        };
    }

    return null;
}

async function resolveSiteEdgeStartId(raw, signal) {
    const token = normalizeSiteEdgeStartToken(raw);
    if (!token) return {
        siteId: getSiteEdgeStartId(),
        label: 'saved edge'
    };

    if (/^\d+$/.test(token)) {
        return {
            siteId: Number(token),
            label: `site ID ${Number(token).toLocaleString()}`
        };
    }

    const known = findKnownSiteEdgePersonByUsername(token);
    if (known?.siteId && Number.isFinite(Number(known.siteId))) {
        return {
            siteId: Number(known.siteId),
            label: `@${known.siteSubDomain || token} (${Number(known.siteId).toLocaleString()})`
        };
    }

    const { data, error } = await fetchWithRetry(
        `https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(token)}&page=0&size=10`,
        signal,
        `Site-edge username lookup @${token}`
    );
    if (error === 'rate_limited') {
        throw new Error('VSCO rate limited username lookup. Wait a while, then try again.');
    }
    if (error || !data) {
        throw new Error(`Could not resolve @${token} to a site ID.`);
    }

    const grids = data?.results || data?.grids || [];
    const exact = grids.find(person => String(person?.siteSubDomain || '').toLowerCase() === token.toLowerCase());
    const match = exact || grids.find(person => person?.siteId);
    if (!match?.siteId || !Number.isFinite(Number(match.siteId))) {
        throw new Error(`No site ID found for @${token}.`);
    }

    collectDiscoveredSiteIds([match], 'site-edge-start', token);
    return {
        siteId: Number(match.siteId),
        label: `@${match.siteSubDomain || token} (${Number(match.siteId).toLocaleString()})`
    };
}

async function probeVscoSiteId(siteId, options = {}) {
    const sid = String(siteId);
    const timeoutMs = Math.max(500, Number(options.timeoutMs || 5000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let siteResp;
    try {
        siteResp = await fetch(`https://vsco.co/api/2.0/sites/${encodeURIComponent(sid)}`, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        });
    } catch (e) {
        if (e.name === 'AbortError') {
            return { siteId: sid, exists: false, timedOut: true, via: 'timeout', label: `${sid}: timed out` };
        }
        throw e;
    } finally {
        clearTimeout(timeout);
    }

    if (siteResp.status === 429) {
        return { siteId: sid, exists: null, rateLimited: true, label: `${sid}: rate limited` };
    }

    if (siteResp.ok) {
        const data = await siteResp.json();
        const site = data?.site || data;
        const username = site?.siteSubDomain || site?.subdomain || site?.name || site?.siteDomain || '';
            if (site && Object.keys(site).length > 0) {
                const person = buildSiteEdgePersonFromSite(sid, site);
                const pfpLabel = siteEdgePersonHasPfp(person) ? ' · pfp' : ' · no pfp';
                const recentLabel = person.recentlyPublishedUrl ? ' · recent' : ' · no recent';
                return {
                    siteId: sid,
                    exists: true,
                    via: 'site',
                    person,
                    hasPfp: siteEdgePersonHasPfp(person),
                    label: `${sid}: exists via site${username ? ` (@${username})` : ''}${pfpLabel}${recentLabel}`
                };
            }
    }

    return { siteId: sid, exists: false, via: 'none', label: `${sid}: no site found` };
}

function setSiteEdgeRunning(isRunning) {
    const { start, upBtn, downBtn, stopBtn } = getSiteEdgeFinderEls();
    if (start) start.disabled = isRunning;
    if (upBtn) upBtn.disabled = isRunning;
    if (downBtn) downBtn.disabled = isRunning;
    if (stopBtn) stopBtn.disabled = !isRunning;
}

async function runSiteEdgeDirectionalProbe(direction) {
    const els = getSiteEdgeFinderEls();
    const step = Math.max(1, readPositiveSiteEdgeNumber(els.step, 1));
    const count = Math.min(1000, Math.max(1, readPositiveSiteEdgeNumber(els.batchCount, 100)));
    const parallelCount = Math.min(1000, Math.max(1, readPositiveSiteEdgeNumber(els.parallelCount, 100)));
    const delayMs = Math.max(0, readNonNegativeSiteEdgeNumber(els.delay, 0));
    const timeoutMs = Math.max(500, readPositiveSiteEdgeNumber(els.timeout, 5000));
    const useCache = els.useCache?.checked !== false;
    const directionLabel = direction > 0 ? 'up' : 'down';

    siteEdgeFinderAbort = new AbortController();
    const controller = siteEdgeFinderAbort;
    setSiteEdgeRunning(true);

    let checked = 0;
    let found = 0;
    let missing = 0;
    let fromCache = 0;
    let nextId = null;
    let scheduled = 0;
    let skipLogCount = 0;
    let queueLock = Promise.resolve();
    let lastStatusAt = 0;

    const waitBetweenRequests = () => delayMs > 0 ? new Promise(resolve => setTimeout(resolve, delayMs)) : Promise.resolve();

    try {
        setSiteEdgeStatus('Resolving start point...');
        const anchor = await resolveSiteEdgeStartId(els.start?.value, controller.signal);
        nextId = anchor.siteId + direction * step;
        appendSiteEdgeLog(`Starting ${directionLabel} from ${anchor.label}; first check is ${nextId}.`);

        const handleResult = (result) => {
            checked++;
            if (result.fromCache) fromCache++;
            if (result.exists) found++;
            if (result.exists === false) missing++;

            appendSiteEdgeLogBuffered(`${result.fromCache ? '[saved] ' : ''}${result.label}`);
            updateSiteEdgeStateFromResult(result);
            addSiteEdgeResult(result);

            if (result.rateLimited) {
                controller.abort();
                throw new Error('VSCO rate limited this check. Wait a while, then continue.');
            }
        };

        if (!useCache) {
            const ids = [];
            for (let i = 0; i < count; i++) {
                const id = nextId + direction * step * i;
                if (id <= 0) break;
                ids.push(id);
            }
            scheduled = ids.length;
            setSiteEdgeStatus(`Probe ${directionLabel}: checking ${ids.length} IDs · ${parallelCount} parallel · cache skipped`);

            const chunkSize = Math.max(1, Math.min(parallelCount, ids.length));
            for (let offset = 0; offset < ids.length; offset += chunkSize) {
                if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

                const chunk = ids.slice(offset, offset + chunkSize);
                setSiteEdgeStatus(`Probe ${directionLabel}: sending ${offset + 1}-${offset + chunk.length}/${ids.length} · cache skipped`);

                const settled = await Promise.allSettled(chunk.map(id =>
                    probeVscoSiteIdCached(id, { signal: controller.signal, useCache: false, timeoutMs })
                ));
                const results = settled
                    .filter(item => item.status === 'fulfilled' && item.value)
                    .map(item => item.value);
                const failed = settled.length - results.length;

                checked += settled.length;
                found += results.filter(result => result.exists).length;
                missing += results.filter(result => result.exists === false).length;
                fromCache = 0;

                if (failed) appendSiteEdgeLogBuffered(`${failed} request${failed === 1 ? '' : 's'} failed in this batch.`);
                for (const result of results) {
                    appendSiteEdgeLogBuffered(result.label);
                    updateSiteEdgeStateFromResult(result);
                    if (result.rateLimited) {
                        controller.abort();
                        throw new Error('VSCO rate limited this check. Wait a while, then continue.');
                    }
                }

                addSiteEdgeResultsBatch(results);
                setSiteEdgeStatus(`Probe ${directionLabel}: plotted ${Math.min(offset + chunk.length, ids.length)}/${ids.length} · cache skipped`);
            }
        } else {

            const takeNextUncachedId = () => {
                const locked = queueLock.then(async () => {
                    while (nextId > 0 && scheduled < count) {
                        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

                        const candidate = nextId;
                        nextId += direction * step;

                        const cached = await readSiteEdgeProbe(candidate);
                        if (cached) {
                            skipLogCount++;
                            continue;
                        }

                        scheduled++;
                        if (skipLogCount > 0) {
                            appendSiteEdgeLog(`Skipped ${skipLogCount} saved probe${skipLogCount === 1 ? '' : 's'} while queueing.`);
                            skipLogCount = 0;
                        }
                        return candidate;
                    }
                    return null;
                });
                queueLock = locked.catch(() => {});
                return locked;
            };

            const runWorker = async () => {
                while (!controller.signal.aborted) {
                    const id = await takeNextUncachedId();
                    if (!id) return;

                    const now = Date.now();
                    if (now - lastStatusAt > 150) {
                        lastStatusAt = now;
                        setSiteEdgeStatus(`Probe ${directionLabel}: ${checked}/${count} done · checking ${id} · ${Math.min(parallelCount, count)} rolling slots`);
                    }
                    const result = await probeVscoSiteIdCached(id, { signal: controller.signal, useCache: true, timeoutMs });
                    handleResult(result);

                    if (checked < count) await waitBetweenRequests();
                }
            };

            const workerCount = Math.min(parallelCount, count);
            await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
        }

        if (siteEdgeSummaryTimer) {
            clearTimeout(siteEdgeSummaryTimer);
            siteEdgeSummaryTimer = null;
        }
        saveSiteEdgeState();
        rerenderSiteEdgeResults();
        const parallelText = parallelCount > 1 ? ` · ${parallelCount} parallel` : '';
        const cacheText = useCache ? `${fromCache} from saved cache` : 'saved cache skipped';
        const summary = `Probe ${directionLabel} done: ${found} found, ${missing} missing, ${cacheText}${parallelText}.`;
        appendSiteEdgeLog(summary);
        setSiteEdgeStatus(summary);
        updateSiteEdgeSummary();
    } catch (e) {
        controller.abort();
        if (e.name !== 'AbortError') setSiteEdgeStatus(e.message || String(e), true);
    } finally {
        siteEdgeFinderAbort = null;
        setSiteEdgeRunning(false);
    }
}

async function runSingleSiteEdgeProbe() {
    const els = getSiteEdgeFinderEls();
    const siteId = readPositiveSiteEdgeNumber(els.probe, 0);
    if (!siteId) {
        setSiteEdgeStatus('Enter a site ID to probe.', true);
        return;
    }

    siteEdgeFinderAbort = new AbortController();
    const controller = siteEdgeFinderAbort;
    setSiteEdgeRunning(true);
    setSiteEdgeStatus(`Checking ${siteId}...`);

    try {
        const result = await probeVscoSiteId(siteId, {
            signal: controller.signal
        });
        appendSiteEdgeLog(result.label);
        addSiteEdgeResult(result);
        setSiteEdgeStatus(result.rateLimited ? 'VSCO rate limited this check. Stop and wait before trying again.' : result.label, result.rateLimited);
    } catch (e) {
        if (e.name !== 'AbortError') setSiteEdgeStatus(`Probe failed: ${e.message || e}`, true);
    } finally {
        siteEdgeFinderAbort = null;
        setSiteEdgeRunning(false);
    }
}

async function runSiteEdgeBinarySearch() {
    const els = getSiteEdgeFinderEls();
    let low = readPositiveSiteEdgeNumber(els.low, 0);
    let high = readPositiveSiteEdgeNumber(els.high, 0);
    const delayMs = Math.max(500, readPositiveSiteEdgeNumber(els.delay, 1200));
    const maxChecks = Math.min(60, Math.max(1, readPositiveSiteEdgeNumber(els.maxChecks, 30)));

    if (!low || !high || low >= high) {
        setSiteEdgeStatus('Enter a lower known-existing ID and a higher likely-empty ID.', true);
        return;
    }

    siteEdgeFinderAbort = new AbortController();
    const controller = siteEdgeFinderAbort;
    setSiteEdgeRunning(true);
    setSiteEdgeStatus('Verifying endpoints before binary search...');

    let checks = 0;
    let lastExisting = null;
    let firstMissing = null;

    const waitBetweenChecks = () => new Promise(resolve => setTimeout(resolve, delayMs));
    const probe = async (id) => {
        if (checks > 0) await waitBetweenChecks();
        checks++;
        setSiteEdgeStatus(`Check ${checks}/${maxChecks}: probing ${id}...`);
        const result = await probeVscoSiteId(id, {
            signal: controller.signal
        });
        appendSiteEdgeLog(result.label);
        addSiteEdgeResult(result);
        if (result.rateLimited) throw new Error('VSCO rate limited the search. Wait a while, then continue with the current bracket.');
        return result;
    };

    try {
        const lowResult = await probe(low);
        if (!lowResult.exists) {
            setSiteEdgeStatus(`Low bound ${low} does not exist. Pick a lower bound that returns a profile first.`, true);
            return;
        }
        lastExisting = low;

        const highResult = await probe(high);
        if (highResult.exists) {
            setSiteEdgeStatus(`High bound ${high} still exists. Raise the high number and run again.`, true);
            return;
        }
        firstMissing = high;

        while (high - low > 1 && checks < maxChecks) {
            const mid = Math.floor((low + high) / 2);
            const result = await probe(mid);
            if (result.exists) {
                low = mid;
                lastExisting = mid;
            } else {
                high = mid;
                firstMissing = mid;
            }
            if (els.low) els.low.value = String(low);
            if (els.high) els.high.value = String(high);
            setSiteEdgeStatus(`Bracket: last existing ${low}, first missing ${high}.`);
        }

        const doneText = high - low <= 1
            ? `Edge found: last existing ${lastExisting || low}, first missing ${firstMissing || high}.`
            : `Stopped at check limit. Current bracket: ${low} to ${high}.`;
        setSiteEdgeStatus(doneText);
        appendSiteEdgeLog(doneText);
    } catch (e) {
        if (e.name !== 'AbortError') setSiteEdgeStatus(e.message || String(e), true);
    } finally {
        siteEdgeFinderAbort = null;
        setSiteEdgeRunning(false);
    }
}

async function runSiteIdRangeSample() {
    const els = getSiteEdgeFinderEls();
    const start = readPositiveSiteEdgeNumber(els.sampleStart, readPositiveSiteEdgeNumber(els.probe, 0));
    const direction = els.sampleDirection?.value === 'up' ? 1 : -1;
    const step = Math.max(1, readPositiveSiteEdgeNumber(els.sampleStep, 1));
    const count = Math.min(200, Math.max(1, readPositiveSiteEdgeNumber(els.sampleCount, 50)));
    const delayMs = Math.max(500, readPositiveSiteEdgeNumber(els.delay, 1200));

    if (!start) {
        setSiteEdgeStatus('Enter a sample start site ID.', true);
        return;
    }

    siteEdgeFinderAbort = new AbortController();
    const controller = siteEdgeFinderAbort;
    setSiteEdgeRunning(true);

    const stats = {
        checked: 0,
        exists: 0,
        missing: 0,
        firstExisting: null,
        lastExisting: null,
        firstMissing: null,
        lastMissing: null,
        longestMissingRun: 0,
        currentMissingRun: 0,
        longestExistingRun: 0,
        currentExistingRun: 0
    };

    const waitBetweenChecks = () => new Promise(resolve => setTimeout(resolve, delayMs));

    try {
        for (let i = 0; i < count; i++) {
            if (i > 0) await waitBetweenChecks();
            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

            const siteId = start + direction * step * i;
            if (siteId <= 0) break;

            setSiteEdgeStatus(`Sample ${i + 1}/${count}: checking ${siteId}...`);
            const result = await probeVscoSiteId(siteId, {
                signal: controller.signal
            });
            appendSiteEdgeLog(result.label);
            addSiteEdgeResult(result);

            if (result.rateLimited) throw new Error('VSCO rate limited the sample. Wait a while, then continue with a smaller count or longer delay.');

            stats.checked++;
            if (result.exists) {
                stats.exists++;
                stats.firstExisting = stats.firstExisting || siteId;
                stats.lastExisting = siteId;
                stats.currentExistingRun++;
                stats.currentMissingRun = 0;
                stats.longestExistingRun = Math.max(stats.longestExistingRun, stats.currentExistingRun);
            } else {
                stats.missing++;
                stats.firstMissing = stats.firstMissing || siteId;
                stats.lastMissing = siteId;
                stats.currentMissingRun++;
                stats.currentExistingRun = 0;
                stats.longestMissingRun = Math.max(stats.longestMissingRun, stats.currentMissingRun);
            }
        }

        const hitRate = stats.checked ? Math.round((stats.exists / stats.checked) * 100) : 0;
        const directionLabel = direction === -1 ? 'downward' : 'upward';
        const summary = `Sample ${directionLabel}: ${stats.exists}/${stats.checked} exist (${hitRate}%), ${stats.missing} missing, longest missing run ${stats.longestMissingRun}.`;
        appendSiteEdgeLog(summary);
        setSiteEdgeStatus(summary);

        if (stats.lastExisting && stats.firstMissing && els.low && els.high) {
            const low = Math.min(stats.lastExisting, stats.firstMissing);
            const high = Math.max(stats.lastExisting, stats.firstMissing);
            els.low.value = String(low);
            els.high.value = String(high);
        }
    } catch (e) {
        if (e.name !== 'AbortError') setSiteEdgeStatus(e.message || String(e), true);
    } finally {
        siteEdgeFinderAbort = null;
        setSiteEdgeRunning(false);
    }
}

function stopSiteEdgeFinder() {
    if (siteEdgeFinderAbort) siteEdgeFinderAbort.abort();
    siteEdgeFinderAbort = null;
    setSiteEdgeRunning(false);
    setSiteEdgeStatus('Stopped.');
}

function clearSiteEdgeResults() {
    siteEdgeResults = [];
    siteEdgeSeenIds.clear();
    if (mode === 'site-edge') {
        showSiteEdgeFinder();
    }
}

function attachSiteEdgeFinderControls() {
    const { upBtn, downBtn, clearBtn, stopBtn, onlyPfp } = getSiteEdgeFinderEls();
    if (upBtn) upBtn.addEventListener('click', () => runSiteEdgeDirectionalProbe(1));
    if (downBtn) downBtn.addEventListener('click', () => runSiteEdgeDirectionalProbe(-1));
    if (clearBtn) clearBtn.addEventListener('click', clearSiteEdgeResults);
    if (stopBtn) stopBtn.addEventListener('click', stopSiteEdgeFinder);
    if (onlyPfp) onlyPfp.addEventListener('change', rerenderSiteEdgeResults);
    setSiteEdgeRunning(false);
}

async function showSiteEdgeFinder() {
    stopScraper();
    stopAutoPfp();
    mode = 'site-edge';
    fetching = false;
    deepMode = false;
    resetPagination();
    browseBtn.textContent = "🌐 Live Feed";
    challengeBtn.textContent = "⏳ Scraper";
    if (scraperUi) scraperUi.style.display = 'none';
    hideHeaderMap();
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());
    grid.style.display = "";
    grid.classList.remove('review-queue-active');
    grid.innerHTML = getSiteEdgeFinderHtml();
    attachSiteEdgeFinderControls();
    await loadSiteEdgeProbeStats();
    updateSiteEdgeSummary();
    renderSortToggle();
    rerenderSiteEdgeResults();
}

function showSettings() {
    stopScraper();
    mode = 'settings';

    grid.innerHTML = '';
    grid.style.display = "";
    grid.classList.remove('review-queue-active');

    resetPagination();
    info.textContent = `Settings`;
    hideHeaderMap();
    if (scraperUi) scraperUi.style.display = 'none';
    document.querySelectorAll('.sort-bar').forEach(el => el.remove());
    document.querySelectorAll('.auto-pfp-bar').forEach(el => el.remove());

    const container = document.createElement('div');
    container.className = 'settings-container';
    container.style = 'max-width: 600px; margin: 40px auto; padding: 24px; background: #141414; border-radius: 12px; border: 1px solid #333; color: white;';

    container.innerHTML = `
        <h2 style="margin-top:0; border-bottom: 1px solid #333; padding-bottom: 16px;">App Settings</h2>
        
        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">Only Check Profile Pics</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">When scanning for updates, ignore new image uploads and only notify of changed profile pictures.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-updatesOnlyCheckPfps" ${appSettings.updatesOnlyCheckPfps ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">Auto-hide Viewed Images</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Automatically remove images from the feed as you scroll past them so you don't see them again.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-autoHideViewed" ${appSettings.autoHideViewed ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">GPS Features Enabled</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Show GPS badges, run GPS extraction, and keep GPS-related filters available.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-gpsEnabled" ${appSettings.gpsEnabled !== false ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

	        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
	            <div>
	                <strong style="display:block; font-size:16px;">Auto-Scrape on "Fully Like"</strong>
	                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Automatically background scrape a user's entire profile into your Vault when you click "❤️ Fully Like".</span>
	            </div>
            <label class="switch">
                <input type="checkbox" id="setting-autoScrapeOnLike" ${appSettings.autoScrapeOnLike ? 'checked' : ''}>
                <span class="slider round"></span>
	            </label>
	        </div>

	        <h3 style="font-size:15px; margin: 4px 0 16px; color:#ddd; border-top:1px solid #333; padding-top:20px;">Followed Account Scrape Sources</h3>

	        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
	            <div>
	                <strong style="display:block; font-size:16px;">Use Usernames / Display Names</strong>
	                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Add exact handles and names from followed accounts to the scraper queue.</span>
	            </div>
	            <label class="switch">
	                <input type="checkbox" id="setting-followedScrapeUsernames" ${appSettings.followedScrapeUsernames ? 'checked' : ''}>
	                <span class="slider round"></span>
	            </label>
	        </div>

	        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
	            <div>
	                <strong style="display:block; font-size:16px;">Use Bio / User Description</strong>
	                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Add words and phrases from followed accounts' profile bios.</span>
	            </div>
	            <label class="switch">
	                <input type="checkbox" id="setting-followedScrapeBioDescriptions" ${appSettings.followedScrapeBioDescriptions ? 'checked' : ''}>
	                <span class="slider round"></span>
	            </label>
	        </div>

	        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
	            <div>
	                <strong style="display:block; font-size:16px;">Use Image Descriptions</strong>
	                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Add captions/descriptions from followed accounts' media.</span>
	            </div>
	            <label class="switch">
	                <input type="checkbox" id="setting-followedScrapeImageDescriptions" ${appSettings.followedScrapeImageDescriptions ? 'checked' : ''}>
	                <span class="slider round"></span>
	            </label>
	        </div>

	        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
	            <div>
	                <strong style="display:block; font-size:16px;">Use Followed Users' Reposted People</strong>
	                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">For a few followed accounts, fetch one repost page and add the reposted users' handles, names, site IDs, and bios when available.</span>
	            </div>
	            <label class="switch">
	                <input type="checkbox" id="setting-followedScrapeRepostedUsers" ${appSettings.followedScrapeRepostedUsers ? 'checked' : ''}>
	                <span class="slider round"></span>
	            </label>
	        </div>

	        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
	            <div>
	                <strong style="display:block; font-size:16px;">Include Descriptions in Auto-Scrape</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">When auto-scraping, add all unique words from their photo descriptions to your background queue.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-scrapeDescriptionsOnLike" ${appSettings.scrapeDescriptionsOnLike ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">Include Names/Bio in Auto-Scrape</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">When auto-scraping, add the username and profile name to your background scraper queue.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-scrapeNameBioOnLike" ${appSettings.scrapeNameBioOnLike ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">Show Profile Pics for Reposts</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Instead of showing the reposted image in feeds, show the original poster's profile picture.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-showOriginalPosterPfpInReposts" ${appSettings.showOriginalPosterPfpInReposts ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">Scrape Image Descriptions</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Global Scraper Check: Scan against photo <code style="background:#222; padding:2px 4px; border-radius:4px;">description</code> texts. Uses the Images Search API.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-scraperTargetDescriptions" ${appSettings.scraperTargetDescriptions ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

        <div class="setting-row" style="margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <strong style="display:block; font-size:16px;">Scrape Profile Names/Bios</strong>
                <span style="color:#aaa; font-size:13px; display:block; margin-top:4px;">Global Scraper Check: Scan against user <code style="background:#222; padding:2px 4px; border-radius:4px;">name</code>, <code style="background:#222; padding:2px 4px; border-radius:4px;">bio</code>, and <code style="background:#222; padding:2px 4px; border-radius:4px;">username</code> fields. Uses the People Search API.</span>
            </div>
            <label class="switch">
                <input type="checkbox" id="setting-scraperTargetProfileBio" ${appSettings.scraperTargetProfileBio ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        </div>

    `;

    grid.appendChild(container);

    const toggleSetting = (id, key) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                if (key === 'gpsEnabled') {
                    setGpsEnabled(e.target.checked);
                } else {
                    appSettings[key] = e.target.checked;
                    chrome.storage.local.set({ appSettings });
                }
            });
        }
    };

    toggleSetting('setting-updatesOnlyCheckPfps', 'updatesOnlyCheckPfps');
    toggleSetting('setting-autoHideViewed', 'autoHideViewed');
    toggleSetting('setting-gpsEnabled', 'gpsEnabled');
    toggleSetting('setting-autoScrapeOnLike', 'autoScrapeOnLike');
    toggleSetting('setting-followedScrapeUsernames', 'followedScrapeUsernames');
    toggleSetting('setting-followedScrapeBioDescriptions', 'followedScrapeBioDescriptions');
    toggleSetting('setting-followedScrapeImageDescriptions', 'followedScrapeImageDescriptions');
    toggleSetting('setting-followedScrapeRepostedUsers', 'followedScrapeRepostedUsers');
    toggleSetting('setting-scrapeDescriptionsOnLike', 'scrapeDescriptionsOnLike');
    toggleSetting('setting-scrapeNameBioOnLike', 'scrapeNameBioOnLike');
    toggleSetting('setting-showOriginalPosterPfpInReposts', 'showOriginalPosterPfpInReposts');
    toggleSetting('setting-scraperTargetDescriptions', 'scraperTargetDescriptions');
    toggleSetting('setting-scraperTargetProfileBio', 'scraperTargetProfileBio');
}

const followQueue = [];
let isFollowing = false;

// Update scan pause state
let scanPaused = false;
let scanResumeResolvers = [];
async function waitIfPaused() {
    if (!scanPaused) return;
    await new Promise(resolve => { scanResumeResolvers.push(resolve); });
}
function setScanPaused(paused) {
    scanPaused = paused;
    if (!paused && scanResumeResolvers.length > 0) {
        const pendingResolvers = scanResumeResolvers;
        scanResumeResolvers = [];
        pendingResolvers.forEach(resolve => resolve());
    }
    const btn = document.getElementById('scan-pause-btn');
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
}

async function processFollowQueue() {
    if (isFollowing || followQueue.length === 0) return;
    isFollowing = true;
    while (followQueue.length > 0) {
        const siteId = followQueue[0]; // Peek at next in queue
        try {
            // First check if already following to save POST rate limits
            let checkResp = await fetch(`https://vsco.co/api/2.0/follows/${siteId}`, { credentials: 'include', headers: { 'Accept': 'application/json' } });
            if (checkResp.ok) {
                let status = await checkResp.json();
                if (status.is_following) {
                    console.log(`[Auto-Follow] Already following user ${siteId}, skipping POST.`);
                    followQueue.shift(); // Remove from queue
                    continue; // Skip the delay
                }
            }

            let resp = await fetch(`https://vsco.co/api/2.0/follows/${siteId}`, { method: 'POST', credentials: 'include', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } });

            if (resp.status === 429) {
                console.warn(`[Auto-Follow] Rate limited! Halting queue. Waiting for cooldown.`);
                if (document.getElementById('bulk-follow-btn')) {
                    document.getElementById('bulk-follow-btn').textContent = `Rate Limited 🛑 (${followQueue.length} left)`;
                }
                break; // Stop processing the queue completely
            }

            if (resp.ok) {
                console.log(`[Auto-Follow] Successfully followed user ${siteId}`);
            }

            followQueue.shift(); // Remove from queue only after successful attempt
        } catch (e) {
            console.warn('Follow error:', e);
            followQueue.shift();
        }
        await new Promise(r => setTimeout(r, 1500)); // 1.5s delay
    }
    isFollowing = false;

    // Reset button UI if queue finishes normally
    if (followQueue.length === 0 && document.getElementById('bulk-follow-btn')) {
        document.getElementById('bulk-follow-btn').textContent = `✅ Bulk Follow Finished`;
        document.getElementById('bulk-follow-btn').style.opacity = '1';
    }
}

function followUser(siteId) {
    if (!siteId) return;
    if (!followQueue.includes(siteId)) {
        followQueue.push(siteId);
        processFollowQueue();
    }
}

async function autoScrapeFullyLikedUser(siteId, originalImg, prefetchedItems = null) {
    if (!siteId) return;
    return;

    // followUser(siteId); // Disabled due to rate limit; bulk follow from Fully Liked view instead.

    let newTerms = new Set();
    let fetchedDescriptions = [];
    if (originalImg.grid?.subdomain) newTerms.add(originalImg.grid.subdomain);
    if (originalImg.userName) newTerms.add(originalImg.userName);
    if (originalImg.gridName) newTerms.add(originalImg.gridName);
    if (originalImg.description) {
        newTerms.add(originalImg.description);
        fetchedDescriptions.push(originalImg.description);
    }

    // Run scraping asynchronously so we don't block the UI
    setTimeout(async () => {
        try {
            let items = prefetchedItems;
            if (!items) {
                let resp = await fetch(`https://vsco.co/api/2.0/medias?site_id=${siteId}&page=0&return=1000`, { credentials: 'include' });
                if (!resp.ok) {
                    resp = await fetch(`https://vsco.co/api/3.0/medias/profile?site_id=${siteId}&limit=14`, { credentials: 'include' });
                    if (resp.ok) {
                        const data = await resp.json();
                        items = (data.media || []).map(m => m.image).filter(Boolean);
                    }
                } else {
                    const data = await resp.json();
                    items = data.media || data.results || data.files || [];
                }
            }

            if (items && items.length > 0) {
                let toSave = [];

                for (const item of items) {
                    const img = item.image || item;
                    if (!img.imageId && !img._id && !img.id) continue;

                    if (img.description) {
                        newTerms.add(img.description);
                        fetchedDescriptions.push(img.description);
                    }
                    if (img.userName) newTerms.add(img.userName);
                    if (img.gridName) newTerms.add(img.gridName);
                    if (img.grid?.subdomain) newTerms.add(img.grid.subdomain);

                    img.sourceQuery = originalImg.sourceQuery || 'Auto-Liked API Fetch';
                    if (!img.grid && originalImg.grid) {
                        img.grid = originalImg.grid;
                    }

                    toSave.push(img);
                }

                if (toSave.length > 0) {
                    await saveToVaultDB(toSave);
                    masterScrapeCount += toSave.length;
                }
            }
        } catch (e) {
            console.warn("Failed to auto-fetch full medias for", siteId, e);
        }

        if (fetchedDescriptions.length > 0) {
            const sid = String(siteId);
            const existing = likedProfiles[sid] || {};
            const now = Date.now();
            const pfpUrl = existing.pfpUrl || savedPfps[sid] || normalize(originalImg.site_profile_image_url || '');
            await saveLikedProfile({
                ...existing,
                siteId: sid,
                username: existing.username || originalImg.grid?.subdomain || originalImg.perma_subdomain || 'unknown',
                displayName: existing.displayName || originalImg.userName || '',
                bio: existing.bio || originalImg.gridName || '',
                imageDescriptions: mergeLikedProfileDescriptions(existing.imageDescriptions, fetchedDescriptions),
                pfpUrl,
                pfpHistory: existing.pfpHistory || (pfpUrl ? [{ url: pfpUrl, detectedAt: now }] : []),
                firstLikedAt: existing.firstLikedAt || now,
                lastDescriptionScrapeAt: now,
                lastCheckedAt: now
            });
        }

        let addedToQueue = false;
        newTerms.forEach(tStr => {
            const termRaw = tStr.trim();
            if (termRaw && termRaw.length < 200 && termRaw.toLowerCase() !== (originalImg.sourceQuery || '').toLowerCase()) {
                if (!customQueue.includes(termRaw)) {
                    customQueue.push(termRaw);
                    addedToQueue = true;
                }
            }
        });

        if (addedToQueue) {
            chrome.storage.local.set({ customQueue: customQueue });
            if (typeof runScraper === 'function' && typeof scraperState !== 'undefined' && scraperState === 'idle') {
                runScraper(true);
            }
        }
    }, 100);
}

console.log('VSCO Feed ready!');
