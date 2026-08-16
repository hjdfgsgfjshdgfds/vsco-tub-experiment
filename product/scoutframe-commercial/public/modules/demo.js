const CAMERAS = ['Fujifilm X100V', 'iPhone 15 Pro', 'Leica Q2', 'Sony A7 IV', 'Canon EOS R6', 'Nikon Zf'];
const COUNTRIES = ['Norway', 'Japan', 'France', 'United States', 'Italy', 'Iceland'];
const PRESETS = ['A6', 'C1', 'M5', 'HB2', 'KE1', 'None'];
const TERMS = ['coast', 'night', 'concrete', 'train', 'portrait', 'forest', 'rain', 'summer', 'street', 'quiet', 'studio', 'mountain'];

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function artwork(seed, label, width, height) {
  const hue = seed % 360;
  const second = (hue + 52 + seed % 80) % 360;
  const safe = escapeXml(label.slice(0, 28));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue} 26% 18%)"/><stop offset="1" stop-color="hsl(${second} 42% 58%)"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${Math.round(width * .72)}" cy="${Math.round(height * .3)}" r="${Math.round(Math.min(width, height) * .22)}" fill="rgba(255,255,255,.16)"/>
    <path d="M0 ${Math.round(height * .76)} Q ${Math.round(width * .35)} ${Math.round(height * .45)} ${width} ${Math.round(height * .8)} V${height}H0Z" fill="rgba(0,0,0,.32)"/>
    <text x="${Math.round(width * .06)}" y="${Math.round(height * .9)}" fill="white" font-family="system-ui" font-size="${Math.max(18, Math.round(width * .04))}" opacity=".88">${safe}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function dimensions(index) {
  const options = [[1200, 1500], [1600, 1067], [1400, 1400], [1920, 1080], [1000, 1800]];
  return options[index % options.length];
}

export function makeDemoItems(query = 'quiet coast', mode = 'images', count = 48) {
  const base = hash(`${query}:${mode}`);
  return Array.from({ length: count }, (_, index) => {
    const seed = (base + index * 7919) >>> 0;
    const [width, height] = dimensions(seed % 5);
    const username = ['mara', 'northwindow', 'linhframes', 'atelierzero', 'nicoafterdark', 'softrelay'][seed % 6] + (index % 4 || '');
    const terms = [TERMS[seed % TERMS.length], TERMS[(seed + index + 3) % TERMS.length]];
    const id = `demo-${mode}-${seed.toString(16)}-${index}`;
    const timestamp = Date.UTC(2026 - (index % 4), (seed + index) % 12, 1 + (seed % 27), 8 + (index % 12));
    const common = {
      id,
      kind: mode === 'images' ? 'image' : 'person',
      username,
      displayName: username.replace(/(^|\d)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`),
      description: mode === 'bio' ? `${terms.join(' ')} photographer — ${query || 'visual notes'}` : `${terms.join(' ')} study`,
      profileImageUrl: artwork(seed + 2, username, 320, 320),
      imageUrl: artwork(seed, `${terms.join(' ')} · ${index + 1}`, width, height),
      permalink: 'https://vsco.co/',
      timestamp,
      width,
      height,
      hasGps: seed % 3 === 0,
      coordinates: seed % 3 === 0 ? { lat: 35 + (seed % 2400) / 100, lng: -18 + (seed % 4800) / 100 } : null,
      country: COUNTRIES[seed % COUNTRIES.length],
      camera: CAMERAS[seed % CAMERAS.length],
      preset: PRESETS[seed % PRESETS.length],
      software: seed % 2 ? 'VSCO' : 'Capture One',
      sourceQuery: query,
      demo: true
    };
    if (mode !== 'images') {
      common.siteId = `demo-site-${seed.toString(16)}`;
      common.imageUrl = common.profileImageUrl;
      common.width = 320;
      common.height = 320;
      common.hasGps = false;
      common.coordinates = null;
      common.country = '';
      common.camera = '';
      common.preset = '';
    }
    return common;
  });
}

export async function demoSearch({ query, mode = 'images', limit = 120 } = {}) {
  await new Promise(resolve => setTimeout(resolve, 260));
  const count = Math.min(Math.max(Number(limit) || 48, 12), 120);
  return {
    ok: true,
    demo: true,
    items: makeDemoItems(query, mode, count),
    sourceCount: count,
    tookMs: 260
  };
}
