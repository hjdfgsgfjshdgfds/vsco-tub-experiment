// social_scrape_content.js (v1.49 - page-wide VSCO social scraper)

const vscoSocialQueued = new Set();
let vscoSocialScanTimer = null;

function extractVscoUsername(value) {
    if (!value || typeof value !== 'string') return null;
    let url;
    try {
        url = new URL(value, document.baseURI);
    } catch {
        return null;
    }

    if (!/(^|\.)vsco\.co$/i.test(url.hostname)) return null;
    const username = url.pathname.split('/').filter(Boolean)[0];
    if (!username || ['api', 'about', 'privacy', 'terms', 'search', 'user'].includes(username.toLowerCase())) return null;
    if (!/^[a-z0-9._-]+$/i.test(username)) return null;
    return username.toLowerCase();
}

function queueVscoSocialScrape(username) {
    if (!username || vscoSocialQueued.has(username)) return;
    vscoSocialQueued.add(username);
}

function scanForVscoSocialProfiles() {
    const currentUsername = extractVscoUsername(window.location.href);
    if (currentUsername) queueVscoSocialScrape(currentUsername);

    document.querySelectorAll('a[href*="vsco.co/"]').forEach(link => {
        const username = extractVscoUsername(link.href);
        if (username) queueVscoSocialScrape(username);
    });
}

function scheduleVscoSocialScan(delay = 750) {
    clearTimeout(vscoSocialScanTimer);
    vscoSocialScanTimer = setTimeout(scanForVscoSocialProfiles, delay);
}

const vscoSocialObserver = new MutationObserver(() => scheduleVscoSocialScan());

if (document.body) {
    vscoSocialObserver.observe(document.body, { childList: true, subtree: true });
    scheduleVscoSocialScan(1000);
}
