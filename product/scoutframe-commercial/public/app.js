import { companionHealth, companionSearch } from './modules/bridge.js';
import { demoSearch } from './modules/demo.js';
import { filterAndSortScoutItems, parseScoutQuery, scoutAspect } from './modules/query.js';

const appShell = document.querySelector('#app');
const main = document.querySelector('#main');
const breadcrumb = document.querySelector('#breadcrumb');
const connectionPill = document.querySelector('#connection-pill');
const demoPill = document.querySelector('#demo-pill');
const detailDrawer = document.querySelector('#detail-drawer');
const toastRegion = document.querySelector('#toast-region');
const helpDialog = document.querySelector('#help-dialog');

const state = {
  view: 'explore',
  status: null,
  billing: null,
  companion: { ok: false, checking: true },
  demoMode: false,
  mode: 'images',
  query: '',
  filters: { aspect: '', gps: '', camera: '', country: '', after: '', before: '', sort: 'newest' },
  advancedOpen: false,
  loading: false,
  sourceItems: [],
  visibleItems: [],
  sourceCount: 0,
  tookMs: 0,
  selectedIds: new Set(),
  selectedItem: null,
  collections: [],
  selectedCollectionId: '',
  collectionItems: new Map(),
  collectionLoading: false,
  watches: [],
  searchController: null
};

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'title') node.title = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function safeUrl(value, { media = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (media && raw.startsWith('data:image/')) return raw;
  if (media && raw.startsWith('blob:')) return raw;
  const candidate = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:') return parsed.href;
    if (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)) return parsed.href;
    return '';
  } catch {
    return '';
  }
}

function formatDate(timestamp, { short = false } = {}) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, short
    ? { year: 'numeric', month: 'short' }
    : { year: 'numeric', month: 'short', day: 'numeric' }
  ).format(date);
}

function formatPlan(plan) {
  return String(plan || 'free').replace(/^./, letter => letter.toUpperCase());
}

function currency(amount) {
  const code = state.billing?.currency || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}

