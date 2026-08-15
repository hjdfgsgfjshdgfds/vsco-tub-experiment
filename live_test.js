const puppeteer = require('puppeteer-core');

(async () => {
    let browser;
    try {
        console.log("Connecting to your explicitly logged-in Chrome browser on port 9222...");
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: null
        });

        console.log("Opening your local VSCO New Tab directly onto your screen...");
        const vsPage = await browser.newPage();
        await vsPage.goto('chrome://newtab/', { waitUntil: 'domcontentloaded' });

        console.log("✅ Successfully hooked into the VSCO tab!");
        await vsPage.bringToFront();
        const wait = ms => new Promise(r => setTimeout(r, ms));

        // give it time to load the extension override DOM
        await wait(2000);

        console.log("Typing 'dog' into your search bar to get some images...");
        const searchInput = await vsPage.$('#query');
        if (searchInput) {
            await searchInput.click({ clickCount: 3 });
            await vsPage.keyboard.press('Backspace');
            await wait(200);
            await searchInput.type('dog', { delay: 100 });
            await vsPage.keyboard.press('Enter');
        } else {
            // Alternatively try clicking 'Random'
            const luckBtn = await vsPage.$('#luck-btn');
            if (luckBtn) {
                console.log("Clicking Random button instead...");
                await luckBtn.click();
            } else {
                console.log("Could not find search bar or random button!");
                process.exit(1);
            }
        }

        console.log("Waiting 5 seconds for your vault to fetch images...");
        await wait(5000);

        const cards = await vsPage.$$('.card-img-wrap');
        console.log(`📸 Found ${cards.length} image cards in your grid!`);

        if (cards.length > 0) {
            console.log("Moving your mouse to hover over the first card...");
            const box = await cards[0].boundingBox();
            if (box) {
                await vsPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
                await wait(1000);

                console.log("Clicking the first card to trigger inline expansion...");
                await vsPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }

            console.log("Waiting 4 seconds for the inline layout to fetch their profile and expand...");
            await wait(4000);

            console.log("Scrolling down so you can see the fully rendered expanded grid...");
            await vsPage.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));

            console.log("Please look at your browser window now!");
            await wait(5000);

            const dismiss = await vsPage.$('.dismiss-inline-btn');
            if (dismiss) {
                console.log("Collapsing the inline layout...");
                await dismiss.click();
            }
        } else {
            console.log("No images loaded. Make sure your Vault has data or the API works.");
        }

        console.log("✅ Done.");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        if (browser) await browser.disconnect();
    }
})();
