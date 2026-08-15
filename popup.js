const state = {
  matches: [],
  filter: ''
};

const els = {
  summary: document.getElementById('summary'),
  matches: document.getElementById('matches'),
  empty: document.getElementById('empty'),
  filter: document.getElementById('filter'),
  openFeed: document.getElementById('open-feed'),
  refresh: document.getElementById('refresh'),
  copy: document.getElementById('copy'),
  export: document.getElementById('export'),
  clear: document.getElementById('clear')
};

function tiktokSearchUrl(handle) {
  return `https://www.tiktok.com/search?q=${encodeURIComponent(handle)}`;
}

function formatMatches(matches) {
  return matches.map(match => {
    const lines = [
      `VSCO: ${match.vscoUrl}`,
      `Username: ${match.username}`,
      `Description: ${match.description || ''}`
    ];
    if (match.tiktok && match.tiktok.length) {
      lines.push(`TikTok: ${match.tiktok.join(', ')}`);
      lines.push(`TikTok search: ${match.tiktok.map(tiktokSearchUrl).join(' | ')}`);
    }
    if (match.snap && match.snap.length) {
      lines.push(`Snap: ${match.snap.join(', ')}`);
    }
    lines.push(`Detected: ${match.detectedAt || ''}`);
    return lines.join('\n');
  }).join('\n\n---\n\n') + (matches.length ? '\n' : '');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function filteredMatches() {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.matches;
  return state.matches.filter(match => [
    match.username,
    match.vscoUrl,
    match.description,
    ...(match.tiktok || []),
    ...(match.snap || [])
  ].some(value => String(value || '').toLowerCase().includes(q)));
}

function render() {
  const matches = filteredMatches().slice().sort((a, b) => String(b.detectedAt || '').localeCompare(String(a.detectedAt || '')));
  els.summary.textContent = `${matches.length} shown, ${state.matches.length} saved`;
  els.empty.hidden = matches.length !== 0;
  els.matches.textContent = '';

  matches.forEach(match => {
    const card = document.createElement('article');
    card.className = 'match';
    const detected = match.detectedAt ? new Date(match.detectedAt).toLocaleString() : '';
    const pfp = match.profileImageUrl
      ? `<img class="pfp" src="${escapeHtml(match.profileImageUrl)}" alt="@${escapeHtml(match.username)} profile picture">`
      : '<div class="pfp placeholder"></div>';
    card.innerHTML = `
      <div class="match-top">
        ${pfp}
        <div class="match-main">
          <div class="match-head">
            <a class="username" href="${escapeHtml(match.vscoUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(match.username)}</a>
            <span class="detected">${escapeHtml(detected)}</span>
          </div>
          <div class="links">
            <a class="pill" href="${escapeHtml(match.vscoUrl)}" target="_blank" rel="noopener noreferrer">VSCO</a>
            ${(match.tiktok || []).map(handle => `<a class="pill" href="${escapeHtml(tiktokSearchUrl(handle))}" target="_blank" rel="noopener noreferrer">TikTok: ${escapeHtml(handle)}</a>`).join('')}
            ${(match.snap || []).map(handle => `<span class="pill snap">Snap: ${escapeHtml(handle)}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="description">${escapeHtml(match.description || '')}</div>
    `;
    els.matches.appendChild(card);
  });

  backfillMissingPfps(matches);
}

async function loadMatches() {
  const stored = await chrome.storage.local.get({ vscoSocialMatches: [] });
  state.matches = Array.isArray(stored.vscoSocialMatches) ? stored.vscoSocialMatches : [];
  render();
}

function fetchProfileForPopup(username) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'fetchVscoProfileAvatar', username }, response => {
      if (chrome.runtime.lastError || !response || !response.success || !response.profileImageUrl) {
        resolve(null);
        return;
      }
      resolve(response.profileImageUrl);
    });
  });
}

async function backfillMissingPfps(matches) {
  const missing = matches.filter(match => match.username && !match.profileImageUrl).slice(0, 25);
  if (!missing.length) return;

  let changed = false;
  for (const match of missing) {
    const profileImageUrl = await fetchProfileForPopup(match.username);
    if (!profileImageUrl) continue;

    const target = state.matches.find(item => item.key === match.key || (item.username === match.username && item.description === match.description));
    if (target && !target.profileImageUrl) {
      target.profileImageUrl = profileImageUrl;
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ vscoSocialMatches: state.matches });
    render();
  }
}

async function exportTxt() {
  const text = formatMatches(state.matches);
  if (!text.trim()) return;
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: 'vsco_social_matches.txt',
    conflictAction: 'overwrite',
    saveAs: false
  });
}

els.filter.addEventListener('input', event => {
  state.filter = event.target.value;
  render();
});

els.openFeed.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
});
els.refresh.addEventListener('click', loadMatches);
els.export.addEventListener('click', exportTxt);
els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(formatMatches(filteredMatches()));
});
els.clear.addEventListener('click', async () => {
  await chrome.storage.local.set({ vscoSocialMatches: [] });
  await loadMatches();
});

loadMatches();