function toast(message, type = '') {
  const node = element('div', { class: `toast ${type}`.trim(), text: message });
  toastRegion.append(node);
  window.setTimeout(() => node.remove(), 3600);
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (!['GET', 'HEAD'].includes(method)) headers['X-Scoutframe-Client'] = 'web';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (response.status === 204) return {};
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || payload || `Request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function reportError(error) {
  if (error?.name === 'AbortError') return;
  console.error(error);
  toast(error?.message || 'Something went wrong.', 'error');
}

function activeEntitlement() {
  return state.status?.entitlement || {
    plan: 'free', trial: false, paid: false,
    limits: { resultLimit: 120, collections: 1, watches: 1, collectionItems: 250, export: false, advancedFilters: false, batchSave: false }
  };
}

function updateChrome() {
  const title = ({ explore: 'Explore', collections: 'Collections', watches: 'Watched searches', upgrade: 'Plans & license' })[state.view] || 'Scoutframe';
  breadcrumb.textContent = title;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === state.view));
  document.querySelector('#collection-count').textContent = state.collections.length;
  document.querySelector('#watch-count').textContent = state.watches.length;

  const entitlement = activeEntitlement();
  const planCard = document.querySelector('#plan-card');
  planCard.replaceChildren(
    element('strong', {}, formatPlan(entitlement.plan), element('span', { text: entitlement.paid ? 'Active' : entitlement.trial ? 'Trial' : 'Local' })),
    element('p', { text: entitlement.trial
      ? `${entitlement.daysRemaining} day${entitlement.daysRemaining === 1 ? '' : 's'} left with every Pro feature.`
      : entitlement.paid ? `Licensed to ${entitlement.license?.email || 'this machine'}.` : `${entitlement.limits.resultLimit} results per search. Upgrade to export.` })
  );

  connectionPill.classList.toggle('is-online', state.companion.ok && state.companion.authenticated !== false);
  connectionPill.classList.toggle('is-offline', (!state.companion.ok || state.companion.authenticated === false) && !state.companion.checking);
  connectionPill.querySelector('b').textContent = state.companion.checking
    ? 'Checking companion'
    : state.companion.ok && state.companion.authenticated === false
      ? 'Sign in to VSCO'
      : state.companion.ok ? 'Companion connected' : 'Companion offline';
  demoPill.hidden = !state.demoMode;
}

function setView(view) {
  if (!['explore', 'collections', 'watches', 'upgrade'].includes(view)) return;
  state.view = view;
  appShell.classList.remove('nav-open');
  updateChrome();
  render();
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function recordEvent(name, payload = {}) {
  api('/api/events', { method: 'POST', body: { name, payload } }).catch(() => {});
}

async function loadCore() {
  const [status, billing, collections, watches] = await Promise.all([
    api('/api/status'),
    api('/api/billing/config'),
    api('/api/collections'),
    api('/api/watches')
  ]);
  state.status = status;
  state.billing = billing;
  state.collections = collections.collections || [];
  state.watches = watches.watches || [];
  state.selectedCollectionId ||= state.collections[0]?.id || '';
}

async function refreshCompanion({ quiet = false } = {}) {
  state.companion = { ok: false, checking: true };
  updateChrome();
  const result = await companionHealth();
  state.companion = { ...result, checking: false };
  updateChrome();
  if (!quiet) toast(result.ok ? 'Scoutframe Companion is connected.' : 'Companion not detected. Demo mode is still available.', result.ok ? '' : 'error');
  if (state.view === 'explore') renderExplore();
  return result;
}

function parsedCurrentQuery() {
  return parseScoutQuery(state.query);
}

function normalizedUiFilters() {
  const result = { ...state.filters };
  if (result.gps === 'true') result.gps = true;
  else if (result.gps === 'false') result.gps = false;
  else delete result.gps;
  if (result.after) result.after = Date.parse(`${result.after}T00:00:00Z`);
  else delete result.after;
  if (result.before) result.before = Date.parse(`${result.before}T00:00:00Z`);
  else delete result.before;
  return result;
}

function refreshVisible() {
  state.visibleItems = filterAndSortScoutItems(state.sourceItems, parsedCurrentQuery(), normalizedUiFilters());
}

function readSearchForm() {
  const form = main.querySelector('#search-form');
  if (!form) return;
  state.query = form.querySelector('#query').value;
  for (const name of Object.keys(state.filters)) {
    const input = form.elements.namedItem(name);
    if (input) state.filters[name] = input.value;
  }
}

async function runSearch({ watch = null } = {}) {
  readSearchForm();
  const parsed = parsedCurrentQuery();
  const query = parsed.apiQuery || state.query.replace(/(?:^|\s)(?:from|camera|country|gps|after|before|aspect|minwidth|minheight|sort):\S+/gi, ' ').trim();
  if (!query) return toast('Enter at least one search word before searching.', 'error');
  if (!state.demoMode && !state.companion.ok) {
    toast('Connect the companion or switch to demo data first.', 'error');
    return;
  }

  state.searchController?.abort();
  state.searchController = new AbortController();
  state.loading = true;
  state.selectedIds.clear();
  state.sourceItems = [];
  state.visibleItems = [];
  renderExplore();

  try {
    const limit = activeEntitlement().limits.resultLimit;
    const result = state.demoMode
      ? await demoSearch({ mode: state.mode, query, limit })
      : await companionSearch({ mode: state.mode, query, limit, signal: state.searchController.signal });
    state.sourceItems = (result.items || []).map(item => ({ ...item, sourceQuery: state.query }));
    state.sourceCount = Number(result.sourceCount ?? state.sourceItems.length);
    state.tookMs = Number(result.tookMs || 0);
    refreshVisible();
    recordEvent('search.completed', { mode: state.mode, demo: state.demoMode, returned: state.sourceItems.length, visible: state.visibleItems.length });

    if (watch) {
      const prior = new Set(watch.lastSeenIds || []);
      const ids = state.sourceItems.map(item => String(item.id)).filter(Boolean).slice(0, 500);
      const newCount = prior.size ? ids.filter(id => !prior.has(id)).length : 0;
      const updated = await api(`/api/watches/${encodeURIComponent(watch.id)}`, {
        method: 'PATCH',
        body: { lastSeenIds: ids, lastCheckedAt: Date.now(), newCount }
      });
      state.watches = state.watches.map(entry => entry.id === watch.id ? updated.watch : entry);
      if (newCount) toast(`${newCount} new result${newCount === 1 ? '' : 's'} since the last check.`);
    }
  } catch (error) {
    reportError(error);
  } finally {
    state.loading = false;
    renderExplore();
    updateChrome();
  }
}

function searchMarkup() {
  const entitlement = activeEntitlement();
  const advancedLocked = !entitlement.limits.advancedFilters;
  return `
    <form id="search-form" class="search-panel">
      <div class="mode-switch" aria-label="Search mode">
        <button type="button" data-mode="images" class="${state.mode === 'images' ? 'is-active' : ''}">Images</button>
        <button type="button" data-mode="people" class="${state.mode === 'people' ? 'is-active' : ''}">People</button>
        <button type="button" data-mode="bio" class="${state.mode === 'bio' ? 'is-active' : ''}">Bio text</button>
      </div>
      <div class="search-row">
        <label class="search-input-wrap">
          <span aria-hidden="true">⌕</span>
          <input id="query" class="search-input" name="query" autocomplete="off" value="" placeholder="Try quiet coast, night train, from:username…">
        </label>
        <button class="primary-button search-button" type="submit">${state.loading ? 'Searching…' : 'Search'}</button>
      </div>
      <div class="search-foot">
        <span>Up to ${entitlement.limits.resultLimit.toLocaleString()} results · authenticated in your Chrome profile</span>
        <button id="advanced-toggle" type="button" class="text-button">${advancedLocked ? 'Advanced filters · Pro' : state.advancedOpen ? 'Hide filters' : 'Advanced filters'}</button>
      </div>
      <div id="advanced-filters" class="filter-row" ${state.advancedOpen && !advancedLocked ? '' : 'hidden'}>
        <div class="field"><label for="aspect">Aspect</label><select id="aspect" name="aspect"><option value="">Any</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option><option value="wide">Wide</option><option value="tall">Tall</option></select></div>
        <div class="field"><label for="gps">GPS</label><select id="gps" name="gps"><option value="">Any</option><option value="true">Has GPS</option><option value="false">No GPS</option></select></div>
        <div class="field field-grow"><label for="camera">Camera contains</label><input id="camera" name="camera" placeholder="Fujifilm"></div>
        <div class="field field-grow"><label for="country">Country contains</label><input id="country" name="country" placeholder="Norway"></div>
        <div class="field"><label for="after">After</label><input id="after" name="after" type="date"></div>
        <div class="field"><label for="before">Before</label><input id="before" name="before" type="date"></div>
        <div class="field"><label for="sort">Sort</label><select id="sort" name="sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="largest">Largest</option><option value="username">Username</option></select></div>
      </div>
    </form>`;
}

function installSearchEvents() {
  const form = main.querySelector('#search-form');
  if (!form) return;
  form.querySelector('#query').value = state.query;
  for (const [name, value] of Object.entries(state.filters)) {
    const field = form.elements.namedItem(name);
    if (field) field.value = value;
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    runSearch();
  });
  form.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    readSearchForm();
    state.mode = button.dataset.mode;
    state.sourceItems = [];
    state.visibleItems = [];
    state.selectedIds.clear();
    renderExplore();
  }));
  form.querySelector('#advanced-toggle').addEventListener('click', () => {
    if (!activeEntitlement().limits.advancedFilters) return setView('upgrade');
    state.advancedOpen = !state.advancedOpen;
    readSearchForm();
    renderExplore();
  });
  form.querySelectorAll('#advanced-filters input, #advanced-filters select').forEach(field => field.addEventListener('change', () => {
    readSearchForm();
    refreshVisible();
    renderResultsIntoPage();
  }));
}

function renderOnboarding(container) {
  const onboarding = element('section', { class: 'onboarding' });
  const copy = element('div', { class: 'onboarding-copy' },
    element('p', { class: 'eyebrow', text: 'Private browser companion' }),
    element('h2', { text: 'Search with your session. Keep the session to yourself.' }),
    element('p', { text: 'Scoutframe asks a tiny Chrome companion to make authenticated VSCO requests inside your existing browser profile. Cookies never enter this local app or a Scoutframe server.' })
  );
  const actions = element('div', { class: 'onboarding-actions' },
    element('button', { class: 'primary-button', type: 'button', onclick: () => enableDemo() }, 'Explore with demo data'),
    element('button', { class: 'secondary-button', type: 'button', onclick: () => refreshCompanion() }, 'Retry companion'),
    element('button', { class: 'ghost-button', type: 'button', onclick: () => helpDialog.showModal() }, 'How search works')
  );
  copy.append(actions);
  const visual = element('div', { class: 'onboarding-visual' });
  const stack = element('div', { class: 'mock-stack' });
  for (let index = 0; index < 3; index += 1) {
    stack.append(element('div', { class: 'mock-card' }, element('div', { class: 'mock-image' }), element('div', { class: 'mock-line' }), element('div', { class: 'mock-line short' })));
  }
  visual.append(stack);
  onboarding.append(copy, visual);
  container.append(onboarding);
}

function resultCard(item, { saved = false, onDelete = null } = {}) {
  const card = element('article', { class: `result-card ${item.kind === 'person' ? 'people-card' : ''} ${state.selectedIds.has(item.id) ? 'is-selected' : ''}`.trim() });
  const mediaWrap = element('div', { class: 'result-image-wrap' });
  const imageUrl = safeUrl(item.kind === 'person' ? item.profileImageUrl || item.imageUrl : item.imageUrl, { media: true });
  const image = element('img', { alt: item.description || `${item.username || 'VSCO'} result`, loading: 'lazy', decoding: 'async' });
  if (imageUrl) image.src = imageUrl;
  else image.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#242620"/></svg>')}`;
  image.addEventListener('error', () => image.removeAttribute('src'), { once: true });
  mediaWrap.append(image);

  if (!saved) {
    const selector = element('button', { class: 'card-select', type: 'button', title: 'Select result', text: state.selectedIds.has(item.id) ? '✓' : '' });
    selector.addEventListener('click', event => {
      event.stopPropagation();
      if (state.selectedIds.has(item.id)) state.selectedIds.delete(item.id);
      else state.selectedIds.add(item.id);
      renderResultsIntoPage();
    });
    const save = element('button', { class: 'card-save', type: 'button', title: 'Save to collection', text: '+' });
    save.addEventListener('click', event => {
      event.stopPropagation();
      saveItem(item).catch(reportError);
    });
    mediaWrap.append(selector, save);
  } else if (onDelete) {
    const remove = element('button', { class: 'card-save', type: 'button', title: 'Remove from collection', text: '×' });
    remove.style.opacity = '1';
    remove.addEventListener('click', event => {
      event.stopPropagation();
      onDelete(item);
    });
    mediaWrap.append(remove);
  }

  const body = element('div', { class: 'card-body' });
  body.append(element('div', { class: 'card-line' },
    element('strong', { text: item.username ? `@${item.username}` : item.displayName || 'Untitled' }),
    element('span', { text: formatDate(item.timestamp, { short: true }) })
  ));
  if (item.description) body.append(element('p', { text: item.description }));
  const chips = element('div', { class: 'meta-chips' });
  const values = item.kind === 'person'
    ? [item.displayName]
    : [item.camera, item.country, item.hasGps ? 'GPS' : '', scoutAspect(item) !== 'unknown' ? scoutAspect(item) : ''];
  for (const value of values.filter(Boolean).slice(0, 3)) chips.append(element('span', { class: 'meta-chip', text: value }));
  if (chips.childElementCount) body.append(chips);
  card.append(mediaWrap, body);
  card.addEventListener('click', () => openDetail(item, { saved, onDelete }));
  return card;
}

