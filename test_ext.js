const puppeteer = require('puppeteer-core');

(async () => {
    try {
        console.log("Connecting to Chrome...");
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        // Find the extension ID. Need to look at background pages or service workers.
        const targets = await browser.targets();
        let extTarget = targets.find(t => t.url().includes('chrome-extension://'));
        let extId = '';
        if (extTarget) {
            extId = extTarget.url().split('/')[2];
        } else {
            console.log("Could not find chrome extension ID.");
            // Just try to find a tab with newtab.html
            extTarget = targets.find(t => t.url().includes('newtab.html'));
            if (extTarget) {
                extId = extTarget.url().split('/')[2];
            }
        }

        if (!extId) {
            console.log("Could not find chrome extension ID. Ensure the extension is loaded.");
            console.log(targets.map(t => t.url()));
            process.exit(1);
        }

        console.log("Found extension ID:", extId);
        console.log("Opening new tab with extension...");

        const page = await browser.newPage();
        await page.goto(`chrome-extension://${extId}/newtab.html`, { waitUntil: 'load' });

        console.log("Page loaded. Testing filter local btn timeframe...");
        await page.click('#challenge-btn'); // Open scraper UI
        await new Promise(r => setTimeout(r, 1000));
        await page.click('#filter-local-btn');
        await new Promise(r => setTimeout(r, 3000));

        const cards = await page.$$('.card');
        console.log(`Loaded ${cards.length} cards in vault after filtering.`);

        if (cards.length > 0) {
            console.log("Clicking the first card to see expansion...");
            const firstCardWrap = await cards[0].$('.card-img-wrap');
            if (firstCardWrap) {
                await firstCardWrap.click();
                await new Promise(r => setTimeout(r, 4000)); // wait for api
                const inlineContainer = await page.$('.inline-review-container');
                if (inlineContainer) {
                    console.log("Inline container successfully opened.");
                    const inlineCards = await inlineContainer.$$('.card');
                    console.log(`Found ${inlineCards.length} images inside the inline grid.`);

                    const reviewGrid = await page.$('.review-grid');
                    if (reviewGrid) {
                        const gridStyle = await page.evaluate(el => el.getAttribute('style'), reviewGrid);
                        console.log("Review grid style:", gridStyle);
                    }
                } else {
                    console.log("Inline container failed to open or wasn't found.");
                    await page.screenshot({ path: 'test_failure.png' });
                }
            }
        } else {
            console.log("No images found in local vault. Ensure the db has data.");
        }

        console.log("Testing successfully finished.");
        await browser.disconnect();
    } catch (err) {
        console.error(err);
    }
})();
