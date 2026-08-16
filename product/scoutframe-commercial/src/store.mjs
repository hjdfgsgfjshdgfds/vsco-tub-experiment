import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { entitlementFor, verifyLicenseToken } from './license.mjs';

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanName(value, fallback = 'Untitled') {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  return (name || fallback).slice(0, 80);
}

function cleanTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map(tag => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 24);
}

function finiteNumber(value, fallback = 0, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanCoordinates(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function safePayload(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    id: String(source.id || source.imageId || source.siteId || '').slice(0, 160),
    kind: String(source.kind || 'image').slice(0, 20),
    username: String(source.username || '').slice(0, 160),
    displayName: String(source.displayName || '').slice(0, 240),
    siteId: String(source.siteId || '').slice(0, 160),
    imageUrl: String(source.imageUrl || '').slice(0, 4096),
    profileImageUrl: String(source.profileImageUrl || '').slice(0, 4096),
    description: String(source.description || '').slice(0, 10_000),
    timestamp: finiteNumber(source.timestamp, 0, { min: 0 }),
    width: finiteNumber(source.width, 0, { min: 0 }),
    height: finiteNumber(source.height, 0, { min: 0 }),
    hasGps: Boolean(source.hasGps),
    coordinates: cleanCoordinates(source.coordinates),
    country: String(source.country || '').slice(0, 120),
    camera: String(source.camera || '').slice(0, 240),
    software: String(source.software || '').slice(0, 240),
    preset: String(source.preset || '').slice(0, 240),
    permalink: String(source.permalink || '').slice(0, 4096),
    sourceQuery: String(source.sourceQuery || '').slice(0, 500)
  };
}

export class ScoutframeStore {
  constructor(config) {
    this.config = config;
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.dbPath = path.join(config.dataDir, 'scoutframe.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
    if (!this.getMeta('trial_started_at')) this.setMeta('trial_started_at', String(Date.now()));
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collection_items (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        username TEXT,
        image_url TEXT,
        payload TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        saved_at INTEGER NOT NULL,
        UNIQUE(collection_id, source_id)
      );
      CREATE INDEX IF NOT EXISTS collection_items_saved_at ON collection_items(collection_id, saved_at DESC);

      CREATE TABLE IF NOT EXISTS watches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        query TEXT NOT NULL,
        filters_json TEXT NOT NULL DEFAULT '{}',
        last_seen_json TEXT NOT NULL DEFAULT '[]',
        last_checked_at INTEGER NOT NULL DEFAULT 0,
        new_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS watches_updated_at ON watches(updated_at DESC);

      CREATE TABLE IF NOT EXISTS local_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS local_events_created_at ON local_events(created_at DESC);

      CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token TEXT NOT NULL,
        payload TEXT NOT NULL,
        activated_at INTEGER NOT NULL
      );
    `);
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(String(key))?.value || '';
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(key), String(value));
  }

  getEntitlement(now = Date.now()) {
    const license = this.db.prepare('SELECT token FROM licenses WHERE id = 1').get();
    const licenseResult = license?.token
      ? verifyLicenseToken(license.token, this.config.licensePublicKey, { now })
      : null;
    return entitlementFor({
      trialStartedAt: Number(this.getMeta('trial_started_at') || now),
      trialDays: this.config.trialDays,
      licenseResult,
      now
    });
  }

  status() {
    const entitlement = this.getEntitlement();
    const counts = {
      collections: Number(this.db.prepare('SELECT COUNT(*) AS count FROM collections').get().count),
      items: Number(this.db.prepare('SELECT COUNT(*) AS count FROM collection_items').get().count),
      watches: Number(this.db.prepare('SELECT COUNT(*) AS count FROM watches').get().count)
    };
    return {
      ok: true,
      version: '0.1.0',
      localOnly: true,
      dataPath: this.config.dev ? this.dbPath : undefined,
      entitlement,
      counts
    };
  }

  activateLicense(token) {
    const result = verifyLicenseToken(token, this.config.licensePublicKey);
    if (!result.ok) {
      const error = new Error(result.reason);
      error.statusCode = 400;
      throw error;
    }
    this.db.prepare(`
      INSERT INTO licenses (id, token, payload, activated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET token = excluded.token, payload = excluded.payload,
        activated_at = excluded.activated_at
    `).run(String(token).trim(), JSON.stringify(result.payload), Date.now());
    return this.getEntitlement();
  }

  deactivateLicense() {
    this.db.prepare('DELETE FROM licenses WHERE id = 1').run();
    return this.getEntitlement();
  }

  listCollections() {
    return this.db.prepare(`
      SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(i.id) AS item_count
      FROM collections c
      LEFT JOIN collection_items i ON i.collection_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.created_at DESC
    `).all().map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      itemCount: Number(row.item_count)
    }));
  }

  createCollection(name) {
    const entitlement = this.getEntitlement();
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM collections').get().count);
    if (count >= entitlement.limits.collections) {
      const error = new Error(`Your ${entitlement.plan} plan allows ${entitlement.limits.collections} collection${entitlement.limits.collections === 1 ? '' : 's'}.`);
      error.statusCode = 402;
      throw error;
    }
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare('INSERT INTO collections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, cleanName(name, 'Inbox'), now, now);
    return this.getCollection(id);
  }

  getCollection(id) {
    const row = this.db.prepare(`
      SELECT c.id, c.name, c.created_at, c.updated_at, COUNT(i.id) AS item_count
      FROM collections c LEFT JOIN collection_items i ON i.collection_id = c.id
      WHERE c.id = ? GROUP BY c.id
    `).get(String(id));
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      itemCount: Number(row.item_count)
    };
  }

  updateCollection(id, patch) {
    const existing = this.getCollection(id);
    if (!existing) return null;
    this.db.prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?')
      .run(cleanName(patch?.name, existing.name), Date.now(), String(id));
    return this.getCollection(id);
  }

  deleteCollection(id) {
    const result = this.db.prepare('DELETE FROM collections WHERE id = ?').run(String(id));
    return result.changes > 0;
  }

  listCollectionItems(collectionId, { limit = 2000, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 2000, 1), 10_000);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    return this.db.prepare(`
      SELECT id, source_id, payload, notes, tags_json, saved_at
      FROM collection_items WHERE collection_id = ?
      ORDER BY saved_at DESC LIMIT ? OFFSET ?
    `).all(String(collectionId), safeLimit, safeOffset).map(row => ({
      ...parseJson(row.payload, {}),
      savedItemId: row.id,
      sourceId: row.source_id,
      notes: row.notes,
      tags: parseJson(row.tags_json, []),
      savedAt: row.saved_at
    }));
  }

  saveCollectionItem(collectionId, item, { notes = '', tags = [] } = {}) {
    const collection = this.getCollection(collectionId);
    if (!collection) {
      const error = new Error('Collection not found.');
      error.statusCode = 404;
      throw error;
    }
    const payload = safePayload(item);
    if (!payload.id) {
      const error = new Error('A result id is required.');
      error.statusCode = 400;
      throw error;
    }
    const entitlement = this.getEntitlement();
    const totalItems = Number(this.db.prepare('SELECT COUNT(*) AS count FROM collection_items').get().count);
    const existing = this.db.prepare('SELECT id FROM collection_items WHERE collection_id = ? AND source_id = ?')
      .get(String(collectionId), payload.id);
    if (!existing && totalItems >= entitlement.limits.collectionItems) {
      const error = new Error(`Your ${entitlement.plan} plan has reached its saved-item limit.`);
      error.statusCode = 402;
      throw error;
    }

    const id = existing?.id || randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO collection_items
        (id, collection_id, source_id, kind, username, image_url, payload, notes, tags_json, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection_id, source_id) DO UPDATE SET
        kind = excluded.kind,
        username = excluded.username,
        image_url = excluded.image_url,
        payload = excluded.payload,
        notes = excluded.notes,
        tags_json = excluded.tags_json,
        saved_at = excluded.saved_at
    `).run(
      id,
      String(collectionId),
      payload.id,
      payload.kind,
      payload.username,
      payload.imageUrl,
      JSON.stringify(payload),
      String(notes || '').slice(0, 10_000),
      JSON.stringify(cleanTags(tags)),
      now
    );
    this.db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now, String(collectionId));
    return this.db.prepare('SELECT id, saved_at FROM collection_items WHERE collection_id = ? AND source_id = ?')
      .get(String(collectionId), payload.id);
  }

  deleteCollectionItem(collectionId, sourceId) {
    const result = this.db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND source_id = ?')
      .run(String(collectionId), String(sourceId));
    if (result.changes) this.db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(Date.now(), String(collectionId));
    return result.changes > 0;
  }

  listWatches() {
    return this.db.prepare('SELECT * FROM watches ORDER BY updated_at DESC').all().map(row => ({
      id: row.id,
      name: row.name,
      mode: row.mode,
      query: row.query,
      filters: parseJson(row.filters_json, {}),
      lastSeenIds: parseJson(row.last_seen_json, []),
      lastCheckedAt: row.last_checked_at,
      newCount: Number(row.new_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  createWatch(input) {
    const entitlement = this.getEntitlement();
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM watches').get().count);
    if (count >= entitlement.limits.watches) {
      const error = new Error(`Your ${entitlement.plan} plan allows ${entitlement.limits.watches} watched search${entitlement.limits.watches === 1 ? '' : 'es'}.`);
      error.statusCode = 402;
      throw error;
    }
    const query = String(input?.query || '').trim().slice(0, 500);
    if (!query) {
      const error = new Error('A search query is required.');
      error.statusCode = 400;
      throw error;
    }
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO watches
        (id, name, mode, query, filters_json, last_seen_json, last_checked_at, new_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '[]', 0, 0, ?, ?)
    `).run(
      id,
      cleanName(input?.name, query),
      ['images', 'people', 'bio'].includes(input?.mode) ? input.mode : 'images',
      query,
      JSON.stringify(input?.filters && typeof input.filters === 'object' ? input.filters : {}),
      now,
      now
    );
    return this.listWatches().find(watch => watch.id === id);
  }

  updateWatch(id, patch) {
    const existing = this.listWatches().find(watch => watch.id === String(id));
    if (!existing) return null;
    const lastSeenIds = Array.isArray(patch?.lastSeenIds)
      ? [...new Set(patch.lastSeenIds.map(String))].slice(0, 500)
      : existing.lastSeenIds;
    const now = Date.now();
    this.db.prepare(`
      UPDATE watches SET name = ?, mode = ?, query = ?, filters_json = ?, last_seen_json = ?,
        last_checked_at = ?, new_count = ?, updated_at = ? WHERE id = ?
    `).run(
      cleanName(patch?.name, existing.name),
      ['images', 'people', 'bio'].includes(patch?.mode) ? patch.mode : existing.mode,
      String(patch?.query ?? existing.query).trim().slice(0, 500),
      JSON.stringify(patch?.filters && typeof patch.filters === 'object' ? patch.filters : existing.filters),
      JSON.stringify(lastSeenIds),
      Number.isFinite(Number(patch?.lastCheckedAt)) ? Number(patch.lastCheckedAt) : existing.lastCheckedAt,
      Number.isFinite(Number(patch?.newCount)) ? Math.max(0, Number(patch.newCount)) : existing.newCount,
      now,
      String(id)
    );
    return this.listWatches().find(watch => watch.id === String(id));
  }

  deleteWatch(id) {
    return this.db.prepare('DELETE FROM watches WHERE id = ?').run(String(id)).changes > 0;
  }

  recordEvent(name, payload = {}) {
    const eventName = String(name || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 80);
    if (!eventName) return;
    this.db.prepare('INSERT INTO local_events (name, payload, created_at) VALUES (?, ?, ?)')
      .run(eventName, JSON.stringify(payload && typeof payload === 'object' ? payload : {}), Date.now());
    this.db.prepare(`DELETE FROM local_events WHERE id NOT IN (SELECT id FROM local_events ORDER BY id DESC LIMIT 5000)`).run();
  }

  exportData({ collectionId = '' } = {}) {
    const collections = collectionId
      ? this.listCollections().filter(collection => collection.id === String(collectionId))
      : this.listCollections();
    const items = collections.flatMap(collection => {
      const collected = [];
      let offset = 0;
      while (true) {
        const batch = this.listCollectionItems(collection.id, { limit: 10_000, offset });
        collected.push(...batch);
        if (batch.length < 10_000) break;
        offset += batch.length;
      }
      return collected.map(item => ({ ...item, collectionId: collection.id, collectionName: collection.name }));
    });
    return {
      exportedAt: Date.now(),
      product: 'Scoutframe',
      version: '0.1.0',
      collections,
      watches: this.listWatches(),
      items
    };
  }

  close() {
    this.db.close();
  }
}

export function toCsv(items) {
  const columns = [
    'collectionName', 'kind', 'id', 'username', 'displayName', 'description', 'timestamp',
    'country', 'camera', 'preset', 'hasGps', 'latitude', 'longitude', 'permalink', 'imageUrl',
    'notes', 'tags', 'savedAt'
  ];
  const escape = value => {
    const text = String(value ?? '');
    const inert = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(inert) ? `"${inert.replaceAll('"', '""')}"` : inert;
  };
  const rows = items.map(item => ({
    ...item,
    latitude: item.coordinates?.lat ?? '',
    longitude: item.coordinates?.lng ?? '',
    tags: Array.isArray(item.tags) ? item.tags.join('|') : ''
  }));
  return [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\n');
}
