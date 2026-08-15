import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const NAV_ITEMS = [
  ['discover', 'Discover'], ['images', 'Live Feed'], ['people', 'People'], ['bio', 'Bio Search'], ['vault', 'Vault'],
  ['review', 'Review Queue'], ['liked', 'Fully Liked'], ['reposts', 'Reposts'], ['updates', 'Updates'], ['social', 'Social'],
  ['site-ids', 'Site IDs'], ['site-edge', 'Site Edge'], ['settings', 'Settings']
];

const ICONS = {
  discover: '◉', images: '◌', people: '♙', bio: '⌕', vault: '□', review: '◴', liked: '♡', reposts: '↻',
  updates: '♧', social: '○', 'site-ids': '▣', 'site-edge': '◎', settings: '⚙'
};

function imageFallback(event, fallback) {
  const img = event.currentTarget;
  if (fallback && img.src !== fallback) img.src = fallback;
  else img.closest('.media-frame')?.classList.add('failed');
}

function resultTimestamp(item) {
  const numeric = Number(item?.timestamp || 0);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }

  const id = String(item?.id || '');
  if (!/^[0-9a-f]{24}$/i.test(id)) return 0;
  const seconds = parseInt(id.slice(0, 8), 16);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function compareRecentUploads(a, b) {
  return (resultTimestamp(b) - resultTimestamp(a)) || String(b?.id || '').localeCompare(String(a?.id || ''));
}

let bridgeSequence = 0;
const pendingBridgeMessages = new Map();

window.addEventListener('message', event => {
  if (event.source !== window || event.data?.source !== 'vsco-local-app-response') return;
  const pending = pendingBridgeMessages.get(event.data.id);
  if (!pending) return;
  pendingBridgeMessages.delete(event.data.id);
  clearTimeout(pending.timer);
  if (event.data.error) pending.reject(new Error(event.data.error));
  else if (!event.data.response?.ok) pending.reject(new Error(event.data.response?.error || 'Extension bridge failed.'));
  else pending.resolve(event.data.response);
});

function extensionMessage(payload) {
  return new Promise((resolve, reject) => {
    const id = `vsco-${Date.now()}-${++bridgeSequence}`;
    const timer = window.setTimeout(() => {
      pendingBridgeMessages.delete(id);
      reject(new Error('Reload the VSCO extension once, then reload this page.'));
    }, 5000);
    pendingBridgeMessages.set(id, { resolve, reject, timer });
    window.postMessage({ source: 'vsco-local-app-request', id, payload }, window.location.origin);
  });
}