function resultsToolbar() {
  const container = element('div', { class: 'results-toolbar' });
  const label = state.loading
    ? 'Searching through your Chrome session…'
    : state.sourceItems.length ? `${state.visibleItems.length.toLocaleString()} visible · ${state.sourceItems.length.toLocaleString()} received${state.tookMs ? ` · ${(state.tookMs / 1000).toFixed(1)}s` : ''}`
      : 'No search run yet';
  container.append(element('div', { class: 'results-meta' }, element('strong', { text: state.loading ? 'Working' : state.visibleItems.length.toLocaleString() }), document.createTextNode(` · ${label}`)));

  const actions = element('div', { class: 'toolbar-actions' });
  const collectionSelect = element('select', { title: 'Save destination', 'aria-label': 'Save destination' });
  if (!state.collections.length) collectionSelect.append(element('option', { value: '', text: 'New Inbox on save' }));
  for (const collection of state.collections) collectionSelect.append(element('option', { value: collection.id, text: collection.name }));
  collectionSelect.value = state.selectedCollectionId;
  collectionSelect.addEventListener('change', () => { state.selectedCollectionId = collectionSelect.value; });
  actions.append(collectionSelect);

  if (state.selectedIds.size) {
    const batchAllowed = activeEntitlement().limits.batchSave;
    const batch = element('button', { class: 'secondary-button', type: 'button', text: batchAllowed ? `Save ${state.selectedIds.size}` : 'Batch save · Pro' });
    batch.addEventListener('click', () => batchAllowed ? saveSelected().catch(reportError) : setView('upgrade'));
    actions.append(batch);
  }
  const watch = element('button', { class: 'ghost-button', type: 'button', text: 'Watch search' });
  watch.addEventListener('click', () => createWatchFromCurrent().catch(reportError));
  actions.append(watch);
  container.append(actions);
  return container;
}

