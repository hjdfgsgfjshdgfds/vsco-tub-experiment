const DB_NAME = "VSCO_Vault";
const DB_VERSION = 8;
const BACKGROUND_QUERY_DELAY_MS = 2500;
const GRID_REQUEST_MIN_INTERVAL_MS = 2500;
const GRID_REQUEST_JITTER_MS = 2500;
const RATE_LIMIT_BASE_MS = 4000;
const RATE_LIMIT_MAX_MS = 60000;
const PROFILE_MEDIA_DELAY_MS = 1500;
const PROFILE_DESCRIPTION_REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_PROFILE_DESCRIPTION_REFRESHES_PER_RUN = 20;
const FOLLOWING_PAGE_SIZE = 100;
const MAX_FOLLOWING_PAGES = 30;       // 2.9k follows means valid pages are 0-29 at size=100
const MAX_FOLLOWING_DETAIL_REFRESHES_PER_RUN = 50;
const MAX_BACKGROUND_QUERIES = 1000;
const BACKGROUND_HOURLY_SCRAPE_ENABLED = false;
let backgroundGridRequestChain = Promise.resolve();
let nextBackgroundGridRequestAt = 0;
let backgroundGridRateLimitUntil = 0;
let capturedVscoAuthorization = '';
const capturedVscoGrpcHeaders = new Map();
const INTERACTION_GRPC_READ_PATHS = new Set([
    '/interaction.InteractionGrpc/GetReactionsForMedia',
    '/interaction.InteractionGrpc/GetReactionsForMedias',
    '/interaction.InteractionGrpc/TestRPC',
    '/interaction.InteractionGrpc/HasReactions',
    '/interaction.InteractionGrpc/GetInteractionIdsOfSitesMedias',
    '/interaction.InteractionGrpc/GetFavorites',
    '/interaction.InteractionGrpc/GetReposts',
    '/interaction.InteractionGrpc/GetActivity',
    '/interaction.InteractionGrpc/GetInteractionIdsOfSite',
    '/interaction.InteractionGrpc/FetchCollectionItemBySiteAndMedia',
    '/interaction.InteractionGrpc/FetchCollectionItemsById',
    '/interaction.InteractionGrpc/FetchCollections',
    '/interaction.InteractionGrpc/FetchCollectionsBySite',
    '/interaction.InteractionGrpc/FetchCollectionItemsBySite',
    '/interaction.InteractionGrpc/GetRepostedMediaIdsForSite'
]);
const MEDIA_GRPC_READ_PATHS = new Set([
    '/media.Media/FetchImages',
    '/media.Media/FetchImage',
    '/media.Media/FetchProfileImage',
    '/media.Media/FetchProfileImages',
    '/media.Media/FetchImagesBySite',
    '/media.Media/FetchActiveImagesBySite',
    '/media.Media/FetchImageUploadData',
    '/media.Media/FetchPersonalMedia',
    '/media.Media/FetchArticlesByImageID',
    '/media.Media/FetchArticleByPermalink',
    '/media.Media/FetchArticles',
    '/media.Media/FetchSlimArticles',
    '/media.Media/FetchArticlesBySite',
    '/media.Media/FetchFeedback',
    '/media.Media/FetchFeedbackBatch',
    '/media.Media/FetchUserComments'
    ,'/media.Media/FetchImagesByAlbum'
    ,'/media.Media/FetchImagesByUserAndTag'
]);
const MAX_MEDIA_GRPC_READ_BODY_CHARACTERS = 1000000;
const VSCO_GRPC_AUTH_SESSION_KEY = 'vscoGrpcAuthorization';
const VSCO_DESCRIPTOR_REVERSIBLE_MUTATIONS = new Set([
    'interaction.InteractionGrpc/CreateFavorite',
    'interaction.InteractionGrpc/DeleteFavorite',
    'interaction.InteractionGrpc/CreateRepost',
    'interaction.InteractionGrpc/DeleteRepost'
]);
const vscoGrpcSchemaPromise = fetch(chrome.runtime.getURL('docs/vsco-grpc-schema.json')).then(response => {
    if (!response.ok) throw new Error(`Could not load bundled gRPC schema: HTTP ${response.status}`);
    return response.json();
});

async function descriptorGrpcMethod(service, method) {
    const schema = await vscoGrpcSchemaPromise;
    return schema.services?.[service]?.methods?.find(candidate => candidate.method === method) || null;
}

async function sendDescriptorGrpc(service, method, body, confirmed, allowUnsafeAll = false) {
    const definition = await descriptorGrpcMethod(service, method);
    if (!definition) throw new Error('RPC is not present in the bundled descriptor.');
    const key = `${service}/${method}`;
    const internal = /Admin|Internal/.test(method);
    const mutating = /^(?:Create|Delete|Update|Configure|Insert|Intent|Generate|ImageUpload|Invalidate|Optout|Admin(?:Create|Delete|Update))/.test(method);
    if (internal && !allowUnsafeAll) throw new Error('Admin/internal RPC execution requires Enable all RPCs.');
    if (mutating && !allowUnsafeAll && (!VSCO_DESCRIPTOR_REVERSIBLE_MUTATIONS.has(key) || confirmed !== true)) {
        throw new Error('Only captured reversible favorite/repost mutations are enabled.');
    }
    if ((mutating || internal) && confirmed !== true) throw new Error('Unsafe RPC confirmation is required.');
    const authorization = await getVscoGrpcAuthorization();
    if (!authorization) throw new Error('Waiting for fresh VSCO authorization. Reload a VSCO page and retry.');
    const origin = service === 'media.Media' ? 'https://media-grpc-api.vsco.co'
        : service === 'interaction.InteractionGrpc' ? 'https://interaction-api-grpc.vsco.co' : '';
    if (!origin) throw new Error('Unknown RPC service origin.');
    const response = await fetch(`${origin}/${service}/${method}`, {
        method: 'POST', credentials: 'include', body,
        headers: {
            accept: 'application/grpc-web-text', authorization,
            ...Object.fromEntries(capturedVscoGrpcHeaders),
            'content-type': 'application/grpc-web-text',
            'x-client-platform': capturedVscoGrpcHeaders.get('x-client-platform') || 'web',
            'x-grpc-web': '1', 'x-user-agent': 'grpc-web-javascript/0.1'
        }
    });
    return {
        ok: response.ok,
        httpStatus: response.status,
        contentType: response.headers.get('content-type') || '',
        grpcStatus: response.headers.get('grpc-status'),
        grpcMessage: response.headers.get('grpc-message') || '',
        body: await response.text(),
        error: response.ok ? '' : `HTTP ${response.status}`
    };
}

async function getVscoGrpcAuthorization() {
    if (capturedVscoAuthorization) return capturedVscoAuthorization;
    const stored = await chrome.storage.session.get(VSCO_GRPC_AUTH_SESSION_KEY);
    const value = String(stored?.[VSCO_GRPC_AUTH_SESSION_KEY] || '');
    if (/^[a-f0-9]{40}$/i.test(value)) capturedVscoAuthorization = value;
    return capturedVscoAuthorization;
}

