const puppeteer = require('puppeteer-core');

(async () => {
    let browser;
    try {
        console.log("Connecting to your natively opened Chrome session...");
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        console.log("Checking available pages...");
        const pages = await browser.pages();
        let targetPage;

        for (const p of pages) {
            const url = p.url();
            if (url.includes('newtab.html') || url.includes('cknhekaafkopepjopknhlghhbhhogdfk')) {
                targetPage = p;
                break;
            }
        }

        if (!targetPage) {
            console.log("No VSCO tab found visually mounted! Fetching extension ID natively to open a new tab...");
            const extId = 'cknhekaafkopepjopknhlghhbhhogdfk';
            console.log("Opening new Chrome Tab exactly to your VSCO plugin...");
            targetPage = await browser.newPage();
            await targetPage.goto(`chrome-extension://${extId}/newtab.html`, { waitUntil: 'domcontentloaded' });
        } else {
            console.log("Found your existing open VSCO tab directly on screen!");
        }

        console.log("Bringing the tab cleanly to the front of your computer!");
        await targetPage.bringToFront();
        const wait = ms => new Promise(r => setTimeout(r, ms));

        console.log("Checking UI state... Look at your screen!");
        await wait(1500);

        // Click Random to generate grid
        console.log("Simulating click on 'Random' to load recent feed items...");
        const randomBtn = await targetPage.$('#luck-btn');
        if (randomBtn) {
            const box = await randomBtn.boundingBox();
            if (box) {
                // move mouse visibly
                await targetPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
                await wait(500);
                await randomBtn.click();
            }
        } else {
            console.log("Random button missing? Tab might be weird.");
        }

        console.log("Waiting 4 seconds for native feed to drop from Vault / API...");
        await wait(4000);

        const cards = await targetPage.$$('.card-img-wrap');
        if (cards.length > 0) {
            console.log(`Generated ${cards.length} image blocks onto grid! Testing native layout expansion...`);

            // Hover around so user sees
            for (let i = 0; i < Math.min(3, cards.length); i++) {
                const box = await cards[i].boundingBox();
                if (box) {
                    await targetPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
                    await wait(800);
                }
            }

            console.log("Clicking the very first loaded block to trigger the precise 2-row layout...");
            const firstBox = await cards[0].boundingBox();
            if (firstBox) {
                await targetPage.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2, { steps: 15 });
                await wait(500);
                await targetPage.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);

                console.log("Waiting 3.5 seconds for their native Profile UI backlog to mount...");
                await wait(3500);

                console.log("Scrolling cleanly down so you can analyze the specific Column and Row drops...");
                await targetPage.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' }));
                await wait(4000);

                console.log("Closing the inline window gracefully...");
                const dismiss = await targetPage.$('.dismiss-inline-btn');
                if (dismiss) {
                    await dismiss.click();
                }
            }
        } else {
            console.log("Vault loaded 0 images! Grid is empty.");
        }

        console.log("Test completely finished. Disconnecting.");
    } catch (e) {
        console.error("Test automation error:", e);
    } finally {
        if (browser) await browser.disconnect();
    }
})();
