import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { ScoutframeStore, toCsv } from './store.mjs';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8']
]);

function securityHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.vsco.co https://vsco.co",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  };
}

function send(res, statusCode, body, headers = {}) {
  const payload = body === undefined ? '' : body;
  res.writeHead(statusCode, { ...securityHeaders(), ...headers });
  res.end(payload);
}

function sendJson(res, statusCode, value, headers = {}) {
  send(res, statusCode, JSON.stringify(value), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
}

function noContent(res) {
  send(res, 204, '');
}

function publicStatus(error) {
  const status = Number(error?.statusCode || 500);
  return status >= 400 && status <= 599 ? status : 500;
}

function publicMessage(error, dev) {
  if (publicStatus(error) >= 500 && !dev) return 'Scoutframe could not complete that request.';
  return String(error?.message || 'Unknown error').slice(0, 600);
}

async function readJson(req, { maxBytes = 2_000_000 } = {}) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function assertLocalRequest(req, config) {
  const host = String(req.headers.host || '').toLowerCase();
  const allowedHost = host === `${config.host}:${config.port}` ||
    host.startsWith('127.0.0.1:') || host.startsWith('localhost:') || host === '127.0.0.1' || host === 'localhost';
  if (!allowedHost) {
    const error = new Error('Scoutframe only accepts local requests.');
    error.statusCode = 403;
    throw error;
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
    if (String(req.headers['x-scoutframe-client'] || '') !== 'web') {
      const error = new Error('Missing Scoutframe local-request header.');
      error.statusCode = 403;
      throw error;
    }
    const origin = String(req.headers.origin || '');
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      const error = new Error('Cross-origin writes are not allowed.');
      error.statusCode = 403;
      throw error;
    }
  }
}

function integerParam(value, fallback, max = 10_000) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), max) : fallback;
}