function renderResultsIntoPage() {
  const host = main.querySelector('#results-host');
  const toolbarHost = main.querySelector('#toolbar-host');
  if (!host || !toolbarHost) return;
  toolbarHost.replaceChildren(resultsToolbar());
  host.replaceChildren();
  if (state.loading) {
    const loading = element('div', { class: 'loading-grid' });
    for (let index = 0; index < 15; index += 1) loading.append(element('div', { class: 'skeleton' }));
    host.append(loading);
    return;
  }
  if (!state.sourceItems.length) {
    const empty = element('div', { class: 'empty-state' }, element('div', {},
      element('h2', { text: 'Build a visual trail' }),
      element('p', { text: state.demoMode ? 'Search the generated demo library to try filtering, collections, watches, and exports.' : 'Enter a phrase above. Scoutframe keeps the search deliberate: no endless auto-fetching and no fabricated metadata.' })
    ));
    host.append(empty);
    return;
  }
  if (!state.visibleItems.length) {
    host.append(element('div', { class: 'empty-state' }, element('div', {}, element('h2', { text: 'Nothing matches the local filters' }), element('p', { text: 'The source results arrived, but the active metadata filters removed all of them. Clear a filter or broaden the query.' }))));
    return;
  }
  const grid = element('section', { class: 'results-grid', 'aria-label': 'Search results' });
  for (const item of state.visibleItems) grid.append(resultCard(item));
  host.append(grid);
}

function renderExplore() {
  state.view = 'explore';
  updateChrome();
  main.innerHTML = `<div class="page">
    <header class="page-header"><div><p class="eyebrow">VSCO discovery, without the search friction</p><h1>Find the frame you remember.</h1><p>Search images and people, narrow only by observed metadata, then keep the useful trail in a local collection.</p></div></header>
    ${searchMarkup()}
    <div id="notice-host"></div>
    <div id="toolbar-host"></div>
    <div id="results-host"></div>
  </div>`;
  installSearchEvents();
  const noticeHost = main.querySelector('#notice-host');
  if (state.demoMode) {
    const notice = element('div', { class: 'notice is-demo' },
      element('div', {}, element('strong', { text: 'You are exploring generated demo data.' }), element('p', { text: 'Collections, watches, exports, and filters are real. Result imagery and metadata are synthetic.' })),
      element('button', { class: 'ghost-button', type: 'button', onclick: disableDemo }, 'Use live companion')
    );
    noticeHost.append(notice);
  } else if (!state.companion.ok && !state.companion.checking) {
    renderOnboarding(noticeHost);
  }
  renderResultsIntoPage();
}

