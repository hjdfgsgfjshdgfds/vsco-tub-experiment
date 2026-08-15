// Experimental VSCO search replacement.
// It leaves the normal VSCO search bar and URLs intact, but replaces the
// native result batch with a progressively-rendered, newest-first result set.

(function () {
    const ROOT_ID = 'vsco-tub-search-root';
    const STYLE_ID = 'vsco-tub-search-style';
    const AUTONOMOUS_PROFILE_DISCOVERY_KEY = '__vsco_tub_discover_profiles__';
    let activeKey = '';
    let state = null;
    let searchSettings = {
        expansionEnabled: false,
        autonomousCountry: 'ALL',
        gallerySize: 'medium',
        profileImageMode: 'avatar',
        profileImageAspect: 'crop',
        imageAspect: 'crop',
        showImageDescriptions: true,
        showUsernames: true,
        showProfileImages: true,
        showProfileBio: true,
        showProfileBioLength: false,
        showProfileLink: false,
        showMediaLink: false,
        showImageId: false,
        showProfileImageUrl: false,
        showProfileImageId: false,
        showProfileSiteId: false,
        showPostedAge: false,
        sortOrder: 'newest',
        timeWindow: 'all',
        metadataStatus: 'all',
        metadataGps: 'all',
        metadataExif: 'all',
        metadataCamera: '',
        metadataSoftware: '',
        metadataQuery: '',
        metadataCountry: '',
        profileAspect: 'all',
        groupImagesBy: 'none',
        batchSize: 60,
        expansionWorkers: 6,
        developerMode: false
    };
    let settingsReady = Promise.resolve();
    let savedImages = new Map();
    let savedProfiles = new Map();
    let watchedSearchIds = new Set();
    let watchedSearchDetails = new Map();
    let collectionFilter = 'all';
    const resultCache = new Map();
    let contextMenuGuardInstalled = false;
    let guardedInputState = null;
    let searchInputGuardInstalled = false;
    const grpcPending = new Map();
    let grpcProbeStatus = 'Not run';
    const grpcCheckedImageIds = new Set();
    const grpcQueuedImageIds = new Set();
    let grpcViewportObserver = null;
    let grpcViewportTimer = null;
    let grpcViewportRunning = false;
    let grpcProbeStopRequested = false;
    let grpcForceMediaProbe = false;
    let grpcAutoProbeKey = '';
    let grpcMetadataRequestsCompleted = 0;
    const TUB_LOGGING_ENABLED = true;
    function tubLog(event, details = {}) {
        if (!TUB_LOGGING_ENABLED) return;
        try {
            console.info('[VSCO Tub]', event, details);
        } catch (_) { /* logging must never affect search */ }
    }
    // VSCO accepts a 10k-ID FetchImages body but live testing returned only
    // 3,880 records for 9,892 requested IDs. Keep 1k batches for coverage;
    // these consistently return approximately 999 records per request.
    const GRPC_IMAGE_SEARCH_BATCH_SIZE = 1000;
    const GRPC_PROFILE_BATCH_SIZE = 1000;
    const GRPC_IMAGE_SEARCH_WORKERS = 10;
    const GRPC_PROFILE_SEARCH_WORKERS = 4;
    const GRPC_IMAGE_PROBE_MAX = 10000;
    const GRPC_IMAGE_PROBE_DEFAULT = 1000;
    const grpcImageRecords = new Map();
    const pfpChangesBySite = new Map();
    let pfpCheckStatus = 'Not checked';
    let pfpSnapshotDbPromise = null;
    function openPfpSnapshotDb() {
        if (pfpSnapshotDbPromise) return pfpSnapshotDbPromise;
        pfpSnapshotDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('VSCO_Tub_PFP_Snapshots', 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains('profiles')) request.result.createObjectStore('profiles', { keyPath: 'siteId' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        return pfpSnapshotDbPromise;
    }
    async function savePfpSnapshots(items) {
        const profiles = (items || []).map(item => ({
            siteId: String(item.siteId || ''), username: item.username || '',
            profileImageId: metadataImageId(item), profileImageUrl: item.profileImageUrl || item.imageUrl || '', checkedAt: Date.now()
        })).filter(item => item.siteId && item.profileImageId);
        if (!profiles.length) return;
        const db = await openPfpSnapshotDb();
        const tx = db.transaction('profiles', 'readwrite');
        profiles.forEach(profile => tx.objectStore('profiles').put(profile));
    }
    async function checkPfpChanges() {
        const previousState = state;
        if (!state) state = { mode: 'people', response: {}, rawItems: [], items: [], root: null, list: null };
        if (state.mode !== 'people') { state = previousState; return; }
        const db = await openPfpSnapshotDb();
        const snapshots = await new Promise((resolve, reject) => { const r = db.transaction('profiles').objectStore('profiles').getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error); });
        const ids = [...new Set(snapshots.map(item => item.profileImageId).filter(Boolean))].slice(0, 10000);
        if (!ids.length) { pfpCheckStatus = 'No saved profile-image IDs yet'; renderExpansionDetails(); state = previousState; return; }
        grpcProbeStopRequested = false; grpcForceMediaProbe = true; pfpCheckStatus = `Checking ${ids.length.toLocaleString()} saved profile images…`; renderExpansionDetails();
        queueViewportGrpc(ids);
        await new Promise(resolve => { const timer = setInterval(() => { if (!grpcViewportRunning && !grpcQueuedImageIds.size) { clearInterval(timer); resolve(); } }, 250); });
        let changed = 0;
        snapshots.forEach(snapshot => { const record = grpcImageRecords.get(snapshot.profileImageId); if (!record) return; const currentUrl = record.responsiveUrl || record.imageUrl || ''; const different = String(record.id || '') !== snapshot.profileImageId || (currentUrl && snapshot.profileImageUrl && currentUrl !== snapshot.profileImageUrl); if (different) { pfpChangesBySite.set(snapshot.siteId, { status: 'changed', username: snapshot.username }); changed++; } else pfpChangesBySite.set(snapshot.siteId, { status: 'unchanged', username: snapshot.username }); });
        grpcForceMediaProbe = false;
        pfpCheckStatus = `PFP check complete · ${changed.toLocaleString()} changed · ${snapshots.length.toLocaleString()} saved · failures/unavailable shown as unknown`;
        renderExpansionDetails();
        state = previousState;
    }
    const countrySignaledImageIds = new Set();
    const reactionStateByMedia = new Map();
    let grpcSuiteResults = [];
    let grpcSuiteStopRequested = false;
    let continuousExpansionRunning = false;
    let signedInAccountContextPromise = null;
    async function sendRuntimeMessage(request, retries = 1) {
        try {
            return await chrome.runtime.sendMessage(request);
        } catch (error) {
            const message = String(error?.message || error);
            if (retries > 0 && /message channel closed|receiving end does not exist|asynchronous response/i.test(message)) {
                await new Promise(resolve => setTimeout(resolve, 250));
                return sendRuntimeMessage(request, retries - 1);
            }
            throw error;
        }
    }

    function userFacingRuntimeError(error, fallback = 'VSCO request failed.') {
        const message = String(error?.message || error || fallback);
        if (/message channel closed|receiving end does not exist|asynchronous response/i.test(message)) {
            return 'Tub is reconnecting to its background worker. Try the action again in a moment.';
        }
        return message || fallback;
    }
    const grpcSchemaPromise = fetch(chrome.runtime.getURL('docs/vsco-grpc-schema.json')).then(response => {
        if (!response.ok) throw new Error(`Could not load gRPC schema: HTTP ${response.status}`);
        return response.json();
    });

    window.addEventListener('vsco-tub-grpc-response', event => {
        const detail = event.detail || {};
        const pending = grpcPending.get(detail.requestId);
        if (!pending) return;
        grpcPending.delete(detail.requestId);
        clearTimeout(pending.timer);
        pending.resolve(detail);
    });

    chrome.runtime.onMessage.addListener(message => {
        if (message?.action !== 'enhancedExpansionUpdate' || !state || message.query !== currentSearch()?.query) return;
        resultCache.set(`${state.mode}:${message.query}`, message.response);
        renderResults(state.mode, message.response);
    });

    function grpcRead(path, body, origin = '') {
        if (path.startsWith('/interaction.InteractionGrpc/')) {
            return sendRuntimeMessage({ action: 'enhancedVscoInteractionGrpcRead', path, body });
        }
        if (path.startsWith('/media.Media/')) {
            return sendRuntimeMessage({ action: 'enhancedVscoMediaGrpcRead', path, body });
        }
        const requestId = `vsco-tub-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                grpcPending.delete(requestId);
                resolve({ ok: false, error: 'Browser-context RPC timed out.' });
            }, 15000);
            grpcPending.set(requestId, { resolve, timer });
            window.dispatchEvent(new CustomEvent('vsco-tub-grpc-request', {
                detail: { requestId, path, body, origin }
            }));
        });
    }

    function varint(value) {
        let current = BigInt(value);
        const bytes = [];
        do {
            let byte = Number(current & 0x7fn);
            current >>= 7n;
            if (current) byte |= 0x80;
            bytes.push(byte);
        } while (current);
        return bytes;
    }

    function protobufString(field, value) {
        const bytes = [...new TextEncoder().encode(String(value))];
        return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
    }

    function protobufBool(field, value) {
        return [...varint(field << 3), value ? 1 : 0];
    }

    function protobufInt(field, value) {
        return [...varint(field << 3), ...varint(value)];
    }

    function protobufMessage(field, bytes) {
        return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
    }

    function protobufDouble(field, value) {
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setFloat64(0, Number(value), true);
        return [...varint((field << 3) | 1), ...bytes];
    }

    function protobufBytes(field, value) {
        const raw = typeof value === 'string' ? value : value?.base64;
        if (!raw) return [];
        const bytes = Uint8Array.from(atob(raw), character => character.charCodeAt(0));
        return protobufMessage(field, [...bytes]);
    }

    function encodeMessageWithSchema(messageName, input, schema) {
        const message = schema.messages?.[messageName];
        if (!message) throw new Error(`Missing request schema ${messageName}`);
        const output = [];
        for (const field of message.fields || []) {
            let values = input?.[field.name];
            if (values === undefined || values === null || values === '') continue;
            values = field.repeated && Array.isArray(values) ? values : [values];
            for (const value of values) {
                if (field.resolvedType) output.push(...protobufMessage(field.number, encodeMessageWithSchema(field.resolvedType, value, schema)));
                else if (field.type === 'String') output.push(...protobufString(field.number, value));
                else if (field.type === 'Bool') output.push(...protobufBool(field.number, Boolean(value)));
                else if (field.type === 'Double') output.push(...protobufDouble(field.number, value));
                else if (field.type === 'Bytes' || (!['Int32', 'Int64', 'Uint32', 'Uint64', 'Sint32', 'Sint64', 'Enum'].includes(field.type))) output.push(...protobufBytes(field.number, value));
                else if (field.type === 'Sint32' || field.type === 'Sint64') {
                    const integer = BigInt(value);
                    output.push(...protobufInt(field.number, (integer << 1n) ^ (integer >> 63n)));
                } else output.push(...protobufInt(field.number, value));
            }
        }
        return output;
    }

    function descriptorRequestTemplate(method, context = {}) {
        const actorSiteMethods = new Set([
            'CreateFavorite', 'DeleteFavorite', 'CreateRepost', 'DeleteRepost',
            'GetReactionsForMedia', 'GetReactionsForMedias'
        ]);
        const valueFor = name => {
            if (name === 'id') return context.imageId || context.collectionId || context.articleId || '';
            if (name === 'imageId' || name === 'mediaId') return context.imageId || '';
            if (name === 'siteId') return actorSiteMethods.has(method.method) ? (context.viewerSiteId || '') : (context.siteId || '');
            if (name === 'uploaderSiteId') return context.siteId || '';
            if (name === 'collectorSiteId') return context.collectorSiteId || '';
            if (name === 'userId') return context.userId || '';
            if (name === 'collectionId') return context.collectionId || '';
            if (name === 'albumId') return context.albumId || '';
            if (name === 'articleId') return context.articleId || '';
            if (name === 'permalink') return context.permalink || '';
            if (name === 'tag') return context.tag || '';
            if (name === 'idsList') return context.imageId ? [context.imageId] : [];
            if (name === 'limit') return Number(context.limit || 2);
            if (name === 'includeSite' || name === 'fetchHasActivity') return true;
            return '';
        };
        return Object.fromEntries((method.request?.fields || []).map(field => [field.name, valueFor(field.name)]).filter(([, value]) => value !== '' && (!Array.isArray(value) || value.length)));
    }

    function grpcWebText(payload) {
        const framed = new Uint8Array(5 + payload.length);
        new DataView(framed.buffer).setUint32(1, payload.length, false);
        framed.set(payload, 5);
        let binary = '';
        framed.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
    }

    function decodeBase64Parts(text) {
        const chunks = String(text || '').replace(/\s+/g, '').match(/[A-Za-z0-9+/]+={0,2}/g) || [];
        const arrays = chunks.map(chunk => Uint8Array.from(atob(chunk), character => character.charCodeAt(0)));
        const output = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0));
        let offset = 0;
        arrays.forEach(bytes => { output.set(bytes, offset); offset += bytes.length; });
        return output;
    }

    function readVarint(bytes, cursor) {
        let value = 0n;
        let shift = 0n;
        while (cursor.offset < bytes.length) {
            const byte = bytes[cursor.offset++];
            value |= BigInt(byte & 0x7f) << shift;
            if (!(byte & 0x80)) return value;
            shift += 7n;
            if (shift > 70n) throw new Error('Invalid protobuf varint');
        }
        throw new Error('Truncated protobuf varint');
    }

    function parseProtobuf(bytes) {
        const fields = new Map();
        const cursor = { offset: 0 };
        while (cursor.offset < bytes.length) {
            const key = readVarint(bytes, cursor);
            const number = Number(key >> 3n);
            const wire = Number(key & 7n);
            let value;
            if (wire === 0) value = readVarint(bytes, cursor);
            else if (wire === 1) { value = bytes.slice(cursor.offset, cursor.offset + 8); cursor.offset += 8; }
            else if (wire === 2) {
                const length = Number(readVarint(bytes, cursor));
                value = bytes.slice(cursor.offset, cursor.offset + length);
                cursor.offset += length;
            } else if (wire === 5) { value = bytes.slice(cursor.offset, cursor.offset + 4); cursor.offset += 4; }
            else throw new Error(`Unsupported protobuf wire type ${wire}`);
            if (cursor.offset > bytes.length) throw new Error('Truncated protobuf field');
            if (!fields.has(number)) fields.set(number, []);
            fields.get(number).push({ wire, value });
        }
        return fields;
    }

    const utf8Decoder = new TextDecoder();
    const firstField = (fields, number) => fields.get(number)?.[0];
    const textField = (fields, number) => {
        const field = firstField(fields, number);
        return field?.wire === 2 ? utf8Decoder.decode(field.value) : '';
    };
    const intField = (fields, number) => {
        const field = firstField(fields, number);
        return field?.wire === 0 ? field.value.toString() : '';
    };
    const boolField = (fields, number) => firstField(fields, number)?.value === 1n;
    const doubleField = (fields, number) => {
        const field = firstField(fields, number);
        if (field?.wire !== 1 || field.value.length !== 8) return null;
        return new DataView(field.value.buffer, field.value.byteOffset, 8).getFloat64(0, true);
    };

    function bytesToBase64(bytes) {
        let binary = '';
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary);
    }

    function rawFieldInventory(fields) {
        const output = {};
        for (const [number, values] of fields) {
            output[number] = values.map(field => {
                if (field.wire === 0) return { wireType: 0, kind: 'varint', value: field.value.toString() };
                const bytes = field.value;
                const raw = {
                    wireType: field.wire,
                    kind: field.wire === 1 ? 'fixed64' : field.wire === 5 ? 'fixed32' : 'length-delimited',
                    byteLength: bytes.length,
                    base64: bytesToBase64(bytes)
                };
                if (field.wire === 1 && bytes.length === 8) {
                    raw.doubleLittleEndian = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
                }
                if (field.wire === 2) {
                    const text = utf8Decoder.decode(bytes);
                    if (/^[\x09\x0a\x0d\x20-\x7e]{1,500}$/.test(text)) raw.utf8 = text;
                }
                return raw;
            });
        }
        return output;
    }

    function decodeSchemaScalar(fieldSchema, field, schema) {
        const type = fieldSchema?.type;
        if (fieldSchema?.resolvedType && field.wire === 2) {
            return decodeMessageWithSchema(fieldSchema.resolvedType, field.value, schema);
        }
        if (field.wire === 0) {
            if (type === 'Bool') return field.value !== 0n;
            if (type === 'Sint32' || type === 'Sint64') {
                const decoded = (field.value >> 1n) ^ (-(field.value & 1n));
                return decoded.toString();
            }
            return field.value.toString();
        }
        if (field.wire === 1 && field.value.length === 8) {
            const view = new DataView(field.value.buffer, field.value.byteOffset, 8);
            if (type === 'Double') return view.getFloat64(0, true);
            return { fixed64Base64: bytesToBase64(field.value) };
        }
        if (field.wire === 5 && field.value.length === 4) {
            const view = new DataView(field.value.buffer, field.value.byteOffset, 4);
            if (type === 'Float') return view.getFloat32(0, true);
            return { fixed32Base64: bytesToBase64(field.value) };
        }
        if (field.wire === 2) {
            if (type === 'String') return utf8Decoder.decode(field.value);
            if (type === 'Bytes') return { byteLength: field.value.length, base64: bytesToBase64(field.value) };
            return {
                unresolvedType: fieldSchema?.type || null,
                candidates: fieldSchema?.typeCandidates || [],
                byteLength: field.value.length,
                base64: bytesToBase64(field.value)
            };
        }
        return { wireType: field.wire, base64: bytesToBase64(field.value) };
    }

    function decodeMessageWithSchema(messageName, bytes, schema) {
        const messageSchema = schema.messages?.[messageName];
        const fields = parseProtobuf(bytes);
        if (!messageSchema) return {
            $type: messageName,
            $unresolved: true,
            $rawFields: rawFieldInventory(fields),
            $rawMessageBase64: bytesToBase64(bytes)
        };
        const decoded = { $type: messageName };
        const knownNumbers = new Set();
        for (const fieldSchema of messageSchema.fields || []) {
            knownNumbers.add(fieldSchema.number);
            const occurrences = fields.get(fieldSchema.number) || [];
            if (!occurrences.length) continue;
            const values = occurrences.map(field => decodeSchemaScalar(fieldSchema, field, schema));
            const enumType = messageName === 'interaction.Activity' && fieldSchema.name === 'reaction'
                ? 'interaction.Activity.ReactionType'
                : messageName === 'interaction.Activity' && fieldSchema.name === 'followStatus'
                    ? 'interaction.Activity.FollowStatus' : '';
            if (enumType) {
                const entries = schema.enums?.[enumType] || {};
                values.forEach((value, index) => {
                    const name = Object.entries(entries).find(([, number]) => String(number) === String(value))?.[0] || 'UNKNOWN';
                    values[index] = { value: String(value), name };
                });
            }
            decoded[fieldSchema.name] = fieldSchema.repeated ? values : values[0];
        }
        const unknown = new Map([...fields].filter(([number]) => !knownNumbers.has(number)));
        if (unknown.size) decoded.$unknownFields = rawFieldInventory(unknown);
        decoded.$rawFields = rawFieldInventory(fields);
        decoded.$rawMessageBase64 = bytesToBase64(bytes);
        return decoded;
    }

    function decodeCoords(bytes) {
        if (!bytes?.length) return null;
        const fields = parseProtobuf(bytes);
        const lat = doubleField(fields, 1);
        const lng = doubleField(fields, 2);
        return Number.isFinite(lat) && Number.isFinite(lng) ? {
            lat,
            lng,
            rawProtobufFields: rawFieldInventory(fields),
            rawMessageBase64: bytesToBase64(bytes)
        } : null;
    }

    function decodeImageMeta(bytes) {
        if (!bytes?.length) return null;
        const fields = parseProtobuf(bytes);
        return {
            aperture: doubleField(fields, 1),
            iso: intField(fields, 4),
            make: textField(fields, 5),
            model: textField(fields, 6),
            shutterSpeed: textField(fields, 7),
            whiteBalance: textField(fields, 8),
            preset: textField(fields, 9),
            location: decodeCoords(firstField(fields, 16)?.value),
            software: textField(fields, 17),
            rawProtobufFields: rawFieldInventory(fields),
            rawMessageBase64: bytesToBase64(bytes)
        };
    }

    function decodeDateTime(bytes) {
        if (!bytes?.length) return null;
        const fields = parseProtobuf(bytes);
        const seconds = intField(fields, 1);
        if (!seconds) return null;
        const milliseconds = Number(BigInt(seconds) * 1000n + BigInt(intField(fields, 2) || 0) / 1000000n);
        return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
    }

    function decodeGridImage(bytes) {
        const fields = parseProtobuf(bytes);
        return {
            id: textField(fields, 1),
            siteId: intField(fields, 2),
            userId: intField(fields, 3),
            updateDate: decodeDateTime(firstField(fields, 5)?.value),
            captureDate: decodeDateTime(firstField(fields, 6)?.value),
            uploadDate: decodeDateTime(firstField(fields, 7)?.value),
            imageMeta: decodeImageMeta(firstField(fields, 8)?.value),
            location: decodeCoords(firstField(fields, 9)?.value),
            showLocation: boolField(fields, 10),
            height: intField(fields, 11),
            width: intField(fields, 12),
            description: textField(fields, 13),
            permaSubdomain: textField(fields, 24),
            responsiveUrl: textField(fields, 27),
            rawProtobufFields: rawFieldInventory(fields),
            rawMessageBase64: bytesToBase64(bytes)
        };
    }

    async function decodeFetchImagesResponse(body) {
        const schema = await grpcSchemaPromise;
        const bytes = decodeBase64Parts(body);
        const images = [];
        const trailers = [];
        let offset = 0;
        while (offset + 5 <= bytes.length) {
            const flags = bytes[offset];
            const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false);
            const payload = bytes.slice(offset + 5, offset + 5 + length);
            if (payload.length !== length) throw new Error('Truncated gRPC-Web frame');
            if (flags & 0x80) trailers.push(utf8Decoder.decode(payload));
            else {
                const decodedResponse = decodeMessageWithSchema('media.FetchImagesResponse', payload, schema);
                (decodedResponse.imagesList || []).forEach(image => images.push(normalizeDecodedImage(image)));
            }
            offset += 5 + length;
        }
        return { images: images.filter(image => image.id), trailers };
    }

    function decodedDateTime(value) {
        if (!value?.sec) return null;
        const milliseconds = Number(BigInt(value.sec) * 1000n + BigInt(value.ns || 0) / 1000000n);
        return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
    }

    function normalizeDecodedCoords(value) {
        if (!value) return null;
        const lat = Number(value.lat);
        const lng = Number(value.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { ...value, lat, lng } : null;
    }

    function normalizeDecodedImage(image) {
        const imageMeta = image?.imageMeta ? {
            ...image.imageMeta,
            captureDate: decodedDateTime(image.imageMeta.captureDate),
            location: normalizeDecodedCoords(image.imageMeta.location)
        } : null;
        const location = normalizeDecodedCoords(image?.location) || imageMeta?.location;
        const country = location ? countryForCoords(location) : null;
        return {
            ...image,
            width: Number(image?.width || imageMeta?.width || image?.dimensions?.width || 0),
            height: Number(image?.height || imageMeta?.height || image?.dimensions?.height || 0),
            updateDate: decodedDateTime(image?.updateDate),
            captureDate: decodedDateTime(image?.captureDate),
            uploadDate: decodedDateTime(image?.uploadDate),
            location: normalizeDecodedCoords(image?.location),
            imageMeta,
            country
        };
    }

    function countryForCoords(coords) {
        if (!coords || !globalThis.countryCoder) return null;
        try {
            const point = [Number(coords.lng), Number(coords.lat)];
            const code = countryCoder.iso1A2Code(point, { level: 'territory' });
            if (!code) return { code: '', name: 'Outside mapped land', flag: '🌊' };
            const feature = countryCoder.feature(code);
            return { code, name: feature?.properties?.nameEn || code, flag: countryCoder.emojiFlag(code) || '' };
        } catch { return null; }
    }

    async function decodeRpcResponse(service, methodName, body) {
        const schema = await grpcSchemaPromise;
        const method = schema.services?.[service]?.methods?.find(candidate => candidate.method === methodName);
        if (!method?.response?.fullName) throw new Error(`Missing response schema for ${service}/${methodName}`);
        const bytes = decodeBase64Parts(body);
        const messages = [];
        const trailers = [];
        let offset = 0;
        while (offset + 5 <= bytes.length) {
            const flags = bytes[offset];
            const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false);
            const payload = bytes.slice(offset + 5, offset + 5 + length);
            if (payload.length !== length) throw new Error('Truncated gRPC-Web frame');
            if (flags & 0x80) trailers.push(utf8Decoder.decode(payload));
            else messages.push(decodeMessageWithSchema(method.response.fullName, payload, schema));
            offset += 5 + length;
        }
        return { messages, trailers };
    }

    function normalizeMediaId(value) {
        return String(value || '').match(/([a-f0-9]{24})/i)?.[1]?.toLowerCase() || '';
    }

    function populateGrpcContextFields(context) {
        Object.entries(context || {}).forEach(([field, value]) => {
            if (value === undefined || value === null || value === '') return;
            document.querySelectorAll(`[data-grpc-context="${field}"]`).forEach(input => { input.value = String(value); });
        });
        if (!context?.imageId && context?.profileImageId) {
            document.querySelectorAll('[data-grpc-context="imageId"]').forEach(input => { input.value = String(context.profileImageId); });
        }
    }

    async function resolveGrpcToolContext(input = {}) {
        const response = await sendRuntimeMessage({
            action: 'enhancedVscoResolveToolContext',
            context: { ...input, source: input.source || location.href }
        });
        if (!response?.ok) throw new Error(response?.error || 'Could not resolve VSCO context');
        populateGrpcContextFields(response.context);
        return response.context || {};
    }

    async function resolveSignedInAccountContext() {
        signedInAccountContextPromise ||= sendRuntimeMessage({ action: 'enhancedVscoAccountContext' }).then(response => {
            if (!response?.ok) throw new Error(response?.error || 'Could not resolve signed-in VSCO account');
            return response.context || {};
        }).catch(error => {
            signedInAccountContextPromise = null;
            throw error;
        });
        const context = await signedInAccountContextPromise;
        populateGrpcContextFields(context);
        return context;
    }

    async function descriptorGrpcCall(service, methodName, request, confirmed = false) {
        const schema = await grpcSchemaPromise;
        const method = schema.services?.[service]?.methods?.find(candidate => candidate.method === methodName);
        if (!method?.request?.fullName) throw new Error(`Missing descriptor for ${service}/${methodName}`);
        const body = grpcWebText(new Uint8Array(encodeMessageWithSchema(method.request.fullName, request, schema)));
        const response = await sendRuntimeMessage({
            action: 'enhancedVscoDescriptorGrpcCall', service, method: methodName, body, confirmed
        });
        if (!response?.ok) throw new Error(response?.error || `${methodName} request failed`);
        const decoded = await decodeRpcResponse(service, methodName, response.body || '');
        const status = decoded.trailers.join('\n').match(/grpc-status:\s*(\d+)/i)?.[1] ?? response.grpcStatus;
        if (String(status) !== '0') throw new Error(`${methodName} returned gRPC ${status ?? 'without status'}`);
        return decoded;
    }

    async function toggleCardReaction(item, kind, button) {
        const account = await resolveSignedInAccountContext();
        if (!account.viewerSiteId || !item?.id) throw new Error('Missing signed-in site ID or media ID.');
        const state = await descriptorGrpcCall('interaction.InteractionGrpc', 'GetReactionsForMedia', {
            siteId: account.viewerSiteId, imageId: item.id, fetchHasActivity: true
        });
        const reaction = state.messages?.[0] || {};
        const active = kind === 'favorite' ? Boolean(reaction.beenFavorited) : Boolean(reaction.beenReposted);
        const method = `${active ? 'Delete' : 'Create'}${kind === 'favorite' ? 'Favorite' : 'Repost'}`;
        const request = kind === 'favorite'
            ? { siteId: account.viewerSiteId, imageId: item.id }
            : { collectionId: account.collectionId, siteId: account.viewerSiteId, imageId: item.id };
        if (kind === 'repost' && !account.collectionId) throw new Error('Signed-in account has no repost collection ID.');
        await descriptorGrpcCall('interaction.InteractionGrpc', method, request, true);
        button.classList.toggle('active', !active);
        button.textContent = kind === 'favorite' ? (!active ? '♥' : '♡') : (!active ? '↻' : '↝');
        button.setAttribute('aria-pressed', String(!active));
        button.title = `${!active ? 'Remove' : 'Add'} ${kind === 'favorite' ? 'favorite' : 'repost'}`;
        reactionStateByMedia.set(String(item.id), {
            ...(reactionStateByMedia.get(String(item.id)) || {}),
            [kind === 'favorite' ? 'beenFavorited' : 'beenReposted']: !active
        });
    }

    function paintReactionState(mediaId, state) {
        document.querySelectorAll(`[data-media-id="${CSS.escape(String(mediaId))}"] .vsco-tub-reaction`).forEach(button => {
            const active = button.dataset.reactionKind === 'favorite' ? Boolean(state.beenFavorited) : Boolean(state.beenReposted);
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
            button.textContent = button.dataset.reactionKind === 'favorite' ? (active ? '♥' : '♡') : (active ? '↻' : '↝');
        });
    }

    async function loadReactionStates(ids) {
        const pending = [...new Set(ids.map(String))].filter(id => id && !reactionStateByMedia.has(id)).slice(0, 120);
        if (!pending.length) return;
        try {
            const account = await resolveSignedInAccountContext();
            const decoded = await descriptorGrpcCall('interaction.InteractionGrpc', 'GetReactionsForMedias', {
                siteId: account.viewerSiteId,
                mediaIdsList: pending.map(imageId => ({ imageId }))
            });
            (decoded.messages?.[0]?.reactionsList || []).forEach(reaction => {
                const mediaId = reaction.mediaId?.imageId;
                if (!mediaId) return;
                const state = { beenFavorited: Boolean(reaction.beenFavorited), beenReposted: Boolean(reaction.beenReposted) };
                reactionStateByMedia.set(mediaId, state);
                paintReactionState(mediaId, state);
            });
            pending.forEach(mediaId => {
                if (!reactionStateByMedia.has(mediaId)) reactionStateByMedia.set(mediaId, { beenFavorited: false, beenReposted: false });
                paintReactionState(mediaId, reactionStateByMedia.get(mediaId));
            });
        } catch { /* card actions still resolve state individually on click */ }
    }

    async function enrichGrpcContextFromMedia(context) {
        const imageId = normalizeMediaId(context?.imageId || context?.profileImageId || '');
        if (!imageId) return context;
        const response = await grpcRead('/media.Media/FetchImages', encodeFetchImages([imageId]));
        if (!response?.ok || !response.body) return context;
        const decoded = await decodeFetchImagesResponse(response.body);
        const image = decoded.images.find(item => item.id === imageId);
        if (!image) return context;
        const enriched = {
            ...context,
            imageId,
            siteId: String(context.siteId || image.siteId || ''),
            userId: String(context.userId || image.userId || '')
        };
        applyDecodedImageRecords([image]);
        populateGrpcContextFields(enriched);
        return enriched;
    }

    async function runReadProbe(service, method, body, context) {
        const path = `/${service}/${method}`;
        grpcProbeStatus = `Read suite ${grpcSuiteResults.length + 1}: ${method}…`;
        renderExpansionDetails();
        const response = await grpcRead(path, body);
        const characters = String(response.body || '').length;
        const row = {
            service, method, path, ...context,
            httpStatus: response.httpStatus || null, grpcStatus: response.grpcStatus ?? null,
            contentType: response.contentType || '', responseCharacters: characters,
            rawGrpcWebRequest: body, rawGrpcWebText: String(response.body || '')
        };
        if (response.ok && characters) {
            try { row.classification = 'PASS'; row.decoded = await decodeRpcResponse(service, method, response.body); }
            catch (error) { row.classification = 'DECODE_FAIL'; row.error = error?.message || String(error); }
        } else if (response.ok) row.classification = response.grpcStatus === '0' ? 'PASS_EMPTY' : 'INCONCLUSIVE_EMPTY_200';
        else { row.classification = 'FAIL'; row.error = response.error || `HTTP ${response.httpStatus || '?'}`; }
        grpcSuiteResults.push(row);
        renderExpansionDetails();
        return row;
    }

    function skipReadProbe(service, method, missing, context) {
        grpcSuiteResults.push({
            service, method, path: `/${service}/${method}`, ...context,
            classification: `SKIPPED_MISSING_${missing.toUpperCase()}`,
            rawGrpcWebRequest: '', rawGrpcWebText: ''
        });
    }

    async function runRelevantGrpcSuite(input = {}) {
        const supplied = typeof input === 'string' ? { imageId: normalizeMediaId(input), siteId: String(input).match(/(?:^|\s)(\d{6,})(?=\s|$)/)?.[1] || '' } : input;
        const selectedService = String(supplied.selectedService || '');
        const selectedMethod = String(supplied.selectedMethod || '');
        let resolved = {};
        try { resolved = await resolveGrpcToolContext(supplied); }
        catch (error) { grpcProbeStatus = `Context resolver warning · ${error?.message || error}`; renderExpansionDetails(); }
        const context = {
            imageId: normalizeMediaId(supplied.imageId || resolved.imageId || resolved.profileImageId || location.href),
            siteId: String(supplied.siteId || resolved.siteId || ''),
            viewerSiteId: String(supplied.viewerSiteId || resolved.viewerSiteId || ''),
            userId: String(supplied.userId || resolved.userId || ''),
            collectorSiteId: String(supplied.collectorSiteId || resolved.collectorSiteId || resolved.viewerSiteId || ''),
            collectionId: String(supplied.collectionId || resolved.collectionId || ''),
            albumId: String(supplied.albumId || resolved.albumId || ''),
            articleId: String(supplied.articleId || ''),
            permalink: String(supplied.permalink || '').trim(),
            tag: String(supplied.tag || '').trim(),
            limit: Math.max(1, Math.min(100, Math.trunc(Number(supplied.limit) || 2)))
        };
        grpcSuiteResults = [];
        grpcSuiteStopRequested = false;
        const frame = bytes => grpcWebText(new Uint8Array(bytes));
        const pagination = [...protobufInt(1, 0), ...protobufInt(2, context.limit)];

        if (context.imageId && (selectedMethod === 'FetchImages' || !context.siteId || !context.userId)) {
            const resolver = await runReadProbe('media.Media', 'FetchImages', encodeFetchImages([context.imageId]), context);
            const image = resolver.decoded?.messages?.flatMap(message => message.imagesList || []).find(item => item.id === context.imageId)
                || grpcImageRecords.get(context.imageId);
            if (image) {
                context.siteId ||= String(image.siteId || '');
                context.userId ||= String(image.userId || '');
                populateGrpcContextFields(context);
                applyDecodedImageRecords([image]);
            }
        }

        const definitions = [
            ['media.Media', 'FetchImage', ['imageId'], () => frame([...protobufString(1, context.imageId), ...protobufBool(2, true)])],
            ['media.Media', 'FetchProfileImage', ['imageId'], () => frame(protobufString(1, context.imageId))],
            ['media.Media', 'FetchProfileImages', ['imageId'], () => frame(protobufString(1, context.imageId))],
            ['media.Media', 'FetchImagesBySite', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufInt(3, context.limit)])],
            ['media.Media', 'FetchActiveImagesBySite', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufInt(3, context.limit)])],
            ['media.Media', 'FetchPersonalMedia', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufBool(3, true), ...protobufBool(4, true), ...protobufInt(6, context.limit)])],
            ['media.Media', 'FetchArticlesByImageID', ['imageId'], () => frame(protobufString(1, context.imageId))],
            ['media.Media', 'FetchArticlesBySite', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufBool(6, true), ...protobufInt(9, context.limit)])],
            ['media.Media', 'FetchArticleByPermalink', ['siteId', 'permalink'], () => frame([...protobufString(1, context.permalink), ...protobufInt(2, context.siteId)])],
            ['media.Media', 'FetchArticles', ['articleId'], () => frame(protobufString(1, context.articleId))],
            ['media.Media', 'FetchSlimArticles', ['articleId'], () => frame(protobufString(1, context.articleId))],
            ['media.Media', 'FetchFeedback', ['imageId'], () => frame([...protobufString(1, context.imageId), ...protobufInt(2, context.limit), ...protobufBool(4, true)])],
            ['media.Media', 'FetchFeedbackBatch', ['imageId'], () => frame(protobufString(1, context.imageId))],
            ['media.Media', 'FetchImageUploadData', ['imageId'], () => frame(protobufString(1, context.imageId))],
            ['media.Media', 'FetchUserComments', ['userId'], () => frame([...protobufInt(1, context.userId), ...protobufInt(2, context.limit), ...protobufBool(4, true)])],
            ['media.Media', 'FetchImagesByAlbum', ['albumId'], () => frame([...protobufString(1, context.albumId), ...protobufInt(3, context.limit)])],
            ['media.Media', 'FetchImagesByUserAndTag', ['userId', 'tag'], () => frame([...protobufInt(1, context.userId), ...protobufString(2, context.tag), ...protobufInt(3, context.limit)])],
            ['interaction.InteractionGrpc', 'GetReactionsForMedia', ['viewerSiteId', 'imageId'], () => frame([...protobufInt(1, context.viewerSiteId), ...protobufString(2, context.imageId), ...protobufBool(4, true)])],
            ['interaction.InteractionGrpc', 'GetReactionsForMedias', ['viewerSiteId', 'imageId'], () => frame([...protobufInt(1, context.viewerSiteId), ...protobufMessage(2, protobufString(1, context.imageId))])],
            ['interaction.InteractionGrpc', 'HasReactions', ['viewerSiteId', 'imageId'], () => frame([...protobufInt(1, context.viewerSiteId), ...protobufString(2, context.imageId)])],
            ['interaction.InteractionGrpc', 'GetInteractionIdsOfSitesMedias', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufInt(3, context.limit)])],
            ['interaction.InteractionGrpc', 'GetActivity', ['siteId', 'imageId'], () => frame([...protobufInt(1, context.siteId), ...protobufString(3, context.imageId)])],
            ['interaction.InteractionGrpc', 'FetchCollectionsBySite', ['siteId'], () => frame(protobufInt(1, context.siteId))],
            ['interaction.InteractionGrpc', 'FetchCollectionItemsBySite', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufInt(3, context.limit)])],
            ['interaction.InteractionGrpc', 'GetRepostedMediaIdsForSite', ['siteId'], () => frame([...protobufInt(1, context.siteId), ...protobufInt(3, context.limit)])],
            ['interaction.InteractionGrpc', 'GetFavorites', [], () => frame(protobufMessage(1, pagination))],
            ['interaction.InteractionGrpc', 'FetchCollectionItemBySiteAndMedia', ['collectorSiteId', 'imageId'], () => frame([...protobufInt(1, context.collectorSiteId), ...protobufString(2, context.imageId)])],
            ['interaction.InteractionGrpc', 'GetInteractionIdsOfSite', ['collectorSiteId'], () => frame([...protobufInt(1, context.collectorSiteId), ...protobufInt(3, context.limit)])],
            ['interaction.InteractionGrpc', 'FetchCollections', ['collectionId'], () => frame(protobufString(1, context.collectionId))],
            ['interaction.InteractionGrpc', 'FetchCollectionItemsById', ['collectionId'], () => frame(protobufString(1, context.collectionId))],
            ['interaction.InteractionGrpc', 'GetReposts', ['collectionId'], () => frame([...protobufString(1, context.collectionId), ...protobufMessage(2, pagination)])]
        ];

        let selectedMatched = !selectedMethod || (selectedService === 'media.Media' && selectedMethod === 'FetchImages');
        for (const [service, method, required, makeBody] of definitions) {
            if (selectedMethod && (service !== selectedService || method !== selectedMethod)) continue;
            selectedMatched = true;
            if (grpcSuiteStopRequested) break;
            const missing = required.find(name => !context[name]);
            if (missing) skipReadProbe(service, method, missing, context);
            else {
                const row = await runReadProbe(service, method, makeBody(), context);
                if (method === 'FetchCollectionsBySite' && !context.collectionId) {
                    context.collectionId = row.decoded?.messages?.flatMap(message => message.collectionsList || []).find(collection => collection?.id)?.id || '';
                    if (context.collectionId) populateGrpcContextFields(context);
                }
            }
        }
        if (selectedMethod && !selectedMatched) {
            grpcSuiteResults.push({
                service: selectedService, method: selectedMethod, path: `/${selectedService}/${selectedMethod}`,
                classification: 'SELECTED_READ_NOT_YET_ENCODABLE', rawGrpcWebRequest: '', rawGrpcWebText: ''
            });
        }
        const counts = grpcSuiteResults.reduce((result, row) => {
            result[row.classification] = (result[row.classification] || 0) + 1;
            return result;
        }, {});
        grpcProbeStatus = `Read suite complete · ${Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(' · ')}`;
        renderExpansionDetails();
    }

    async function copyRawGrpcResults() {
        const schema = await grpcSchemaPromise;
        const bundle = {
            format: 'vsco-tub-grpc-raw-bundle-v1',
            generatedAt: new Date().toISOString(),
            warning: 'Only calls listed in calls were transmitted. schema is the complete extracted client inventory, not proof every route is deployed.',
            schema,
            calls: grpcSuiteResults.map(row => ({
                service: row.service,
                method: row.method,
                path: row.path,
                imageId: row.imageId,
                siteId: row.siteId,
                httpStatus: row.httpStatus,
                grpcStatus: row.grpcStatus,
                contentType: row.contentType,
                classification: row.classification,
                rawGrpcWebRequest: row.rawGrpcWebRequest || '',
                rawGrpcWebResponse: row.rawGrpcWebText || ''
            }))
        };
        const text = JSON.stringify(bundle, null, 2);
        await navigator.clipboard.writeText(text);
        grpcProbeStatus = `Copied complete schema plus ${grpcSuiteResults.length} raw request/response pairs`;
        renderExpansionDetails();
    }

    async function probeGrpcReflection() {
        const path = '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo';
        // grpc.reflection.v1alpha.ServerReflectionRequest { list_services: "" }
        const body = 'AAAAAAI6AA==';
        const origins = [
            'https://media-grpc-api.vsco.co',
            'https://interaction-api-grpc.vsco.co'
        ];
        for (const origin of origins) {
            grpcProbeStatus = `Reflection probe: ${new URL(origin).hostname}…`;
            renderExpansionDetails();
            const response = await grpcRead(path, body, origin);
            grpcSuiteResults.push({
                service: 'grpc.reflection.v1alpha.ServerReflection',
                method: 'ServerReflectionInfo',
                path,
                origin,
                classification: response.ok && (response.body || response.grpcStatus === '0') ? 'REFLECTION_RESPONSE' : response.ok ? 'INCONCLUSIVE_EMPTY_200' : 'FAIL',
                httpStatus: response.httpStatus || null,
                grpcStatus: response.grpcStatus ?? null,
                grpcMessage: response.grpcMessage || '',
                contentType: response.contentType || '',
                rawGrpcWebRequest: body,
                rawGrpcWebText: String(response.body || ''),
                error: response.error || ''
            });
            renderExpansionDetails();
        }
        grpcProbeStatus = 'Reflection probes complete';
        renderExpansionDetails();
    }

    async function runGrpcUpload(file) {
        if (!file) {
            grpcProbeStatus = 'Choose an image file first';
            renderExpansionDetails();
            return;
        }
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 25 * 1024 * 1024) {
            grpcProbeStatus = 'Upload test accepts JPEG, PNG, or WebP up to 25 MB';
            renderExpansionDetails();
            return;
        }
        grpcSuiteResults = [];
        const generatePath = '/media.Media/GenerateUploadUrl';
        const generateBody = grpcWebText(new Uint8Array([
            ...protobufString(1, file.name),
            ...protobufInt(2, file.size)
        ]));
        grpcProbeStatus = `GenerateUploadUrl · ${file.name} · ${file.size.toLocaleString()} bytes…`;
        renderExpansionDetails();
        const generated = await grpcRead(generatePath, generateBody);
        const generateRow = {
            service: 'media.Media', method: 'GenerateUploadUrl', path: generatePath,
            httpStatus: generated.httpStatus || null, grpcStatus: generated.grpcStatus ?? null,
            grpcMessage: generated.grpcMessage || '',
            contentType: generated.contentType || '', rawGrpcWebRequest: generateBody,
            rawGrpcWebText: '[redacted: response contains a signed upload URL]'
        };
        if (!generated.ok || (generated.grpcStatus != null && String(generated.grpcStatus) !== '0') || !generated.body) {
            generateRow.classification = 'FAIL';
            generateRow.error = generated.grpcMessage || generated.error || 'No gRPC response body';
            grpcSuiteResults.push(generateRow);
            grpcProbeStatus = `GenerateUploadUrl FAIL · ${generateRow.error}`;
            renderExpansionDetails();
            return;
        }
        let generateDecoded;
        try {
            generateDecoded = await decodeRpcResponse('media.Media', 'GenerateUploadUrl', generated.body);
            generateRow.classification = 'PASS';
        } catch (error) {
            generateRow.classification = 'DECODE_FAIL';
            generateRow.error = error?.message || String(error);
            grpcSuiteResults.push(generateRow);
            grpcProbeStatus = `GenerateUploadUrl decode failed · ${generateRow.error}`;
            renderExpansionDetails();
            return;
        }
        const generatedMessage = generateDecoded.messages?.[0] || {};
        const mediaId = generatedMessage.mediaId;
        const uploadUrl = generatedMessage.url;
        generateRow.mediaId = mediaId || '';
        generateRow.signedUploadUrlReturned = Boolean(uploadUrl);
        // Do not retain the decoded message: its raw fields also contain the signed URL.
        generateRow.decoded = { mediaId: mediaId || '', url: '[signed URL redacted]' };
        grpcSuiteResults.push(generateRow);
        if (!mediaId || !uploadUrl) {
            grpcProbeStatus = 'GenerateUploadUrl response lacked mediaId or URL';
            renderExpansionDetails();
            return;
        }

        grpcProbeStatus = `Uploading ${file.size.toLocaleString()} bytes to signed URL…`;
        renderExpansionDetails();
        let putResponse;
        try {
            putResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: { 'content-type': file.type || 'image/jpeg' },
                body: file
            });
        } catch (error) {
            grpcSuiteResults.push({ method: 'SignedUrlPUT', mediaId, classification: 'FAIL', error: error?.message || String(error) });
            grpcProbeStatus = `Signed upload FAIL · ${error?.message || error}`;
            renderExpansionDetails();
            return;
        }
        grpcSuiteResults.push({ method: 'SignedUrlPUT', mediaId, httpStatus: putResponse.status, bytes: file.size, classification: putResponse.ok ? 'PASS' : 'FAIL' });
        if (!putResponse.ok) {
            grpcProbeStatus = `Signed upload FAIL · HTTP ${putResponse.status}`;
            renderExpansionDetails();
            return;
        }

        const completePath = '/media.Media/ImageUploadComplete';
        const completeBody = grpcWebText(new Uint8Array([
            ...protobufString(1, mediaId),
            ...protobufString(2, file.name),
            ...protobufBool(3, false),
            ...protobufBool(4, false),
            ...protobufBool(9, false)
        ]));
        grpcProbeStatus = `ImageUploadComplete · publish=false · showLocation=false…`;
        renderExpansionDetails();
        const completed = await grpcRead(completePath, completeBody);
        const completeRow = {
            service: 'media.Media', method: 'ImageUploadComplete', path: completePath, mediaId,
            httpStatus: completed.httpStatus || null, grpcStatus: completed.grpcStatus ?? null,
            contentType: completed.contentType || '', rawGrpcWebRequest: completeBody,
            rawGrpcWebText: String(completed.body || ''),
            classification: completed.ok && completed.body ? 'PASS' : 'FAIL',
            error: completed.error || ''
        };
        if (completed.body) {
            try { completeRow.decoded = await decodeRpcResponse('media.Media', 'ImageUploadComplete', completed.body); }
            catch (error) { completeRow.classification = 'DECODE_FAIL'; completeRow.error = error?.message || String(error); }
        }
        grpcSuiteResults.push(completeRow);
        if (completeRow.classification !== 'PASS') {
            grpcProbeStatus = `ImageUploadComplete ${completeRow.classification} · ${completeRow.error || 'no response'}`;
            renderExpansionDetails();
            return;
        }

        const uploadDataPath = '/media.Media/FetchImageUploadData';
        const uploadDataBody = grpcWebText(new Uint8Array(protobufString(1, mediaId)));
        const uploadData = await grpcRead(uploadDataPath, uploadDataBody);
        const uploadDataRow = {
            service: 'media.Media', method: 'FetchImageUploadData', path: uploadDataPath, mediaId,
            httpStatus: uploadData.httpStatus || null, grpcStatus: uploadData.grpcStatus ?? null,
            contentType: uploadData.contentType || '', rawGrpcWebRequest: uploadDataBody,
            rawGrpcWebText: String(uploadData.body || ''),
            classification: uploadData.ok && uploadData.body ? 'PASS' : 'FAIL', error: uploadData.error || ''
        };
        if (uploadData.body) {
            try { uploadDataRow.decoded = await decodeRpcResponse('media.Media', 'FetchImageUploadData', uploadData.body); }
            catch (error) { uploadDataRow.classification = 'DECODE_FAIL'; uploadDataRow.error = error?.message || String(error); }
        }
        grpcSuiteResults.push(uploadDataRow);
        grpcProbeStatus = `Upload test complete · media ${mediaId} · publish=false · FetchImageUploadData ${uploadDataRow.classification}`;
        renderExpansionDetails();
    }

    function metadataFiltersActive() {
        return searchSettings.metadataStatus !== 'all'
            || searchSettings.metadataGps !== 'all'
            || searchSettings.metadataExif !== 'all'
            || Boolean(searchSettings.metadataCamera.trim())
            || Boolean(searchSettings.metadataSoftware.trim())
            || Boolean(searchSettings.metadataQuery.trim())
            || Boolean(searchSettings.metadataCountry.trim())
            || (state?.response?.autonomousCountry && state.response.autonomousCountry !== 'ALL')
            || searchSettings.profileAspect !== 'all'
            || searchSettings.groupImagesBy === 'country';
    }

    function applyDecodedImageRecords(images, refreshFilters = true) {
        images.forEach(image => grpcImageRecords.set(image.id, image));
        const search = currentSearch();
        if (search?.autonomous && search.country && search.country !== 'ALL' && state?.mode === 'people') {
            const verifiedIds = images
                .filter(image => String(image.country?.code || '').toUpperCase() === search.country)
                .map(image => String(image.id || '').toLowerCase())
                .filter(id => id && !countrySignaledImageIds.has(id));
            if (verifiedIds.length) {
                verifiedIds.forEach(id => countrySignaledImageIds.add(id));
                sendRuntimeMessage({ action: 'enhancedVscoCountrySignals', query: search.query, profileImageIds: verifiedIds })
                    .catch(error => tubLog('country signal failed', { error: error?.message || String(error) }));
            }
        }
        if (refreshFilters && images.length && metadataFiltersActive() && state && ['images', 'people'].includes(state.mode)) {
            const response = state.response;
            renderResults(state.mode, response);
            applyDecodedImageRecords([], false);
            return;
        }
        document.querySelectorAll('#vsco-tub-search-root figure[data-media-id], #vsco-tub-search-root .vsco-tub-person[data-media-id]').forEach(card => {
            const record = grpcImageRecords.get(card.dataset.mediaId);
            if (!record) return;
            const metadataHost = card.matches('figure') ? card.querySelector('figcaption') : card.querySelector('.vsco-tub-person-body');
            if (!metadataHost) return;
            let badge = card.querySelector('.vsco-tub-grpc-media');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'vsco-tub-grpc-media';
                metadataHost.appendChild(badge);
            }
            const coords = record.location || record.imageMeta?.location;
            const camera = [record.imageMeta?.make, record.imageMeta?.model].filter(Boolean).join(' ');
            const parts = [];
            if (coords) parts.push(`📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}${record.showLocation ? '' : ' · hidden by VSCO UI'}`);
            if (record.country) parts.push(`${record.country.flag || '🌐'} ${record.country.name}`);
            if (camera) parts.push(`📷 ${camera}`);
            if (record.width && record.height) parts.push(`${record.width}×${record.height}`);
            if (record.uploadDate) parts.push(new Date(record.uploadDate).toLocaleDateString());
            parts.push(`site ${record.siteId || '—'}`);
            badge.textContent = parts.join(' · ');
            badge.title = JSON.stringify(record, null, 2);
            let details = card.querySelector('.vsco-tub-grpc-all-fields');
            if (!details) {
                details = document.createElement('details');
                details.className = 'vsco-tub-grpc-all-fields';
                const summary = document.createElement('summary');
                summary.textContent = 'All gRPC fields';
                const pre = document.createElement('pre');
                details.append(summary, pre);
                metadataHost.appendChild(details);
            }
            details.querySelector('pre').textContent = JSON.stringify(record, null, 2);
        });
    }

    function encodeFetchImages(ids) {
        return grpcWebText(new Uint8Array([
            ...ids.flatMap(id => protobufString(1, id)),
            ...protobufBool(2, true)
        ]));
    }

    function encodeFetchProfileImages(ids) {
        return grpcWebText(new Uint8Array(ids.flatMap(id => protobufString(1, id))));
    }

    function visibleImageIds() {
        if (!state?.root) return [];
        return [...state.root.querySelectorAll('figure[data-media-id]')]
            .filter(card => {
                const rect = card.getBoundingClientRect();
                return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
            })
            .map(card => card.dataset.mediaId)
            .filter(id => /^[a-f0-9]{24}$/i.test(id));
    }

    function renderedImageIds() {
        if (!state?.root) return [];
        return [...state.root.querySelectorAll('figure[data-media-id]')]
            .map(card => card.dataset.mediaId)
            .filter(id => /^[a-f0-9]{24}$/i.test(id));
    }

    function metadataImageId(item) {
        const id = item?.profileImageId || item?.imageId || item?.id || '';
        return /^[a-f0-9]{24}$/i.test(String(id)) ? String(id).toLowerCase() : '';
    }

    function availableImageIds() {
        if (!state || !['images', 'people'].includes(state.mode)) return [];
        const windows = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
        const windowMs = windows[searchSettings.timeWindow];
        return [...new Set(state.rawItems
            .slice()
            .sort((a, b) => (b.timestamp - a.timestamp) || String(b.id).localeCompare(String(a.id)))
            .filter(item => !windowMs || (item.timestamp && Date.now() - item.timestamp <= windowMs))
            .map(metadataImageId)
            .filter(Boolean))];
    }

    function queueViewportGrpc(ids) {
        if (grpcProbeStopRequested) return;
        ids.forEach(id => {
            if (!grpcCheckedImageIds.has(id)) grpcQueuedImageIds.add(id);
        });
        clearTimeout(grpcViewportTimer);
        grpcViewportTimer = setTimeout(runViewportGrpcQueue, 180);
    }

    function grpcMetadataBatchSize() {
        return state?.mode === 'images' ? GRPC_IMAGE_SEARCH_BATCH_SIZE : GRPC_PROFILE_BATCH_SIZE;
    }

    function grpcMetadataWorkerCount() {
        return state?.mode === 'images' ? GRPC_IMAGE_SEARCH_WORKERS : GRPC_PROFILE_SEARCH_WORKERS;
    }

    async function runViewportGrpcQueue() {
        if (grpcViewportRunning || !grpcQueuedImageIds.size) return;
        grpcViewportRunning = true;
        const workerCount = grpcMetadataWorkerCount();
        let activeRequests = 0;
        const worker = async () => {
            while (grpcQueuedImageIds.size && !grpcProbeStopRequested) {
                const ids = [...grpcQueuedImageIds].slice(0, grpcMetadataBatchSize());
                ids.forEach(id => grpcQueuedImageIds.delete(id));
                activeRequests++;
                tubLog('metadata request start', { mode: state.mode, ids: ids.length, queued: grpcQueuedImageIds.size, workers: workerCount });
                grpcProbeStatus = `Fetching metadata · ${activeRequests} active · ${grpcQueuedImageIds.size.toLocaleString()} IDs queued · ${workerCount} workers`;
                renderExpansionDetails();
                const response = state.mode === 'people' && !grpcForceMediaProbe
                    ? await grpcRead('/media.Media/FetchProfileImages', encodeFetchProfileImages(ids))
                    : await grpcRead('/media.Media/FetchImages', encodeFetchImages(ids));
                activeRequests--;
                grpcMetadataRequestsCompleted++;
                const responseCharacters = String(response.body || '').length;
                const grpcSucceeded = response.grpcStatus === '0' || responseCharacters > 0;
                if (response.ok && grpcSucceeded) {
                    let decoded;
                    try {
                        decoded = state.mode === 'people' && !grpcForceMediaProbe
                            ? await decodeRpcResponse('media.Media', 'FetchProfileImages', response.body).then(result => ({ images: (result.messages || []).flatMap(message => message.profileImagesList || []), trailers: result.trailers }))
                            : await decodeFetchImagesResponse(response.body);
                        // Only mark IDs as checked when the response actually
                        // contains a record for them. VSCO can legitimately
                        // omit unavailable/private media from a successful
                        // batch; treating every requested ID as checked makes
                        // metadata filters silently hide those results.
                        const returnedIds = new Set(decoded.images.map(image => String(image.id).toLowerCase()));
                        ids.forEach(id => {
                            if (returnedIds.has(String(id).toLowerCase())) grpcCheckedImageIds.add(id);
                        });
                        applyDecodedImageRecords(decoded.images);
                    } catch (error) {
                        grpcProbeStatus = `Metadata DECODE FAIL · ${error?.message || error}`;
                        grpcProbeStopRequested = true;
                        return;
                    }
                    grpcProbeStatus = `Metadata PASS · ${grpcMetadataRequestsCompleted} requests · latest ${ids.length} IDs / ${decoded.images.length} images · ${grpcCheckedImageIds.size.toLocaleString()} checked · ${activeRequests} active · ${grpcQueuedImageIds.size.toLocaleString()} queued`;
                    tubLog('metadata request complete', { mode: state.mode, requested: ids.length, returned: decoded.images.length, checked: grpcCheckedImageIds.size, requests: grpcMetadataRequestsCompleted });
                } else if (response.ok) {
                    grpcProbeStatus = `Metadata INCONCLUSIVE · ${ids.length} IDs · HTTP ${response.httpStatus} but no gRPC frames`;
                    grpcProbeStopRequested = true;
                    return;
                } else {
                    grpcProbeStatus = `Metadata FAIL · ${response.error || `HTTP ${response.httpStatus || '?'}`}`;
                    grpcProbeStopRequested = true;
                    tubLog('metadata request failed', { mode: state.mode, requested: ids.length, error: response.error || response.httpStatus });
                    return;
                }
                renderExpansionDetails();
            }
        };
        try {
            await Promise.all(Array.from({ length: workerCount }, worker));
        } finally {
            grpcViewportRunning = false;
            if (grpcProbeStopRequested) grpcProbeStatus = `Metadata probe stopped · ${grpcCheckedImageIds.size} checked this session`;
            renderExpansionDetails();
        }
    }

    async function probeVisibleGrpc(requestedCount = GRPC_IMAGE_PROBE_DEFAULT) {
        if (!state || !['images', 'people'].includes(state.mode)) {
            grpcProbeStatus = 'Open an Images or People search first';
            renderExpansionDetails();
            return;
        }
        const count = Math.max(1, Math.min(GRPC_IMAGE_PROBE_MAX, Math.trunc(Number(requestedCount) || GRPC_IMAGE_PROBE_DEFAULT)));
        const available = availableImageIds();
        const ids = available.filter(id => !grpcCheckedImageIds.has(id)).slice(0, count);
        if (!ids.length) {
            grpcProbeStatus = available.length ? 'All available image IDs already checked' : 'No valid image IDs available';
            renderExpansionDetails();
            return;
        }
        grpcProbeStopRequested = false;
        grpcProbeStatus = `Queued ${ids.length} of ${count} requested image records`;
        renderExpansionDetails();
        queueViewportGrpc(ids);
    }

    function stopGrpcProbe() {
        grpcProbeStopRequested = true;
        grpcQueuedImageIds.clear();
        clearTimeout(grpcViewportTimer);
        grpcProbeStatus = grpcViewportRunning
            ? 'Stopping metadata probe after the active request…'
            : `Metadata probe stopped · ${grpcCheckedImageIds.size} checked this session`;
        renderExpansionDetails();
    }

    function startAutomaticMetadataProbe() {
        if (!state || !['images', 'people'].includes(state.mode)) return;
        const search = currentSearch();
        const key = `${search?.mode || 'images'}:${search?.query || activeKey}`;
        if (!key || grpcAutoProbeKey === key) return;
        grpcAutoProbeKey = key;
        grpcProbeStopRequested = false;
        grpcQueuedImageIds.clear();
        const ids = availableImageIds().filter(id => !grpcCheckedImageIds.has(id)).slice(0, GRPC_IMAGE_PROBE_MAX);
        const batchSize = grpcMetadataBatchSize();
        grpcProbeStatus = ids.length
            ? `Automatically queued ${ids.length.toLocaleString()} image IDs · full returned set (10,000 max) · newest first · ${Math.ceil(ids.length / batchSize).toLocaleString()} bounded request${Math.ceil(ids.length / batchSize) === 1 ? '' : 's'} · ${batchSize.toLocaleString()} IDs per request · ${grpcMetadataWorkerCount()} workers`
            : 'All image metadata for this search is already checked';
        renderExpansionDetails();
        if (ids.length) queueViewportGrpc(ids);
    }

    function observeGrpcCard(card) {
        // Automatic enrichment is deliberately capped to the returned 10,000;
        // scrolling must not expand that scope unexpectedly.
        return card;
    }

    function resetGrpcViewportObserver() {
        grpcViewportObserver?.disconnect();
        grpcViewportObserver = new IntersectionObserver(entries => {
            const ids = entries.filter(entry => entry.isIntersecting).map(entry => entry.target.dataset.mediaId).filter(Boolean);
            if (ids.length) queueViewportGrpc(ids);
        }, { rootMargin: '180px 0px', threshold: 0.01 });
    }

    function currentSearch() {
        if (/^\/search\/people\/?$/i.test(location.pathname) && new URLSearchParams(location.search).get('vsco_tub') === 'discover-profiles') {
            const requestedCountry = String(new URLSearchParams(location.search).get('country') || 'ALL').toUpperCase();
            const country = ['ALL', 'IE', 'IL', 'CA'].includes(requestedCountry) ? requestedCountry : 'ALL';
            return { mode: 'people', query: `${AUTONOMOUS_PROFILE_DISCOVERY_KEY}:${country}`, autonomous: true, country };
        }
        const match = location.pathname.match(/^\/search\/(images|people)(?:\/([^/]+))?\/?$/i);
        if (!match || !match[2]) return null;
        return { mode: match[1].toLowerCase(), query: decodeURIComponent(match[2]).trim() };
    }

    function installStyles() {
        if (document.getElementById(STYLE_ID)) return;
        if (!document.head) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .vsco-tub-native-hidden { display: none !important; }
            #${ROOT_ID} { width: 100%; box-sizing: border-box; padding: 18px 0 48px; }
            #${ROOT_ID} .vsco-tub-status { color: #777; font: 13px/1.4 system-ui, sans-serif; margin: 0 0 18px; }
            #${ROOT_ID} .vsco-tub-workspace-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 0 0 14px; padding: 8px 10px; border: 1px solid #e5e5e5; border-radius: 9px; background: #fafafa; font: 12px/1.2 system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-workspace-nav strong { margin-right: 3px; font-size: 13px; }
            #${ROOT_ID} .vsco-tub-workspace-nav button { border: 1px solid #d0d0d0; border-radius: 999px; background: #fff; color: #222; padding: 5px 9px; cursor: pointer; }
            #${ROOT_ID} .vsco-tub-workspace-nav button:hover, #${ROOT_ID} .vsco-tub-workspace-nav button:focus-visible { border-color: #111; }
            #${ROOT_ID} .vsco-tub-workspace-nav button[aria-pressed="true"] { background: #111; color: #fff; border-color: #111; }
            #${ROOT_ID} .vsco-tub-travel-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px 12px; align-items: center; margin: 0 0 14px; padding: 11px 12px; border: 1px solid #d9d0f6; border-radius: 9px; background: #faf8ff; color: #222; font: 12px/1.35 system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-travel-panel strong, #${ROOT_ID} .vsco-tub-travel-panel span { display: block; }
            #${ROOT_ID} .vsco-tub-travel-panel span { color: #666; margin-top: 2px; }
            #${ROOT_ID} .vsco-tub-travel-status { grid-column: 1 / -1; color: #66588d; font-size: 11px; }
            #${ROOT_ID} .vsco-tub-travel-panel button { border: 1px solid #aaa; border-radius: 5px; background: #fff; padding: 6px 9px; cursor: pointer; }
            #${ROOT_ID} .vsco-tub-travel-panel button:first-of-type { background: #111; color: #fff; border-color: #111; }
            #${ROOT_ID} .vsco-tub-expansion { margin: -8px 0 18px; border: 1px solid #ddd; border-radius: 7px; padding: 10px 12px; color: #555; font: 12px/1.45 system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-expansion summary { cursor: pointer; color: #222; font-weight: 600; }
            #${ROOT_ID} .vsco-tub-expansion-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 7px; }
            #${ROOT_ID} .vsco-tub-expansion button { border: 1px solid #aaa; border-radius: 5px; background: #fff; padding: 6px 10px; cursor: pointer; }
            #${ROOT_ID} .vsco-tub-expansion button:disabled { cursor: default; opacity: .45; }
            #${ROOT_ID} .vsco-tub-expansion button[aria-pressed="true"] { background: #111; color: #fff; border-color: #111; }
            #${ROOT_ID} .vsco-tub-timeframe-label { color: #777; font-weight: 600; margin-right: 2px; }
            #${ROOT_ID} .vsco-tub-timeframe-select { border: 1px solid #aaa; border-radius: 5px; background: #fff; color: #222; padding: 6px 8px; }
            #${ROOT_ID} .vsco-tub-grpc-target { min-width: 250px; border: 1px solid #aaa; border-radius: 5px; padding: 6px 8px; font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
            #${ROOT_ID} .vsco-tub-grpc-probe-count { width: 86px; border: 1px solid #aaa; border-radius: 5px; padding: 6px 8px; font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
            #${ROOT_ID} .vsco-tub-expansion-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 3px 12px; }
            #${ROOT_ID} .vsco-tub-expansion-queries { max-height: 92px; overflow: auto; margin-top: 7px; overflow-wrap: anywhere; }
            #vsco-tub-map-drawer { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(0,0,0,.48); font: 13px/1.4 system-ui, sans-serif; }
            #vsco-tub-map-drawer[hidden] { display: none; }
            #vsco-tub-map-panel { width: min(980px, 96vw); max-height: 90vh; overflow: auto; background: #fff; color: #111; border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,.3); padding: 18px; }
            #vsco-tub-map-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
            #vsco-tub-map-head strong { font-size: 18px; }
            #vsco-tub-map-close { border: 0; background: transparent; font-size: 20px; cursor: pointer; }
            #vsco-tub-map-canvas { position: relative; aspect-ratio: 2 / 1; overflow: hidden; border-radius: 8px; background: linear-gradient(#e8f1f5 0 49.5%, #d9e8ee 49.5% 50.5%, #e8f1f5 50.5%); border: 1px solid #c5d5db; }
            #vsco-tub-map-canvas::before, #vsco-tub-map-canvas::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .35; background: repeating-linear-gradient(90deg, transparent 0 9.9%, #fff 10% 10.15%, transparent 10.25% 20%); }
            #vsco-tub-map-canvas::after { background: repeating-linear-gradient(0deg, transparent 0 9.9%, #fff 10% 10.15%, transparent 10.25% 20%); }
            .vsco-tub-map-dot { position: absolute; width: 9px; height: 9px; transform: translate(-50%, -50%); border-radius: 50%; background: #111; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.35); cursor: pointer; }
            .vsco-tub-map-dot:hover { z-index: 2; transform: translate(-50%, -50%) scale(1.45); }
            #vsco-tub-map-note { color: #666; margin: 10px 0 0; }
            #vsco-tub-map-countries { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            #vsco-tub-map-countries button { border: 1px solid #ccd6da; border-radius: 999px; background: #fff; padding: 5px 8px; cursor: pointer; }
            #${ROOT_ID} .vsco-tub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px 14px; }
            #${ROOT_ID} .vsco-tub-country-groups { display: grid; gap: 30px; }
            #${ROOT_ID} .vsco-tub-country-group > h3 { margin: 0 0 12px; padding-bottom: 7px; border-bottom: 1px solid #ddd; font: 600 18px/1.2 system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-country-group .vsco-tub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px 14px; }
            #${ROOT_ID}[data-gallery-size="compact"] .vsco-tub-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
            #${ROOT_ID}[data-gallery-size="large"] .vsco-tub-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
            #${ROOT_ID} figure { margin: 0; min-width: 0; }
            #${ROOT_ID} figure { position: relative; }
            #${ROOT_ID} .vsco-tub-card-actions { display: flex; justify-content: flex-end; align-items: center; min-height: 26px; opacity: 0; transition: opacity .12s ease; }
            #${ROOT_ID} figure:hover .vsco-tub-card-actions, #${ROOT_ID} figure:focus-within .vsco-tub-card-actions { opacity: 1; }
            #${ROOT_ID} .vsco-tub-save { display: inline-grid; place-items: center; width: 26px; height: 26px; border: 0; padding: 0; background: transparent; color: #aaa; cursor: pointer; }
            #${ROOT_ID} .vsco-tub-save:hover, #${ROOT_ID} .vsco-tub-save:focus-visible { color: #111; }
            #${ROOT_ID} .vsco-tub-save svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; }
            #${ROOT_ID} .vsco-tub-save.saved svg { fill: #111; stroke: #111; }
            #${ROOT_ID} .vsco-tub-reaction { width: 26px; height: 26px; border: 0; padding: 0; background: transparent; color: #aaa; cursor: pointer; font: 18px/1 system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-reaction:hover, #${ROOT_ID} .vsco-tub-reaction:focus-visible, #${ROOT_ID} .vsco-tub-reaction.active { color: #111; }
            #${ROOT_ID} .vsco-tub-reaction:disabled { opacity: .45; cursor: wait; }
            #${ROOT_ID} a { color: inherit; text-decoration: none; }
            #${ROOT_ID} .vsco-tub-image-link { display: block; overflow: hidden; background: #f2f2f2; }
            #${ROOT_ID} img { display: block; width: 100%; height: auto; aspect-ratio: 1 / 1.22; object-fit: cover; }
            #${ROOT_ID}[data-image-aspect="full"] img { aspect-ratio: auto; object-fit: contain; }
            #${ROOT_ID} figcaption { padding-top: 7px; font: 13px/1.35 system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-user { color: #777; margin-top: 2px; }
            #${ROOT_ID} .vsco-tub-meta-link { color: #777; display: block; font-size: 11px; margin-top: 3px; overflow-wrap: anywhere; }
            #${ROOT_ID} .vsco-tub-grpc-media { color: #666; font-size: 10px; line-height: 1.35; margin-top: 4px; overflow-wrap: anywhere; }
            #${ROOT_ID} .vsco-tub-grpc-all-fields { color: #555; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 5px; }
            #${ROOT_ID} .vsco-tub-grpc-all-fields summary { cursor: pointer; font-family: system-ui, sans-serif; }
            #${ROOT_ID} .vsco-tub-grpc-all-fields pre { box-sizing: border-box; max-height: 420px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 8px; background: #f4f4f4; border: 1px solid #ddd; }
            #${ROOT_ID} .vsco-tub-grpc-suite-output { box-sizing: border-box; max-height: 560px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 9px; background: #f4f4f4; border: 1px solid #ddd; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
            #${ROOT_ID} .vsco-tub-person { display: flex; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee; }
            #${ROOT_ID} .vsco-tub-person-body { min-width: 0; flex: 1; }
            #${ROOT_ID} .vsco-tub-follow { display: inline-grid; place-items: center; width: 26px; height: 26px; flex: 0 0 auto; border: 0; border-radius: 50%; background: transparent; color: #aaa; padding: 0; cursor: pointer; font: 19px/1 system-ui, sans-serif; opacity: 0; transition: opacity .12s ease, color .12s ease; }
            #${ROOT_ID} .vsco-tub-person:hover .vsco-tub-follow, #${ROOT_ID} .vsco-tub-person:focus-within .vsco-tub-follow { opacity: 1; }
            #${ROOT_ID} .vsco-tub-follow:hover, #${ROOT_ID} .vsco-tub-follow:focus-visible, #${ROOT_ID} .vsco-tub-follow.following { color: #111; }
            #${ROOT_ID} .vsco-tub-follow:disabled { opacity: .5; cursor: wait; }
            #${ROOT_ID} .vsco-tub-avatar { width: 54px; height: 54px; border-radius: 50%; object-fit: cover; background: #eee; flex: 0 0 auto; }
            #${ROOT_ID} .vsco-tub-people { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0 28px; width: 100%; }
            #${ROOT_ID}[data-gallery-size="compact"] .vsco-tub-people { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
            #${ROOT_ID}[data-gallery-size="large"] .vsco-tub-people { grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }
            #${ROOT_ID} .vsco-tub-person.full-image { display: block; padding: 0 0 18px; margin: 0 0 18px; }
            #${ROOT_ID} .vsco-tub-person.full-image .vsco-tub-avatar { display: block; width: 100%; height: 220px; border-radius: 0; margin-bottom: 10px; }
            #${ROOT_ID} .vsco-tub-person.full-image.full-aspect .vsco-tub-avatar { height: auto; aspect-ratio: auto; object-fit: contain; }
            #${ROOT_ID}[data-gallery-size="compact"] .vsco-tub-person.full-image .vsco-tub-avatar { height: 160px; }
            #${ROOT_ID}[data-gallery-size="large"] .vsco-tub-person.full-image .vsco-tub-avatar { height: 300px; }
            #${ROOT_ID}[data-gallery-size="compact"] .vsco-tub-person.full-image.full-aspect .vsco-tub-avatar,
            #${ROOT_ID}[data-gallery-size="large"] .vsco-tub-person.full-image.full-aspect .vsco-tub-avatar { height: auto; }
            #${ROOT_ID} .vsco-tub-age { color: #888; margin-left: 6px; }
            #${ROOT_ID} .vsco-tub-error { color: #b42318; }
            @media (max-width: 640px) { #${ROOT_ID} .vsco-tub-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 8px; } }
            #vsco-tub-settings-launcher { position: fixed; z-index: 2147483647; left: 16px; top: 68px; font: 12px/1.4 system-ui, sans-serif; color: #f5f5f5; }
            #vsco-tub-settings-launcher > button { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 6px 0; font: inherit; font-weight: 500; text-align: left; }
            #vsco-tub-settings-launcher > button:hover { color: #fff; }
            #vsco-tub-settings-launcher .vsco-tub-settings-menu { display: none; box-sizing: border-box; width: 282px; max-height: calc(100vh - 120px); overflow: auto; padding: 16px; background: #111; color: #f5f5f5; border: 1px solid #3a3a3a; border-radius: 9px; box-shadow: 0 12px 32px rgba(0,0,0,.42); }
            #vsco-tub-settings-launcher .vsco-tub-settings-menu.open { display: block; }
            #vsco-tub-settings-launcher .vsco-tub-settings-title { font-size: 14px; font-weight: 600; }
            #vsco-tub-settings-launcher .vsco-tub-settings-subtitle { color: #aaa; margin-top: 2px; }
            #vsco-tub-settings-launcher .vsco-tub-settings-section { border-top: 1px solid #333; margin-top: 14px; padding-top: 12px; }
            #vsco-tub-settings-launcher .vsco-tub-settings-section-title { color: #aaa; font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; margin: 0 0 9px; }
            #vsco-tub-settings-launcher label { display: block; margin: 0 0 11px; }
            #vsco-tub-settings-launcher label.vsco-tub-settings-check { display: flex; gap: 8px; align-items: flex-start; }
            #vsco-tub-settings-launcher label.vsco-tub-settings-check input { margin-top: 2px; accent-color: #fff; }
            #vsco-tub-settings-launcher select, #vsco-tub-settings-launcher input[type="search"] { box-sizing: border-box; width: 100%; margin-top: 5px; padding: 6px 7px; background: #222; color: #fff; border: 1px solid #555; border-radius: 5px; }
            #vsco-tub-settings-launcher select:focus, #vsco-tub-settings-launcher input[type="search"]:focus { outline: 1px solid #aaa; }
            #vsco-tub-settings-launcher .vsco-tub-settings-help { display: block; color: #999; margin-top: 10px; }
            #vsco-tub-settings-launcher .vsco-tub-settings-status { color: #bbb; font-size: 11px; margin-top: 10px; }
            #vsco-tub-settings-launcher .vsco-tub-settings-coming { opacity: .5; }
            #vsco-tub-collection-launcher { position: fixed; z-index: 2147483646; left: 16px; top: 98px; font: 12px/1.4 system-ui, sans-serif; }
            #vsco-tub-collection-launcher { display: none; }
            #vsco-tub-collection-launcher > button { border: 0; background: transparent; color: #f5f5f5; cursor: pointer; padding: 6px 0; font: inherit; font-weight: 500; }
            #vsco-tub-nav-launcher { position: fixed; z-index: 2147483647; right: 18px; top: 112px; font: 12px/1.4 system-ui, sans-serif; color: #fff; background: rgba(20,20,20,.94); border: 1px solid rgba(255,255,255,.28); border-radius: 10px; padding: 8px; box-shadow: 0 8px 26px rgba(0,0,0,.28); }
            #vsco-tub-nav-launcher nav { display: flex; flex-direction: column; gap: 2px; }
            #vsco-tub-nav-launcher button { border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; padding: 7px 10px; font: inherit; font-weight: 600; text-align: left; }
            #vsco-tub-nav-launcher button:hover, #vsco-tub-nav-launcher button:focus-visible { background: rgba(255,255,255,.16); outline: none; }
            #vsco-tub-nav-launcher button:hover, #vsco-tub-nav-launcher button[aria-current="page"] { color: #fff; }
            #vsco-tub-nav-launcher .vsco-tub-nav-label { color: #999; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; margin: 6px 0 1px; }
            #vsco-tub-collection-drawer { position: fixed; z-index: 2147483647; inset: 0 0 0 auto; width: min(440px, 94vw); box-sizing: border-box; overflow: auto; background: #fff; color: #111; padding: 18px; box-shadow: -10px 0 35px rgba(0,0,0,.25); font: 13px/1.4 system-ui, sans-serif; }
            #vsco-tub-collection-drawer[hidden] { display: none; }
            #vsco-tub-collection-drawer .vsco-tub-collection-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
            #vsco-tub-collection-drawer .vsco-tub-collection-head strong { font-size: 18px; }
            #vsco-tub-collection-drawer .vsco-tub-collection-summary { color: #777; font-size: 11px; margin: -8px 0 14px; }
            #vsco-tub-nav-launcher nav button[aria-pressed="true"] { color: #fff; font-weight: 700; }
            #vsco-tub-profile-image-tool { position: fixed; z-index: 2147483646; right: 18px; top: 112px; }
            #vsco-tub-profile-image-tool button { border: 1px solid #bbb; border-radius: 7px; background: #111; color: #fff; padding: 8px 10px; cursor: pointer; font: 12px/1.2 system-ui, sans-serif; box-shadow: 0 5px 18px rgba(0,0,0,.2); }
            #vsco-tub-collection-drawer select { width: 100%; box-sizing: border-box; margin: 0 0 14px; padding: 7px 8px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #111; }
            #vsco-tub-collection-drawer button { cursor: pointer; }
            #vsco-tub-collection-drawer .vsco-tub-collection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            #vsco-tub-collection-drawer .vsco-tub-country-group { margin: 0 0 18px; }
            #vsco-tub-collection-drawer .vsco-tub-country-group h3 { margin: 0 0 8px; font-size: 13px; }
            #vsco-tub-collection-drawer figure { margin: 0; min-width: 0; }
            #vsco-tub-collection-drawer img { width: 100%; aspect-ratio: 1 / 1.15; object-fit: cover; display: block; }
            #vsco-tub-tools-launcher { position: fixed; z-index: 2147483646; left: 16px; top: 128px; font: 12px/1.4 system-ui, sans-serif; }
            #vsco-tub-tools-launcher > button { border: 0; background: transparent; color: #f5f5f5; cursor: pointer; padding: 6px 0; font: inherit; font-weight: 500; }
            .vsco-tub-developer-only { display: none !important; }
            html.vsco-tub-developer-mode .vsco-tub-developer-only { display: revert !important; }
            #vsco-tub-tools-drawer { position: fixed; z-index: 2147483647; inset: 0 0 0 auto; width: min(620px, 96vw); box-sizing: border-box; overflow: auto; background: #fff; color: #111; padding: 18px; box-shadow: -10px 0 35px rgba(0,0,0,.25); font: 12px/1.45 system-ui, sans-serif; }
            #vsco-tub-tools-drawer[hidden] { display: none; }
            #vsco-tub-tools-drawer .vsco-tub-tools-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
            #vsco-tub-tools-drawer .vsco-tub-expansion { border: 1px solid #ddd; border-radius: 7px; padding: 10px 12px; color: #555; }
            #vsco-tub-tools-drawer .vsco-tub-expansion summary { cursor: pointer; color: #222; font-weight: 600; }
            #vsco-tub-tools-drawer .vsco-tub-expansion-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 7px; }
            #vsco-tub-tools-drawer .vsco-tub-expansion button { border: 1px solid #aaa; border-radius: 5px; background: #fff; padding: 6px 10px; cursor: pointer; }
            #vsco-tub-tools-drawer .vsco-tub-expansion button:disabled { cursor: default; opacity: .45; }
            #vsco-tub-tools-drawer .vsco-tub-grpc-target { min-width: 250px; flex: 1; border: 1px solid #aaa; border-radius: 5px; padding: 6px 8px; font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
            #vsco-tub-tools-drawer .vsco-tub-grpc-probe-count { width: 86px; border: 1px solid #aaa; border-radius: 5px; padding: 6px 8px; }
            #vsco-tub-tools-drawer .vsco-tub-expansion-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 3px 12px; }
            #vsco-tub-tools-drawer .vsco-tub-expansion-queries { max-height: 92px; overflow: auto; margin-top: 7px; overflow-wrap: anywhere; }
            #vsco-tub-tools-drawer .vsco-tub-grpc-suite-output { box-sizing: border-box; max-height: 560px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 9px; background: #f4f4f4; border: 1px solid #ddd; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
            .vsco-tub-rpc-inventory { display: grid; gap: 5px; max-height: 560px; overflow: auto; padding: 8px 0; }
            .vsco-tub-rpc-inventory .vsco-tub-rpc-inventory-row { display: block; width: 100%; box-sizing: border-box; text-align: left; border: 1px solid #ccc; border-radius: 5px; background: #fff; color: #222; padding: 7px 9px; cursor: pointer; font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
            .vsco-tub-rpc-inventory .blocked_mutation, .vsco-tub-rpc-inventory .blocked_admin_internal { color: #8a3b12; background: #fff8f1; }
            .vsco-tub-rpc-inventory .mutation_requires_confirmation { color: #8a3b12; background: #fff8f1; }
            #vsco-tub-collection-drawer figcaption { display: flex; gap: 6px; justify-content: space-between; padding-top: 5px; overflow: hidden; }
            #vsco-tub-collection-drawer .vsco-tub-collection-profiles { display: grid; gap: 7px; margin-top: 20px; }
            #vsco-tub-collection-drawer .vsco-tub-collection-profiles > div { display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px solid #eee; }
            #vsco-tub-collection-drawer .vsco-tub-collection-watches { display: grid; gap: 7px; margin-top: 20px; }
            #vsco-tub-collection-drawer .vsco-tub-collection-watches > div { display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px solid #eee; }
            #vsco-tub-collection-drawer .vsco-tub-collection-watches small { color: #777; }
            #vsco-tub-collection-drawer a { color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
            @media (max-width: 640px) { #vsco-tub-settings-launcher { left: 10px; top: 50px; } #vsco-tub-settings-launcher .vsco-tub-settings-menu { width: min(282px, calc(100vw - 20px)); } }
        `;
        document.head.appendChild(style);
    }

    function findNativeResults(mode) {
        if (mode === 'images') {
            const figure = document.querySelector('figure.MediaThumbnail');
            return figure?.closest('section') || figure?.parentElement || null;
        }
        const lists = [...document.querySelectorAll('main ul')];
        const resultList = lists.find(list => list.querySelector('a[href$="/gallery"], button'));
        return resultList?.closest('section') || resultList || null;
    }

    function hideNativeResults(mode) {
        const native = findNativeResults(mode);
        if (native && !native.classList.contains('vsco-tub-native-hidden')) {
            native.classList.add('vsco-tub-native-hidden');
        }
        document.querySelectorAll('main button').forEach(button => {
            if (button.textContent.trim().toLowerCase() === 'load more') {
                button.classList.add('vsco-tub-native-hidden');
            }
        });
        document.querySelectorAll('main grain-button').forEach(button => {
            if (button.textContent.trim().toLowerCase() === 'load more') {
                (button.parentElement || button).classList.add('vsco-tub-native-hidden');
            }
        });
    }

    function guardNativeSearchForm() {
        if (searchInputGuardInstalled) return;
        searchInputGuardInstalled = true;
        window.addEventListener('input', event => {
            const input = event.target?.matches?.('input.SearchFormInput') ? event.target : null;
            if (!input) return;
            guardedInputState = { value: input.value };
            event.stopImmediatePropagation();
            queueMicrotask(() => restoreGuardedInputValue());
        }, true);
        window.addEventListener('click', event => {
            const button = event.target.closest?.('button.SearchFormInput-clearButton');
            if (!button) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const input = document.querySelector('input.SearchFormInput');
            if (!input) return;
            input.value = '';
            guardedInputState = { value: '' };
            submitSearch('');
        }, true);
        window.addEventListener('submit', event => {
            const input = event.target?.querySelector?.('input.SearchFormInput');
            if (!input) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            submitSearch(guardedInputState?.value ?? input.value);
        }, true);
        window.addEventListener('keydown', event => {
            const input = event.target?.matches?.('input.SearchFormInput') ? event.target : null;
            if (!input) return;
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            submitSearch(guardedInputState?.value ?? input.value);
        }, true);
    }

    function restoreGuardedInputValue() {
        const tracked = guardedInputState;
        const input = document.querySelector('input.SearchFormInput');
        if (!tracked || !input || input.value === tracked.value) return;
        input.value = tracked.value;
    }

    function submitSearch(value) {
        const mode = currentSearch()?.mode || (location.pathname.includes('/images') ? 'images' : 'people');
        const query = String(value || '').trim();
        const target = query ? `/search/${mode}/${encodeURIComponent(query)}` : `/search/${mode}`;
        guardedInputState = null;
        history.pushState({}, '', target);
        activeKey = '';
        tick();
    }

    function syncNativeSearchLinks(search) {
        if (!search) return;
        if (search.autonomous) return;
        const encoded = encodeURIComponent(search.query);
        const paths = {
            People: `/search/people/${encoded}`,
            Images: `/search/images/${encoded}`,
            Blogs: `/search/journal/${encoded}`
        };
        document.querySelectorAll('main a').forEach(link => {
            const label = link.textContent.trim();
            if (paths[label]) link.href = paths[label];
        });
    }

    function installGlobalSettingsLauncher() {
        if (document.getElementById('vsco-tub-settings-launcher') || !document.body) return;
        const launcher = document.createElement('div');
        launcher.id = 'vsco-tub-settings-launcher';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '⚙ Settings';
        const menu = document.createElement('div');
        menu.className = 'vsco-tub-settings-menu';

        const title = document.createElement('div');
        title.className = 'vsco-tub-settings-title';
        title.textContent = 'VSCO Tub Experiment';
        const subtitle = document.createElement('div');
        subtitle.className = 'vsco-tub-settings-subtitle';
        subtitle.textContent = 'Experimental controls';

        const section = (name) => {
            const wrapper = document.createElement('section');
            wrapper.className = 'vsco-tub-settings-section';
            const heading = document.createElement('h3');
            heading.className = 'vsco-tub-settings-section-title';
            heading.textContent = name;
            wrapper.appendChild(heading);
            menu.appendChild(wrapper);
            return wrapper;
        };

        const check = (text, checked, onChange, disabled = false) => {
            const label = document.createElement('label');
            label.className = 'vsco-tub-settings-check' + (disabled ? ' vsco-tub-settings-coming' : '');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = checked;
            input.disabled = disabled;
            input.addEventListener('change', onChange);
            label.append(input, document.createTextNode(text));
            return label;
        };

        const select = (text, values, current, onChange) => {
            const label = document.createElement('label');
            label.textContent = text;
            const input = document.createElement('select');
            values.forEach(([value, name]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = name;
                input.appendChild(option);
            });
            input.value = current;
            input.addEventListener('change', onChange);
            label.appendChild(input);
            return label;
        };

        const textFilter = (text, current, placeholder, onChange) => {
            const label = document.createElement('label');
            label.textContent = text;
            const input = document.createElement('input');
            input.type = 'search';
            input.value = current;
            input.placeholder = placeholder;
            input.addEventListener('change', onChange);
            label.appendChild(input);
            return label;
        };

        const save = () => chrome.storage.local.set({ enhancedSearchSettings: searchSettings });
        const rerender = () => {
            if (!state) return;
            renderResults(state.mode, state.response);
            if (state.mode === 'images' || state.mode === 'people') applyDecodedImageRecords([], false);
        };

        menu.append(title, subtitle);
        const searchSection = section('Search');
        const expansionLabel = document.createElement('label');
        expansionLabel.className = 'vsco-tub-settings-check';
        const expansion = document.createElement('input');
        expansion.type = 'checkbox';
        expansion.checked = searchSettings.expansionEnabled;
        expansionLabel.append(expansion, document.createTextNode('Start seedless discovery after every submitted search'));
        searchSection.appendChild(expansionLabel);
        const searchInfo = document.createElement('div');
        searchInfo.className = 'vsco-tub-settings-help';
        searchInfo.textContent = 'The submitted search supplies the initial 10,000-result corpus. Automatic discovery then searches newly found terms without reusing the original search.';
        searchSection.appendChild(searchInfo);
        const autonomousCountry = select('Autonomous discovery country', [
            ['ALL', 'Worldwide / no GPS country filter'],
            ['IE', 'Ireland'],
            ['IL', 'Israel'],
            ['CA', 'Canada']
        ], searchSettings.autonomousCountry, () => {
            searchSettings.autonomousCountry = autonomousCountryInput.value;
            save();
        });
        const autonomousCountryInput = autonomousCountry.querySelector('select');
        searchSection.appendChild(autonomousCountry);
        const countryInfo = document.createElement('div');
        countryInfo.className = 'vsco-tub-settings-help';
        countryInfo.textContent = 'Names and terms guide starter searches only. Country results are verified from returned GPS metadata, never inferred from a name.';
        searchSection.appendChild(countryInfo);

        const gallerySection = section('Gallery');
        const size = select('Gallery size', [['compact', 'Compact'], ['medium', 'Medium'], ['large', 'Large']], searchSettings.gallerySize, () => {
            searchSettings.gallerySize = sizeInput.value;
            save();
            rerender();
        });
        const sizeInput = size.querySelector('select');
        gallerySection.appendChild(size);
        const batch = select('Render batch', [['30', '30 at a time'], ['60', '60 at a time'], ['120', '120 at a time']], String(searchSettings.batchSize), () => {
            searchSettings.batchSize = Number(batchInput.value);
            save();
        });
        const batchInput = batch.querySelector('select');
        gallerySection.appendChild(batch);
        const profile = select('Profile images', [['avatar', 'Circular avatar'], ['full-image', 'Full image']], searchSettings.profileImageMode, () => {
            searchSettings.profileImageMode = profileInput.value;
            save();
            rerender();
        });
        const profileInput = profile.querySelector('select');
        gallerySection.appendChild(profile);
        const profileAspect = select('Profile image shape', [['crop', 'Cropped'], ['full', 'Full aspect ratio']], searchSettings.profileImageAspect, () => {
            searchSettings.profileImageAspect = profileAspectInput.value;
            save();
            rerender();
        });
        const profileAspectInput = profileAspect.querySelector('select');
        gallerySection.appendChild(profileAspect);
        const imageAspect = select('Search image shape', [['crop', 'Cropped'], ['full', 'Full aspect ratio']], searchSettings.imageAspect, () => {
            searchSettings.imageAspect = imageAspectInput.value;
            save();
            rerender();
        });
        const imageAspectInput = imageAspect.querySelector('select');
        gallerySection.appendChild(imageAspect);

        const infoSection = section('Visible information');
        const infoOptions = [
            ['showImageDescriptions', 'Image captions / descriptions'],
            ['showUsernames', 'Usernames'],
            ['showProfileImages', 'Profile images'],
            ['showProfileBio', 'Profile bio / display name'],
            ['showProfileBioLength', 'Profile bio length'],
            ['showProfileLink', 'Profile link'],
            ['showMediaLink', 'Media link'],
            ['showImageId', 'Media ID'],
            ['showProfileImageUrl', 'Profile image URL'],
            ['showProfileImageId', 'Profile image ID'],
            ['showProfileSiteId', 'Profile site ID'],
            ['showPostedAge', 'Posted age (images + profiles)']
        ];
        infoOptions.forEach(([key, label]) => infoSection.appendChild(check(label, searchSettings[key], event => {
            searchSettings[key] = event.target.checked;
            save();
            rerender();
        })));

        const sortSection = section('Sort and filter');
        const sort = select('Order', [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['random', 'Random'], ['site-high', 'Site ID: high to low'], ['site-low', 'Site ID: low to high']], searchSettings.sortOrder, () => {
            searchSettings.sortOrder = sortInput.value;
            save();
            rerender();
        });
        const sortInput = sort.querySelector('select');
        sortSection.appendChild(sort);
        const timeframe = select('Timeframe', [['all', 'Any time'], ['day', 'Last 24 hours'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['year', 'Last year']], searchSettings.timeWindow, () => {
            searchSettings.timeWindow = timeframeInput.value;
            save();
            rerender();
        });
        const timeframeInput = timeframe.querySelector('select');
        sortSection.appendChild(timeframe);
        const metadataStatus = select('Metadata', [['all', 'Any metadata state'], ['fetched', 'Metadata fetched'], ['pending', 'Not fetched yet']], searchSettings.metadataStatus, () => {
            searchSettings.metadataStatus = metadataStatusInput.value;
            save();
            rerender();
        });
        const metadataStatusInput = metadataStatus.querySelector('select');
        const metadataGps = select('GPS', [['all', 'Any GPS state'], ['yes', 'Has GPS coordinates'], ['no', 'No GPS coordinates']], searchSettings.metadataGps, () => {
            searchSettings.metadataGps = metadataGpsInput.value;
            save();
            rerender();
        });
        const metadataGpsInput = metadataGps.querySelector('select');
        const metadataExif = select('EXIF', [['all', 'Any EXIF state'], ['yes', 'Has EXIF metadata'], ['no', 'No EXIF metadata']], searchSettings.metadataExif, () => {
            searchSettings.metadataExif = metadataExifInput.value;
            save();
            rerender();
        });
        const metadataExifInput = metadataExif.querySelector('select');
        const cameraFilter = textFilter('Camera / phone', searchSettings.metadataCamera, 'e.g. iPhone 15 Pro or Canon', () => {
            searchSettings.metadataCamera = cameraFilterInput.value.trim();
            save();
            rerender();
        });
        const cameraFilterInput = cameraFilter.querySelector('input');
        const softwareFilter = textFilter('Software', searchSettings.metadataSoftware, 'e.g. VSCO Android', () => {
            searchSettings.metadataSoftware = softwareFilterInput.value.trim();
            save();
            rerender();
        });
        const softwareFilterInput = softwareFilter.querySelector('input');
        const metadataQueryFilter = textFilter('Any metadata field', searchSettings.metadataQuery, 'model, ISO, tag, filename, platform…', () => {
            searchSettings.metadataQuery = metadataQueryInput.value.trim();
            save();
            rerender();
        });
        const metadataQueryInput = metadataQueryFilter.querySelector('input');
        const countryFilter = textFilter('Country', searchSettings.metadataCountry, 'Italy, IT, United States…', () => {
            searchSettings.metadataCountry = countryFilterInput.value.trim();
            save();
            rerender();
        });
        const countryFilterInput = countryFilter.querySelector('input');
        const profileRatio = select('Profile image ratio', [['all', 'Any ratio'], ['tall-4-5', 'Tall (4:5+)'], ['tall-2-3', 'Very tall (2:3+)'], ['tall-9-16', 'Phone portrait (9:16+)']], searchSettings.profileAspect, () => {
            searchSettings.profileAspect = profileRatioInput.value;
            save();
            rerender();
        });
        const profileRatioInput = profileRatio.querySelector('select');
        const groupImages = select('Group images', [['none', 'No grouping'], ['country', 'Group by country']], searchSettings.groupImagesBy, () => {
            searchSettings.groupImagesBy = groupImagesInput.value;
            save();
            rerender();
        });
        const groupImagesInput = groupImages.querySelector('select');
        sortSection.append(metadataStatus, metadataGps, metadataExif, cameraFilter, softwareFilter, metadataQueryFilter, countryFilter, profileRatio, groupImages);
        const sortHelp = document.createElement('div');
        sortHelp.className = 'vsco-tub-settings-help';
        sortHelp.textContent = 'Sorting happens locally after the 10,000-result API response. Profile image ratio uses fetched width/height metadata; unchecked profiles remain pending.';
        sortSection.appendChild(sortHelp);

        const developerSection = section('Developer / experimental');
        const developer = check('Developer mode', searchSettings.developerMode, () => {
            searchSettings.developerMode = developerInput.checked;
            save();
            applyDeveloperMode();
            updateDiagnostics();
        });
        const developerInput = developer.querySelector('input');
        developerSection.appendChild(developer);
        const workers = select('Expansion workers', [['3', '3 workers'], ['6', '6 workers'], ['9', '9 workers'], ['12', '12 workers']], String(searchSettings.expansionWorkers), () => {
            searchSettings.expansionWorkers = Number(workersInput.value);
            save();
        });
        const workersInput = workers.querySelector('select');
        developerSection.appendChild(workers);
        const diagnostics = document.createElement('div');
        diagnostics.className = 'vsco-tub-settings-status';
        const updateDiagnostics = () => {
            diagnostics.hidden = !searchSettings.developerMode;
            diagnostics.textContent = `Active: ${currentSearch()?.mode || 'idle'} API · 10k seed · ${searchSettings.expansionWorkers} expansion workers`;
        };
        updateDiagnostics();
        developerSection.appendChild(diagnostics);
        const help = document.createElement('span');
        help.className = 'vsco-tub-settings-help';
        help.textContent = 'Settings persist in this experimental extension profile. Unfinished controls are intentionally disabled.';
        button.addEventListener('click', () => menu.classList.toggle('open'));
        expansion.addEventListener('change', () => {
            searchSettings.expansionEnabled = expansion.checked;
            save();
            if (expansion.checked && state && ['images', 'people'].includes(state.mode)) expandUntilSaturated();
            if (!expansion.checked) stopExpansion();
        });
        menu.appendChild(help);
        launcher.append(button, menu);
        document.body.appendChild(launcher);
    }

    function persistSavedImages() {
        chrome.storage.local.set({ vscoTubSavedImages: [...savedImages.values()], vscoTubSavedProfiles: [...savedProfiles.values()] });
        updateCollectionUi();
    }

    function toggleSavedProfile(item) {
        const id = String(item?.siteId || item?.id || item?.username || '');
        if (!id) return;
        if (savedProfiles.has(id)) savedProfiles.delete(id);
        else savedProfiles.set(id, { id, siteId: item.siteId || '', username: item.username || '', displayName: item.displayName || '', description: item.description || '', profileImageUrl: item.profileImageUrl || item.imageUrl || '', savedAt: Date.now() });
        persistSavedImages();
    }

    function toggleSavedImage(item) {
        const id = String(item?.id || '');
        if (!id) return;
        if (savedImages.has(id)) savedImages.delete(id);
        else {
            const metadata = grpcImageRecords.get(id);
            const location = metadata?.location || metadata?.imageMeta?.location;
            const search = currentSearch();
            savedImages.set(id, {
                id,
                username: item.username || '',
                description: item.description || '',
                imageUrl: item.imageUrl || `https://i.vsco.co/${encodeURIComponent(id)}`,
                mediaUrl: item.username ? `https://vsco.co/${encodeURIComponent(item.username)}/media/${encodeURIComponent(id)}` : `https://i.vsco.co/${encodeURIComponent(id)}`,
                savedAt: Date.now(),
                sourceSearch: search?.query || '',
                sourceMode: search?.mode || '',
                country: metadata?.country || null,
                location: location || null,
                camera: [metadata?.imageMeta?.make, metadata?.imageMeta?.model].filter(Boolean).join(' ') || ''
            });
        }
        persistSavedImages();
    }

    function updateCollectionUi() {
        const launcher = document.querySelector('#vsco-tub-collection-launcher > button');
        if (launcher) launcher.textContent = `♡ Collection (${(savedImages.size + savedProfiles.size).toLocaleString()})`;
        const navCollection = document.querySelector('#vsco-tub-nav-collection');
        if (navCollection) navCollection.textContent = `♡ Collection (${(savedImages.size + savedProfiles.size).toLocaleString()})`;
        document.querySelectorAll('.vsco-tub-save[data-media-id]').forEach(button => {
            const isSaved = savedImages.has(button.dataset.mediaId);
            button.classList.toggle('saved', isSaved);
            button.setAttribute('aria-label', isSaved ? 'Remove from Collection' : 'Save to Collection');
            button.title = isSaved ? 'Remove from Collection' : 'Save to Collection';
            button.setAttribute('aria-pressed', String(isSaved));
        });
        const summary = document.querySelector('#vsco-tub-collection-summary');
        if (summary) {
            const gpsCount = [...savedImages.values()].filter(item => item.location).length;
            const watchCount = [...watchedSearchDetails.values()].filter(item => item.enabled).length;
            summary.textContent = `${savedImages.size.toLocaleString()} images · ${gpsCount.toLocaleString()} with GPS · ${savedProfiles.size.toLocaleString()} creators · ${watchCount.toLocaleString()} watched worlds`;
        }
        renderCollectionDrawer();
    }

    function renderCollectionDrawer() {
        const drawer = document.getElementById('vsco-tub-collection-drawer');
        if (!drawer || drawer.hidden) return;
        const grid = drawer.querySelector('.vsco-tub-collection-grid');
        grid.textContent = '';
        const items = [...savedImages.values()]
            .filter(item => collectionFilter !== 'creators' && (collectionFilter === 'all'
                || (collectionFilter === 'gps' && item.location)
                || (collectionFilter === 'country' && item.country?.name)
                || (collectionFilter === 'camera' && item.camera)
                || (collectionFilter === 'search' && item.sourceSearch)))
            .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        if (!items.length && collectionFilter !== 'creators') {
            const empty = document.createElement('p');
            empty.textContent = savedImages.size && collectionFilter !== 'all'
                ? 'Nothing in your collection matches this filter yet.'
                : 'Save images from search results and they will appear here.';
            grid.appendChild(empty);
            if (savedImages.size && collectionFilter !== 'all') {
                const showAll = document.createElement('button');
                showAll.type = 'button';
                showAll.textContent = 'Show all saved';
                showAll.addEventListener('click', () => {
                    collectionFilter = 'all';
                    chrome.storage.local.set({ vscoTubCollectionFilter: 'all' });
                    const filter = drawer.querySelector('select[aria-label="Filter collection"]');
                    if (filter) filter.value = 'all';
                    renderCollectionDrawer();
                });
                grid.appendChild(showAll);
            }
            return;
        }
        let targetGrid = grid;
        let targetCountry = '';
        items.forEach(item => {
            if (collectionFilter === 'country' || collectionFilter === 'camera' || collectionFilter === 'search') {
                const groupLabel = collectionFilter === 'camera'
                    ? (item.camera || 'Camera unavailable')
                    : collectionFilter === 'search'
                        ? (item.sourceSearch ? `“${item.sourceSearch}”` : 'Search unavailable')
                        : (item.country?.name || item.country?.code || 'Country unavailable');
                if (groupLabel !== targetCountry) {
                    targetCountry = groupLabel;
                    const section = document.createElement('section');
                    section.className = 'vsco-tub-country-group';
                    const heading = document.createElement('h3');
                    heading.textContent = groupLabel;
                    targetGrid = document.createElement('div');
                    targetGrid.className = 'vsco-tub-collection-grid';
                    section.append(heading, targetGrid);
                    grid.appendChild(section);
                }
            }
            const figure = document.createElement('figure');
            const link = makeSafeNewTab(document.createElement('a'));
            link.href = item.mediaUrl;
            const image = document.createElement('img');
            image.src = item.imageUrl;
            image.loading = 'lazy';
            image.alt = item.description || item.username || 'Saved VSCO image';
            link.appendChild(image);
            const caption = document.createElement('figcaption');
            const label = document.createElement('span');
            label.textContent = item.username || item.id;
            const context = document.createElement('small');
            const parts = [];
            const lat = Number(item.location?.lat);
            const lng = Number(item.location?.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) parts.push(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            if (item.country?.name) parts.push(item.country.name);
            if (item.camera) parts.push(item.camera);
            if (item.sourceSearch) parts.push(`from “${item.sourceSearch}”`);
            context.textContent = parts.join(' · ');
            context.style.color = '#777';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => toggleSavedImage(item));
            caption.append(document.createElement('span'));
            caption.firstChild.append(label, context);
            caption.append(remove);
            figure.append(link, caption);
            targetGrid.appendChild(figure);
        });
        const profileRoot = drawer.querySelector('.vsco-tub-collection-profiles');
        if (profileRoot) {
            profileRoot.textContent = '';
            const profiles = [...savedProfiles.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            if (profiles.length) {
                const heading = document.createElement('strong');
                heading.textContent = 'Saved creators';
                profileRoot.appendChild(heading);
                profiles.forEach(profile => {
                    const row = document.createElement('div');
                    const link = makeSafeNewTab(document.createElement('a'));
                    link.href = `/${encodeURIComponent(profile.username)}/gallery`;
                    link.textContent = profile.displayName || profile.username || profile.id;
                    const remove = document.createElement('button');
                    remove.type = 'button'; remove.textContent = 'Remove';
                    remove.addEventListener('click', () => toggleSavedProfile(profile));
                    row.append(link, remove); profileRoot.appendChild(row);
                });
            } else if (collectionFilter === 'creators') {
                const empty = document.createElement('p');
                empty.textContent = 'Save creators from People search results and they will appear here.';
                profileRoot.appendChild(empty);
            }
        }
        const watchRoot = drawer.querySelector('.vsco-tub-collection-watches');
        if (watchRoot) {
            watchRoot.textContent = '';
            const watches = [...watchedSearchDetails.values()].sort((a, b) => String(a.query).localeCompare(String(b.query)));
            if (watches.length) {
                const heading = document.createElement('strong');
                heading.textContent = 'Watched visual worlds';
                watchRoot.appendChild(heading);
                watches.forEach(watch => {
                    const row = document.createElement('div');
                    const link = makeSafeNewTab(document.createElement('a'));
                    link.href = `/search/${watch.mode === 'people' ? 'people' : 'images'}/${encodeURIComponent(watch.query)}`;
                    link.textContent = `${watch.mode === 'people' ? 'People' : 'Images'} · ${watch.query}`;
                    const freshness = document.createElement('small');
                    const modeLabel = watch.mode === 'people' ? 'People' : 'Images';
                    const stateLabel = watch.enabled ? 'active' : 'muted';
                    freshness.textContent = `${modeLabel} · ${stateLabel} · ${watch.lastCheckedAt ? `checked ${new Date(watch.lastCheckedAt).toLocaleDateString()}` : 'checking soon'}`;
                    const mute = document.createElement('button');
                    mute.type = 'button';
                    mute.textContent = watch.enabled ? 'Mute' : 'Unmute';
                    mute.title = watch.enabled ? `Stop watching “${watch.query}”` : `Resume watching “${watch.query}”`;
                    mute.addEventListener('click', async () => {
                        const response = await sendRuntimeMessage({ action: 'enhancedVscoSavedSearchToggle', mode: watch.mode, query: watch.query, enabled: !watch.enabled });
                        if (response?.ok) {
                            watch.enabled = !watch.enabled;
                            if (watch.enabled) watchedSearchIds.add(watch.id);
                            else watchedSearchIds.delete(watch.id);
                            updateCollectionUi();
                        }
                    });
                    row.append(link, freshness, mute);
                    watchRoot.appendChild(row);
                });
            }
        }
    }

    function installCollectionLauncher() {
        if (document.getElementById('vsco-tub-collection-launcher') || !document.body) return;
        const launcher = document.createElement('div');
        launcher.id = 'vsco-tub-collection-launcher';
        const open = document.createElement('button');
        open.type = 'button';
        const drawer = document.createElement('aside');
        drawer.id = 'vsco-tub-collection-drawer';
        drawer.hidden = true;
        const head = document.createElement('div');
        head.className = 'vsco-tub-collection-head';
        const title = document.createElement('strong');
        title.textContent = 'Collection';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', () => { drawer.hidden = true; });
        head.append(title, close);
        const summary = document.createElement('div');
        summary.id = 'vsco-tub-collection-summary';
        summary.className = 'vsco-tub-collection-summary';
        const filter = document.createElement('select');
        filter.setAttribute('aria-label', 'Filter collection');
        [['all', 'All saved'], ['gps', 'With location'], ['country', 'By country'], ['camera', 'By camera'], ['search', 'From a search'], ['creators', 'Saved creators']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            filter.appendChild(option);
        });
        filter.value = collectionFilter;
        filter.addEventListener('change', () => {
            collectionFilter = filter.value;
            chrome.storage.local.set({ vscoTubCollectionFilter: collectionFilter });
            renderCollectionDrawer();
        });
        const grid = document.createElement('div');
        grid.className = 'vsco-tub-collection-grid';
        const profiles = document.createElement('div');
        profiles.className = 'vsco-tub-collection-profiles';
        const watches = document.createElement('div');
        watches.className = 'vsco-tub-collection-watches';
        drawer.append(head, summary, filter, grid, profiles, watches);
        open.addEventListener('click', () => { drawer.hidden = !drawer.hidden; renderCollectionDrawer(); });
        launcher.appendChild(open);
        document.body.append(launcher, drawer);
        updateCollectionUi();
    }

    function installProductNavLauncher() {
        if (document.getElementById('vsco-tub-nav-launcher') || !document.body) return;
        const launcher = document.createElement('div');
        launcher.id = 'vsco-tub-nav-launcher';
        const nav = document.createElement('nav');
        const label = document.createElement('span');
        label.className = 'vsco-tub-nav-label';
        label.textContent = 'Tub';
        nav.appendChild(label);
        const action = (text, handler, current = false) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            if (current) button.setAttribute('aria-current', 'page');
            button.addEventListener('click', handler);
            nav.appendChild(button);
            return button;
        };
        action('⌕ Explore', () => {
            const input = document.querySelector(`#${ROOT_ID} input[type="search"], #${ROOT_ID} input:not([type])`);
            input?.focus();
            input?.select?.();
            document.getElementById(ROOT_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, Boolean(state));
        const selectedCountryName = { IE: 'Ireland', IL: 'Israel', CA: 'Canada' }[searchSettings.autonomousCountry] || 'Worldwide';
        action(`∞ Discover profiles · ${selectedCountryName}`, () => {
            const country = ['ALL', 'IE', 'IL', 'CA'].includes(searchSettings.autonomousCountry) ? searchSettings.autonomousCountry : 'ALL';
            location.assign(`/search/people?vsco_tub=discover-profiles&country=${country}`);
        }, currentSearch()?.autonomous === true);
        const setWindow = value => {
            selectDiscoveryWindow(value);
        };
        const todayAction = action('◷ Today', () => setWindow('day'));
        todayAction.dataset.timeWindow = 'day';
        todayAction.setAttribute('aria-pressed', String(searchSettings.timeWindow === 'day'));
        const weekAction = action('◷ This week', () => setWindow('week'));
        weekAction.dataset.timeWindow = 'week';
        weekAction.setAttribute('aria-pressed', String(searchSettings.timeWindow === 'week'));
        action('◎ World map', openLocationMap);
        const collectionAction = action('♡ Collection', () => document.querySelector('#vsco-tub-collection-launcher > button')?.click());
        collectionAction.id = 'vsco-tub-nav-collection';
        launcher.appendChild(nav);
        document.body.appendChild(launcher);
    }

    function installProfileImageTool() {
        const isProfile = /^\/(?!search\/)[^/]+\/gallery\/?$/i.test(location.pathname);
        const existing = document.getElementById('vsco-tub-profile-image-tool');
        if (!isProfile) { existing?.remove(); return; }
        if (existing || !document.body) return;
        const images = [...document.querySelectorAll('main img, [role="main"] img, img')].filter(image => image.complete && image.naturalWidth > 80);
        const profileImage = images.find(image => {
            const rect = image.getBoundingClientRect();
            return rect.top > 60 && rect.top < innerHeight && rect.left > 240 && rect.width >= 70 && rect.width <= 420;
        });
        if (!profileImage?.src) return;
        const launcher = document.createElement('div');
        launcher.id = 'vsco-tub-profile-image-tool';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '↗ Full profile image';
        button.title = 'Open the profile image at its original URL';
        button.addEventListener('click', () => window.open(profileImage.currentSrc || profileImage.src, '_blank', 'noopener,noreferrer'));
        launcher.appendChild(button);
        document.body.appendChild(launcher);
    }

    function installGlobalToolsLauncher() {
        if (document.getElementById('vsco-tub-tools-launcher') || !document.body) return;
        const launcher = document.createElement('div');
        launcher.id = 'vsco-tub-tools-launcher';
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = '⚗ Tools';
        const drawer = document.createElement('aside');
        drawer.id = 'vsco-tub-tools-drawer';
        drawer.hidden = true;
        const head = document.createElement('div');
        head.className = 'vsco-tub-tools-head';
        const title = document.createElement('strong');
        title.textContent = 'VSCO Tub tools';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', () => { drawer.hidden = true; });
        head.append(title, close);
        const controls = createExpansionDetails(state?.response || {});
        controls.open = true;
        drawer.append(head, controls);
        open.addEventListener('click', () => {
            drawer.hidden = !drawer.hidden;
            if (!drawer.hidden) {
                const currentMediaId = normalizeMediaId(location.href);
                const target = drawer.querySelector('.vsco-tub-grpc-target');
                if (currentMediaId && target) target.value = currentMediaId;
                renderExpansionDetails();
            }
        });
        launcher.appendChild(open);
        document.body.append(launcher, drawer);
        renderExpansionDetails();
    }

    function applyDeveloperMode() {
        document.documentElement.classList.toggle('vsco-tub-developer-mode', searchSettings.developerMode === true);
        const launcher = document.getElementById('vsco-tub-tools-launcher');
        if (launcher) launcher.hidden = false;
        document.querySelectorAll('.vsco-tub-advanced-toggle').forEach(button => {
            button.textContent = searchSettings.developerMode ? 'Hide advanced gRPC tools' : 'Show advanced gRPC tools';
            button.setAttribute('aria-pressed', String(searchSettings.developerMode === true));
        });
    }

    function createRoot(mode) {
        let root = document.getElementById(ROOT_ID);
        if (root) return root;
        const main = document.querySelector('main');
        if (!main) return null;
        root = document.createElement('section');
        root.id = ROOT_ID;
        root.dataset.mode = mode;
        main.appendChild(root);
        return root;
    }

    function setStatus(text, error = false) {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;
        let status = root.querySelector('.vsco-tub-status');
        if (!status) {
            status = document.createElement('p');
            status.className = 'vsco-tub-status';
            root.prepend(status);
        }
        status.textContent = text;
        status.classList.toggle('vsco-tub-error', error);
    }

    function formatAge(timestamp) {
        if (!timestamp) return '';
        const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
        if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
        return `${Math.floor(seconds / 31536000)}y ago`;
    }

    function compareSiteIds(a, b) {
        const left = String(a?.siteId || a?.id || '');
        const right = String(b?.siteId || b?.id || '');
        if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
            try {
                const delta = BigInt(left) - BigInt(right);
                return delta > 0n ? 1 : delta < 0n ? -1 : 0;
            } catch { /* use lexical ordering below */ }
        }
        return left.localeCompare(right, undefined, { numeric: true });
    }

    function visibleItems(items) {
        const windows = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
        const windowMs = windows[searchSettings.timeWindow];
        let filtered = windowMs ? items.filter(item => item.timestamp && Date.now() - item.timestamp <= windowMs) : items.slice();
        if (items.some(item => metadataImageId(item)) && metadataFiltersActive()) {
            const cameraNeedle = searchSettings.metadataCamera.trim().toLowerCase();
            const softwareNeedle = searchSettings.metadataSoftware.trim().toLowerCase();
            const metadataNeedle = searchSettings.metadataQuery.trim().toLowerCase();
            const countryNeedle = searchSettings.metadataCountry.trim().toLowerCase();
            const autonomousCountry = state?.response?.autonomousCountry && state.response.autonomousCountry !== 'ALL'
                ? state.response.autonomousCountry.toUpperCase()
                : '';
            filtered = filtered.filter(item => {
                const imageId = metadataImageId(item);
                const record = grpcImageRecords.get(imageId);
                if (searchSettings.metadataStatus === 'fetched' && !record) return false;
                if (searchSettings.metadataStatus === 'pending' && record) return false;
                if (!record) {
                    // A persisted metadata filter can be active before the
                    // automatic probe starts. Keep unchecked results visible
                    // as pending instead of presenting a misleading empty
                    // search, then classify them as each batch completes.
                    if (!grpcCheckedImageIds.has(imageId)) return true;
                    return !cameraNeedle && !softwareNeedle && !metadataNeedle && !countryNeedle && !autonomousCountry
                        && searchSettings.metadataGps !== 'yes'
                        && searchSettings.metadataExif !== 'yes'
                        && searchSettings.profileAspect === 'all';
                }
                const meta = record.imageMeta || null;
                const hasGps = Boolean(record.location || meta?.location);
                if (searchSettings.metadataGps === 'yes' && !hasGps) return false;
                if (searchSettings.metadataGps === 'no' && hasGps) return false;
                if (searchSettings.metadataExif === 'yes' && !meta) return false;
                if (searchSettings.metadataExif === 'no' && meta) return false;
                const camera = [meta?.make, meta?.model].filter(Boolean).join(' ').toLowerCase();
                if (cameraNeedle && !camera.includes(cameraNeedle)) return false;
                const software = String(meta?.software || '').toLowerCase();
                if (softwareNeedle && !software.includes(softwareNeedle)) return false;
                if (metadataNeedle) {
                    const searchable = JSON.stringify(record, (key, value) => key.startsWith('$raw') ? undefined : value).toLowerCase();
                    if (!searchable.includes(metadataNeedle)) return false;
                }
                if (autonomousCountry && String(record.country?.code || '').toUpperCase() !== autonomousCountry) return false;
                if (countryNeedle) {
                    const country = `${record.country?.name || ''} ${record.country?.code || ''}`.toLowerCase();
                    if (!country.includes(countryNeedle)) return false;
                }
                if (state?.mode === 'people' && searchSettings.profileAspect !== 'all') {
                    const width = Number(record.width || meta?.width || record.dimensions?.width || meta?.dimensions?.width || 0);
                    const height = Number(record.height || meta?.height || record.dimensions?.height || meta?.dimensions?.height || 0);
                    if (!(width > 0 && height > 0)) return !grpcCheckedImageIds.has(imageId);
                    const ratio = height / width;
                    const minimum = searchSettings.profileAspect === 'tall-4-5' ? 1.25
                        : searchSettings.profileAspect === 'tall-2-3' ? 1.5 : 16 / 9;
                    if (ratio < minimum) return false;
                }
                return true;
            });
        }
        return filtered.sort((a, b) => {
            if (searchSettings.sortOrder === 'random') {
                const score = value => {
                    let hash = 2166136261;
                    for (const char of String(value?.id || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
                    return hash >>> 0;
                };
                return score(a) - score(b);
            }
            if (searchSettings.sortOrder === 'oldest') return (a.timestamp - b.timestamp) || a.id.localeCompare(b.id);
            if (searchSettings.sortOrder === 'site-high') return compareSiteIds(b, a);
            if (searchSettings.sortOrder === 'site-low') return compareSiteIds(a, b);
            return (b.timestamp - a.timestamp) || b.id.localeCompare(a.id);
        });
    }

    function makeSafeNewTab(link) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
    }

    function makeImageCard(item) {
        const figure = document.createElement('figure');
        figure.dataset.mediaId = String(item.id || '');
        const link = document.createElement('a');
        link.className = 'vsco-tub-image-link';
        link.href = item.username && item.id ? `/${encodeURIComponent(item.username)}/media/${encodeURIComponent(item.id)}` : '#';
        makeSafeNewTab(link);
        const image = document.createElement('img');
        image.src = item.imageUrl;
        image.loading = 'lazy';
        image.draggable = true;
        image.alt = item.description || item.username || 'VSCO image';
        link.appendChild(image);
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'vsco-tub-save';
        save.dataset.mediaId = item.id;
        save.setAttribute('aria-label', 'Save to Collection');
        save.title = 'Save to Collection';
        const saveIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        saveIcon.setAttribute('viewBox', '0 0 24 24');
        saveIcon.setAttribute('aria-hidden', 'true');
        const savePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        savePath.setAttribute('d', 'M6.5 3.5h11v17L12 17l-5.5 3.5z');
        saveIcon.appendChild(savePath);
        save.appendChild(saveIcon);
        save.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggleSavedImage(item); });
        const actions = document.createElement('div');
        actions.className = 'vsco-tub-card-actions';
        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'vsco-tub-reaction';
        favorite.dataset.reactionKind = 'favorite';
        favorite.textContent = '♡';
        favorite.title = 'Toggle favorite';
        favorite.setAttribute('aria-label', 'Toggle favorite');
        const repost = document.createElement('button');
        repost.type = 'button';
        repost.className = 'vsco-tub-reaction';
        repost.dataset.reactionKind = 'repost';
        repost.textContent = '↝';
        repost.title = 'Toggle repost';
        repost.setAttribute('aria-label', 'Toggle repost');
        [[favorite, 'favorite'], [repost, 'repost']].forEach(([button, kind]) => button.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            button.disabled = true;
            try { await toggleCardReaction(item, kind, button); }
            catch (error) { button.textContent = '!'; button.title = error?.message || String(error); }
            finally { button.disabled = false; }
        }));
        actions.append(save, favorite, repost);
        const cachedReaction = reactionStateByMedia.get(String(item.id));
        if (cachedReaction) queueMicrotask(() => paintReactionState(item.id, cachedReaction));
        const caption = document.createElement('figcaption');
        if (searchSettings.showImageDescriptions && item.description) caption.appendChild(document.createTextNode(item.description));
        if (searchSettings.showUsernames && item.username) {
            const user = document.createElement('div');
            user.className = 'vsco-tub-user';
            const userLink = document.createElement('a');
            userLink.href = `/${encodeURIComponent(item.username)}/gallery`;
            makeSafeNewTab(userLink);
            userLink.textContent = item.username;
            user.appendChild(userLink);
            caption.appendChild(user);
        }
        if (searchSettings.showMediaLink && item.id) {
            const mediaLink = document.createElement('a');
            mediaLink.className = 'vsco-tub-meta-link';
            mediaLink.href = link.href;
            makeSafeNewTab(mediaLink);
            mediaLink.textContent = 'Open media link';
            caption.appendChild(mediaLink);
        }
        if (searchSettings.showImageId && item.id) {
            const imageId = document.createElement('span');
            imageId.className = 'vsco-tub-meta-link';
            imageId.textContent = `media ${item.id}`;
            caption.appendChild(imageId);
        }
        if (searchSettings.showPostedAge && item.timestamp) {
            const age = document.createElement('span');
            age.className = 'vsco-tub-age';
            age.textContent = formatAge(item.timestamp);
            caption.appendChild(age);
        }
        figure.append(link, actions, caption);
        const isSaved = savedImages.has(String(item.id));
        save.classList.toggle('saved', isSaved);
        save.setAttribute('aria-label', isSaved ? 'Remove from Collection' : 'Save to Collection');
        save.title = isSaved ? 'Remove from Collection' : 'Save to Collection';
        save.setAttribute('aria-pressed', String(isSaved));
        observeGrpcCard(figure);
        return figure;
    }

    function makePersonRow(item) {
        const row = document.createElement('div');
        row.className = `vsco-tub-person${searchSettings.profileImageMode === 'full-image' ? ' full-image' : ''}${searchSettings.profileImageAspect === 'full' ? ' full-aspect' : ''}`;
        const profileMetadataId = metadataImageId(item);
        if (profileMetadataId) row.dataset.mediaId = profileMetadataId;
        const avatar = document.createElement('img');
        avatar.className = 'vsco-tub-avatar';
        avatar.loading = 'lazy';
        avatar.src = item.profileImageUrl || item.imageUrl || '';
        avatar.alt = item.username || 'VSCO profile';
        const body = document.createElement('div');
        body.className = 'vsco-tub-person-body';
        const link = document.createElement('a');
        link.href = item.username ? `/${encodeURIComponent(item.username)}/gallery` : '#';
        makeSafeNewTab(link);
        link.textContent = searchSettings.showUsernames ? (item.username || item.displayName || 'Unknown profile') : 'VSCO profile';
        const description = document.createElement('div');
        description.className = 'vsco-tub-user';
        if (searchSettings.showProfileBio) description.textContent = item.description || item.displayName || '';
        if (searchSettings.showProfileBioLength && item.description) {
            const length = document.createElement('span');
            length.className = 'vsco-tub-age';
            length.textContent = `${item.description.length} chars`;
            description.appendChild(length);
        }
        const profileRecord = profileMetadataId ? grpcImageRecords.get(profileMetadataId) : null;
        const profileWidth = Number(profileRecord?.width || profileRecord?.imageMeta?.width || 0);
        const profileHeight = Number(profileRecord?.height || profileRecord?.imageMeta?.height || 0);
        if (profileWidth > 0 && profileHeight > 0) {
            const ratio = document.createElement('span');
            ratio.className = 'vsco-tub-age';
            ratio.textContent = `ratio ${(profileHeight / profileWidth).toFixed(2)}:1`;
            description.appendChild(ratio);
        }
        body.append(link, description);
        if (searchSettings.showProfileSiteId && item.siteId) {
            const siteId = document.createElement('div');
            siteId.className = 'vsco-tub-user';
            siteId.textContent = `site ${item.siteId}`;
            body.appendChild(siteId);
        }
        if (searchSettings.showProfileImages) row.appendChild(avatar);
        if (searchSettings.showProfileLink && item.profileUrl) {
            const profileLink = document.createElement('a');
            profileLink.className = 'vsco-tub-meta-link';
            profileLink.href = item.profileUrl;
            makeSafeNewTab(profileLink);
            profileLink.textContent = 'Open profile link';
            body.appendChild(profileLink);
        }
        if (searchSettings.showProfileImageUrl && (item.profileImageUrl || item.imageUrl)) {
            const imageUrl = document.createElement('a');
            imageUrl.className = 'vsco-tub-meta-link';
            imageUrl.href = item.profileImageUrl || item.imageUrl;
            makeSafeNewTab(imageUrl);
            imageUrl.textContent = 'Open profile image';
            body.appendChild(imageUrl);
        }
        if (searchSettings.showProfileImageId && item.profileImageId) {
            const imageId = document.createElement('div');
            imageId.className = 'vsco-tub-meta-link';
            imageId.textContent = `profile image ${item.profileImageId}`;
            body.appendChild(imageId);
        }
        if (searchSettings.showPostedAge && item.timestamp) {
            const age = document.createElement('div');
            age.className = 'vsco-tub-user';
            age.textContent = `posted ${formatAge(item.timestamp)}`;
            body.appendChild(age);
        }
        if (item.siteId) {
            const saveProfile = document.createElement('button');
            saveProfile.type = 'button';
            saveProfile.className = 'vsco-tub-follow';
            saveProfile.textContent = savedProfiles.has(String(item.siteId)) ? '★' : '☆';
            saveProfile.setAttribute('aria-label', savedProfiles.has(String(item.siteId)) ? 'Remove creator from Collection' : 'Save creator to Collection');
            saveProfile.title = saveProfile.getAttribute('aria-label');
            saveProfile.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggleSavedProfile(item); });
            const follow = document.createElement('button');
            follow.type = 'button';
            follow.className = 'vsco-tub-follow';
            follow.textContent = '+';
            follow.setAttribute('aria-label', 'Follow profile');
            follow.title = 'Follow profile';
            follow.addEventListener('click', async () => {
                follow.disabled = true;
                follow.textContent = '…';
                const response = await sendRuntimeMessage({ action: 'enhancedVscoFollowToggle', siteId: item.siteId });
                follow.disabled = false;
                if (!response?.ok) {
                    follow.textContent = '!';
                    follow.setAttribute('aria-label', 'Retry follow');
                    follow.title = response?.error || 'Could not update follow state.';
                    return;
                }
                follow.classList.toggle('following', response.following);
                follow.textContent = response.following ? '✓' : '+';
                follow.setAttribute('aria-label', response.following ? 'Unfollow profile' : 'Follow profile');
                follow.title = response.following ? 'Unfollow profile' : 'Follow profile';
            });
            row.append(body, saveProfile, follow);
        } else {
            row.appendChild(body);
        }
        return row;
    }

    function seedCountText() {
        if (!state) return '';
        const fetched = state.rawItems.length;
        const reports = state.response.seedReports || [];
        const seedFetched = reports.reduce((sum, report) => sum + (Number(report.fetched) || 0), 0);
        if (state.mode === 'images' && Number.isSafeInteger(state.response.exactTotal)) {
            return `${state.response.exactTotal.toLocaleString()} available / ${seedFetched.toLocaleString()} seed fetched`;
        }
        const capped = reports.length === 1 && reports[0].fetched >= 10000 && reports[0].total == null;
        if (state.mode === 'images' && capped) return `10,000+ available / ${seedFetched.toLocaleString()} seed fetched`;
        if (state.mode === 'images' && reports.length > 1) return `${fetched.toLocaleString()} unique fetched across ${reports.length} seed terms`;
        return `${fetched.toLocaleString()} fetched`;
    }

    function updateResultStatus() {
        if (!state) return;
        const windowLabel = { day: 'Today', week: 'This week', month: 'This month', year: 'This year', all: 'All time' }[searchSettings.timeWindow] || 'All time';
        setStatus(`${windowLabel} · ${seedCountText()} · ${state.rawItems.length.toLocaleString()} unique · ${state.items.length.toLocaleString()} after filters · showing ${state.rendered.toLocaleString()} · ${searchSettings.sortOrder === 'newest' ? 'newest first' : searchSettings.sortOrder}`);
    }

    function renderExpansionDetails() {
        const detailPanels = document.querySelectorAll('.vsco-tub-expansion');
        if (!detailPanels.length) return;
        const expansion = state?.response?.expansion || {};
        const countryCode = state?.response?.autonomousCountry && state.response.autonomousCountry !== 'ALL'
            ? state.response.autonomousCountry
            : '';
        const countryNames = { IE: 'Ireland', IL: 'Israel', CA: 'Canada' };
        const verifiedCountryProfiles = countryCode && state
            ? state.rawItems.filter(item => String(grpcImageRecords.get(metadataImageId(item))?.country?.code || '').toUpperCase() === countryCode).length
            : 0;
        document.querySelectorAll('.vsco-tub-travel-status').forEach(node => {
            const progress = expansion.status === 'running' || expansion.status === 'stopping'
                ? `Seedless discovery running · ${expansion.requestsCompleted || 0} requests · ${expansion.travelSeedScanned || 0} results scanned · ${expansion.travelCandidates || 0} candidate terms`
                : `Seedless discovery ready · ${expansion.travelSeedScanned || 0} results scanned · ${expansion.travelCandidates || 0} candidate terms`;
            node.textContent = countryCode
                ? `${countryNames[countryCode] || countryCode} · ${verifiedCountryProfiles.toLocaleString()} GPS-verified profiles · ${progress}`
                : progress;
        });
        const active = expansion.status === 'running' || expansion.status === 'stopping';
        const last = expansion.lastBatch || {};
        const search = currentSearch();
        const watched = search && watchedSearchIds.has(watchId(search.mode, search.query));
        const metrics = [
            `Status: ${expansion.status || 'idle'}`,
            `Last batch: ${last.status || 'none'}`,
            `Workers: ${active ? expansion.workers : (last.workers || searchSettings.expansionWorkers)}`,
            `Queued: ${active ? expansion.queued : (last.queued || 0)}`,
            `Completed: ${active ? expansion.completed : (last.completed || 0)}`,
            `Batches: ${expansion.batches || 0}`,
            `Requests total: ${expansion.requestsCompleted || 0}`,
            `Added unique: ${state?.mode === 'people' ? (expansion.addedPeople || 0) : (expansion.addedImages || 0)}`,
            `Duplicates: ${expansion.duplicates || 0}`,
            `Rejected: ${expansion.rejected || 0}`
        ];
        const insights = expansion.travelInsights || { usernames: [], emojis: [] };
        metrics.push(`Top usernames this week: ${(insights.usernames || []).slice(0, 5).map(item => `${item.value} (${item.count})`).join(', ') || 'none'}`);
        metrics.push(`Top emojis this week: ${(insights.emojis || []).slice(0, 8).map(item => `${item.value} (${item.count})`).join(' ') || 'none'}`);
        if (countryCode) metrics.push(`GPS-guided terms: ${(expansion.countryBoostTerms || []).slice(0, 8).map(item => `${item.term} (${item.count})`).join(', ') || 'waiting for verified GPS matches'}`);
        const queries = active ? expansion.currentQueries : (last.queries || []);
        detailPanels.forEach(details => {
            details.querySelector('.vsco-tub-expand-more').disabled = !state || !search || active;
            details.querySelector('.vsco-tub-expand-stop').disabled = !state || !active;
            const notify = details.querySelector('.vsco-tub-notify-search');
            notify.disabled = !state || !search;
            notify.textContent = watched ? 'Notifications on' : 'Notify me';
            const watch = search && watchedSearchDetails.get(watchId(search.mode, search.query));
            notify.title = watched
                ? `Watching this search${watch?.lastCheckedAt ? ` · last checked ${new Date(watch.lastCheckedAt).toLocaleString()}` : ' · first check pending'}`
                : 'Watch this search for new results';
            notify.setAttribute('aria-pressed', String(Boolean(watched)));
            const seeds = details.querySelector('.vsco-tub-expansion-seeds');
            if (seeds) seeds.textContent = state?.response?.autonomous
                ? `Autonomous starters: ${(state.response.apiQueries || []).join(' · ') || 'none'} · learned queries do not require user input`
                : `Seed terms: ${(state?.response?.apiQueries || []).join(' · ') || 'none'}`;
            const exclusions = details.querySelector('.vsco-tub-expansion-exclusions');
            if (exclusions) exclusions.textContent = `Excluded terms: ${(state?.response?.excludedTerms || []).join(' · ') || 'none'}${state?.response?.seedExcluded ? ` · removed ${state.response.seedExcluded.toLocaleString()} seed results` : ''}`;
            const grpcStatus = details.querySelector('.vsco-tub-grpc-status');
            if (grpcStatus) grpcStatus.textContent = `Browser gRPC: ${grpcProbeStatus}`;
            const suiteOutput = details.querySelector('.vsco-tub-grpc-suite-output');
            if (suiteOutput) suiteOutput.textContent = grpcSuiteResults.length ? JSON.stringify(grpcSuiteResults, null, 2) : 'Read suite not run yet.';
            const metricsRoot = details.querySelector('.vsco-tub-expansion-metrics');
            metricsRoot.textContent = '';
            metrics.forEach(value => { const span = document.createElement('span'); span.textContent = value; metricsRoot.appendChild(span); });
            details.querySelector('.vsco-tub-expansion-queries').textContent = queries.length ? `Batch queries: ${queries.join(' · ')}` : 'Batch queries: none yet';
        });
    }

    function createTravelPanel(response = {}) {
        const panel = document.createElement('section');
        panel.className = 'vsco-tub-travel-panel';
        const copy = document.createElement('div');
        const countryNames = { IE: 'Ireland', IL: 'Israel', CA: 'Canada' };
        const countryLabel = countryNames[response.autonomousCountry] || '';
        copy.innerHTML = response.autonomous
            ? `<strong>Autonomous profile discovery${countryLabel ? ` · ${countryLabel}` : ''}</strong><span>Country-appropriate names and terms guide the bounded starter searches; only GPS metadata verifies the country. Learned terms then drive continuous seedless batches.</span>`
            : '<strong>Seedless discovery</strong><span>The submitted search builds the initial corpus. New queries then travel through discovered terms without including the original search.</span>';
        const status = document.createElement('div');
        status.className = 'vsco-tub-travel-status';
        const start = document.createElement('button');
        start.type = 'button'; start.textContent = 'Start seedless discovery'; start.addEventListener('click', expandUntilSaturated);
        const stop = document.createElement('button');
        stop.type = 'button'; stop.textContent = 'Stop'; stop.addEventListener('click', stopExpansion);
        panel.append(copy, status, start, stop);
        return panel;
    }

    function openLocationMap() {
        const existing = document.getElementById('vsco-tub-map-drawer');
        if (existing) existing.hidden = false;
        else {
            const drawer = document.createElement('div');
            drawer.id = 'vsco-tub-map-drawer';
            const panel = document.createElement('section');
            panel.id = 'vsco-tub-map-panel';
            const head = document.createElement('div');
            head.id = 'vsco-tub-map-head';
            const title = document.createElement('strong');
            title.textContent = 'World map';
            const close = document.createElement('button');
            close.id = 'vsco-tub-map-close';
            close.type = 'button';
            close.setAttribute('aria-label', 'Close map');
            close.textContent = '×';
            close.addEventListener('click', () => { drawer.hidden = true; });
            head.append(title, close);
            const canvas = document.createElement('div');
            canvas.id = 'vsco-tub-map-canvas';
            const note = document.createElement('p');
            note.id = 'vsco-tub-map-note';
            const countries = document.createElement('div');
            countries.id = 'vsco-tub-map-countries';
            panel.append(head, canvas, note, countries);
            drawer.appendChild(panel);
            drawer.addEventListener('click', event => { if (event.target === drawer) drawer.hidden = true; });
            document.body.appendChild(drawer);
        }
        const canvas = document.getElementById('vsco-tub-map-canvas');
        const note = document.getElementById('vsco-tub-map-note');
        const countries = document.getElementById('vsco-tub-map-countries');
        if (!canvas || !note) return;
        canvas.textContent = '';
        if (countries) countries.textContent = '';
        const points = [];
        const countryCounts = new Map();
        for (const [id, record] of grpcImageRecords) {
            const location = record?.location || record?.imageMeta?.location;
            const lat = Number(location?.lat);
            const lng = Number(location?.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                points.push({ id, lat, lng, record });
                const country = record?.country?.name || record?.country?.code;
                if (country) countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
            }
        }
        points.forEach(({ id, lat, lng, record }) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'vsco-tub-map-dot';
            dot.style.left = `${((lng + 180) / 360) * 100}%`;
            dot.style.top = `${((90 - lat) / 180) * 100}%`;
            dot.title = `${lat.toFixed(4)}, ${lng.toFixed(4)} · ${id}`;
            const source = state?.rawItems?.find(item => metadataImageId(item) === id);
            const target = source?.username
                ? `https://vsco.co/${encodeURIComponent(source.username)}/media/${encodeURIComponent(id)}`
                : `https://i.vsco.co/${encodeURIComponent(id)}`;
            dot.addEventListener('click', () => window.open(target, '_blank', 'noopener,noreferrer'));
            canvas.appendChild(dot);
        });
        const countrySummary = [...countryCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 6)
            .map(([country, count]) => `${country} ${count}`)
            .join(' · ');
        if (countries) {
            [...countryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).forEach(([country, count]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = `${country} · ${count}`;
                button.setAttribute('aria-label', `Filter results by ${country} (${count} GPS locations)`);
                button.title = `Filter results by ${country}`;
                button.addEventListener('click', () => {
                    searchSettings.metadataCountry = country;
                    chrome.storage.local.set({ enhancedSearchSettings: searchSettings });
                    document.getElementById('vsco-tub-map-drawer').hidden = true;
                    if (state) renderResults(state.mode, state.response);
                });
                countries.appendChild(button);
            });
        }
        note.textContent = points.length
            ? `${points.length.toLocaleString()} GPS locations from returned metadata · ${countryCounts.size.toLocaleString()} countries${countrySummary ? ` · ${countrySummary}` : ''} · more appear as enrichment completes.`
            : 'No returned GPS locations yet. Keep browsing or run metadata enrichment to populate the map.';
    }

    function createWorkspaceNav(mode) {
        const nav = document.createElement('nav');
        nav.className = 'vsco-tub-workspace-nav';
        nav.setAttribute('aria-label', 'VSCO Tub workspace');
        const label = document.createElement('strong');
        label.textContent = 'Tub';
        nav.appendChild(label);
        const explore = document.createElement('button');
        explore.type = 'button';
        explore.textContent = 'Explore';
        explore.setAttribute('aria-label', 'Focus Tub search');
        explore.addEventListener('click', () => {
            const input = document.querySelector(`#${ROOT_ID} input[type="search"], #${ROOT_ID} input:not([type])`);
            if (input) {
                input.focus();
                input.select?.();
            } else {
                document.querySelector('#vsco-tub-settings-launcher > button')?.focus();
            }
        });
        nav.appendChild(explore);
        if (mode === 'people') {
            const discover = document.createElement('button');
            discover.type = 'button';
            discover.textContent = `Discover profiles · ${{ IE: 'Ireland', IL: 'Israel', CA: 'Canada' }[searchSettings.autonomousCountry] || 'Worldwide'}`;
            discover.setAttribute('aria-pressed', String(currentSearch()?.autonomous === true));
            discover.addEventListener('click', () => {
                const country = ['ALL', 'IE', 'IL', 'CA'].includes(searchSettings.autonomousCountry) ? searchSettings.autonomousCountry : 'ALL';
                location.assign(`/search/people?vsco_tub=discover-profiles&country=${country}`);
            });
            nav.appendChild(discover);
        }
        const searchLink = document.createElement('button');
        searchLink.type = 'button';
        searchLink.textContent = mode === 'images' ? 'Images' : 'People';
        searchLink.setAttribute('aria-pressed', 'true');
        searchLink.addEventListener('click', () => {
            const search = currentSearch();
            const query = search?.query && !search.autonomous ? `/${encodeURIComponent(search.query)}` : '';
            history.pushState({}, '', `/search/${mode === 'images' ? 'images' : 'people'}${query}`);
            activeKey = '';
            tick();
        });
        nav.appendChild(searchLink);
        const timeframe = (value, text) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.setAttribute('aria-pressed', String(searchSettings.timeWindow === value));
            button.addEventListener('click', () => selectDiscoveryWindow(value));
            return button;
        };
        nav.append(timeframe('day', 'Today'), timeframe('week', 'This week'));
        const travel = document.createElement('button');
        travel.type = 'button';
        travel.textContent = 'Seedless discovery';
        travel.title = 'Use this search only as the initial corpus, then continuously explore discovered terms without the original search';
        travel.addEventListener('click', expandUntilSaturated);
        nav.appendChild(travel);
        const map = document.createElement('button');
        map.type = 'button'; map.textContent = 'World map';
        map.addEventListener('click', openLocationMap);
        nav.appendChild(map);
        const collection = document.createElement('button');
        collection.type = 'button'; collection.textContent = 'Collection';
        collection.addEventListener('click', () => document.querySelector('#vsco-tub-collection-launcher > button')?.click());
        nav.appendChild(collection);
        return nav;
    }

    function selectDiscoveryWindow(value) {
        searchSettings.timeWindow = value;
        chrome.storage.local.set({ enhancedSearchSettings: searchSettings });
        document.querySelectorAll('#vsco-tub-nav-launcher [data-time-window]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.timeWindow === value));
        });
        if (!state) return;
        renderResults(state.mode, state.response);
        if ((value === 'day' || value === 'week') && !state.response?.expansion?.running) expandMore();
    }

    function createExpansionDetails(response = {}) {
        const details = document.createElement('details');
        details.className = 'vsco-tub-expansion';
        const summary = document.createElement('summary');
        summary.textContent = 'Search tools';
        const seeds = document.createElement('div');
        seeds.className = 'vsco-tub-expansion-seeds';
        seeds.textContent = `Seed terms: ${(response.apiQueries || []).join(' · ') || 'none'}`;
        const exclusions = document.createElement('div');
        exclusions.className = 'vsco-tub-expansion-exclusions';
        exclusions.textContent = `Excluded terms: ${(response.excludedTerms || []).join(' · ') || 'none'}${response.seedExcluded ? ` · removed ${response.seedExcluded.toLocaleString()} seed results` : ''}`;
        const actions = document.createElement('div');
        actions.className = 'vsco-tub-expansion-actions';
        const timeframeLabel = document.createElement('span');
        timeframeLabel.textContent = 'Explore:';
        timeframeLabel.className = 'vsco-tub-timeframe-label';
        const timeframeSelect = document.createElement('select');
        timeframeSelect.className = 'vsco-tub-timeframe-select';
        timeframeSelect.setAttribute('aria-label', 'Discovery timeframe');
        [['all', 'All time'], ['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']].forEach(([value, label]) => {
            const option = document.createElement('option'); option.value = value; option.textContent = label; timeframeSelect.appendChild(option);
        });
        timeframeSelect.value = searchSettings.timeWindow;
        timeframeSelect.addEventListener('change', event => {
            event.preventDefault();
            event.stopPropagation();
            selectDiscoveryWindow(timeframeSelect.value);
        });
        const setTimeframe = (value, label) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.className = `vsco-tub-timeframe-${value}`;
            button.setAttribute('aria-pressed', String(searchSettings.timeWindow === value));
            button.onclick = () => {
                selectDiscoveryWindow(value);
            };
            return button;
        };
        const today = setTimeframe('day', 'Today');
        const week = setTimeframe('week', 'This week');
        const allTime = setTimeframe('all', 'All time');
        const expand = document.createElement('button');
        expand.type = 'button';
        expand.className = 'vsco-tub-expand-more';
        expand.textContent = 'Expand more';
        expand.addEventListener('click', expandMore);
        const expandUntil = document.createElement('button');
        expandUntil.type = 'button';
        expandUntil.className = 'vsco-tub-expand-until';
        expandUntil.textContent = 'Start seedless discovery · current window';
        expandUntil.title = 'Repeated bounded batches whose generated queries exclude the original search. The selected timeframe controls which results accumulate; All time has no date cutoff.';
        expandUntil.addEventListener('click', expandUntilSaturated);
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'vsco-tub-expand-stop';
        stop.textContent = 'Stop';
        stop.addEventListener('click', stopExpansion);
        const notify = document.createElement('button');
        notify.type = 'button';
        notify.className = 'vsco-tub-notify-search';
        notify.addEventListener('click', toggleSearchNotifications);
        const map = document.createElement('button');
        map.type = 'button';
        map.textContent = 'View on map';
        map.addEventListener('click', openLocationMap);
        const grpcProbe = document.createElement('button');
        grpcProbe.type = 'button';
        grpcProbe.textContent = 'Probe image metadata';
        const grpcProbeCount = document.createElement('input');
        grpcProbeCount.type = 'number';
        grpcProbeCount.className = 'vsco-tub-grpc-probe-count';
        grpcProbeCount.setAttribute('aria-label', 'Image metadata probe count');
        grpcProbeCount.min = '1';
        grpcProbeCount.max = String(GRPC_IMAGE_PROBE_MAX);
        grpcProbeCount.step = '1';
        grpcProbeCount.value = String(GRPC_IMAGE_PROBE_DEFAULT);
        grpcProbe.addEventListener('click', () => probeVisibleGrpc(grpcProbeCount.value));
        const grpcProbeStop = document.createElement('button');
        grpcProbeStop.type = 'button';
        grpcProbeStop.textContent = 'Stop metadata probe';
        grpcProbeStop.addEventListener('click', stopGrpcProbe);
        const pfpCheck = document.createElement('button');
        pfpCheck.type = 'button';
        pfpCheck.textContent = 'Check PFP changes';
        pfpCheck.title = 'Compare saved profile-picture snapshots with batched FetchImages checks';
        pfpCheck.hidden = false;
        pfpCheck.addEventListener('click', () => {
            checkPfpChanges().catch(error => { pfpCheckStatus = `PFP check failed · ${error?.message || error}`; renderExpansionDetails(); });
        });
        const advancedToggle = document.createElement('button');
        advancedToggle.type = 'button';
        advancedToggle.className = 'vsco-tub-advanced-toggle';
        advancedToggle.textContent = searchSettings.developerMode ? 'Hide advanced gRPC tools' : 'Show advanced gRPC tools';
        advancedToggle.setAttribute('aria-pressed', String(searchSettings.developerMode === true));
        advancedToggle.addEventListener('click', () => {
            searchSettings.developerMode = !searchSettings.developerMode;
            chrome.storage.local.set({ enhancedSearchSettings: searchSettings });
            applyDeveloperMode();
        });
        const grpcSuite = document.createElement('button');
        grpcSuite.type = 'button';
        grpcSuite.textContent = 'Run all read RPCs';
        const contextInput = (field, label, value = '') => {
            const input = document.createElement('input');
            input.type = field === 'limit' ? 'number' : 'text';
            input.className = 'vsco-tub-grpc-target';
            input.dataset.grpcContext = field;
            input.setAttribute('aria-label', label);
            input.placeholder = label;
            input.value = value;
            return input;
        };
        const grpcSource = contextInput('source', 'Username, VSCO URL, media ID, or site ID', location.href);
        const grpcUsername = contextInput('username', 'Username');
        const grpcTarget = contextInput('imageId', 'Media URL or image ID', normalizeMediaId(location.href));
        const grpcSiteId = contextInput('siteId', 'Uploader or page site ID');
        const grpcViewerSiteId = contextInput('viewerSiteId', 'Signed-in viewer site ID');
        const grpcUserId = contextInput('userId', 'User ID');
        const grpcCollectorSiteId = contextInput('collectorSiteId', 'Viewer / collector site ID');
        const grpcCollectionId = contextInput('collectionId', 'Collection ID');
        const grpcAlbumId = contextInput('albumId', 'Album ID');
        const grpcArticleId = contextInput('articleId', 'Article ID');
        const grpcPermalink = contextInput('permalink', 'Article permalink');
        const grpcTag = contextInput('tag', 'Tag');
        const grpcCommentId = contextInput('commentId', 'Comment ID (mutation)');
        const grpcComment = contextInput('comment', 'Comment text (mutation)');
        const grpcMutationStatus = contextInput('status', 'Mutation enum/status number');
        const grpcLimit = contextInput('limit', 'Per-RPC limit', '2');
        grpcLimit.min = '1';
        grpcLimit.max = '100';
        const readContext = () => Object.fromEntries([...details.querySelectorAll('[data-grpc-context]')].map(input => [input.dataset.grpcContext, input.value.trim()]));
        grpcSuite.addEventListener('click', () => runRelevantGrpcSuite(readContext()).catch(error => {
            grpcProbeStatus = `Read suite failed · ${error?.message || error}`;
            renderExpansionDetails();
        }));
        const resolveContext = document.createElement('button');
        resolveContext.type = 'button';
        resolveContext.textContent = 'Resolve current page';
        resolveContext.addEventListener('click', async () => {
            try {
                await resolveSignedInAccountContext();
                const localImageId = normalizeMediaId(grpcSource.value) || visibleImageIds()[0] || availableImageIds()[0] || '';
                if (localImageId && !grpcTarget.value) grpcTarget.value = localImageId;
                const record = grpcImageRecords.get(localImageId);
                if (record?.siteId && !grpcSiteId.value) grpcSiteId.value = record.siteId;
                if (record?.userId && !grpcUserId.value) grpcUserId.value = record.userId;
                let resolved = await resolveGrpcToolContext(readContext());
                if (!grpcTarget.value && resolved.profileImageId) grpcTarget.value = resolved.profileImageId;
                resolved = await enrichGrpcContextFromMedia({ ...resolved, imageId: grpcTarget.value || resolved.imageId });
                grpcProbeStatus = `Resolved context · username ${resolved.username || '—'} · media ${resolved.imageId || resolved.profileImageId || '—'} · site ${resolved.siteId || '—'} · user ${resolved.userId || '—'}`;
            } catch (error) {
                grpcProbeStatus = `Context resolution failed · ${error?.message || error}`;
            }
            renderExpansionDetails();
        });
        const stopReads = document.createElement('button');
        stopReads.type = 'button';
        stopReads.textContent = 'Stop read suite';
        stopReads.addEventListener('click', () => { grpcSuiteStopRequested = true; grpcProbeStatus = 'Stopping read suite after the active request…'; renderExpansionDetails(); });
        const copyRaw = document.createElement('button');
        copyRaw.type = 'button';
        copyRaw.textContent = 'Copy complete gRPC bundle';
        copyRaw.addEventListener('click', () => copyRawGrpcResults().catch(error => {
            grpcProbeStatus = `Copy failed · ${error?.message || error}`;
            renderExpansionDetails();
        }));
        const exportFollowing = document.createElement('button');
        exportFollowing.type = 'button';
        exportFollowing.textContent = 'Export following JSON';
        exportFollowing.title = 'Scan all followed profiles with a delay and download following.json';
        exportFollowing.addEventListener('click', async () => {
            exportFollowing.disabled = true;
            exportFollowing.textContent = 'Scanning following…';
            try {
                const result = await sendRuntimeMessage({ action: 'enhancedVscoExportFollowing' });
                if (!result?.ok) throw new Error(result?.error || 'Following scan failed');
                const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a'); link.href = url; link.download = 'following.json'; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                exportFollowing.textContent = `Downloaded following.json · ${result.count.toLocaleString()} profiles`;
            } catch (error) { exportFollowing.textContent = `Following export failed · ${error?.message || error}`; }
            finally { exportFollowing.disabled = false; }
        });
        const randomFollowingBio = document.createElement('button');
        randomFollowingBio.type = 'button';
        randomFollowingBio.textContent = 'Explore random following bio';
        randomFollowingBio.title = 'Pick a stored following profile with a bio and open a People search for it';
        randomFollowingBio.addEventListener('click', async () => {
            const stored = await new Promise(resolve => chrome.storage.local.get({ vscoTubFollowingExport: null }, resolve));
            const profiles = stored.vscoTubFollowingExport?.profiles || [];
            const candidates = profiles.filter(profile => String(profile.bio || profile.description || profile.gridName || '').trim());
            if (!candidates.length) { randomFollowingBio.textContent = 'Export following first'; return; }
            const chosen = candidates[Math.floor(Math.random() * candidates.length)];
            const bio = String(chosen.bio || chosen.description || chosen.gridName).trim().replace(/\s+/g, ' ').slice(0, 120);
            location.assign(`/search/people/${encodeURIComponent(bio)}`);
        });
        const reflection = document.createElement('button');
        reflection.type = 'button';
        reflection.textContent = 'Probe reflection';
        reflection.addEventListener('click', probeGrpcReflection);
        const uploadInput = document.createElement('input');
        uploadInput.type = 'file';
        uploadInput.className = 'vsco-tub-grpc-upload-input';
        uploadInput.accept = 'image/jpeg,image/png,image/webp';
        const upload = document.createElement('button');
        upload.type = 'button';
        upload.textContent = 'Test gRPC upload (unpublished)';
        upload.addEventListener('click', () => runGrpcUpload(uploadInput.files?.[0]));
        actions.append(timeframeLabel, timeframeSelect, today, week, allTime, expand, expandUntil, stop, notify, map, grpcProbeCount, grpcProbe, grpcProbeStop, pfpCheck, exportFollowing, randomFollowingBio, advancedToggle, resolveContext, grpcSource, grpcUsername, grpcTarget, grpcSiteId, grpcViewerSiteId, grpcUserId, grpcCollectorSiteId, grpcCollectionId, grpcAlbumId, grpcArticleId, grpcPermalink, grpcTag, grpcCommentId, grpcComment, grpcMutationStatus, grpcLimit, grpcSuite, stopReads, reflection, uploadInput, upload, copyRaw);
        const pfpStatus = document.createElement('div');
        pfpStatus.className = 'vsco-tub-pfp-status';
        pfpStatus.textContent = pfpCheckStatus;
        actions.appendChild(pfpStatus);
        const metrics = document.createElement('div');
        metrics.className = 'vsco-tub-expansion-metrics';
        const queries = document.createElement('div');
        queries.className = 'vsco-tub-expansion-queries';
        const grpcStatus = document.createElement('div');
        grpcStatus.className = 'vsco-tub-grpc-status';
        const suiteDetails = document.createElement('details');
        const suiteSummary = document.createElement('summary');
        suiteSummary.textContent = 'Proven metadata/read results';
        const suiteOutput = document.createElement('pre');
        suiteOutput.className = 'vsco-tub-grpc-suite-output';
        suiteDetails.append(suiteSummary, suiteOutput);
        const inventoryDetails = document.createElement('details');
        const inventorySummary = document.createElement('summary');
        inventorySummary.textContent = 'Descriptor-backed RPC inventory (inspection only)';
        const inventoryOutput = document.createElement('div');
        inventoryOutput.className = 'vsco-tub-rpc-inventory';
        inventoryOutput.textContent = 'Loading schema inventory…';
        const rpcMethod = document.createElement('select');
        rpcMethod.className = 'vsco-tub-grpc-method';
        rpcMethod.setAttribute('aria-label', 'Descriptor RPC method');
        const rpcJson = document.createElement('textarea');
        rpcJson.className = 'vsco-tub-grpc-json';
        rpcJson.rows = 7;
        rpcJson.setAttribute('aria-label', 'RPC request JSON');
        rpcJson.placeholder = '{ "imageId": "..." }';
        const runRpc = document.createElement('button');
        runRpc.type = 'button';
        runRpc.textContent = 'Run selected descriptor RPC';
        const unsafeLabel = document.createElement('label');
        unsafeLabel.className = 'vsco-tub-grpc-unsafe-label';
        const unsafeAll = document.createElement('input');
        unsafeAll.type = 'checkbox';
        unsafeAll.className = 'vsco-tub-grpc-unsafe-all';
        unsafeLabel.append(unsafeAll, document.createTextNode(' Enable all RPCs for this page session'));
        actions.append(unsafeLabel, rpcMethod, rpcJson, runRpc);
        inventoryDetails.append(inventorySummary, inventoryOutput);
        [resolveContext, grpcSource, grpcUsername, grpcTarget, grpcSiteId, grpcViewerSiteId, grpcUserId,
            grpcCollectorSiteId, grpcCollectionId, grpcAlbumId, grpcArticleId, grpcPermalink, grpcTag,
            grpcCommentId, grpcComment, grpcMutationStatus, grpcLimit, grpcSuite, stopReads, reflection,
            uploadInput, upload, copyRaw, unsafeLabel, rpcMethod, rpcJson, runRpc, suiteDetails,
            inventoryDetails].forEach(element => element.classList.add('vsco-tub-developer-only'));
        grpcSchemaPromise.then(schema => {
            const mutating = /^(?:Create|Delete|Update|Configure|Insert|Intent|Generate|ImageUpload|Invalidate|Optout|Admin(?:Create|Delete|Update))/;
            const methods = [];
            inventoryOutput.textContent = '';
            Object.entries(schema.services || {}).forEach(([service, definition]) => {
                (definition.methods || []).forEach(method => {
                    methods.push({ service, ...method });
                    const internal = /Admin|Internal/.test(method.method);
                    const classification = mutating.test(method.method) ? 'MUTATION' : internal ? 'INTERNAL_READ' : 'READ';
                    const row = document.createElement('div');
                    row.className = `vsco-tub-rpc-inventory-row ${classification.toLowerCase()}`;
                    row.textContent = `${classification} · ${service}/${method.method}`;
                    row.title = `${method.request?.fullName || 'unknown request'} → ${method.response?.fullName || 'unknown response'}`;
                    row.tabIndex = 0;
                    inventoryOutput.appendChild(row);
                });
            });
            methods.forEach(method => {
                const option = document.createElement('option');
                option.value = `${method.service}/${method.method}`;
                option.textContent = `${method.service}/${method.method}`;
                rpcMethod.appendChild(option);
            });
            const selected = () => methods.find(method => `${method.service}/${method.method}` === rpcMethod.value);
            const refreshTemplate = () => {
                const method = selected();
                if (method) rpcJson.value = JSON.stringify(descriptorRequestTemplate(method, readContext()), null, 2);
            };
            inventoryOutput.querySelectorAll('.vsco-tub-rpc-inventory-row').forEach((row, index) => {
                const choose = () => { rpcMethod.value = `${methods[index].service}/${methods[index].method}`; refreshTemplate(); rpcJson.focus(); };
                row.addEventListener('click', choose);
                row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') choose(); });
            });
            rpcMethod.value = normalizeMediaId(location.href)
                ? 'interaction.InteractionGrpc/GetReactionsForMedia'
                : 'media.Media/FetchImages';
            rpcMethod.addEventListener('change', refreshTemplate);
            refreshTemplate();
            resolveSignedInAccountContext().then(() => refreshTemplate()).catch(error => {
                grpcProbeStatus = `Account context warning · ${error?.message || error}`;
                renderExpansionDetails();
            });
            runRpc.addEventListener('click', async () => {
                const method = selected();
                if (!method) return;
                try {
                    await resolveSignedInAccountContext();
                    const enteredContext = readContext();
                    let context = { ...enteredContext, ...await resolveGrpcToolContext(enteredContext) };
                    context = await enrichGrpcContextFromMedia({ ...context, imageId: grpcTarget.value || context.imageId });
                    const entered = JSON.parse(rpcJson.value || '{}');
                    const inferred = descriptorRequestTemplate(method, context);
                    const typed = { ...inferred, ...Object.fromEntries(Object.entries(entered).filter(([, value]) => value !== '' && value !== null)) };
                    rpcJson.value = JSON.stringify(typed, null, 2);
                    const requestBytes = encodeMessageWithSchema(method.request.fullName, typed, schema);
                    const body = grpcWebText(new Uint8Array(requestBytes));
                    const isMutation = mutating.test(method.method);
                    const isInternal = /Admin|Internal/.test(method.method);
                    const unsafeEnabled = unsafeAll.checked;
                    if ((isInternal || (isMutation && !/^(?:Create|Delete)(?:Favorite|Repost)$/.test(method.method))) && !unsafeEnabled) {
                        throw new Error('Check Enable all RPCs to run this admin, internal, or non-reversible method.');
                    }
                    const needsConfirmation = isMutation || isInternal;
                    if (needsConfirmation && !window.confirm(`Run ${method.service}/${method.method}?\n\nThis may read internal data or change VSCO account data. The exact request is:\n${JSON.stringify(typed, null, 2)}`)) return;
                    grpcProbeStatus = `Running ${method.service}/${method.method}…`;
                    renderExpansionDetails();
                    const response = await sendRuntimeMessage({
                        action: 'enhancedVscoDescriptorGrpcCall',
                        service: method.service,
                        method: method.method,
                        body,
                        confirmed: needsConfirmation,
                        allowUnsafeAll: unsafeEnabled
                    });
                    const row = {
                        service: method.service, method: method.method, path: `/${method.service}/${method.method}`,
                        request: typed, rawGrpcWebRequest: body, httpStatus: response?.httpStatus || null,
                        grpcStatus: response?.grpcStatus ?? null, grpcMessage: response?.grpcMessage || '',
                        rawGrpcWebText: String(response?.body || ''), classification: response?.ok ? 'HTTP_OK' : 'FAIL',
                        error: response?.error || ''
                    };
                    if (response?.body) {
                        row.decoded = await decodeRpcResponse(method.service, method.method, response.body);
                        const trailerStatus = row.decoded.trailers.join('\n').match(/grpc-status:\s*(\d+)/i)?.[1];
                        if (trailerStatus !== undefined) row.grpcStatus = trailerStatus;
                    }
                    row.classification = !response?.ok ? 'FAIL' : row.grpcStatus === '0' ? 'PASS' : 'RPC_ERROR';
                    grpcSuiteResults = [row];
                    grpcProbeStatus = `${row.classification} · ${method.method} · HTTP ${row.httpStatus || '?'} · gRPC ${row.grpcStatus ?? '?'}`;
                } catch (error) {
                    grpcProbeStatus = `Descriptor RPC failed · ${error?.message || error}`;
                }
                renderExpansionDetails();
            });
        }).catch(error => { inventoryOutput.textContent = `Schema inventory failed: ${error?.message || error}`; });
        details.append(summary, seeds, exclusions, actions, metrics, queries, grpcStatus, suiteDetails, inventoryDetails);
        return details;
    }

    function renderNextBatch() {
        if (!state) return;
        // Filters can legitimately produce an empty result set. Keep the
        // result summary visible instead of leaving only the tools panel,
        // which made the search look as though the enhancer had crashed.
        if (state.rendered >= state.items.length) {
            updateResultStatus();
            return;
        }
        const end = Math.min(state.rendered + (Number(searchSettings.batchSize) || 60), state.items.length);
        const batch = state.items.slice(state.rendered, end);
        for (const item of batch) {
            const card = state.mode === 'images' ? makeImageCard(item) : makePersonRow(item);
            if (state.mode === 'images' && searchSettings.groupImagesBy === 'country') {
                const country = grpcImageRecords.get(metadataImageId(item))?.country;
                const key = country?.code || 'unknown';
                let group = state.list.querySelector(`[data-country-group="${CSS.escape(key)}"]`);
                if (!group) {
                    group = document.createElement('section');
                    group.className = 'vsco-tub-country-group';
                    group.dataset.countryGroup = key;
                    const heading = document.createElement('h3');
                    heading.textContent = country ? `${country.flag || '🌐'} ${country.name}` : '📍 Country pending / unavailable';
                    const grid = document.createElement('div');
                    grid.className = 'vsco-tub-grid';
                    group.append(heading, grid);
                    state.list.appendChild(group);
                }
                group.querySelector('.vsco-tub-grid').appendChild(card);
            } else state.list.appendChild(card);
        }
        state.rendered = end;
        updateResultStatus();
        if (state.mode === 'images') loadReactionStates(batch.map(item => item.id));
    }

    function renderResults(mode, response) {
        const root = createRoot(mode);
        if (!root) return;
        root.innerHTML = '';
        if (mode === 'images' || mode === 'people') resetGrpcViewportObserver();
        const items = visibleItems(mode === 'images' ? response.images : response.people);
        root.dataset.gallerySize = searchSettings.gallerySize;
        root.dataset.profileImageMode = searchSettings.profileImageMode;
        root.dataset.imageAspect = searchSettings.imageAspect;
        root.oncontextmenu = event => event.stopPropagation();
        const list = document.createElement('div');
        list.className = mode === 'images'
            ? (searchSettings.groupImagesBy === 'country' ? 'vsco-tub-country-groups' : 'vsco-tub-grid')
            : 'vsco-tub-people';
        root.append(createWorkspaceNav(mode), createTravelPanel(response), createExpansionDetails(response), list);
        state = { mode, response, root, rawItems: (mode === 'images' ? response.images : response.people).slice(), items, list, rendered: 0 };
        if (mode === 'people') savePfpSnapshots(state.rawItems).catch(error => console.warn('[VSCO Tub] PFP snapshot save failed', error));
        renderNextBatch();
        renderExpansionDetails();
        // Automatically enrich the full returned set, capped at 10,000 valid
        // IDs. The list remains timestamp-ordered by availableImageIds(),
        // independent of the user's visible sort choice.
        if (mode === 'images' || mode === 'people') startAutomaticMetadataProbe();
        const sentinel = document.createElement('div');
        sentinel.style.height = '1px';
        root.appendChild(sentinel);
        new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) renderNextBatch();
        }, { rootMargin: '900px' }).observe(sentinel);
    }

    async function refreshExpansionStatus(query, key) {
        const status = await sendRuntimeMessage({ action: 'enhancedVscoExpansionStatus', query });
        if (activeKey !== key || !status?.ok || !state) return;
        state.response.expansion = status.expansion;
        renderExpansionDetails();
    }

    async function expandMore(options = {}) {
        const search = currentSearch();
        if (!search || !state) return;
        const key = `${search.mode}:${search.query}`;
        state.response.expansion = { ...(state.response.expansion || {}), status: 'running', workers: searchSettings.expansionWorkers };
        renderExpansionDetails();
        const poll = setInterval(() => refreshExpansionStatus(search.query, key), 500);
        try {
            const windows = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000, all: 0 };
            const expanded = await sendRuntimeMessage({ action: 'enhancedVscoExpand', query: search.query, mode: search.mode, workers: searchSettings.expansionWorkers, travel: options.travel === true, originalEngine: options.originalEngine === true, travelWindowMs: options.travel ? (windows[searchSettings.timeWindow] ?? 0) : 0 });
            if (activeKey !== key) return;
            if (!expanded?.ok) throw new Error(expanded?.error || 'Expansion failed');
            if (options.travel) {
                const field = search.mode === 'people' ? 'people' : 'images';
                const merged = new Map((state.response[field] || []).map(item => [item.id, item]));
                (expanded[field] || []).forEach(item => merged.set(item.id, item));
                expanded[field] = [...merged.values()].sort((a, b) => (b.timestamp - a.timestamp) || b.id.localeCompare(a.id));
                expanded.responseTruncated = Boolean(expanded.responseTruncated);
            }
            resultCache.set(key, expanded);
            renderResults(search.mode, expanded);
        } catch (error) {
            setStatus(userFacingRuntimeError(error, 'Expansion failed'), true);
            await refreshExpansionStatus(search.query, key);
        } finally {
            clearInterval(poll);
        }
    }

    async function expandUntilSaturated() {
        const search = currentSearch();
        if (!search || !state || continuousExpansionRunning) return;
        continuousExpansionRunning = true;
        try {
            while (continuousExpansionRunning) {
                // Seedless discovery uses the submitted search only to build the
                // initial corpus. Every generated query comes from discovered
                // terms and therefore excludes the original seed terms.
                await expandMore({ travel: true, originalEngine: false });
                const last = state.response?.expansion?.lastBatch || {};
                if (last.status === 'exhausted') break;
                await new Promise(resolve => setTimeout(resolve, 1500));
                if (last.completed === 0) break;
            }
        } finally {
            continuousExpansionRunning = false;
            renderExpansionDetails();
        }
    }

    async function stopExpansion() {
        const search = currentSearch();
        if (!search) return;
        continuousExpansionRunning = false;
        await sendRuntimeMessage({ action: 'enhancedVscoExpansionCancel', query: search.query });
        await refreshExpansionStatus(search.query, `${search.mode}:${search.query}`);
    }

    function watchId(mode, query) {
        return `${mode === 'people' ? 'people' : 'images'}:${String(query || '').normalize('NFKC').toLocaleLowerCase().trim()}`;
    }

    async function toggleSearchNotifications() {
        const search = currentSearch();
        if (!search || !state) return;
        const id = watchId(search.mode, search.query);
        const enabled = !watchedSearchIds.has(id);
        const response = await sendRuntimeMessage({
            action: 'enhancedVscoSavedSearchToggle',
            mode: search.mode,
            query: search.query,
            enabled,
            baselineIds: state.rawItems.slice(0, 500).map(item => item.id)
        });
        if (!response?.ok) {
            setStatus(response?.error || 'Could not update notifications.', true);
            return;
        }
        if (response.enabled) watchedSearchIds.add(id); else watchedSearchIds.delete(id);
        const existing = watchedSearchDetails.get(id) || { id, mode: search.mode, query: search.query };
        existing.enabled = Boolean(response.enabled);
        existing.updatedAt = Date.now();
        existing.knownIds = state.rawItems.slice(0, 500).map(item => String(item.id));
        watchedSearchDetails.set(id, existing);
        renderExpansionDetails();
    }

    async function loadSearch(search) {
        const key = `${search.mode}:${search.query}`;
        // VSCO can replace <main> during its own SPA render without changing
        // the URL. In that case our root is detached while activeKey still
        // matches, so treating the search as already loaded leaves only the
        // native partial results on screen.
        const mountedRoot = document.getElementById(ROOT_ID);
        if (key === activeKey && mountedRoot?.isConnected) return;
        activeKey = key;
        await settingsReady;
        installStyles();
        hideNativeResults(search.mode);
        const root = createRoot(search.mode);
        if (!root) return;
        root.innerHTML = '';
        setStatus(`Loading ${search.mode === 'images' ? 'images' : 'people'}…`);
        try {
            const cached = resultCache.get(key);
            const response = cached || await sendRuntimeMessage(search.autonomous
                ? { action: 'enhancedVscoAutonomousProfiles', country: search.country }
                : { action: 'enhancedVscoSearch', query: search.query, mode: search.mode });
            if (!response?.ok) throw new Error(response?.error || 'Search failed');
            if (activeKey !== key) return;
            resultCache.set(key, response);
            renderResults(search.mode, response);
            if (search.autonomous || searchSettings.expansionEnabled) expandUntilSaturated();
        } catch (error) {
            setStatus(userFacingRuntimeError(error, 'Search failed'), true);
        }
    }

    function tick() {
        installStyles();
        guardNativeSearchForm();
        restoreGuardedInputValue();
        settingsReady.then(installGlobalSettingsLauncher);
        settingsReady.then(installCollectionLauncher);
        settingsReady.then(installProductNavLauncher);
        settingsReady.then(installProfileImageTool);
        settingsReady.then(installGlobalToolsLauncher);
        const search = currentSearch();
        if (!search) {
            activeKey = '';
            state = null;
            document.getElementById(ROOT_ID)?.remove();
            return;
        }
        hideNativeResults(search.mode);
        syncNativeSearchLinks(search);
        loadSearch(search);
    }

    function installContextMenuGuard() {
        if (contextMenuGuardInstalled) return;
        contextMenuGuardInstalled = true;
        document.addEventListener('contextmenu', event => {
            if (event.target.closest?.(`#${ROOT_ID}`)) event.stopImmediatePropagation();
        }, true);
    }

    installContextMenuGuard();
    window.addEventListener('popstate', () => {
        guardedInputState = null;
        activeKey = '';
        tick();
    });
    new MutationObserver(() => tick()).observe(document.documentElement, { childList: true, subtree: true });
    settingsReady = new Promise(resolve => {
        chrome.storage.local.get({ enhancedSearchSettings: {
            expansionEnabled: false, gallerySize: 'medium', profileImageMode: 'avatar', profileImageAspect: 'crop', imageAspect: 'crop',
            showImageDescriptions: true, showUsernames: true, showProfileImages: true, showProfileBio: true, showProfileBioLength: false,
            showProfileLink: false, showMediaLink: false, showImageId: false, showProfileImageUrl: false, showProfileImageId: false,
            showProfileSiteId: false, showPostedAge: false,
            sortOrder: 'newest', timeWindow: 'all', batchSize: 60, expansionWorkers: 6, developerMode: false
        }, vscoTubSavedImages: [], vscoTubSavedProfiles: [], enhancedVscoSavedSearches: [], vscoTubCollectionFilter: 'all' }, result => {
            searchSettings = { ...searchSettings, ...(result.enhancedSearchSettings || {}) };
            savedImages = new Map((result.vscoTubSavedImages || []).filter(item => item?.id).map(item => [String(item.id), item]));
            savedProfiles = new Map((result.vscoTubSavedProfiles || []).filter(item => item?.id).map(item => [String(item.id), item]));
            const watchedSearches = (result.enhancedVscoSavedSearches || []).filter(item => item?.id);
            watchedSearchDetails = new Map(watchedSearches.map(item => [item.id, item]));
            watchedSearchIds = new Set(watchedSearches.filter(item => item.enabled).map(item => item.id));
            collectionFilter = ['all', 'gps', 'country', 'camera', 'search', 'creators'].includes(result.vscoTubCollectionFilter) ? result.vscoTubCollectionFilter : 'all';
            applyDeveloperMode();
            resolve();
        });
    });
    setInterval(tick, 500);
    tick();
})();
