const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
    try {
        console.log("Connecting to Chrome...");
        const browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1400, height: 900 }
        });

        console.log("Opening new tab to trigger extension...");
        const page = await browser.newPage();

        // The extension overrides the new tab page, so navigating to chrome://newtab/ should load it
        await page.goto('chrome://newtab/', { waitUntil: 'load', timeout: 10000 });

        console.log("Checking if VSCO new tab is loaded (looking for #challenge-btn)...");
        try {
            await page.waitForSelector('#query', { timeout: 5000 });
            console.log("VSCO UI detected.");
        } catch (e) {
            console.log("VSCO UI not detected. Taking screenshot of whatever loaded.");
            await page.screenshot({ path: '0_failed_load.png' });
            console.log("URL is:", page.url());
            process.exit(1);
        }

        // Click Scraper to open UI
        console.log("Opening Scraper UI");
        await page.click('#challenge-btn');
        await new Promise(r => setTimeout(r, 1000));

        // Filter local
        console.log("Clicking Filter Local");
        await page.click('#filter-local-btn');
        // Wait for cards to populate
        await new Promise(r => setTimeout(r, 3000));

        const cards = await page.$$('.card');
        console.log(`Vault loaded ${cards.length} cards.`);

        if (cards.length > 0) {
            console.log("Clicking the first card");
            const firstCardWrap = await cards[0].$('.card-img-wrap');
            if (firstCardWrap) {
                await firstCardWrap.click();
                await new Promise(r => setTimeout(r, 4000)); // wait for API

                const inlineContainer = await page.$('.inline-review-container');
                if (inlineContainer) {
                    console.log("Inline container expanded successfully.");
                    await page.screenshot({ path: '1_expanded_view.png', fullPage: true });
                } else {
                    console.log("No inline container found after click!");
                    await page.screenshot({ path: '1_failed_expansion.png', fullPage: true });
                }
            }
        } else {
            console.log("Vault is empty. Searching something random...");
            await page.type('#query', 'vsco');
            const submitBtn = await page.$('button[type="submit"]');
            if (submitBtn) await submitBtn.click();
            await new Promise(r => setTimeout(r, 4000));

            const searchCards = await page.$$('.card');
            if (searchCards.length > 0) {
                const firstCardWrap = await searchCards[0].$('.card-img-wrap');
                await firstCardWrap.click();
                await new Promise(r => setTimeout(r, 4000));
                await page.screenshot({ path: '1_expanded_search.png', fullPage: true });
            }
        }

        console.log("Done. Disconnecting...");
        await browser.disconnect();
    } catch (e) {
        console.error("Error running script:", e);
    }
})();