async function enableDemo() {
  state.demoMode = true;
  state.query ||= 'quiet coast';
  updateChrome();
  renderExplore();
  await runSearch();
  recordEvent('demo.started');
}

function disableDemo() {
  state.demoMode = false;
  state.sourceItems = [];
  state.visibleItems = [];
  state.selectedIds.clear();
  updateChrome();
  renderExplore();
}

async function ensureCollection() {
  if (state.selectedCollectionId && state.collections.some(collection => collection.id === state.selectedCollectionId)) return state.selectedCollectionId;
  const response = await api('/api/collections', { method: 'POST', body: { name: 'Inbox' } });
  state.collections.unshift(response.collection);
  state.selectedCollectionId = response.collection.id;
  updateChrome();
  return state.selectedCollectionId;
}

async function saveItem(item) {
  const collectionId = await ensureCollection();
  await api(`/api/collections/${encodeURIComponent(collectionId)}/items`, { method: 'POST', body: { item } });
  state.collectionItems.delete(collectionId);
  await reloadCollections();
  const collection = state.collections.find(entry => entry.id === collectionId);
  toast(`Saved to ${collection?.name || 'collection'}.`);
  recordEvent('item.saved', { kind: item.kind });
}

async function saveSelected() {
  if (!activeEntitlement().limits.batchSave) return setView('upgrade');
  const collectionId = await ensureCollection();
  const items = state.sourceItems.filter(item => state.selectedIds.has(item.id));
  let saved = 0;
  for (const item of items) {
    await api(`/api/collections/${encodeURIComponent(collectionId)}/items`, { method: 'POST', body: { item } });
    saved += 1;
  }
  state.collectionItems.delete(collectionId);
  state.selectedIds.clear();
  await reloadCollections();
  renderExplore();
  toast(`Saved ${saved} result${saved === 1 ? '' : 's'}.`);
}

function openDetail(item, { saved = false, onDelete = null } = {}) {
  state.selectedItem = item;
  detailDrawer.replaceChildren();
  const head = element('div', { class: 'drawer-head' },
    element('span', { class: 'muted', text: item.kind === 'person' ? 'Profile result' : saved ? 'Saved frame' : 'Search result' }),
    element('button', { class: 'icon-button', type: 'button', text: '×', onclick: closeDetail, 'aria-label': 'Close details' })
  );
  const media = element('img', { class: 'drawer-media', alt: item.description || 'Result preview' });
  const mediaUrl = safeUrl(item.kind === 'person' ? item.profileImageUrl || item.imageUrl : item.imageUrl, { media: true });
  if (mediaUrl) media.src = mediaUrl;
  const content = element('div', { class: 'drawer-content' },
    element('p', { class: 'eyebrow', text: item.username ? `@${item.username}` : 'Scoutframe result' }),
    element('h2', { text: item.displayName || item.description || 'Untitled frame' })
  );
  if (item.description) content.append(element('p', { text: item.description }));
  const details = element('dl', { class: 'detail-list' });
  const entries = [
    ['Captured', formatDate(item.timestamp)],
    ['Dimensions', item.width && item.height ? `${item.width} × ${item.height}` : 'Not observed'],
    ['Camera', item.camera || 'Not observed'],
    ['Preset', item.preset || 'Not observed'],
    ['Country', item.country || 'Not observed'],
    ['GPS', item.hasGps && item.coordinates ? `${item.coordinates.lat}, ${item.coordinates.lng}` : 'Not observed'],
    ['Source query', item.sourceQuery || '—']
  ];
  for (const [term, value] of entries) details.append(element('dt', { text: term }), element('dd', { text: value }));
  content.append(details);
  const actions = element('div', { class: 'drawer-actions' });
  if (!saved) actions.append(element('button', { class: 'primary-button', type: 'button', onclick: () => saveItem(item).catch(reportError) }, 'Save to collection'));
  else if (onDelete) actions.append(element('button', { class: 'danger-button', type: 'button', onclick: () => onDelete(item) }, 'Remove'));
  const permalink = safeUrl(item.permalink);
  if (permalink) actions.append(element('a', { class: 'secondary-button', href: permalink, target: '_blank', rel: 'noreferrer' }, 'Open source'));
  content.append(actions);
  detailDrawer.append(head, media, content);
  detailDrawer.classList.add('is-open');
  detailDrawer.setAttribute('aria-hidden', 'false');
}

function closeDetail() {
  detailDrawer.classList.remove('is-open');
  detailDrawer.setAttribute('aria-hidden', 'true');
  state.selectedItem = null;
}

async function reloadCollections() {
  const result = await api('/api/collections');
  state.collections = result.collections || [];
  if (!state.collections.some(collection => collection.id === state.selectedCollectionId)) state.selectedCollectionId = state.collections[0]?.id || '';
  updateChrome();
}

