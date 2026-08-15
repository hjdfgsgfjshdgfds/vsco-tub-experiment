(function () {
    if (window.__vscoTubGrpcBridgeInstalled) return;
    window.__vscoTubGrpcBridgeInstalled = true;

    const REQUEST_EVENT = 'vsco-tub-grpc-request';
    const RESPONSE_EVENT = 'vsco-tub-grpc-response';
    const READ_PATHS = new Map([
        ['/media.Media/FetchImages', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchImage', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchImagesBySite', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchActiveImagesBySite', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchPersonalMedia', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchArticlesByImageID', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchFeedback', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchImageUploadData', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/GenerateUploadUrl', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/ImageUploadComplete', 'https://media-grpc-api.vsco.co'],
        ['/media.Media/FetchUserComments', 'https://media-grpc-api.vsco.co'],
        ['/interaction.InteractionGrpc/GetReactionsForMedia', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/GetReactionsForMedias', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/GetFavorites', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/GetReposts', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/FetchCollections', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/FetchCollectionsBySite', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/FetchCollectionItemsBySite', 'https://interaction-api-grpc.vsco.co'],
        ['/interaction.InteractionGrpc/GetRepostedMediaIdsForSite', 'https://interaction-api-grpc.vsco.co']
        ,['/interaction.InteractionGrpc/HasReactions', 'https://interaction-api-grpc.vsco.co']
        ,['/interaction.InteractionGrpc/GetInteractionIdsOfSitesMedias', 'https://interaction-api-grpc.vsco.co']
        ,['/interaction.InteractionGrpc/GetFavorites', 'https://interaction-api-grpc.vsco.co']
        ,['/interaction.InteractionGrpc/GetReposts', 'https://interaction-api-grpc.vsco.co']
        ,['/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo', 'https://media-grpc-api.vsco.co']
    ]);
    const REFLECTION_ORIGINS = new Set([
        'https://media-grpc-api.vsco.co',
        'https://interaction-api-grpc.vsco.co'
    ]);
    const capturedHeaders = new Map();
    let capturedBearerAuthorization = '';
    const SITE_SCOPED_PATHS = new Set([
        '/media.Media/FetchImages',
        '/media.Media/FetchImage',
        '/media.Media/FetchImagesBySite',
        '/media.Media/FetchActiveImagesBySite',
        '/media.Media/FetchArticlesByImageID',
        '/media.Media/FetchFeedback',
        '/media.Media/FetchUserComments',
        '/media.Media/GenerateUploadUrl',
        '/media.Media/ImageUploadComplete',
        '/media.Media/FetchImageUploadData',
        '/media.Media/FetchPersonalMedia'
    ]);
    const REPLAY_HEADERS = new Set([
        'authorization',
        'session_token',
        'x-aws-waf-token',
        'x-client-build',
        'x-client-platform',
        'x-client-version'
    ]);

    function maybeCaptureAuthorization(url, headers) {
        try {
            const host = new URL(String(url || ''), location.href).hostname;
            if (host !== 'vsco.co' && !host.endsWith('.vsco.co')) return;
            const normalized = new Headers(headers || {});
            REPLAY_HEADERS.forEach(name => {
                const value = normalized.get(name);
                if (value) {
                    capturedHeaders.set(name, value);
                    if (name === 'authorization' && /^Bearer\s+/i.test(value)) capturedBearerAuthorization = value;
                }
            });
        } catch { /* ignore malformed application requests */ }
    }

    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init = {}) {
        maybeCaptureAuthorization(input?.url || input, init.headers || input?.headers);
        return nativeFetch(input, init);
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__vscoTubRequestUrl = url;
        return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        const normalizedName = String(name).toLowerCase();
        if (REPLAY_HEADERS.has(normalizedName)) {
            maybeCaptureAuthorization(this.__vscoTubRequestUrl, { [normalizedName]: value });
        }
        return nativeSetRequestHeader.call(this, name, value);
    };

    window.addEventListener(REQUEST_EVENT, async event => {
        const request = event.detail || {};
        const path = String(request.path || '');
        let origin = READ_PATHS.get(path);
        if (path === '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo' && REFLECTION_ORIGINS.has(request.origin)) {
            origin = request.origin;
        }
        const requestId = String(request.requestId || '');
        const respond = detail => window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
            detail: { requestId, ...detail }
        }));

        if (!requestId || !origin) return respond({ ok: false, error: 'RPC path is not in the read-only allowlist.' });
        if (!capturedHeaders.get('authorization')) return respond({ ok: false, error: 'Waiting for VSCO authenticated request context. Reload or open a media page first.' });
        if (SITE_SCOPED_PATHS.has(path) && !capturedBearerAuthorization) return respond({ ok: false, error: 'Waiting for a VSCO site-scoped bearer request. Reload an authenticated VSCO page first.' });
        const body = String(request.body || '');
        if (!body || body.length > 100000) return respond({ ok: false, error: 'Invalid or oversized gRPC-Web body.' });

        try {
            const response = await nativeFetch(`${origin}${path}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    accept: 'application/grpc-web-text',
                    ...Object.fromEntries(capturedHeaders),
                    ...(SITE_SCOPED_PATHS.has(path) ? {
                        authorization: capturedBearerAuthorization.replace(/^Bearer\s+/i, '')
                    } : {}),
                    'content-type': 'application/grpc-web-text',
                    'x-grpc-web': '1',
                    'x-user-agent': 'grpc-web-javascript/0.1'
                },
                body
            });
            const responseBody = await response.text();
            respond({
                ok: response.ok,
                httpStatus: response.status,
                contentType: response.headers.get('content-type') || '',
                grpcStatus: response.headers.get('grpc-status'),
                grpcMessage: response.headers.get('grpc-message') || '',
                body: responseBody,
                error: response.ok ? '' : `HTTP ${response.status}`
            });
        } catch (error) {
            respond({ ok: false, error: error?.message || String(error) });
        }
    });
})();
