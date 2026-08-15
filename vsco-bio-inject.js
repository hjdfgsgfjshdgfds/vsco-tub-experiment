// Content script: injects the gridName (bio) from the search API onto VSCO profile pages
// This shows the API's version of the bio which may have more/different info than what VSCO displays

(async function () {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const retryAfterMs = resp => {
        const value = resp.headers.get('Retry-After');
        if (!value) return 0;
        const seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const dateMs = Date.parse(value);
        return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
    };
    const fetchGridBio = async url => {
        await wait(250 + Math.floor(Math.random() * 500));
        for (let attempt = 0; attempt < 3; attempt++) {
            let resp = null;
            try {
                resp = await fetch(url, { credentials: 'include' });
            } catch (error) {
                if (attempt === 2) return null;
            }
            if (resp?.ok) return resp;
            if (resp && resp.status !== 429 && resp.status < 500) return resp;
            if (attempt < 2) {
                const base = Math.max(resp ? retryAfterMs(resp) : 0, 4000 * Math.pow(2, attempt));
                const jitter = Math.floor(Math.random() * Math.max(500, Math.min(base * 0.35, 5000)));
                await wait(Math.min(base + jitter, 60000));
            }
        }
        return null;
    };

    // Only run on profile pages like vsco.co/username or vsco.co/username/gallery
    const match = location.pathname.match(/^\/([a-zA-Z0-9._-]+)(\/.*)?$/);
    if (!match) return;
    const username = match[1];

    // Skip non-profile paths
    const skip = ['search', 'about', 'download', 'create', 'explore', 'discover', 'feed', 'login', 'signup', 'settings', 'api'];
    if (skip.includes(username.toLowerCase())) return;

    try {
        const resp = await fetchGridBio(`https://vsco.co/api/2.0/search/grids?query=${encodeURIComponent(username)}&page=0&size=50`);
        if (!resp?.ok) return;
        const data = await resp.json();
        const results = data.results || data.grids || [];

        // Find exact match for this username
        const person = results.find(p => (p.siteSubDomain || '').toLowerCase() === username.toLowerCase());
        if (!person) return;

        const gridName = person.gridName || '';
        const siteDomain = person.siteDomain || '';
        const userName = person.userName || '';

        // Build info lines to inject
        const lines = [];
        if (gridName) lines.push(gridName);
        if (siteDomain && siteDomain.toLowerCase() !== username.toLowerCase()) {
            lines.push(`domain: ${siteDomain}`);
        }

        if (lines.length === 0) return;

        // Wait for profile header to load (VSCO is a SPA)
        let attempts = 0;
        const inject = () => {
            // Don't inject twice
            if (document.querySelector('.vsco-ext-bio')) return;

            // Look for the bio/description area on the profile
            // VSCO uses a <meta name="description"> tag with bio info
            // and renders the profile info in the page header area
            // Try to find the profile header section
            const bioEl = document.querySelector('[data-testid="user-bio"]')
                || document.querySelector('.UserProfile-bio')
                || document.querySelector('[class*="bio"]')
                || document.querySelector('[class*="Bio"]')
                || document.querySelector('[class*="description"]');

            // Also try to find the username heading as anchor point
            const headings = document.querySelectorAll('h1, h2, [class*="DisplayName"], [class*="username"]');
            let anchor = bioEl;

            if (!anchor) {
                // Use the first heading that contains the username text
                for (const h of headings) {
                    if (h.textContent.toLowerCase().includes(username.toLowerCase())) {
                        anchor = h;
                        break;
                    }
                }
            }

            if (!anchor) {
                if (attempts++ < 20) {
                    setTimeout(inject, 500);
                }
                return;
            }

            // Create the injected bio element
            const el = document.createElement('div');
            el.className = 'vsco-ext-bio';
            el.style.cssText = `
                margin: 8px 0;
                padding: 8px 12px;
                background: rgba(255, 193, 7, 0.12);
                border: 1px solid rgba(255, 193, 7, 0.3);
                border-radius: 8px;
                font-size: 13px;
                line-height: 1.5;
                color: #333;
                max-width: 500px;
                word-break: break-word;
            `;

            // Adapt to dark mode
            const isDark = window.getComputedStyle(document.body).backgroundColor;
            if (isDark && (isDark.includes('0, 0, 0') || isDark.includes('rgb(0') || isDark.includes('rgb(18') || isDark.includes('rgb(30') || isDark.includes('rgb(15'))) {
                el.style.color = '#eee';
                el.style.background = 'rgba(255, 193, 7, 0.08)';
                el.style.borderColor = 'rgba(255, 193, 7, 0.2)';
            }

            const label = document.createElement('span');
            label.style.cssText = 'opacity:0.6;font-size:11px;';
            label.textContent = '📋 API bio:';
            el.appendChild(label);
            for (const line of lines) {
                el.appendChild(document.createElement('br'));
                el.appendChild(document.createTextNode(line));
            }

            // Insert after the anchor element
            if (anchor.nextSibling) {
                anchor.parentNode.insertBefore(el, anchor.nextSibling);
            } else {
                anchor.parentNode.appendChild(el);
            }
        };

        // Start trying to inject (SPA may take time to render)
        inject();

        // Also watch for SPA navigation (URL changes without page reload)
        let lastUrl = location.href;
        const observer = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                // Remove old injection on navigation
                document.querySelectorAll('.vsco-ext-bio').forEach(el => el.remove());
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

    } catch (e) {
        console.error('VSCO bio inject error:', e);
    }
})();