async function loadSelectedCollection() {
  const id = state.selectedCollectionId;
  if (!id || state.collectionItems.has(id) || state.collectionLoading) return;
  state.collectionLoading = true;
  renderCollections();
  try {
    const response = await api(`/api/collections/${encodeURIComponent(id)}/items?limit=10000`);
    state.collectionItems.set(id, response.items || []);
  } catch (error) {
    reportError(error);
  } finally {
    state.collectionLoading = false;
    if (state.view === 'collections') renderCollections();
  }
}

function renderCollections() {
  state.view = 'collections';
  updateChrome();
  const selected = state.collections.find(collection => collection.id === state.selectedCollectionId);
  main.innerHTML = `<div class="page">
    <header class="page-header"><div><p class="eyebrow">Local research library</p><h1>Collections</h1><p>Keep source links, observed metadata, and notes on this machine. Export a collection when the trail is ready to move.</p></div></header>
    <div id="collections-layout" class="split-layout"></div>
  </div>`;
  const layout = main.querySelector('#collections-layout');
  const subnav = element('aside', { class: 'subnav-panel' });
  const addButton = element('button', { class: 'icon-button', type: 'button', title: 'New collection', text: '+' });
  addButton.addEventListener('click', () => createCollection().catch(reportError));
  subnav.append(element('div', { class: 'subnav-head' }, element('strong', { text: 'Your collections' }), addButton));
  const list = element('div', { class: 'subnav-list' });
  for (const collection of state.collections) {
    const button = element('button', { class: `subnav-item ${collection.id === state.selectedCollectionId ? 'is-active' : ''}`, type: 'button' },
      element('span', { text: collection.name }), element('span', { text: collection.itemCount })
    );
    button.addEventListener('click', () => {
      state.selectedCollectionId = collection.id;
      renderCollections();
      loadSelectedCollection();
    });
    list.append(button);
  }
  if (!state.collections.length) list.append(element('p', { class: 'muted', text: 'No collections yet. Save a result or create one here.' }));
  subnav.append(list);

  const panel = element('section', { class: 'content-panel' });
  if (!selected) {
    panel.append(element('div', { class: 'empty-state' }, element('div', {},
      element('h2', { text: 'Start a collection' }),
      element('p', { text: 'Collections are local folders for the frames and profiles worth returning to.' }),
      element('button', { class: 'primary-button', type: 'button', onclick: () => createCollection().catch(reportError) }, 'Create collection')
    )));
  } else {
    const actions = element('div', { class: 'inline-actions' },
      element('button', { class: 'ghost-button', type: 'button', onclick: () => renameCollection(selected).catch(reportError) }, 'Rename'),
      element('button', { class: 'ghost-button', type: 'button', onclick: () => exportCollection(selected.id, 'json') }, 'JSON'),
      element('button', { class: 'ghost-button', type: 'button', onclick: () => exportCollection(selected.id, 'csv') }, 'CSV'),
      element('button', { class: 'danger-button', type: 'button', onclick: () => deleteCollection(selected).catch(reportError) }, 'Delete')
    );
    panel.append(element('div', { class: 'content-panel-head' },
      element('div', {}, element('h2', { text: selected.name }), element('span', { class: 'quiet', text: `${selected.itemCount} saved result${selected.itemCount === 1 ? '' : 's'}` })),
      actions
    ));
    if (state.collectionLoading && !state.collectionItems.has(selected.id)) {
      const loading = element('div', { class: 'loading-grid' });
      for (let index = 0; index < 8; index += 1) loading.append(element('div', { class: 'skeleton' }));
      panel.append(loading);
    } else {
      const items = state.collectionItems.get(selected.id) || [];
      if (!items.length) {
        panel.append(element('div', { class: 'empty-state' }, element('div', {}, element('h2', { text: 'This collection is empty' }), element('p', { text: 'Run a search, then use the + button on a result to save it here.' }), element('button', { class: 'secondary-button', type: 'button', onclick: () => setView('explore') }, 'Open Explore'))));
      } else {
        const grid = element('div', { class: 'collection-grid' });
        for (const item of items) grid.append(resultCard(item, { saved: true, onDelete: entry => removeSavedItem(selected.id, entry).catch(reportError) }));
        panel.append(grid);
      }
    }
  }
  layout.append(subnav, panel);
  if (selected && !state.collectionItems.has(selected.id) && !state.collectionLoading) queueMicrotask(loadSelectedCollection);
}

async function createCollection() {
  const name = window.prompt('Collection name', 'New collection');
  if (name === null) return;
  const response = await api('/api/collections', { method: 'POST', body: { name } });
  state.collections.unshift(response.collection);
  state.selectedCollectionId = response.collection.id;
  state.collectionItems.set(response.collection.id, []);
  updateChrome();
  renderCollections();
  toast('Collection created.');
}

async function renameCollection(collection) {
  const name = window.prompt('Rename collection', collection.name);
  if (name === null || !name.trim()) return;
  const response = await api(`/api/collections/${encodeURIComponent(collection.id)}`, { method: 'PATCH', body: { name } });
  state.collections = state.collections.map(entry => entry.id === collection.id ? response.collection : entry);
  renderCollections();
}

