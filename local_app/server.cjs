const express = require('express');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 5058);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'vsco-live-feed.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    username TEXT,
    image_url TEXT,
    saved_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS vault_saved_at ON vault_items(saved_at DESC);
`);

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http')) return url;
  return `https://${url}`;
}

function imageId(item) {
    return String(item?.imageId || item?._id || item?.id || item?.gridImageId || '').trim();
}

function imageTimestamp(item, id) {
  const objectId = String(id || '');
  if (/^[0-9a-f]{24}$/i.test(objectId)) {
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

function mapImage(item) {
  const id = imageId(item);
  return {
    id,
    kind: 'image',
    username: item?.grid?.subdomain || item?.siteSubDomain || '',
    displayName: item?.grid?.name || '',
    siteId: String(item?.grid?.siteId || item?.siteId || ''),
    imageUrl: normalizeUrl(item?.responsive_url || item?.image_url || item?.site_profile_image_url || (id ? `i.vsco.co/${id}` : '')),
    description: item?.description || '',
    timestamp: imageTimestamp(item, id),
    width: Number(item?.width || item?.image_meta?.width || 0),
    height: Number(item?.height || item?.image_meta?.height || 0),
    hasGps: Boolean(item?.has_location || item?.location_coords || item?.locationCoords),
    raw: item
  };
}

function mapPerson(person) {
  const id = String(person?.siteId || person?.siteSubDomain || '').trim();
  const gridImage = String(person?.gridImage || '').trim();
  return {
    id,
    kind: 'person',
    username: person?.siteSubDomain || '',
    displayName: person?.userName || person?.siteSubDomain || '',
    siteId: String(person?.siteId || ''),
    imageUrl: normalizeUrl(person?.responsive_url || (person?.gridImageId ? `i.vsco.co/${person.gridImageId}` : '')),
    profileImageUrl: normalizeUrl(gridImage ? (gridImage.startsWith('http') || gridImage.startsWith('//') ? gridImage : `img.vsco.co/${gridImage}`) : ''),
    description: person?.gridName || '',
    timestamp: person?.gridImageId ? parseInt(String(person.gridImageId).slice(0, 8), 16) : 0,
    width: Number(person?.width || 0),
    height: Number(person?.height || 0),
    hasGps: Boolean(person?.has_location || person?.location_coords),
    raw: person
  };
}

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: true });
});

app.get('/api/vault', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 5000);
  const rows = db.prepare('SELECT payload, saved_at FROM vault_items ORDER BY saved_at DESC LIMIT ?').all(limit);
  res.json({ items: rows.map(row => ({ ...JSON.parse(row.payload), savedAt: row.saved_at })) });
});

app.post('/api/vault', (req, res) => {
  const item = req.body?.item;
  if (!item?.id) return res.status(400).json({ error: 'A vault item with an id is required.' });
  const savedAt = Date.now();
  db.prepare(`
    INSERT INTO vault_items (id, kind, username, image_url, saved_at, payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, saved_at=excluded.saved_at,
      kind=excluded.kind, username=excluded.username, image_url=excluded.image_url
  `).run(String(item.id), item.kind || 'image', item.username || '', item.imageUrl || '', savedAt, JSON.stringify(item));
  res.json({ ok: true, savedAt });
});

app.post('/api/import', (req, res) => {
  const source = req.body || {};
  const rawItems = Array.isArray(source.indexedDB) ? source.indexedDB : Array.isArray(source.items) ? source.items : [];
  const upsert = db.prepare(`
    INSERT INTO vault_items (id, kind, username, image_url, saved_at, payload)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, saved_at=excluded.saved_at
  `);
  let imported = 0;
  db.exec('BEGIN');
  try {
    for (const raw of rawItems) {
      const item = mapImage(raw);
      if (!item.id) continue;
      upsert.run(item.id, item.kind, item.username, item.imageUrl, Date.now(), JSON.stringify(item));
      imported++;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: error.message });
  }
  res.json({ ok: true, imported });
});

const dist = path.join(ROOT, 'dist');
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`VSCO Live Feed local app: http://127.0.0.1:${PORT}`);
});

async function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