chrome.webRequest.onBeforeSendHeaders.addListener(details => {
    for (const header of details.requestHeaders || []) {
        const name = String(header.name || '').toLowerCase();
        const value = String(header.value || '');
        if (name === 'authorization' && value) {
            // VSCO's media gRPC client sends Redux currentUser.tkn as raw
            // authorization metadata. Other site requests may prefix it with
            // "Bearer "; normalize both forms to the raw token expected by
            // media-grpc-api and interaction-api-grpc.
            const normalized = value.replace(/^Bearer\s+/i, '');
            if (/^[a-f0-9]{40}$/i.test(normalized)) {
                capturedVscoAuthorization = normalized;
                chrome.storage.session.set({ [VSCO_GRPC_AUTH_SESSION_KEY]: normalized });
            }
        } else if (['x-aws-waf-token', 'x-client-build', 'x-client-platform', 'x-client-version'].includes(name) && value) {
            capturedVscoGrpcHeaders.set(name, value);
        }
    }
}, { urls: ['https://vsco.co/*', 'https://*.vsco.co/*'] }, ['requestHeaders', 'extraHeaders']);
const vscoAvatarCache = new Map();
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'you', 'your', 'this', 'that', 'from', 'are',
    'was', 'were', 'have', 'has', 'had', 'but', 'not', 'all', 'just', 'into',
    'out', 'about', 'over', 'under', 'then', 'than', 'a', 'an', 'to', 'of',
    'in', 'on', 'at', 'it', 'is', 'me', 'my', 'we', 'us'
]);

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
            if (!db.objectStoreNames.contains("hidden_ids")) {
                db.createObjectStore("hidden_ids", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains("liked_profiles")) {
                db.createObjectStore("liked_profiles", { keyPath: "siteId" });
            }
            if (!db.objectStoreNames.contains("followed_profiles")) {
                db.createObjectStore("followed_profiles", { keyPath: "siteId" });
            }
            if (!db.objectStoreNames.contains("site_edge_profiles")) {
                db.createObjectStore("site_edge_profiles", { keyPath: "siteId" });
            }
            if (!db.objectStoreNames.contains("site_edge_probes")) {
                db.createObjectStore("site_edge_probes", { keyPath: "siteId" });
            }
            if (!db.objectStoreNames.contains("travel_sessions")) {
                db.createObjectStore("travel_sessions", { keyPath: "key" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function persistTravelSession(cache) {
    try {
        const db = await openVaultDB();
        const compact = item => ({ id: item.id, username: item.username || '', displayName: item.displayName || '', description: item.description || '', timestamp: item.timestamp || 0, siteId: item.siteId || '', imageUrl: item.imageUrl || '', profileImageUrl: item.profileImageUrl || '', width: item.width || 0, height: item.height || 0 });
        const tx = db.transaction('travel_sessions', 'readwrite');
        tx.objectStore('travel_sessions').put({ key: normalizeEnhancedText(cache.query), query: cache.query, mode: cache.mode, updatedAt: Date.now(), images: cache.images.slice(0, 20000).map(compact), people: cache.people.slice(0, 20000).map(compact), completedQueries: [...cache.expansion.completedQueries], expansion: serializeEnhancedExpansion(cache) });
    } catch (error) { console.warn('Background: travel session persistence failed:', error); }
}

function getLocalStorage(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function loadLikedProfiles() {
    return new Promise(async (resolve) => {
        try {
            const db = await openVaultDB();
            if (!db.objectStoreNames.contains("liked_profiles")) {
                resolve([]);
                return;
            }
            const tx = db.transaction("liked_profiles", "readonly");
            const req = tx.objectStore("liked_profiles").getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (e) {
            console.warn('Background: failed to load liked profiles:', e);
            resolve([]);
        }
    });
}

function saveLikedProfile(profile) {
    return new Promise(async (resolve) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("liked_profiles", "readwrite");
            tx.objectStore("liked_profiles").put(profile);
            tx.oncomplete = resolve;
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch (e) {
            console.warn('Background: failed to save liked profile:', e);
            resolve();
        }
    });
}

function loadFollowedProfiles() {
    return new Promise(async (resolve) => {
        try {
            const db = await openVaultDB();
            if (!db.objectStoreNames.contains("followed_profiles")) {
                resolve([]);
                return;
            }
            const tx = db.transaction("followed_profiles", "readonly");
            const req = tx.objectStore("followed_profiles").getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (e) {
            console.warn('Background: failed to load followed profiles:', e);
            resolve([]);
        }
    });
}

function saveFollowedProfile(profile) {
    return new Promise(async (resolve) => {
        try {
            const db = await openVaultDB();
            const tx = db.transaction("followed_profiles", "readwrite");
            tx.objectStore("followed_profiles").put(profile);
            tx.oncomplete = resolve;
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        } catch (e) {
            console.warn('Background: failed to save followed profile:', e);
            resolve();
        }
    });
}

function saveToVaultDB(images) {
    return new Promise(async (resolve, reject) => {
        try {
            saveSocialMatchesFromItems(images).catch(e => console.warn('Background: social match scan failed:', e));
            const db = await openVaultDB();
            const tx = db.transaction(["images", "fetch_index"], "readwrite");
            const store = tx.objectStore("images");
            const fetchStore = tx.objectStore("fetch_index");
            for (const img of images) {
                if (img) {
                    if (!img.imageId && img._id) img.imageId = img._id;
                    if (!img.imageId && img.id) img.imageId = img.id;
                    if (img.imageId) {
                        try {
                            const fetchedAt = Date.now();
                            img.vaultFetchedAt = fetchedAt;
                            store.put(img);
                            fetchStore.put({ imageId: img.imageId, fetchedAt });
                        } catch (e) {
                            if (e.name === 'QuotaExceededError') {
                                console.warn('Background: IndexedDB quota exceeded — stopping saves');
                                break;
                            }
                        }
                    }
                }
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => {
                console.warn('Background: Transaction error:', tx.error?.name || tx.error);
                resolve();
            };
            tx.onabort = () => {
                console.warn('Background: Transaction aborted:', tx.error?.name || tx.error);
                resolve();
            };
        } catch (e) {
            resolve();
        }
    });
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function normalizeVscoImageUrl(value) {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
    if (/^(i|im|images)\.vsco\.co\//i.test(trimmed)) return `https://${trimmed}`;
    try {
        return new URL(trimmed, "https://vsco.co").href;
    } catch {
        return "";
    }
}

function cleanHandle(value) {
    return String(value || "")
        .trim()
        .replace(/^@+/, "")
        .replace(/[),.;:!?\]\}"'<>]+$/g, "")
        .trim();
}

function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function extractSocialHandles(description) {
    const text = String(description || "");
    if (!text.trim()) return { tiktok: [], snap: [] };

    const tiktok = [];
    const snap = [];
    const tiktokHandlePattern = "([@]?[a-zA-Z0-9._]{2,32})";
    const snapHandlePattern = "([@]?[a-zA-Z0-9._-]{2,32})";
    const tiktokPatterns = [
        new RegExp(`(?:^|[\\s,;/|()\\[\\]{}])(?:tik\\s*tok|tiktok|tt)\\s*[:\\-]?\\s*${tiktokHandlePattern}`, "gi")
    ];
    const snapPatterns = [
        new RegExp(`(?:^|[\\s,;/|()\\[\\]{}])(?:snapchat|snap|sc)\\s*[:\\-]?\\s*${snapHandlePattern}`, "gi"),
        new RegExp(`👻\\s*${snapHandlePattern}`, "gi")
    ];

    const collect = (patterns, target) => {
        patterns.forEach(pattern => {
            for (const match of text.matchAll(pattern)) {
                const handle = cleanHandle(match[1]);
                if (handle && !/^(tt|tiktok|tik|tok|sc|snap|snapchat|on|me|add|follow)$/i.test(handle)) {
                    target.push(handle);
                }
            }
        });
    };

    collect(tiktokPatterns, tiktok);
    collect(snapPatterns, snap);

    return {
        tiktok: uniqueValues(tiktok),
        snap: uniqueValues(snap)
    };
}

function getSiteUsername(site) {
    const direct = firstString(
        site?.siteSubDomain,
        site?.subdomain,
        site?.perma_subdomain,
        site?.siteDomain,
        site?.userName,
        site?.username,
        site?.name,
        site?.grid?.subdomain,
        site?.grid?.siteSubDomain
    );
    return direct.replace(/^@/, "").replace(/^vsco\.co\//i, "").split("/")[0].toLowerCase();
}

function getSiteDescription(site) {
    return firstString(site?.description, site?.gridName, site?.bio, site?.site_title);
}

function getProfileImageUrlFromSite(site) {
    const id = firstString(site?.profile_image_id, site?.profileImageId, site?.site_profile_image_id);
    if (id) return `https://i.vsco.co/${encodeURIComponent(id)}`;
    return normalizeVscoImageUrl(firstString(
        site?.profile_image,
        site?.profileImage,
        site?.profile_image_url,
        site?.site_profile_image_url,
        site?.gridImage,
        site?.responsive_url,
        site?.avatar,
        site?.avatar_url
    ));
}

async function saveSocialMatch(username, description, profileImageUrl = "") {
    username = String(username || "").trim().replace(/^@/, "").toLowerCase();
    if (!username || !/^[a-z0-9._-]+$/i.test(username)) return false;

    const handles = extractSocialHandles(description);
    if (!handles.tiktok.length && !handles.snap.length) return false;

    const vscoUrl = `https://vsco.co/${username}`;
    const stored = await chrome.storage.local.get({ vscoSocialMatches: [] });
    const matches = Array.isArray(stored.vscoSocialMatches) ? stored.vscoSocialMatches : [];
    const key = `${username}|${description}`;
    const existingIndex = matches.findIndex(match => match.key === key);
    const entry = {
        key,
        username,
        vscoUrl,
        profileImageUrl,
        description,
        tiktok: handles.tiktok,
        snap: handles.snap,
        detectedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        matches[existingIndex] = {
            ...matches[existingIndex],
            ...entry,
            profileImageUrl: profileImageUrl || matches[existingIndex].profileImageUrl || "",
            detectedAt: matches[existingIndex].detectedAt || entry.detectedAt
        };
    } else {
        matches.push(entry);
    }

    await chrome.storage.local.set({ vscoSocialMatches: matches });
    return true;
}

async function saveSocialMatchesFromItems(items) {
    if (!Array.isArray(items) || !items.length) return;
    for (const item of items) {
        const username = getSiteUsername(item);
        const description = getSiteDescription(item);
        if (!username || !description) continue;
        await saveSocialMatch(username, description, getProfileImageUrlFromSite(item));
    }
}

function getPrimarySite(data) {
    const sites = Array.isArray(data?.sites) ? data.sites : [];
    if (sites.length && sites[0] && typeof sites[0] === "object") return sites[0];
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length && results[0] && typeof results[0] === "object") return results[0];
    const grids = Array.isArray(data?.grids) ? data.grids : [];
    if (grids.length && grids[0] && typeof grids[0] === "object") return grids[0];
    return data;
}

async function fetchVscoProfileAvatar(username) {
    username = String(username || "").trim().replace(/^@/, "").toLowerCase();
    if (vscoAvatarCache.has(username)) return vscoAvatarCache.get(username);

    const encoded = encodeURIComponent(username);
    const urls = [
        `https://vsco.co/api/2.0/sites?subdomain=${encoded}`,
        `https://vsco.co/api/2.0/search/grids?query=${encoded}&page=0&size=10`
    ];

    for (const url of urls) {
        const data = await fetchWithRetry(url);
        const site = getPrimarySite(data);
        if (!site || typeof site !== "object") continue;

        const profileImageUrl = getProfileImageUrlFromSite(site);
        const description = getSiteDescription(site);
        await saveSocialMatch(username, description, profileImageUrl);

        if (profileImageUrl) {
            const profile = { profileImageUrl };
            vscoAvatarCache.set(username, profile);
            return profile;
        }
    }

    const emptyProfile = { profileImageUrl: "" };
    vscoAvatarCache.set(username, emptyProfile);
    return emptyProfile;
}

async function resolveVscoToolContext(input = {}) {
    const result = {
        username: String(input.username || '').trim().replace(/^@/, '').toLowerCase(),
        imageId: String(input.imageId || '').match(/[a-f0-9]{24}/i)?.[0]?.toLowerCase() || '',
        siteId: String(input.siteId || '').match(/\d+/)?.[0] || '',
        userId: String(input.userId || '').match(/\d+/)?.[0] || '',
        profileImageId: ''
    };
    const source = String(input.source || '');
    if (!result.imageId) result.imageId = source.match(/[a-f0-9]{24}/i)?.[0]?.toLowerCase() || '';
    if (!result.siteId) result.siteId = source.match(/(?:site(?:id)?\s*[:=]?\s*)(\d+)/i)?.[1] || '';
    if (!result.siteId && /^\d{6,}$/.test(source.trim())) result.siteId = source.trim();
    if (!result.username) {
        const match = source.match(/vsco\.co\/([a-z0-9._-]+)(?:\/|$)/i);
        const candidate = match?.[1] || (/^@?[a-z0-9._-]+$/i.test(source.trim()) ? source.trim().replace(/^@/, '') : '');
        if (candidate && !['search', 'feed', 'user', 'api'].includes(candidate.toLowerCase())) result.username = candidate.toLowerCase();
    }

    let raw = null;
    if (result.username) {
        raw = getPrimarySite(await fetchWithRetry(`https://vsco.co/api/2.0/sites?subdomain=${encodeURIComponent(result.username)}`));
        if (!raw) raw = getPrimarySite(await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(result.username)}&page=0&size=10`));
    }
    if (!raw && result.siteId) {
        const data = await fetchWithRetry(`https://vsco.co/api/3.0/medias/profile?site_id=${encodeURIComponent(result.siteId)}&limit=1`);
        raw = (data?.media || data?.results || data?.files || [])[0] || null;
    }
    const candidates = profileCandidates(raw);
    result.siteId ||= normalizeSiteId(firstText(...candidates.map(item => item.siteId), ...candidates.map(item => item.site_id), ...candidates.map(item => item.grid?.siteId)));
    result.userId ||= firstText(...candidates.map(item => item.userId), ...candidates.map(item => item.user_id), ...candidates.map(item => item.user?.id));
    result.username ||= getSiteUsername(raw || {});
    result.profileImageId = firstText(...candidates.map(item => item.profileImageId), ...candidates.map(item => item.profile_image_id), ...candidates.map(item => item.gridImageId));
    if (!result.imageId && raw) result.imageId = String(getImageId(raw?.image || raw) || '').match(/[a-f0-9]{24}/i)?.[0]?.toLowerCase() || '';
    return result;
}

async function fetchVscoAccountContext() {
    const response = await fetch('https://vsco.co/api/2.0/users?site_requested=1', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Could not resolve signed-in VSCO account (HTTP ${response.status}).`);
    const user = await response.json();
    const site = Array.isArray(user?.sites) ? user.sites.find(candidate => candidate?.status === 'published') || user.sites[0] : null;
    if (!site?.id) throw new Error('Signed-in VSCO account has no usable site.');
    return {
        userId: String(user.user_id || user.id_str || ''),
        viewerSiteId: String(site.id),
        username: String(site.subdomain || site.name || ''),
        collectionId: String(site.site_collection_id || ''),
        albumId: String(site.grid_album_id || ''),
        profileImageId: String(site.profile_image_id || '')
    };
}

function getBackgroundRetryAfterMs(resp) {
    const value = resp?.headers?.get('Retry-After');
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(value);
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function backgroundBackoffWithJitter(ms) {
    const jitter = Math.floor(Math.random() * Math.max(500, Math.min(ms * 0.35, 5000)));
    return Math.min(ms + jitter, RATE_LIMIT_MAX_MS);
}

function fetchWithBackgroundGridPacing(url, options) {
    if (!String(url).includes('/api/2.0/search/grids?')) return fetch(url, options);

    const request = backgroundGridRequestChain.then(async () => {
        const waitUntil = Math.max(nextBackgroundGridRequestAt, backgroundGridRateLimitUntil);
        await delay(Math.max(0, waitUntil - Date.now()));
        const resp = await fetch(url, options);
        nextBackgroundGridRequestAt = Date.now() + GRID_REQUEST_MIN_INTERVAL_MS + Math.floor(Math.random() * GRID_REQUEST_JITTER_MS);
        if (resp.status === 429) {
            const retryMs = Math.max(getBackgroundRetryAfterMs(resp), RATE_LIMIT_BASE_MS);
            backgroundGridRateLimitUntil = Math.max(backgroundGridRateLimitUntil, Date.now() + retryMs);
        }
        return resp;
    });

    backgroundGridRequestChain = request.catch(() => undefined);
    return request;
}

async function fetchWithRetry(url, options = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort();
        if (options.signal?.aborted) controller.abort();
        else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
            const resp = options.skipGridPacing
                ? await fetch(url, {
                    credentials: 'include',
                    signal: controller.signal
                })
                : await fetchWithBackgroundGridPacing(url, {
                credentials: 'include',
                signal: controller.signal
                });
            if (resp.status === 401 || resp.status === 403) return null;
            if (resp.status === 429) {
                const exponential = RATE_LIMIT_BASE_MS * Math.pow(2, attempt);
                const waitMs = backgroundBackoffWithJitter(Math.max(getBackgroundRetryAfterMs(resp), exponential));
                if (String(url).includes('/api/2.0/search/grids?')) {
                    backgroundGridRateLimitUntil = Math.max(backgroundGridRateLimitUntil, Date.now() + waitMs);
                }
                console.warn(`VSCO rate limited ${url}; retrying in ${waitMs}ms (${attempt + 1}/3).`);
                if (attempt < 2) await delay(waitMs);
                continue;
            }
            if (!resp.ok) {
                if (resp.status >= 500 && attempt < 2) {
                    await delay(backgroundBackoffWithJitter(RATE_LIMIT_BASE_MS * Math.pow(2, attempt)));
                    continue;
                }
                return null;
            }
            return await resp.json();
        } catch (e) {
            if (options.signal?.aborted) return null;
            if (attempt < 2) {
                await delay(backgroundBackoffWithJitter(RATE_LIMIT_BASE_MS * Math.pow(2, attempt)));
            }
        } finally {
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abortFromCaller);
        }
    }
    return null;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shuffleArray(items) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function normalizeQueryTerm(value) {
    if (value === undefined || value === null) return '';
    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/^[\s"'`.,;:!?()[\]{}<>]+|[\s"'`.,;:!?()[\]{}<>]+$/g, '')
        .trim();
}

function isEmojiLikeTerm(term) {
    try {
        return /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u.test(term);
    } catch (e) {
        return /[^\w\s]/.test(term);
    }
}

function addQuery(queue, seen, value) {
    const term = normalizeQueryTerm(value);
    if (!term || term.length > 200) return;

    const lower = term.toLowerCase();
    if (STOP_WORDS.has(lower)) return;
    if (term.length < 3 && !isEmojiLikeTerm(term)) return;
    if (seen.has(lower)) return;

    seen.add(lower);
    queue.push(term);
}

function addExplicitQuery(queue, seen, value) {
    const term = normalizeQueryTerm(value);
    if (!term || term.length > 200) return;

    const lower = term.toLowerCase();
    if (seen.has(lower)) return;

    seen.add(lower);
    queue.push(term);
}

function addTermsFromText(queue, seen, value) {
    const term = normalizeQueryTerm(value);
    if (!term) return;

    addQuery(queue, seen, term);

    term.split(/[\s,.;:!?()[\]{}"'`“”‘’|/\\<>]+/).forEach(piece => {
        addQuery(queue, seen, piece);
    });
}

function getImageId(img) {
    return img?.imageId || img?._id || img?.id || '';
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
}

function normalizeMediaImage(item, fallbackGrid, sourceQuery) {
    const img = item?.image || item;
    if (!img) return null;

    const imageId = getImageId(img);
    if (!imageId) return null;

    img.imageId = imageId;
    if (!img.grid && fallbackGrid) img.grid = fallbackGrid;
    if (!img.sourceQuery) img.sourceQuery = sourceQuery;

    return img;
}

function mergeDescriptions(existing, descriptions) {
    const seen = new Set();
    const merged = [];
    [...asArray(existing), ...asArray(descriptions)].forEach(desc => {
        const cleaned = normalizeQueryTerm(desc);
        const key = cleaned.toLowerCase();
        if (!cleaned || seen.has(key)) return;
        seen.add(key);
        merged.push(cleaned);
    });
    return merged.slice(0, 250);
}

function firstText(...values) {
    for (const value of values) {
        const cleaned = normalizeQueryTerm(value);
        if (cleaned) return cleaned;
    }
    return '';
}

function normalizeSiteId(value) {
    if (value === undefined || value === null || value === '') return '';
    return String(value).trim();
}

function profileCandidates(item) {
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

function normalizeFollowProfile(item) {
    const candidates = profileCandidates(item);
    if (candidates.length === 0) return null;

    const siteId = normalizeSiteId(firstText(
        ...candidates.map(c => c.siteId),
        ...candidates.map(c => c.site_id),
        ...candidates.map(c => c.siteID),
        ...candidates.map(c => c.site?.id),
        ...candidates.map(c => c.profile?.siteId),
        ...candidates.map(c => c.grid?.siteId)
    ));
    const username = firstText(
        ...candidates.map(c => c.siteSubDomain),
        ...candidates.map(c => c.site_subdomain),
        ...candidates.map(c => c.subdomain),
        ...candidates.map(c => c.perma_subdomain),
        ...candidates.map(c => c.site?.subdomain),
        ...candidates.map(c => c.profile?.siteSubDomain),
        ...candidates.map(c => c.username),
        ...candidates.map(c => c.handle)
    );
    const displayName = firstText(
        ...candidates.map(c => c.userName),
        ...candidates.map(c => c.displayName),
        ...candidates.map(c => c.display_name),
        ...candidates.map(c => c.fullName),
        ...candidates.map(c => c.name),
        ...candidates.map(c => c.site?.name)
    );
    const bio = firstText(
        ...candidates.map(c => c.gridName),
        ...candidates.map(c => c.grid_name),
        ...candidates.map(c => c.bio),
        ...candidates.map(c => c.description),
        ...candidates.map(c => c.about),
        ...candidates.map(c => c.site?.description)
    );

    if (!siteId && !username) return null;

    return {
        siteId: siteId || username,
        username,
        displayName,
        bio,
        followed: true
    };
}

function extractFollowingItems(data) {
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
        if (directItems.some(item => normalizeFollowProfile(item))) return directItems;
    }

    const found = [];
    const visit = (value, depth = 0) => {
        if (!value || depth > 4) return;
        if (Array.isArray(value)) {
            const profileLikeCount = value.filter(item => normalizeFollowProfile(item)).length;
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

function mergeProfile(base, incoming) {
    const merged = {
        ...(base || {}),
        ...(incoming || {})
    };

    merged.siteId = normalizeSiteId(incoming?.siteId || base?.siteId);
    merged.username = firstText(incoming?.username, base?.username);
    merged.displayName = firstText(incoming?.displayName, base?.displayName);
    merged.bio = firstText(incoming?.bio, base?.bio);
    merged.imageDescriptions = mergeDescriptions(base?.imageDescriptions, incoming?.imageDescriptions);
    merged.followed = incoming?.followed !== false;
    merged.lastSeenFollowingAt = incoming?.lastSeenFollowingAt || base?.lastSeenFollowingAt || Date.now();

    return merged;
}

function getRandomFollowingPages() {
    const pages = Array.from({ length: MAX_FOLLOWING_PAGES }, (_, page) => page);
    for (let i = pages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pages[i], pages[j]] = [pages[j], pages[i]];
    }
    return pages;
}

async function fetchFollowingProfiles() {
    const endpointBuilders = [
        page => `https://vsco.co/api/2.0/users/me/following?page=${page}&size=${FOLLOWING_PAGE_SIZE}`,
        page => `https://vsco.co/api/2.0/follows?page=${page}&size=${FOLLOWING_PAGE_SIZE}`
    ];

    for (const buildUrl of endpointBuilders) {
        const profiles = [];
        const seen = new Set();
        const pages = getRandomFollowingPages();

        for (const page of pages) {
            const data = await fetchWithRetry(buildUrl(page));
            if (!data) break;

            const items = extractFollowingItems(data);
            if (items.length === 0) break;

            let addedThisPage = 0;
            items.forEach(item => {
                const profile = normalizeFollowProfile(item);
                if (!profile) return;

                const key = String(profile.siteId || profile.username).toLowerCase();
                if (!key || seen.has(key)) return;

                seen.add(key);
                profiles.push(profile);
                addedThisPage++;
            });

            if (addedThisPage === 0) break;
            await delay(750);
        }

        if (profiles.length > 0) return profiles;
    }

    return [];
}

async function fetchGridProfileDetails(profile) {
    if (!profile?.username) return profile;

    const data = await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(profile.username)}&page=0&size=5`);
    const grids = data?.results || data?.grids || [];
    const match = grids.find(g => {
        const sameSite = profile.siteId && String(g.siteId) === String(profile.siteId);
        const sameUser = profile.username && String(g.siteSubDomain || '').toLowerCase() === String(profile.username).toLowerCase();
        return sameSite || sameUser;
    });

    if (!match) return profile;

    return mergeProfile(profile, {
        siteId: normalizeSiteId(match.siteId || profile.siteId),
        username: match.siteSubDomain || profile.username,
        displayName: match.userName || profile.displayName,
        bio: match.gridName || profile.bio,
        followed: true
    });
}

function getFollowedScrapeSources(appSettings) {
    return {
        usernames: appSettings.followedScrapeUsernames === true,
        bio: appSettings.followedScrapeBioDescriptions !== false,
        imageDescriptions: appSettings.followedScrapeImageDescriptions !== false
    };
}

function hasEnabledFollowedScrapeSources(sources) {
    return Boolean(sources?.usernames || sources?.bio || sources?.imageDescriptions);
}

function addProfileTerms(queue, seen, profile, sources) {
    if (!profile) return;

    if (sources.usernames) {
        addTermsFromText(queue, seen, profile.username);
        addTermsFromText(queue, seen, profile.displayName);
    }

    if (sources.bio) {
        addTermsFromText(queue, seen, profile.bio);
    }

    if (sources.imageDescriptions) {
        asArray(profile.imageDescriptions).forEach(desc => addTermsFromText(queue, seen, desc));
    }
}

async function buildFollowedProfilesForScrape(sources) {
    const now = Date.now();
    const cachedProfiles = await loadFollowedProfiles();
    const cachedBySiteId = {};
    const cachedByUsername = {};

    cachedProfiles.forEach(profile => {
        if (profile?.siteId) cachedBySiteId[String(profile.siteId)] = profile;
        if (profile?.username) cachedByUsername[String(profile.username).toLowerCase()] = profile;
    });

    const followingProfiles = await fetchFollowingProfiles();
    const sourceProfiles = followingProfiles.length > 0 ? followingProfiles : cachedProfiles;
    const mergedBySiteId = {};

    sourceProfiles.forEach(profile => {
        const cached = cachedBySiteId[String(profile.siteId)] || cachedByUsername[String(profile.username || '').toLowerCase()];
        const merged = mergeProfile(cached, {
            ...profile,
            lastSeenFollowingAt: now,
            followed: true
        });
        mergedBySiteId[String(merged.siteId)] = merged;
    });

    let refreshCount = 0;
    for (const siteId of Object.keys(mergedBySiteId)) {
        let profile = mergedBySiteId[siteId];
        const needsDetails = sources.bio && (!profile.bio || (now - (profile.lastFollowProfileRefreshAt || 0)) > PROFILE_DESCRIPTION_REFRESH_MS);
        const needsDescriptions = sources.imageDescriptions && (asArray(profile.imageDescriptions).length === 0 || (now - (profile.lastDescriptionScrapeAt || 0)) > PROFILE_DESCRIPTION_REFRESH_MS);

        if ((needsDetails || needsDescriptions) && refreshCount < MAX_FOLLOWING_DETAIL_REFRESHES_PER_RUN) {
            refreshCount++;
            try {
                if (needsDetails) {
                    profile = await fetchGridProfileDetails(profile);
                    profile.lastFollowProfileRefreshAt = now;
                }

                if (needsDescriptions && profile.siteId) {
                    const media = await fetchProfileMedia(profile.siteId, {
                        ...profile,
                        sourceQueryLabel: `Followed profile: ${profile.username || profile.siteId}`
                    });
                    const descriptions = media
                        .map(img => img.description)
                        .filter(desc => normalizeQueryTerm(desc));
                    profile.imageDescriptions = mergeDescriptions(profile.imageDescriptions, descriptions);
                    profile.lastDescriptionScrapeAt = now;
                }
            } catch (e) {
                console.warn('Background: failed to enrich followed profile:', profile.username || profile.siteId, e);
            }

            await delay(PROFILE_MEDIA_DELAY_MS);
        }

        profile.lastCheckedAt = now;
        mergedBySiteId[siteId] = profile;
        await saveFollowedProfile(profile);
    }

    return Object.values(mergedBySiteId);
}

async function fetchProfileMedia(siteId, profile) {
    const sid = String(siteId);
    const username = profile?.username || profile?.subdomain || sid;
    const sourceQuery = profile?.sourceQueryLabel || `Followed profile: ${username}`;
    const fallbackGrid = { siteId: sid, subdomain: profile?.username || '' };
    const urls = [
        `https://vsco.co/api/2.0/medias?site_id=${encodeURIComponent(sid)}&page=0&return=1000`,
        `https://vsco.co/api/3.0/medias/profile?site_id=${encodeURIComponent(sid)}&limit=100`
    ];

    for (const url of urls) {
        const data = await fetchWithRetry(url);
        const rawItems = data?.media || data?.results || data?.files || [];
        const items = rawItems
            .map(item => normalizeMediaImage(item, fallbackGrid, sourceQuery))
            .filter(Boolean);

        if (items.length > 0) {
            await saveToVaultDB(items);
            return items;
        }
    }

    return [];
}

function getPersonTimestamp(p) {
    const id = p.gridImageId || "";
    if (id.length >= 8) {
        const ts = parseInt(id.slice(0, 8), 16);
        if (!isNaN(ts)) return ts * 1000;
    }
    return 0;
}

function addLikedImageTerms(queue, seen, img, sources) {
    if (!img) return;

    if (sources.usernames) {
        addTermsFromText(queue, seen, img.grid?.subdomain);
        addTermsFromText(queue, seen, img.perma_subdomain);
        addTermsFromText(queue, seen, img.userName);
    }

    if (sources.bio) {
        addTermsFromText(queue, seen, img.gridName);
    }

    if (sources.imageDescriptions) {
        addTermsFromText(queue, seen, img.description);
    }
}

function addLikedProfileTerms(queue, seen, profile, sources) {
    if (!profile) return;

    if (sources.usernames) {
        addTermsFromText(queue, seen, profile.username);
        addTermsFromText(queue, seen, profile.displayName);
    }

    if (sources.bio) {
        addTermsFromText(queue, seen, profile.bio);
    }

    if (sources.imageDescriptions) {
        asArray(profile.imageDescriptions).forEach(desc => addTermsFromText(queue, seen, desc));
    }
}

function getFullyLikedSiteIds(fullyLikedImages, likedProfiles) {
    const siteIds = new Set();

    Object.values(fullyLikedImages || {}).forEach(img => {
        const sid = img?.grid?.siteId || img?.siteId || img?.site_id;
        if (sid) siteIds.add(String(sid));
    });

    (likedProfiles || []).forEach(profile => {
        if (profile?.siteId) siteIds.add(String(profile.siteId));
    });

    return siteIds;
}

async function refreshProfileDescriptionTerms(siteIds, profilesBySiteId, queue, seen, includeDescriptions) {
    if (!includeDescriptions || siteIds.size === 0) return;

    const now = Date.now();
    let refreshCount = 0;
    for (const siteId of siteIds) {
        if (refreshCount >= MAX_PROFILE_DESCRIPTION_REFRESHES_PER_RUN) break;

        const profile = profilesBySiteId[siteId] || { siteId };
        const descriptions = asArray(profile.imageDescriptions);
        const lastChecked = profile.lastDescriptionScrapeAt || 0;
        const needsRefresh = descriptions.length === 0 || (now - lastChecked) > PROFILE_DESCRIPTION_REFRESH_MS;

        if (!needsRefresh) continue;
        refreshCount++;

        try {
            const media = await fetchProfileMedia(siteId, profile);
            const freshDescriptions = media
                .map(img => img.description)
                .filter(desc => normalizeQueryTerm(desc));

            const imageDescriptions = mergeDescriptions(descriptions, freshDescriptions);
            imageDescriptions.forEach(desc => addTermsFromText(queue, seen, desc));

            const updatedProfile = {
                ...profile,
                siteId,
                imageDescriptions,
                lastDescriptionScrapeAt: now,
                lastCheckedAt: Math.max(profile.lastCheckedAt || 0, now)
            };
            profilesBySiteId[siteId] = updatedProfile;
            await saveLikedProfile(updatedProfile);
        } catch (e) {
            console.warn('Background: failed to refresh profile media descriptions for', siteId, e);
        }

        await delay(PROFILE_MEDIA_DELAY_MS);
    }
}

async function buildBackgroundQueries() {
    const res = await getLocalStorage(['likedQueries', 'customQueue', 'fullyLikedImages', 'appSettings']);
    const appSettings = {
        scrapeDescriptionsOnLike: true,
        scrapeNameBioOnLike: true,
        followedScrapeUsernames: false,
        followedScrapeBioDescriptions: true,
        followedScrapeImageDescriptions: true,
        followedScrapeRepostedUsers: false,
        ...res.appSettings
    };
    const sources = getFollowedScrapeSources(appSettings);
    const likedProfiles = await loadLikedProfiles();
    const queue = [];
    const seen = new Set();
    const followedProfiles = hasEnabledFollowedScrapeSources(sources) ? await buildFollowedProfilesForScrape(sources) : [];

    followedProfiles.forEach(profile => {
        addProfileTerms(queue, seen, profile, sources);
    });

    if (followedProfiles.length === 0 && hasEnabledFollowedScrapeSources(sources)) {
        const profilesBySiteId = {};

        likedProfiles.forEach(profile => {
            if (profile?.siteId) profilesBySiteId[String(profile.siteId)] = profile;
        });

        Object.values(res.fullyLikedImages || {}).forEach(img => {
            addLikedImageTerms(queue, seen, img, sources);
        });

        likedProfiles.forEach(profile => {
            addLikedProfileTerms(queue, seen, profile, sources);
        });

        const fullyLikedSiteIds = getFullyLikedSiteIds(res.fullyLikedImages || {}, likedProfiles);
        await refreshProfileDescriptionTerms(fullyLikedSiteIds, profilesBySiteId, queue, seen, sources.imageDescriptions);
    }

    (res.customQueue || []).forEach(q => addExplicitQuery(queue, seen, q));
    (res.likedQueries || []).forEach(q => addExplicitQuery(queue, seen, q));

    return shuffleArray(queue).slice(0, MAX_BACKGROUND_QUERIES);
}

async function scrapeQueries() {
    console.log("Starting background hourly scrape...");
    const queries = await buildBackgroundQueries();
    if (!queries.length) {
        console.log("No followed profile terms found to scrape.");
        return;
    }

    console.log(`Background scrape queue built from followed profile bios/descriptions: ${queries.length} queries.`);

    for (const q of queries) {
        console.log("Background scraping query:", q);
        // Fetch Images
        const imgData = await fetchWithRetry(`https://vsco.co/api/2.0/search/images?query=${encodeURIComponent(q)}&size=1000`);
        const imageResults = imgData?.results || [];

        // Fetch People
        const peopleData = await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(q)}&size=10000&page=0`);
        const pResults = peopleData?.results || peopleData?.grids || [];

        const peopleImages = pResults.map(p => {
            return {
                imageId: p.gridImageId,
                responsive_url: p.responsive_url,
                description: p.gridName || p.userName,
                upload_date: getPersonTimestamp(p),
                isProfile: true,
                grid: { siteId: p.siteId, subdomain: p.siteSubDomain }
            }
        }).filter(img => img.imageId && typeof img.imageId === 'string' && img.responsive_url);

        const combined = [...imageResults, ...peopleImages];
        combined.forEach(img => {
            if (!img.sourceQuery) img.sourceQuery = q;
        });

        if (combined.length > 0) {
            await saveToVaultDB(combined);
            console.log(`Saved ${combined.length} images for query "${q}" to Vault DB.`);
        }

        await delay(BACKGROUND_QUERY_DELAY_MS);
    }
    console.log("Background scrape complete.");
}

function syncHourlyScrapeAlarm() {
    if (BACKGROUND_HOURLY_SCRAPE_ENABLED) {
        chrome.alarms.create("hourlyScrape", { periodInMinutes: 60 });
    } else {
        chrome.alarms.clear("hourlyScrape");
    }
}

// Automatic hourly scraping is intentionally off. Manual scraping in the new-tab UI still works.
syncHourlyScrapeAlarm();
chrome.runtime.onInstalled.addListener(syncHourlyScrapeAlarm);
chrome.runtime.onStartup.addListener(syncHourlyScrapeAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "hourlyScrape" && BACKGROUND_HOURLY_SCRAPE_ENABLED) {
        scrapeQueries();
    } else if (alarm.name === "hourlyScrape") {
        chrome.alarms.clear("hourlyScrape");
    } else if (alarm.name === ENHANCED_WATCH_ALARM) {
        runEnhancedSavedSearchChecks();
    }
});

function normalizeLocalResultUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) return `https:${url}`;
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
}

function getLocalImageTimestamp(item, id) {
    const objectIds = [
        id,
        item?.imageId,
        item?._id,
        item?.id,
        item?.media_id,
        item?.mediaId,
        item?.image?.imageId,
        item?.image?._id,
        item?.image?.id
    ];
    for (const value of objectIds) {
        const objectId = String(value || '').trim();
        if (!/^[0-9a-f]{24}$/i.test(objectId)) continue;
        const seconds = parseInt(objectId.slice(0, 8), 16);
        if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }

    const raw = item?.upload_date ?? item?.uploadDate ?? item?.published_at ??
        item?.publishedAt ?? item?.created_at ?? item?.createdAt ?? 0;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 100000000000 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(String(raw || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapLocalImage(item) {
    const id = String(item?.imageId || item?._id || item?.id || '').trim();
    return {
        id,
        kind: 'image',
        username: item?.grid?.subdomain || item?.siteSubDomain || '',
        displayName: item?.grid?.name || item?.userName || '',
        siteId: String(item?.grid?.siteId || item?.siteId || ''),
        imageUrl: normalizeLocalResultUrl(item?.responsive_url || item?.image_url || (id ? `i.vsco.co/${id}` : '')),
        description: item?.description || '',
        timestamp: getLocalImageTimestamp(item, id),
        width: Number(item?.width || item?.image_meta?.width || 0),
        height: Number(item?.height || item?.image_meta?.height || 0),
        hasGps: Boolean(item?.has_location || item?.location_coords || item?.locationCoords)
    };
}

function mapLocalPerson(person) {
    const id = String(person?.siteId || person?.siteSubDomain || '').trim();
    const gridImage = String(person?.gridImage || '').trim();
    const username = String(person?.siteSubDomain || '').trim();
    const profileImageId = String(person?.gridImageId || '').trim();
    return {
        id,
        kind: 'person',
        username,
        displayName: person?.userName || person?.siteSubDomain || '',
        siteId: String(person?.siteId || ''),
        imageUrl: normalizeLocalResultUrl(person?.responsive_url || (profileImageId ? `i.vsco.co/${profileImageId}` : '')),
        profileImageUrl: normalizeLocalResultUrl(gridImage ? (/^https?:\/\//i.test(gridImage) || gridImage.startsWith('//') ? gridImage : `img.vsco.co/${gridImage}`) : ''),
        profileImageId,
        profileUrl: username ? `https://vsco.co/${encodeURIComponent(username)}/gallery` : '',
        description: person?.gridName || '',
        timestamp: getPersonTimestamp(person),
        width: Number(person?.width || 0),
        height: Number(person?.height || 0),
        hasGps: Boolean(person?.has_location || person?.location_coords)
    };
}

async function toggleEnhancedVscoFollow(siteId) {
    const id = String(siteId || '').trim();
    if (!/^\d+$/.test(id)) throw new Error('Missing VSCO site ID.');
    const url = `https://vsco.co/api/2.0/follows/${encodeURIComponent(id)}`;
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    const stateResponse = await fetch(url, { method: 'GET', credentials: 'include', headers });
    if (!stateResponse.ok) throw new Error(`Could not read follow state (HTTP ${stateResponse.status}).`);
    const state = await stateResponse.json();
    const wasFollowing = state?.is_following === true;
    const method = wasFollowing ? 'DELETE' : 'POST';
    const response = await fetch(url, { method, credentials: 'include', headers });
    if (!response.ok) {
        const detail = (await response.text()).slice(0, 240).replace(/\s+/g, ' ').trim();
        throw new Error(`${wasFollowing ? 'Unfollow' : 'Follow'} failed (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    return { ok: true, siteId: id, following: !wasFollowing };
}

async function runLocalAppSearch(request) {
    const mode = ['images', 'people', 'bio'].includes(request.mode) ? request.mode : 'images';
    const query = String(request.q || '').trim();
    const requestedLimit = Math.min(Math.max(Number(request.limit || 10000), 1), 10000);
    const limit = requestedLimit;
    if (!query) throw new Error('Enter a search query.');

    if (mode === 'images') {
        const data = await fetchWithRetry(`https://vsco.co/api/2.0/search/images?query=${encodeURIComponent(query)}&size=${limit}`);
        if (!data) throw new Error('VSCO search failed. Check that you are logged in.');
        const items = (data.results || []).map(mapLocalImage).filter(item => item.id && item.imageUrl);
        items.sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
        return { mode, query, total: items.length, items };
    }

    const data = await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(query)}&page=0&size=${limit}`);
    if (!data) throw new Error('VSCO search failed. Check that you are logged in.');
    const people = (data.results || data.grids || []).map(mapLocalPerson).filter(item => item.id);
    const lowered = query.toLowerCase();
    const items = mode === 'bio'
        ? people.filter(item => item.description.toLowerCase().includes(lowered))
        : people.filter(item => `${item.displayName} ${item.username}`.toLowerCase().includes(lowered));
    return { mode, query, total: items.length, scanned: people.length, items };
}

async function runEnhancedVscoSearch(query, mode = 'images') {
    const trimmed = String(query || '').trim();
    if (!trimmed) throw new Error('Empty VSCO search query.');
    const searchMode = mode === 'people' ? 'people' : 'images';
    const cached = enhancedSearchCache.get(normalizeEnhancedText(trimmed));
    if (cached?.mode === searchMode) return enhancedSearchResponse(cached, { cached: true });
    const syntax = enhancedSearchSyntax(trimmed);
    const apiQueries = syntax.apiQueries;
    if (!apiQueries.length) throw new Error('Add at least one search term before exclusions.');
    const resultSets = await Promise.all(apiQueries.map(async apiQuery => {
        const encoded = encodeURIComponent(apiQuery);
        const imageData = searchMode === 'images'
            ? await fetchWithRetry(`https://vsco.co/api/2.0/search/images?query=${encoded}&size=10000`)
            : null;
        const gridData = searchMode === 'people'
            ? await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encoded}&page=0&size=10000`, { skipGridPacing: true })
            : null;
        return { apiQuery, imageData, gridData };
    }));
    if (!resultSets.some(result => result.imageData || result.gridData)) {
        throw new Error('VSCO search failed. Check that the experimental profile is logged in.');
    }

    const imageMap = new Map();
    const peopleMap = new Map();
    let seedExcluded = 0;
    for (const { imageData, gridData } of resultSets) {
        for (const item of (imageData?.results || []).map(mapLocalImage).filter(item => item.id && item.imageUrl)) {
            if (enhancedMatchesExcluded(item, syntax.excludedTerms)) { seedExcluded++; continue; }
            imageMap.set(item.id, item);
        }
        for (const item of (gridData?.results || gridData?.grids || []).map(mapLocalPerson).filter(item => item.id)) {
            if (enhancedMatchesExcluded(item, syntax.excludedTerms)) { seedExcluded++; continue; }
            peopleMap.set(item.id, item);
        }
    }
    const images = [...imageMap.values()];
    const people = [...peopleMap.values()];

    images.sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
    people.sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
    const seedReports = resultSets.map(({ apiQuery, imageData, gridData }) => {
        const data = searchMode === 'images' ? imageData : gridData;
        const rawResults = data?.results || data?.grids || [];
        const reportedTotal = Number(data?.total);
        return {
            query: apiQuery,
            fetched: rawResults.length,
            total: Number.isSafeInteger(reportedTotal) && reportedTotal >= rawResults.length ? reportedTotal : null
        };
    });
    const exactTotal = seedReports.length === 1 ? seedReports[0].total : null;
    const cache = {
        query: trimmed,
        mode: searchMode,
        apiQueries,
        excludedTerms: syntax.excludedTerms,
        seedExcluded,
        seedReports,
        exactTotal,
        images,
        people,
        expansion: {
            completedQueries: new Set(),
            batches: 0,
            requestsCompleted: 0,
            addedImages: 0,
            addedPeople: 0,
            duplicates: 0,
            rejected: 0,
            travelQueryYield: new Map(),
            countryBoostTokens: new Map(),
            countryVerifiedImageIds: new Set(),
            active: null,
            lastBatch: null
        }
    };
    enhancedSearchCache.set(normalizeEnhancedText(trimmed), cache);
    return enhancedSearchResponse(cache);
}

const enhancedSearchCache = new Map();
const AUTONOMOUS_PROFILE_DISCOVERY_KEY = '__vsco_tub_discover_profiles__';
// The People endpoint is not known to support an empty query. These bounded,
// deliberately broad probes bootstrap an autonomous corpus without pretending
// that an undocumented empty-search API exists. Learned terms drive all later
// seedless batches.
const AUTONOMOUS_PROFILE_STARTERS = Object.freeze({
    ALL: ['✨', '🤍', '🩷', '🦋', 'xo', 'xx', 'em', 'ma'],
    IE: ['aoife', 'ciara', 'niamh', 'saoirse', '✨', '🤍'],
    IL: ['noa', 'maya', 'yael', 'tamar', '✨', '🤍'],
    CA: ['emma', 'olivia', 'ava', 'sophie', '✨', '🤍']
});
const ENHANCED_EXPANSION_MAX_QUERIES = 24;
const ENHANCED_EXPANSION_CONCURRENCY = 6;
const ENHANCED_EXPANSION_MAX_CANDIDATES = 40;
const ENHANCED_TRAVEL_MAX_VOCABULARY = 5000;
const ENHANCED_STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'been', 'being', 'from', 'have', 'into', 'just', 'like', 'more', 'only', 'that', 'their', 'there', 'these', 'they', 'this', 'with', 'you', 'your']);
const ENHANCED_URL_TOKENS = new Set(['http', 'https', 'www', 'com', 'co', 'vsco', 'api', 'share', 'media', 'image', 'jpg', 'jpeg', 'png']);
function enhancedLog(event, details = {}) {
    try { console.info('[VSCO Tub]', event, details); } catch (_) { /* diagnostics are non-critical */ }
}

function normalizeEnhancedText(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
}

function enhancedApiQueries(query) {
    const q = String(query || '').trim();
    if (q.startsWith('"') && q.endsWith('"') && q.length > 2) return [q.slice(1, -1)];
    const simple = q.split(/(?:\s+OR\s+|[\n,;]+)/i).map(value => value.trim()).filter(Boolean);
    if (simple.length > 1 && !/\s+AND\s+/i.test(q) && !/^NOT\s+/i.test(q) && !/[*?]/.test(q)) return [...new Set(simple)];
    return [...new Set(q.split(/\s+OR\s+/i).map(branch => branch.trim()).filter(Boolean).map(branch => branch
        .split(/\s+AND\s+/i).map(value => value.trim().replace(/^NOT\s+/i, '').replace(/[*?]/g, '')).filter(Boolean).join(' ')).filter(Boolean))];
}

function enhancedSearchSyntax(query) {
    const excludedTerms = [];
    const positive = String(query || '').replace(/(^|[\s,;])-(?:"([^"]+)"|([^\s,;]+))/g, (match, prefix, quoted, bare) => {
        const term = normalizeEnhancedText(quoted || bare);
        if (term) excludedTerms.push(term);
        return prefix;
    }).replace(/\s+/g, ' ').replace(/\s*([,;])\s*/g, '$1').replace(/^[,;]+|[,;]+$/g, '').trim();
    return {
        apiQueries: enhancedApiQueries(positive),
        excludedTerms: [...new Set(excludedTerms)]
    };
}

function enhancedTokens(value) {
    return [...new Set((normalizeEnhancedText(String(value || '').replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')).match(/#[\p{L}\p{N}_-]+|[\p{L}\p{N}_-]{2,}|[\u{1F300}-\u{1FAFF}]/gu) || [])
        .filter(token => !ENHANCED_STOP_WORDS.has(token) && !ENHANCED_URL_TOKENS.has(token)))];
}

function enhancedRecordText(item) {
    return normalizeEnhancedText([item?.username, item?.displayName, item?.description].filter(Boolean).join(' '));
}

function enhancedMatchesExcluded(item, excludedTerms) {
    if (!excludedTerms?.length) return false;
    const text = enhancedRecordText(item);
    return excludedTerms.some(term => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, 'u').test(text);
    });
}

function enhancedAddCandidates(items, baseTerms, candidateScores) {
    for (const item of items || []) {
        const text = enhancedRecordText(item);
        const matchingTerms = baseTerms.filter(term => text.includes(term));
        if (!matchingTerms.length) continue;
        for (const term of matchingTerms) {
            for (const token of enhancedTokens(text)) {
                if (baseTerms.includes(token)) continue;
                const key = JSON.stringify([term, token]);
                const current = candidateScores.get(key) || { term, token, score: 0 };
                current.score++;
                candidateScores.set(key, current);
            }
        }
    }
}

function enhancedAddTravelCandidates(items, excludedTerms, candidateScores) {
    for (const item of items || []) {
        if (enhancedMatchesExcluded(item, excludedTerms)) continue;
        for (const token of enhancedTokens(enhancedRecordText(item))) {
            const normalized = normalizeEnhancedText(token);
            if (!normalized || normalized.length < 2) continue;
            const current = candidateScores.get(normalized) || { term: '', token: normalized, score: 0 };
            current.score++;
            candidateScores.set(normalized, current);
        }
    }
    if (candidateScores.size > ENHANCED_TRAVEL_MAX_VOCABULARY) {
        const keep = [...candidateScores.values()]
            .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
            .slice(0, ENHANCED_TRAVEL_MAX_VOCABULARY);
        candidateScores.clear();
        keep.forEach(candidate => candidateScores.set(candidate.token, candidate));
    }
}

function buildTravelInsights(items, windowMs = 604800000) {
    const cutoff = windowMs > 0 ? Date.now() - windowMs : 0;
    const names = new Map();
    const emojis = new Map();
    for (const item of items || []) {
        if (windowMs > 0 && !(item.timestamp > 0 && item.timestamp >= cutoff)) continue;
        const name = String(item.username || '').trim();
        if (name) names.set(name, (names.get(name) || 0) + 1);
        for (const emoji of (String(item.description || '').match(/[\u{1F300}-\u{1FAFF}]/gu) || [])) emojis.set(emoji, (emojis.get(emoji) || 0) + 1);
    }
    const top = map => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([value, count]) => ({ value, count }));
    return { usernames: top(names), emojis: top(emojis) };
}

function serializeEnhancedExpansion(cache) {
    const expansion = cache.expansion;
    const active = expansion.active;
    return {
        status: active ? (active.cancelled ? 'stopping' : 'running') : 'idle',
        workers: active?.workers || 0,
        queued: active?.queries.length || 0,
        completed: active?.completed || 0,
        currentQueries: active?.queries || [],
        completedQueries: [...expansion.completedQueries],
        batches: expansion.batches,
        requestsCompleted: expansion.requestsCompleted,
        addedImages: expansion.addedImages,
        addedPeople: expansion.addedPeople,
        duplicates: expansion.duplicates,
        rejected: expansion.rejected,
        lastBatch: expansion.lastBatch
        ,travelSeedScanned: expansion.travelSeedScanned || 0
        ,travelCandidates: expansion.travelCandidates || 0
        ,travelQueryYield: Object.fromEntries(expansion.travelQueryYield || [])
        ,travelInsights: expansion.travelInsights || { usernames: [], emojis: [] }
        ,countryVerifiedProfiles: expansion.countryVerifiedImageIds?.size || 0
        ,countryBoostTerms: [...(expansion.countryBoostTokens || new Map()).entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 12)
            .map(([term, count]) => ({ term, count }))
    };
}

function enhancedSearchResponse(cache, extra = {}) {
    const responseLimit = Number.isFinite(extra.responseLimit) ? extra.responseLimit : 10000;
    const visibleImages = cache.images.slice(0, responseLimit);
    const visiblePeople = cache.people.slice(0, responseLimit);
    return {
        ok: true,
        query: cache.query,
        apiQueries: cache.apiQueries,
        excludedTerms: cache.excludedTerms,
        seedExcluded: cache.seedExcluded,
        seedReports: cache.seedReports,
        exactTotal: cache.exactTotal,
        autonomous: cache.autonomous === true,
        autonomousCountry: cache.autonomousCountry || 'ALL',
        images: visibleImages,
        people: visiblePeople,
        responseTruncated: cache.images.length > responseLimit || cache.people.length > responseLimit,
        expansion: serializeEnhancedExpansion(cache),
        ...extra
    };
}

async function startAutonomousProfileDiscovery(country = 'ALL') {
    const countryCode = Object.hasOwn(AUTONOMOUS_PROFILE_STARTERS, String(country || '').toUpperCase())
        ? String(country || '').toUpperCase()
        : 'ALL';
    const sessionKey = `${AUTONOMOUS_PROFILE_DISCOVERY_KEY}:${countryCode}`;
    const existing = enhancedSearchCache.get(sessionKey);
    if (existing) return enhancedSearchResponse(existing, { cached: true });

    const starters = AUTONOMOUS_PROFILE_STARTERS[countryCode];
    const bootstrapQuery = starters.join(',');
    await runEnhancedVscoSearch(bootstrapQuery, 'people');
    const bootstrapKey = normalizeEnhancedText(bootstrapQuery);
    const bootstrapCache = enhancedSearchCache.get(bootstrapKey);
    if (!bootstrapCache) throw new Error('Autonomous profile discovery could not build its starter corpus.');

    // Keep an ordinary search cache with the same terms untouched. Autonomous
    // discovery gets its own result arrays and expansion identity.
    const cache = {
        ...bootstrapCache,
        query: sessionKey,
        autonomous: true,
        autonomousCountry: countryCode,
        images: bootstrapCache.images.slice(),
        people: bootstrapCache.people.slice(),
        expansion: {
            completedQueries: new Set(),
            batches: 0,
            requestsCompleted: 0,
            addedImages: 0,
            addedPeople: 0,
            duplicates: 0,
            rejected: 0,
            travelQueryYield: new Map(),
            countryBoostTokens: new Map(),
            countryVerifiedImageIds: new Set(),
            active: null,
            lastBatch: null
        }
    };
    enhancedSearchCache.set(sessionKey, cache);
    enhancedLog('autonomous profile discovery started', {
        country: countryCode,
        starters,
        profiles: cache.people.length
    });
    return enhancedSearchResponse(cache);
}

function addAutonomousCountrySignals(query, profileImageIds = []) {
    const cache = enhancedSearchCache.get(normalizeEnhancedText(query));
    if (!cache?.autonomous || cache.autonomousCountry === 'ALL') {
        return { ok: false, error: 'Country-guided discovery is not active.' };
    }
    const ids = new Set((profileImageIds || [])
        .map(id => String(id || '').toLowerCase())
        .filter(id => /^[a-f0-9]{24}$/.test(id)));
    const verified = cache.expansion.countryVerifiedImageIds || new Set();
    const boosts = cache.expansion.countryBoostTokens || new Map();
    let added = 0;
    for (const person of cache.people) {
        const imageId = String(person.profileImageId || '').toLowerCase();
        if (!ids.has(imageId) || verified.has(imageId)) continue;
        verified.add(imageId);
        added++;
        for (const token of enhancedTokens(enhancedRecordText(person))) {
            boosts.set(token, (boosts.get(token) || 0) + 1);
        }
    }
    cache.expansion.countryVerifiedImageIds = verified;
    cache.expansion.countryBoostTokens = boosts;
    enhancedLog('country GPS signals added', { country: cache.autonomousCountry, added, verified: verified.size, boostedTerms: boosts.size });
    return { ok: true, added, verified: verified.size };
}

function broadcastEnhancedExpansion(cache, options = {}) {
    chrome.runtime.sendMessage({
        action: 'enhancedExpansionUpdate',
        query: cache.query,
        mode: cache.mode,
        response: enhancedSearchResponse(cache, { responseLimit: options.travel ? 2000 : 10000 })
    }).catch(() => {});
}

async function runEnhancedExpansion(query, requestedConcurrency = ENHANCED_EXPANSION_CONCURRENCY, options = {}) {
    const cache = enhancedSearchCache.get(normalizeEnhancedText(query));
    if (!cache) throw new Error('Search expired; run the VSCO search again.');
    if (cache.expansion.active) throw new Error('An expansion batch is already running.');
    const seedTerms = [...new Set(cache.apiQueries.flatMap(enhancedTokens).concat(cache.apiQueries.map(normalizeEnhancedText)).filter(Boolean))];
    const classicTravel = options.travel && options.originalEngine;
    const baseTerms = options.travel && !classicTravel
        ? [...new Set(cache.images.concat(cache.people).flatMap(item => enhancedTokens(enhancedRecordText(item))))].filter(token => !seedTerms.includes(token))
        : seedTerms;
    const imageMap = new Map(cache.images.map(item => [item.id, item]));
    const peopleMap = new Map(cache.people.map(item => [item.id, item]));
    const candidateScores = new Map();
    if (options.travel && !classicTravel) enhancedAddTravelCandidates(cache.images.concat(cache.people), cache.excludedTerms, candidateScores);
    else enhancedAddCandidates(cache.images.concat(cache.people), baseTerms, candidateScores);
    if (options.travel) {
        cache.expansion.travelSeedScanned = cache.images.length + cache.people.length;
        cache.expansion.travelCandidates = candidateScores.size;
        cache.expansion.travelInsights = buildTravelInsights(cache.images.concat(cache.people), options.travelWindowMs ?? 0);
    }
    const queued = new Set(cache.expansion.completedQueries);
    const queue = [];
    const queueCandidates = () => {
        [...candidateScores.values()]
            .sort((a, b) => {
                const ay = Number(cache.expansion.travelQueryYield?.get(a.token) || 0);
                const by = Number(cache.expansion.travelQueryYield?.get(b.token) || 0);
                const ab = Number(cache.expansion.countryBoostTokens?.get(a.token) || 0);
                const bb = Number(cache.expansion.countryBoostTokens?.get(b.token) || 0);
                return ((b.score + (bb * 5)) / (1 + by)) - ((a.score + (ab * 5)) / (1 + ay)) || bb - ab || b.score - a.score || a.token.localeCompare(b.token);
            })
            .slice(0, ENHANCED_EXPANSION_MAX_CANDIDATES)
            .forEach(({ term, token }) => ((options.travel && !classicTravel) ? [token] : [`${term} ${token}`, `${token} ${term}`]).forEach(candidate => {
                const normalized = normalizeEnhancedText(candidate);
                if (!normalized || (options.travel ? seedTerms : baseTerms).includes(normalized) || queued.has(normalized)) return;
                queued.add(normalized);
                queue.push(candidate);
            }));
    };
    queueCandidates();
    const batchQueries = queue.slice(0, ENHANCED_EXPANSION_MAX_QUERIES);
    enhancedLog('travel batch queued', { mode: cache.mode, travel: Boolean(options.travel), windowMs: options.travelWindowMs ?? 0, candidates: candidateScores.size, queries: batchQueries.length, completed: queued.size });
    const concurrency = Math.min(Math.max(Number(requestedConcurrency) || ENHANCED_EXPANSION_CONCURRENCY, 1), 12);
    const active = {
        queries: batchQueries,
        workers: Math.min(concurrency, Math.max(1, batchQueries.length)),
        completed: 0,
        cancelled: false,
        controllers: new Set()
    };
    cache.expansion.active = active;
    let cursor = 0;
    let addedImages = 0;
    let addedPeople = 0;
    let duplicates = 0;
    let rejected = 0;
    const worker = async () => {
        while (!active.cancelled) {
            const queryIndex = cursor++;
            if (queryIndex >= batchQueries.length) return;
            const partitionQuery = batchQueries[queryIndex];
            const anchor = enhancedTokens(partitionQuery).find(token => !baseTerms.includes(token)) || '';
            const encoded = encodeURIComponent(partitionQuery);
            const controller = new AbortController();
            active.controllers.add(controller);
            let imageData = null;
            let gridData = null;
            try {
                imageData = cache.mode === 'images'
                    ? await fetchWithRetry(`https://vsco.co/api/2.0/search/images?query=${encoded}&size=10000`, { signal: controller.signal })
                    : null;
                gridData = cache.mode === 'people'
                    ? await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encoded}&page=0&size=10000`, { skipGridPacing: true, signal: controller.signal })
                    : null;
            } finally {
                active.controllers.delete(controller);
            }
            if (active.cancelled) return;
            const newImages = [];
            const newPeople = [];
            const inTargetWindow = item => !options.travelWindowMs || (item.timestamp > 0 && Date.now() - item.timestamp <= options.travelWindowMs);
            for (const item of (imageData?.results || []).map(mapLocalImage).filter(item => item.id && item.imageUrl)) {
                if (enhancedMatchesExcluded(item, cache.excludedTerms)) { rejected++; continue; }
                if ((!options.travel || classicTravel) && anchor && !enhancedRecordText(item).includes(anchor)) { rejected++; continue; }
                if (!inTargetWindow(item)) continue;
                if (!imageMap.has(item.id)) { imageMap.set(item.id, item); newImages.push(item); } else duplicates++;
            }
            for (const item of (gridData?.results || gridData?.grids || []).map(mapLocalPerson).filter(item => item.id)) {
                if (enhancedMatchesExcluded(item, cache.excludedTerms)) { rejected++; continue; }
                if ((!options.travel || classicTravel) && anchor && !enhancedRecordText(item).includes(anchor)) { rejected++; continue; }
                if (!inTargetWindow(item)) continue;
                if (!peopleMap.has(item.id)) { peopleMap.set(item.id, item); newPeople.push(item); } else duplicates++;
            }
            addedImages += newImages.length;
            addedPeople += newPeople.length;
            if (options.travel) cache.expansion.travelQueryYield.set(normalizeEnhancedText(partitionQuery), newImages.length + newPeople.length);
            if (options.travel && !classicTravel) enhancedAddTravelCandidates(newImages.concat(newPeople), cache.excludedTerms, candidateScores);
            else enhancedAddCandidates(newImages.concat(newPeople), baseTerms, candidateScores);
            if (options.travel) broadcastEnhancedExpansion(cache, options);
            cache.expansion.completedQueries.add(normalizeEnhancedText(partitionQuery));
            active.completed++;
        }
    };
    try {
        await Promise.all(Array.from({ length: active.workers }, worker));
    } finally {
        cache.images = [...imageMap.values()].sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
        cache.people = [...peopleMap.values()].sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
        const lastBatch = {
            status: active.cancelled ? 'cancelled' : (batchQueries.length ? 'complete' : 'exhausted'),
            queued: batchQueries.length,
            completed: active.completed,
            workers: active.workers,
            queries: batchQueries,
            addedImages,
            addedPeople,
            duplicates,
            rejected
        };
        cache.expansion.batches++;
        cache.expansion.requestsCompleted += active.completed;
        cache.expansion.addedImages += addedImages;
        cache.expansion.addedPeople += addedPeople;
        cache.expansion.duplicates += duplicates;
        cache.expansion.rejected += rejected;
        cache.expansion.lastBatch = lastBatch;
        enhancedLog('travel batch complete', { mode: cache.mode, travel: Boolean(options.travel), status: lastBatch.status, completed: active.completed, addedImages, addedPeople, duplicates, rejected, vocabulary: candidateScores.size });
        if (options.travel) cache.expansion.travelCandidates = candidateScores.size;
        if (options.travel) cache.expansion.travelInsights = buildTravelInsights(cache.images.concat(cache.people), options.travelWindowMs ?? 0);
        if (options.travel) persistTravelSession(cache);
        cache.expansion.active = null;
    }
    return enhancedSearchResponse(cache, { responseLimit: options.travel ? 2000 : 10000 });
}

function getEnhancedExpansionStatus(query) {
    const cache = enhancedSearchCache.get(normalizeEnhancedText(query));
    if (!cache) return { ok: false, error: 'Search expired; run the VSCO search again.' };
    return { ok: true, expansion: serializeEnhancedExpansion(cache) };
}

function cancelEnhancedExpansion(query) {
    const cache = enhancedSearchCache.get(normalizeEnhancedText(query));
    const active = cache?.expansion?.active;
    if (!active) return { ok: true, cancelled: false, expansion: cache ? serializeEnhancedExpansion(cache) : null };
    active.cancelled = true;
    active.controllers.forEach(controller => controller.abort());
    return { ok: true, cancelled: true, expansion: serializeEnhancedExpansion(cache) };
}

const ENHANCED_WATCH_ALARM = 'enhancedVscoSavedSearches';
const ENHANCED_WATCH_PERIOD_MINUTES = 30;
const ENHANCED_WATCH_MAX_SEARCHES = 10;
const ENHANCED_WATCH_MAX_SEEDS = 1;
const ENHANCED_WATCH_FETCH_SIZE = 10000;
const ENHANCED_WATCH_KNOWN_IDS = 500;

function enhancedWatchId(mode, query) {
    return `${mode === 'people' ? 'people' : 'images'}:${normalizeEnhancedText(query)}`;
}

async function getEnhancedSavedSearches() {
    const stored = await chrome.storage.local.get({ enhancedVscoSavedSearches: [] });
    return Array.isArray(stored.enhancedVscoSavedSearches) ? stored.enhancedVscoSavedSearches : [];
}

async function syncEnhancedWatchAlarm() {
    const searches = await getEnhancedSavedSearches();
    if (searches.some(search => search.enabled)) {
        chrome.alarms.create(ENHANCED_WATCH_ALARM, { periodInMinutes: ENHANCED_WATCH_PERIOD_MINUTES });
    } else {
        chrome.alarms.clear(ENHANCED_WATCH_ALARM);
    }
}

async function toggleEnhancedSavedSearch(request) {
    const mode = request.mode === 'people' ? 'people' : 'images';
    const query = String(request.query || '').trim();
    if (!query) throw new Error('Empty saved search.');
    const id = enhancedWatchId(mode, query);
    const searches = await getEnhancedSavedSearches();
    const existing = searches.find(search => search.id === id);
    const enabled = request.enabled !== undefined ? Boolean(request.enabled) : !existing?.enabled;
    if (!existing && enabled && searches.length >= ENHANCED_WATCH_MAX_SEARCHES) {
        throw new Error(`Saved-search notifications are capped at ${ENHANCED_WATCH_MAX_SEARCHES}.`);
    }
    if (existing) {
        existing.enabled = enabled;
        existing.updatedAt = Date.now();
        if (Array.isArray(request.baselineIds) && request.baselineIds.length) {
            existing.knownIds = [...new Set(request.baselineIds.map(String))].slice(0, ENHANCED_WATCH_KNOWN_IDS);
        }
    } else {
        searches.push({
            id,
            mode,
            query,
            enabled,
            knownIds: [...new Set((request.baselineIds || []).map(String))].slice(0, ENHANCED_WATCH_KNOWN_IDS),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastCheckedAt: null,
            lastError: null
        });
    }
    await chrome.storage.local.set({ enhancedVscoSavedSearches: searches });
    await syncEnhancedWatchAlarm();
    return { ok: true, enabled, id, periodMinutes: ENHANCED_WATCH_PERIOD_MINUTES };
}

async function fetchEnhancedWatchItems(search) {
    const syntax = enhancedSearchSyntax(search.query);
    const apiQueries = syntax.apiQueries.slice(0, ENHANCED_WATCH_MAX_SEEDS);
    const items = new Map();
    for (const apiQuery of apiQueries) {
        const encoded = encodeURIComponent(apiQuery);
        const data = search.mode === 'people'
            ? await fetchWithRetry(`https://vsco.co/api/2.0/search/grids?query=${encoded}&page=0&size=${ENHANCED_WATCH_FETCH_SIZE}`, { skipGridPacing: true })
            : await fetchWithRetry(`https://vsco.co/api/2.0/search/images?query=${encoded}&size=${ENHANCED_WATCH_FETCH_SIZE}`);
        const mapped = search.mode === 'people'
            ? (data?.results || data?.grids || []).map(mapLocalPerson).filter(item => item.id)
            : (data?.results || []).map(mapLocalImage).filter(item => item.id && item.imageUrl);
        mapped.forEach(item => { if (!enhancedMatchesExcluded(item, syntax.excludedTerms)) items.set(item.id, item); });
    }
    return [...items.values()].sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
}

async function runEnhancedSavedSearchChecks() {
    const searches = await getEnhancedSavedSearches();
    let changed = false;
    for (const search of searches.filter(item => item.enabled)) {
        try {
            const items = await fetchEnhancedWatchItems(search);
            const known = new Set((search.knownIds || []).map(String));
            const firstKnownIndex = items.findIndex(item => known.has(String(item.id)));
            const newItems = firstKnownIndex > 0 ? items.slice(0, firstKnownIndex) : [];
            search.knownIds = [...new Set(items.map(item => String(item.id)).concat(search.knownIds || []))].slice(0, ENHANCED_WATCH_KNOWN_IDS);
            search.lastCheckedAt = Date.now();
            search.lastError = null;
            changed = true;
            if (known.size && newItems.length) {
                const notificationId = `vsco-watch:${search.id}:${Date.now()}`;
                await chrome.notifications.create(notificationId, {
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL('images/layers.png'),
                    title: `${newItems.length.toLocaleString()} new VSCO ${search.mode}`,
                    message: `New results for “${search.query}”`,
                    contextMessage: `Checked every ${ENHANCED_WATCH_PERIOD_MINUTES} minutes`
                });
            }
        } catch (error) {
            search.lastCheckedAt = Date.now();
            search.lastError = error?.message || 'Saved search check failed.';
            changed = true;
        }
    }
    if (changed) await chrome.storage.local.set({ enhancedVscoSavedSearches: searches });
}

chrome.runtime.onInstalled.addListener(syncEnhancedWatchAlarm);
chrome.runtime.onStartup.addListener(syncEnhancedWatchAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enhancedVscoSavedSearches) syncEnhancedWatchAlarm();
});
chrome.notifications.onClicked.addListener(notificationId => {
    if (!notificationId.startsWith('vsco-watch:')) return;
    const parts = notificationId.split(':');
    const mode = parts[1] === 'people' ? 'people' : 'images';
    const query = parts.slice(2, -1).join(':');
    chrome.tabs.create({ url: `https://vsco.co/search/${mode}/${encodeURIComponent(query)}` });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'enhancedVscoExportFollowing') {
        fetchFollowingProfiles()
            .then(async profiles => { const result = { ok: true, exportedAt: new Date().toISOString(), count: profiles.length, profiles }; await chrome.storage.local.set({ vscoTubFollowingExport: result }); sendResponse(result); })
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (request.action === 'enhancedVscoAccountContext') {
        const senderUrl = String(sender.tab?.url || sender.url || '');
        if (!senderUrl.startsWith('https://vsco.co/')) {
            sendResponse({ ok: false, error: 'Account context is only available on VSCO pages.' });
            return false;
        }
        fetchVscoAccountContext()
            .then(context => sendResponse({ ok: true, context }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (request.action === 'enhancedVscoDescriptorGrpcCall') {
        const senderUrl = String(sender.tab?.url || sender.url || '');
        const service = String(request.service || '');
        const method = String(request.method || '');
        const body = String(request.body || '');
        if (!senderUrl.startsWith('https://vsco.co/') || !body || body.length > 1000000) {
            sendResponse({ ok: false, error: 'Descriptor RPC request rejected.' });
            return false;
        }
        sendDescriptorGrpc(service, method, body, request.confirmed, request.allowUnsafeAll === true)
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (request.action === 'enhancedVscoResolveToolContext') {
        const senderUrl = String(sender.tab?.url || sender.url || '');
        if (!senderUrl.startsWith('https://vsco.co/')) {
            sendResponse({ ok: false, error: 'Context resolution is only available on VSCO pages.' });
            return false;
        }
        resolveVscoToolContext(request.context || {})
            .then(context => sendResponse({ ok: true, context }))
            .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (request.action === 'enhancedVscoMediaGrpcRead') {
        const senderUrl = String(sender.tab?.url || sender.url || '');
        const path = String(request.path || '');
        const body = String(request.body || '');
        if (!senderUrl.startsWith('https://vsco.co/') || !MEDIA_GRPC_READ_PATHS.has(path) || !body || body.length > MAX_MEDIA_GRPC_READ_BODY_CHARACTERS) {
            sendResponse({ ok: false, error: 'Media gRPC request rejected.' });
            return false;
        }
        getVscoGrpcAuthorization().then(authorization => {
            if (!authorization) {
                sendResponse({ ok: false, error: 'Waiting for fresh VSCO authorization. Reload an authenticated VSCO page first.' });
                return;
            }
            return fetch(`https://media-grpc-api.vsco.co${path}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    accept: 'application/grpc-web-text',
                    authorization,
                    ...Object.fromEntries(capturedVscoGrpcHeaders),
                    'content-type': 'application/grpc-web-text',
                    'x-client-platform': capturedVscoGrpcHeaders.get('x-client-platform') || 'web',
                    'x-grpc-web': '1',
                    'x-user-agent': 'grpc-web-javascript/0.1'
                },
                body
            }).then(async response => {
                const grpcStatus = response.headers.get('grpc-status');
                const grpcMessage = response.headers.get('grpc-message') || '';
                sendResponse({
                    ok: response.ok && (!grpcStatus || grpcStatus === '0'),
                    httpStatus: response.status,
                    contentType: response.headers.get('content-type') || '',
                    grpcStatus,
                    grpcMessage,
                    body: await response.text(),
                    error: grpcMessage || (response.ok ? '' : `HTTP ${response.status}`)
                });
            });
        }).catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (request.action === 'enhancedVscoInteractionGrpcRead') {
        const senderUrl = String(sender.tab?.url || sender.url || '');
        const path = String(request.path || '');
        const body = String(request.body || '');
        if (!senderUrl.startsWith('https://vsco.co/') || !INTERACTION_GRPC_READ_PATHS.has(path) || !body || body.length > 100000) {
            sendResponse({ ok: false, error: 'Interaction gRPC request rejected.' });
            return false;
        }
        getVscoGrpcAuthorization().then(authorization => {
            if (!authorization) {
                sendResponse({ ok: false, error: 'Waiting for fresh VSCO authorization. Reload an authenticated VSCO page first.' });
                return;
            }
            return fetch(`https://interaction-api-grpc.vsco.co${path}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    accept: 'application/grpc-web-text',
                    authorization,
                    ...Object.fromEntries(capturedVscoGrpcHeaders),
                    'content-type': 'application/grpc-web-text',
                    'x-client-platform': capturedVscoGrpcHeaders.get('x-client-platform') || 'web',
                    'x-grpc-web': '1',
                    'x-user-agent': 'grpc-web-javascript/0.1'
                },
                body
            }).then(async response => {
                const grpcStatus = response.headers.get('grpc-status');
                const grpcMessage = response.headers.get('grpc-message') || '';
                sendResponse({
                    ok: response.ok && (!grpcStatus || grpcStatus === '0'),
                    httpStatus: response.status,
                    contentType: response.headers.get('content-type') || '',
                    grpcStatus,
                    grpcMessage,
                    body: await response.text(),
                    error: grpcMessage || (response.ok ? '' : `HTTP ${response.status}`)
                });
            });
        }).catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
        return true;
    }
    if (request.action === 'enhancedVscoSearch') {
        runEnhancedVscoSearch(request.query, request.mode)
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error.message || 'VSCO search failed.' }));
        return true;
    }
    if (request.action === 'enhancedVscoAutonomousProfiles') {
        startAutonomousProfileDiscovery(request.country)
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error.message || 'Autonomous profile discovery failed.' }));
        return true;
    }
    if (request.action === 'enhancedVscoCountrySignals') {
        sendResponse(addAutonomousCountrySignals(request.query, request.profileImageIds));
        return false;
    }
    if (request.action === 'enhancedVscoExpand') {
        runEnhancedExpansion(request.query, request.workers, { travel: request.travel === true, originalEngine: request.originalEngine === true, travelWindowMs: Number(request.travelWindowMs) || 0 })
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error.message || 'VSCO expansion failed.' }));
        return true;
    }
    if (request.action === 'enhancedVscoExpansionStatus') {
        sendResponse(getEnhancedExpansionStatus(request.query));
        return false;
    }
    if (request.action === 'enhancedVscoExpansionCancel') {
        sendResponse(cancelEnhancedExpansion(request.query));
        return false;
    }
    if (request.action === 'enhancedVscoSavedSearchToggle') {
        toggleEnhancedSavedSearch(request)
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error.message || 'Could not update saved search.' }));
        return true;
    }
    if (request.action === 'enhancedVscoFollowToggle') {
        toggleEnhancedVscoFollow(request.siteId)
            .then(sendResponse)
            .catch(error => sendResponse({ ok: false, error: error.message || 'Could not update follow state.' }));
        return true;
    }
    if (request.action === 'localApiRequest') {
        const senderUrl = String(sender.url || sender.tab?.url || '');
        if (!/^http:\/\/(127\.0\.0\.1|localhost):(5058|8765)\//.test(senderUrl)) {
            sendResponse({ ok: false, error: 'Local bridge rejected this page.' });
            return false;
        }
        const target = String(request.url || '');
        if (!target.startsWith('https://vsco.co/api/')) {
            sendResponse({ ok: false, error: 'Only VSCO API requests are allowed.' });
            return false;
        }
        fetch(target, { method: 'GET', credentials: 'include' })
            .then(async response => ({ ok: response.ok, status: response.status, body: await response.text() }))
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ ok: false, error: error.message || 'VSCO request failed.' }));
        return true;
    }
    if (request.action === 'localAppHealth' || request.action === 'localAppSearch') {
        const senderUrl = String(sender.url || sender.tab?.url || '');
        if (!/^http:\/\/(127\.0\.0\.1|localhost):5058\//.test(senderUrl)) {
            sendResponse({ ok: false, error: 'Local bridge rejected this page.' });
            return false;
        }

        if (request.action === 'localAppHealth') {
            sendResponse({ ok: true });
            return false;
        }

        runLocalAppSearch(request)
            .then(result => sendResponse({ ok: true, ...result }))
            .catch(error => sendResponse({ ok: false, error: error.message || 'Search failed.' }));
        return true;
    }

    if (request.action === "fetchVscoProfileAvatar" || request.action === "scrapeVscoSocialProfile") {
        const username = String(request.username || "").trim().replace(/^@/, "").toLowerCase();
        if (!username || !/^[a-z0-9._-]+$/i.test(username)) {
            sendResponse({ success: false, error: "Invalid username" });
            return false;
        }

        fetchVscoProfileAvatar(username)
            .then(profile => sendResponse({ success: true, username, saved: request.action === "scrapeVscoSocialProfile", ...profile }))
            .catch(error => {
                console.warn(`Background: VSCO profile fetch failed for ${username}:`, error);
                sendResponse({ success: false, username, error: error.message || "VSCO profile fetch failed" });
            });
        return true;
    }

    if (request.action === "openVscoFeed") {
        chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
        sendResponse({ success: true });
        return false;
    }
});

chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
});
