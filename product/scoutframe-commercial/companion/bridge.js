(() => {
  const REQUEST_SOURCE = 'scoutframe-app-request';
  const RESPONSE_SOURCE = 'scoutframe-companion-response';
  const READY_SOURCE = 'scoutframe-companion-ready';
  const ALLOWED_ACTIONS = new Set(['scoutframe.health', 'scoutframe.search']);
  const origin = window.location.origin;
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):4177$/i.test(origin)) return;

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== origin) return;
    const message = event.data;
    if (!message || message.source !== REQUEST_SOURCE || !message.requestId) return;
    const payload = message.payload;
    if (!payload || !ALLOWED_ACTIONS.has(payload.action)) return;

    chrome.runtime.sendMessage(payload, response => {
      const error = chrome.runtime.lastError;
      window.postMessage({
        source: RESPONSE_SOURCE,
        requestId: String(message.requestId),
        response: error ? { ok: false, error: error.message } : response || { ok: false, error: 'Empty companion response.' }
      }, origin);
    });
  });

  window.postMessage({ source: READY_SOURCE, version: chrome.runtime.getManifest().version }, origin);
})();
