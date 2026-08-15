const VSCO_LOCAL_REQUEST = 'vsco-local-app-request';
const VSCO_LOCAL_RESPONSE = 'vsco-local-app-response';

window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== VSCO_LOCAL_REQUEST) return;
    const { id, payload } = event.data;
    if (!id || !payload) return;

    chrome.runtime.sendMessage(payload, response => {
        const error = chrome.runtime.lastError?.message || '';
        window.postMessage({ source: VSCO_LOCAL_RESPONSE, id, response, error }, window.location.origin);
    });
});
