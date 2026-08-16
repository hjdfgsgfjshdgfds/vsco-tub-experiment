const REQUEST_SOURCE = 'scoutframe-app-request';
const RESPONSE_SOURCE = 'scoutframe-companion-response';
const READY_SOURCE = 'scoutframe-companion-ready';
const pending = new Map();
let readySeenAt = 0;

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.source === READY_SOURCE) {
    readySeenAt = Date.now();
    window.dispatchEvent(new CustomEvent('scoutframe:companion-ready'));
    return;
  }
  if (message.source !== RESPONSE_SOURCE || !message.requestId) return;
  const entry = pending.get(message.requestId);
  if (!entry) return;
  pending.delete(message.requestId);
  clearTimeout(entry.timer);
  if (message.response?.ok === false) entry.reject(new Error(message.response.error || 'Companion request failed.'));
  else entry.resolve(message.response || { ok: true });
});

export function companionRequest(payload, { timeout = 25_000 } = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Scoutframe Companion did not respond. Check that it is installed and enabled.'));
    }, timeout);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({ source: REQUEST_SOURCE, requestId, payload }, window.location.origin);
  });
}

export async function companionHealth() {
  try {
    const response = await companionRequest({ action: 'scoutframe.health' }, { timeout: readySeenAt ? 1800 : 900 });
    return { ok: true, ...response };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function companionSearch({ mode = 'images', query, limit = 120, signal } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const request = companionRequest({
    action: 'scoutframe.search',
    mode,
    query: String(query || ''),
    limit: Math.max(1, Math.min(Number(limit) || 120, 10_000))
  }, { timeout: 45_000 });
  if (!signal) return request;
  return Promise.race([
    request,
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  ]);
}