function downloadFilename(prefix, extension) {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${date}.${extension}`;
}

function safeStaticPath(publicDir, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);
  const root = `${path.resolve(publicDir)}${path.sep}`;
  return resolved.startsWith(root) ? resolved : '';
}

function serveStatic(req, res, config, pathname) {
  let candidate = safeStaticPath(config.publicDir, pathname);
  if (!candidate) return sendJson(res, 404, { ok: false, error: 'Not found.' });

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    if (path.extname(pathname)) return sendJson(res, 404, { ok: false, error: 'Not found.' });
    candidate = path.join(config.publicDir, 'index.html');
  }

  if (!fs.existsSync(candidate)) return sendJson(res, 404, { ok: false, error: 'Not found.' });
  const extension = path.extname(candidate).toLowerCase();
  const cache = config.dev || extension === '.html' ? 'no-store' : 'public, max-age=3600';
  const headers = {
    ...securityHeaders(),
    'Content-Type': MIME_TYPES.get(extension) || 'application/octet-stream',
    'Content-Length': fs.statSync(candidate).size,
    'Cache-Control': cache
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(candidate).pipe(res);
}

async function routeApi(req, res, url, store, config) {
  const pathname = url.pathname;
  const segments = pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, store.status());
  }

  if (req.method === 'GET' && pathname === '/api/billing/config') {
    return sendJson(res, 200, {
      ok: true,
      currency: config.billing.currency,
      monthlyPrice: config.billing.monthlyPrice,
      yearlyPrice: config.billing.yearlyPrice,
      monthlyUrl: config.billing.monthlyUrl,
      yearlyUrl: config.billing.yearlyUrl,
      supportEmail: config.billing.supportEmail
    });
  }

  if (req.method === 'POST' && pathname === '/api/license/activate') {
    const body = await readJson(req);
    return sendJson(res, 200, { ok: true, entitlement: store.activateLicense(body.token) });
  }

  if (req.method === 'DELETE' && pathname === '/api/license') {
    return sendJson(res, 200, { ok: true, entitlement: store.deactivateLicense() });
  }

  if (pathname === '/api/collections' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, collections: store.listCollections() });
  }

  if (pathname === '/api/collections' && req.method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 201, { ok: true, collection: store.createCollection(body.name) });
  }

  if (segments[0] === 'api' && segments[1] === 'collections' && segments[2] && segments.length === 3) {
    const collectionId = segments[2];
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const collection = store.updateCollection(collectionId, body);
      if (!collection) return sendJson(res, 404, { ok: false, error: 'Collection not found.' });
      return sendJson(res, 200, { ok: true, collection });
    }
    if (req.method === 'DELETE') {
      if (!store.deleteCollection(collectionId)) return sendJson(res, 404, { ok: false, error: 'Collection not found.' });
      return noContent(res);
    }
  }

  if (segments[0] === 'api' && segments[1] === 'collections' && segments[2] && segments[3] === 'items') {
    const collectionId = segments[2];
    if (segments.length === 4 && req.method === 'GET') {
      if (!store.getCollection(collectionId)) return sendJson(res, 404, { ok: false, error: 'Collection not found.' });
      const items = store.listCollectionItems(collectionId, {
        limit: integerParam(url.searchParams.get('limit'), 2000),
        offset: integerParam(url.searchParams.get('offset'), 0)
      });
      return sendJson(res, 200, { ok: true, items });
    }
    if (segments.length === 4 && req.method === 'POST') {
      const body = await readJson(req);
      const saved = store.saveCollectionItem(collectionId, body.item, { notes: body.notes, tags: body.tags });
      return sendJson(res, 201, { ok: true, saved });
    }
    if (segments.length === 5 && req.method === 'DELETE') {
      const sourceId = segments[4];
      if (!store.deleteCollectionItem(collectionId, sourceId)) {
        return sendJson(res, 404, { ok: false, error: 'Saved item not found.' });
      }
      return noContent(res);
    }
  }

  if (pathname === '/api/watches' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, watches: store.listWatches() });
  }

  if (pathname === '/api/watches' && req.method === 'POST') {
    const body = await readJson(req);
    return sendJson(res, 201, { ok: true, watch: store.createWatch(body) });
  }

  if (segments[0] === 'api' && segments[1] === 'watches' && segments[2] && segments.length === 3) {
    const watchId = segments[2];
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const watch = store.updateWatch(watchId, body);
      if (!watch) return sendJson(res, 404, { ok: false, error: 'Watched search not found.' });
      return sendJson(res, 200, { ok: true, watch });
    }
    if (req.method === 'DELETE') {
      if (!store.deleteWatch(watchId)) return sendJson(res, 404, { ok: false, error: 'Watched search not found.' });
      return noContent(res);
    }
  }

  if (pathname === '/api/export' && req.method === 'GET') {
    const entitlement = store.getEntitlement();
    if (!entitlement.limits.export) {
      const error = new Error('Export is available during the trial and on paid plans.');
      error.statusCode = 402;
      throw error;
    }
    const data = store.exportData({ collectionId: url.searchParams.get('collection') || '' });
    const format = String(url.searchParams.get('format') || 'json').toLowerCase();
    if (format === 'csv') {
      return send(res, 200, toCsv(data.items), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadFilename('scoutframe-export', 'csv')}"`
      });
    }
    return send(res, 200, JSON.stringify(data, null, 2), {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${downloadFilename('scoutframe-export', 'json')}"`
    });
  }

  if (pathname === '/api/events' && req.method === 'POST') {
    const body = await readJson(req, { maxBytes: 80_000 });
    store.recordEvent(body.name, body.payload);
    return noContent(res);
  }

  return sendJson(res, 404, { ok: false, error: 'API route not found.' });
}

export async function createScoutframeServer({ rootDir, ...overrides } = {}) {
  const resolvedRoot = rootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = loadConfig(resolvedRoot, overrides);
  fs.mkdirSync(config.publicDir, { recursive: true });
  const store = new ScoutframeStore(config);
  let baseUrl = '';

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || `${config.host}:${config.port}`}`);
      assertLocalRequest(req, config);
      if (req.method === 'OPTIONS') return noContent(res);
      if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url, store, config);
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return serveStatic(req, res, config, url.pathname);
    } catch (error) {
      const status = publicStatus(error);
      if (config.dev || status >= 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { ok: false, error: publicMessage(error, config.dev) });
      else res.destroy();
    }
  });

  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

  return {
    config,
    store,
    server,
    get baseUrl() {
      return baseUrl;
    },
    async listen() {
      if (server.listening) return baseUrl;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : config.port;
      baseUrl = `http://${config.host}:${port}`;
      return baseUrl;
    },
    async close() {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      store.close();
    }
  };
}