async function deleteCollection(collection) {
  if (!window.confirm(`Delete “${collection.name}” and its saved items?`)) return;
  await api(`/api/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' });
  state.collectionItems.delete(collection.id);
  await reloadCollections();
  renderCollections();
  toast('Collection deleted.');
}

async function removeSavedItem(collectionId, item) {
  await api(`/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(item.id || item.sourceId)}`, { method: 'DELETE' });
  const items = state.collectionItems.get(collectionId) || [];
  state.collectionItems.set(collectionId, items.filter(entry => (entry.id || entry.sourceId) !== (item.id || item.sourceId)));
  await reloadCollections();
  closeDetail();
  renderCollections();
  toast('Removed from collection.');
}

function exportCollection(collectionId, format) {
  if (!activeEntitlement().limits.export) return setView('upgrade');
  window.location.assign(`/api/export?format=${encodeURIComponent(format)}&collection=${encodeURIComponent(collectionId)}`);
  recordEvent('collection.exported', { format });
}

async function reloadWatches() {
  const result = await api('/api/watches');
  state.watches = result.watches || [];
  updateChrome();
}

async function createWatchFromCurrent() {
  readSearchForm();
  if (!state.query.trim()) return toast('Enter a query before creating a watch.', 'error');
  const response = await api('/api/watches', {
    method: 'POST',
    body: { name: state.query, mode: state.mode, query: state.query, filters: state.filters }
  });
  state.watches.unshift(response.watch);
  updateChrome();
  toast('Watched search saved. Run it whenever you want to check for new results.');
  recordEvent('watch.created', { mode: state.mode });
}

function renderWatches() {
  state.view = 'watches';
  updateChrome();
  main.innerHTML = `<div class="page">
    <header class="page-header"><div><p class="eyebrow">Intentional monitoring</p><h1>Watched searches</h1><p>Save a search and check it on demand. Scoutframe does not scrape in the background or create an invisible request loop.</p></div><button id="watch-current" class="primary-button" type="button">Watch current search</button></header>
    <div id="watch-list" class="watch-list"></div>
  </div>`;
  main.querySelector('#watch-current').addEventListener('click', () => createWatchFromCurrent().catch(reportError));
  const list = main.querySelector('#watch-list');
  if (!state.watches.length) {
    list.append(element('div', { class: 'empty-state' }, element('div', {}, element('h2', { text: 'No watched searches yet' }), element('p', { text: 'Build a query in Explore, then save it as a watch. Checks happen only when you press Run.' }), element('button', { class: 'secondary-button', type: 'button', onclick: () => setView('explore') }, 'Build a search'))));
    return;
  }
  for (const watch of state.watches) {
    const title = element('h3', {}, watch.name);
    if (watch.newCount) title.append(element('span', { class: 'watch-badge', text: `${watch.newCount} new` }));
    const summary = element('div', {}, title, element('p', {}, element('code', { text: watch.query }), document.createTextNode(` · ${watch.mode} · ${watch.lastCheckedAt ? `checked ${formatDate(watch.lastCheckedAt)}` : 'never checked'}`)));
    const actions = element('div', { class: 'inline-actions' },
      element('button', { class: 'secondary-button', type: 'button', onclick: () => runWatch(watch) }, 'Run'),
      element('button', { class: 'danger-button', type: 'button', onclick: () => deleteWatch(watch).catch(reportError) }, 'Delete')
    );
    list.append(element('article', { class: 'watch-card' }, summary, actions));
  }
}

function runWatch(watch) {
  state.mode = watch.mode;
  state.query = watch.query;
  state.filters = { ...state.filters, ...(watch.filters || {}) };
  state.view = 'explore';
  renderExplore();
  runSearch({ watch });
}

async function deleteWatch(watch) {
  if (!window.confirm(`Delete watched search “${watch.name}”?`)) return;
  await api(`/api/watches/${encodeURIComponent(watch.id)}`, { method: 'DELETE' });
  await reloadWatches();
  renderWatches();
  toast('Watched search deleted.');
}

function checkoutButton(label, url, featured = false) {
  const safe = safeUrl(url);
  if (!safe) return element('button', { class: featured ? 'primary-button' : 'secondary-button', type: 'button', disabled: true, title: 'Configure the checkout URL in .env', text: 'Checkout not configured' });
  return element('a', { class: featured ? 'primary-button' : 'secondary-button', href: safe, target: '_blank', rel: 'noreferrer' }, label);
}

function renderUpgrade() {
  state.view = 'upgrade';
  updateChrome();
  const entitlement = activeEntitlement();
  main.innerHTML = `<div class="page">
    <header class="page-header"><div><p class="eyebrow">A small tool, paid for by its users</p><h1>Choose your Scoutframe.</h1><p>The app remains local. A signed license unlocks higher limits and export; no account service or telemetry is required to keep it working.</p></div></header>
    <div id="pricing-grid" class="pricing-grid"></div>
    <section id="activation-panel" class="activation-panel"></section>
  </div>`;
  const pricing = main.querySelector('#pricing-grid');
  pricing.append(
    priceCard({ name: 'Free', price: currency(0), suffix: '', description: 'A permanent local workspace for occasional research.', features: ['120 results per search', '1 collection and 1 watch', '250 locally saved items'], button: element('button', { class: 'secondary-button', type: 'button', disabled: true, text: entitlement.plan === 'free' ? 'Current plan' : 'Included' }) }),
    priceCard({ name: 'Pro monthly', price: currency(state.billing?.monthlyPrice || 12), suffix: '/ month', description: 'For active visual research and recurring discovery.', features: ['5,000 results per search', 'Advanced metadata filters', 'Batch save and JSON/CSV export', '100 collections and watches'], featured: true, button: checkoutButton('Start Pro monthly', state.billing?.monthlyUrl, true) }),
    priceCard({ name: 'Pro yearly', price: currency(state.billing?.yearlyPrice || 99), suffix: '/ year', description: 'The same local-first workspace at the best standard price.', features: ['Everything in Pro monthly', 'Two months effectively free', 'License survives app restarts', 'Human support by email'], button: checkoutButton('Start Pro yearly', state.billing?.yearlyUrl) })
  );

  const panel = main.querySelector('#activation-panel');
  panel.append(element('div', { class: 'content-panel-head' },
    element('div', {}, element('h2', { text: 'Activate a signed license' }), element('p', { class: 'muted', text: entitlement.paid ? `Active for ${entitlement.license?.email || 'this customer'}.` : 'Paste the token delivered after purchase. Verification happens locally.' })),
    entitlement.paid ? element('button', { class: 'danger-button', type: 'button', onclick: deactivateLicense }, 'Deactivate') : null
  ));
  if (!entitlement.paid) {
    const field = element('div', { class: 'field' }, element('label', { for: 'license-token', text: 'License token' }), element('textarea', { id: 'license-token', placeholder: 'sf1.…' }));
    const activate = element('button', { class: 'primary-button', type: 'button', text: 'Activate on this machine' });
    activate.addEventListener('click', () => activateLicense(field.querySelector('textarea').value));
    panel.append(field, element('div', { class: 'inline-actions' }, activate));
  }
  panel.append(element('p', { class: 'quiet', text: `Need help? ${state.billing?.supportEmail || 'See the local README.'} Scoutframe is an independent tool and is not affiliated with VSCO.` }));
}

function priceCard({ name, price, suffix, description, features, featured = false, button }) {
  const card = element('article', { class: `price-card ${featured ? 'featured' : ''}`.trim() });
  if (featured) card.append(element('span', { class: 'flag', text: 'Most flexible' }));
  card.append(element('h2', { text: name }), element('div', { class: 'price' }, price, suffix ? element('small', { text: ` ${suffix}` }) : null), element('p', { text: description }));
  const list = element('ul', { class: 'feature-list' });
  for (const feature of features) list.append(element('li', { text: feature }));
  card.append(list, button);
  return card;
}

async function activateLicense(token) {
  if (!String(token || '').trim()) return toast('Paste a license token first.', 'error');
  try {
    const response = await api('/api/license/activate', { method: 'POST', body: { token } });
    state.status.entitlement = response.entitlement;
    updateChrome();
    renderUpgrade();
    toast('License activated.');
    recordEvent('license.activated', { plan: response.entitlement.plan });
  } catch (error) {
    reportError(error);
  }
}

async function deactivateLicense() {
  if (!window.confirm('Deactivate this license on the local app?')) return;
  const response = await api('/api/license', { method: 'DELETE' });
  state.status.entitlement = response.entitlement;
  updateChrome();
  renderUpgrade();
  toast('License deactivated.');
}

function render() {
  if (state.view === 'collections') return renderCollections();
  if (state.view === 'watches') return renderWatches();
  if (state.view === 'upgrade') return renderUpgrade();
  return renderExplore();
}

document.querySelector('#primary-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});
document.querySelector('.upgrade-link').addEventListener('click', event => setView(event.currentTarget.dataset.view));
document.querySelector('#mobile-menu').addEventListener('click', () => appShell.classList.toggle('nav-open'));
document.querySelector('#help-button').addEventListener('click', () => helpDialog.showModal());
connectionPill.addEventListener('click', () => refreshCompanion());
demoPill.addEventListener('click', disableDemo);
window.addEventListener('scoutframe:companion-ready', () => refreshCompanion({ quiet: true }));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeDetail();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setView('explore');
    main.querySelector('#query')?.focus();
  }
});

try {
  await loadCore();
  updateChrome();
  render();
  await refreshCompanion({ quiet: true });
} catch (error) {
  console.error(error);
  main.replaceChildren(element('div', { class: 'page' }, element('div', { class: 'empty-state' }, element('div', {}, element('h2', { text: 'Scoutframe could not start' }), element('p', { text: error.message }), element('button', { class: 'primary-button', type: 'button', onclick: () => window.location.reload() }, 'Reload')))));
}