function App() {
  const [section, setSection] = useState('images');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('images');
  const [items, setItems] = useState([]);
  const [visible, setVisible] = useState(32);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState({ ok: false });
  const [sort, setSort] = useState('recent');
  const [aspect, setAspect] = useState('all');
  const [gpsOnly, setGpsOnly] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/health').then(r => r.json()),
      extensionMessage({ action: 'localAppHealth' })
    ]).then(([serverHealth]) => setHealth(serverHealth)).catch(error => setHealth({ ok: false, error: error.message }));
  }, []);

  const filteredItems = useMemo(() => items.filter(item => {
    if (gpsOnly && !item.hasGps) return false;
    if (aspect === 'tall' && !(item.height > 0 && item.width > 0 && item.height / item.width >= 1.6)) return false;
    if (aspect === 'wide' && !(item.height > 0 && item.width > 0 && item.width / item.height >= 1.6)) return false;
    return true;
  }), [items, aspect, gpsOnly]);

  const displayed = useMemo(() => {
    const copy = [...filteredItems];
    if (sort === 'recent') copy.sort(compareRecentUploads);
    if (sort === 'site-high') copy.sort((a, b) => Number(b.siteId || 0) - Number(a.siteId || 0));
    return copy.slice(0, visible);
  }, [filteredItems, sort, visible]);

  async function runSearch(nextMode = mode, nextQuery = query) {
    const q = nextQuery.trim();
    if (!q) return;
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const data = await extensionMessage({ action: 'localAppSearch', mode: nextMode, q, limit: 10000 });
      setItems(data.items || []);
      setVisible(32);
      setSection(nextMode);
    } catch (searchError) {
      setError(searchError.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadVault() {
    setLoading(true);
    setError('');
    try {
      const data = await fetch('/api/vault').then(r => r.json());
      setItems(data.items || []);
      setVisible(32);
      setSection('vault');
    } catch (vaultError) {
      setError(vaultError.message);
    } finally {
      setLoading(false);
    }
  }

  function navigate(key) {
    if (key === 'vault') return void loadVault();
    if (['images', 'people', 'bio'].includes(key)) {
      setMode(key);
      setSection(key);
      if (query.trim()) void runSearch(key, query);
      return;
    }
    setSection(key);
    setItems([]);
    setSelected(null);
  }

  async function addToVault(item) {
    const response = await fetch('/api/vault', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item })
    });
    if (!response.ok) setError('Could not save this item to the Vault.');
  }

  async function importVaultFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const payload = JSON.parse(await file.text());
      const response = await fetch('/api/import', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed');
      await loadVault();
    } catch (importError) {
      setError(importError.message);
      setLoading(false);
    } finally {
      event.target.value = '';
    }
  }

  const currentLabel = NAV_ITEMS.find(([key]) => key === section)?.[1] || 'Discover';
  const implemented = ['images', 'people', 'bio', 'vault'].includes(section);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">VSCO <span>Live Feed</span></div>
      <nav>
        {NAV_ITEMS.map(([key, label], index) => <React.Fragment key={key}>
          {(index === 4 || index === 8 || index === 12) && <div className="nav-divider" />}
          <button className={section === key ? 'nav-item active' : 'nav-item'} onClick={() => navigate(key)}>
            <span className="nav-icon">{ICONS[key]}</span>{label}
          </button>
        </React.Fragment>)}
      </nav>
      <div className={health.ok ? 'connection online' : 'connection offline'}>
        <span className="status-dot" />
        <div><strong>{health.ok ? 'Connected' : 'Disconnected'}</strong><small>{health.ok ? 'Extension bridge ready' : health.error || 'Bridge unavailable'}</small></div>
      </div>
    </aside>

    <main className="workspace">
      <header className="command-bar">
        <form className="search-form" onSubmit={event => { event.preventDefault(); void runSearch(); }}>
          <span className="search-icon">⌕</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search bios, usernames, or images…" />
          <button className="primary" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
        </form>
        <button className="control" onClick={() => { const terms = ['light', 'summer', 'film', 'city', 'portrait']; const q = terms[Math.floor(Math.random() * terms.length)]; setQuery(q); void runSearch(mode, q); }}>↝ Random</button>
        <div className="segmented">
          {[['images', 'Images'], ['people', 'People'], ['bio', 'Bio']].map(([key, label]) => <button key={key} className={mode === key ? 'selected' : ''} onClick={() => { setMode(key); if (query.trim()) void runSearch(key, query); }}>{label}</button>)}
        </div>
        <button className={gpsOnly ? 'control active-control' : 'control'} onClick={() => { setGpsOnly(value => !value); setVisible(32); }}>GPS · {gpsOnly ? 'Only' : 'All'}</button>
        <select className="control select" value={aspect} onChange={event => setAspect(event.target.value)} aria-label="Aspect filter"><option value="all">Aspect · All</option><option value="tall">Tall 9:16</option><option value="wide">Wide 16:9</option></select>
        <select className="control select" value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort results"><option value="recent">Recent Upload</option><option value="site-high">Site ID High</option></select>
        <div className="result-count">{filteredItems.length.toLocaleString()} results</div>
      </header>

      <section className="content">
        <div className="content-heading"><div><h1>{currentLabel}</h1><p>{section === 'vault' ? 'Saved locally in SQLite' : 'Fast browser-backed VSCO discovery'}</p></div></div>
        {error && <div className="error-banner">{error}</div>}
        {!implemented ? <div className="empty-state"><h2>{currentLabel}</h2><p>This module has not been migrated yet. The old extension remains available while it moves across cleanly.</p></div>
        : !loading && displayed.length === 0 ? <div className="empty-state"><h2>{section === 'vault' ? 'Your local Vault is empty' : 'Search without melting Chrome'}</h2><p>{section === 'vault' ? 'Save a result or import an extension export.' : 'Enter a query above, then choose Images, People, or Bio.'}</p>{section === 'vault' && <label className="import-button">Import extension export<input type="file" accept="application/json,.json" onChange={importVaultFile} /></label>}</div>
        : <div className={selected ? 'media-grid drawer-open' : 'media-grid'}>
          {displayed.map(item => <article className="media-card" key={`${item.kind}-${item.id}`} onClick={() => setSelected(item)}>
            <div className="media-frame">
              {item.imageUrl ? <img src={item.imageUrl} loading="lazy" alt={item.displayName || item.username || 'VSCO result'} onError={event => imageFallback(event, item.profileImageUrl)} /> : <div className="placeholder">{(item.displayName || item.username || '?').slice(0, 1).toUpperCase()}</div>}
            </div>
            <div className="media-meta"><strong>@{item.username || 'unknown'}</strong><span>{item.siteId ? `ID ${item.siteId}` : ''}</span></div>
            {item.description && <p className="description">{item.description}</p>}
          </article>)}
        </div>}
        {visible < filteredItems.length && <button className="load-more" onClick={() => setVisible(count => count + 32)}>Load 32 more</button>}
      </section>
    </main>

    {selected && <aside className="details-drawer">
      <button className="drawer-close" onClick={() => setSelected(null)} aria-label="Close details">×</button>
      <div className="profile-line"><div className="avatar">{(selected.displayName || selected.username || '?').slice(0, 1).toUpperCase()}</div><div><strong>@{selected.username || 'unknown'}</strong><span>{selected.displayName}</span></div></div>
      <dl><div><dt>Site ID</dt><dd>{selected.siteId || 'Unknown'}</dd></div><div><dt>Type</dt><dd>{selected.kind}</dd></div></dl>
      {selected.imageUrl && <div className="drawer-image"><img src={selected.imageUrl} alt="Selected VSCO result" onError={event => imageFallback(event, selected.profileImageUrl)} /></div>}
      {selected.description && <p className="drawer-description">{selected.description}</p>}
      <a className="action secondary" href={`https://vsco.co/${selected.username}`} target="_blank" rel="noreferrer">Open VSCO profile</a>
      <button className="action primary" onClick={() => void addToVault(selected)}>♡ Add to Vault</button>
    </aside>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
