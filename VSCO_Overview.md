# VSCO & Extension Overview

## How VSCO Works (API & Data)
VSCO uses a largely public API for its core features (search, profiles, images) which uses a cookie-based session authentication. As long as you are logged into VSCO on your browser, the extension can piggyback off these cookies to make authenticated requests.
- **Image Search (v2.0)**: Allows searching by any string (emojis, keywords, etc.) and returns up to 10,000 results at a time. The results returned are generally randomized or varying in order rather than strictly chronological.
- **People/Grid Search (v2.0)**: Searches usernames and bios to find people.
- **Profile Media (v3.0)**: Fetches recent uploads of a user, which includes metadata like camera info, presets used, and location coordinates.
- **IDs & Timestamps**: VSCO uses MongoDB ObjectIds (`imageId`). The first 8 hex characters of this ID represent a Unix timestamp, which allows us to extract upload dates naturally and query ranges efficiently in the database without needing it as a separate field from the API.

## How This Extension Works
This extension replaces your Chrome "New Tab" page with a fully custom, powerful VSCO image search and live feed engine. It completely bypasses VSCO's standard minimal web UI to offer extensive, mass-discovery features.

### Core Architecture & Technologies
- **Main Interface (`newtab.html` / `newtab.js`)**: The core functionality lives in the New Tab override. It handles searching, scraping, UI rendering, mapping, and IndexedDB operations.
- **Storage (IndexedDB Vault)**: A local `VSCO_Vault` database stores all discovered images. Since VSCO has no public "global feed" and pagination is tricky, the extension acts as a scraper, rapidly querying different terms (names, emojis, locations) and caching all distinct results in this vault. With over 11 million records supported, it uses `IDBKeyRange` queries over the embedded timestamps in the `imageId` for rapid filtering.
- **Chrome Storage**: Used for lightweight user settings: seen image hide lists, scraper history queues, custom search terms, etc.
- **Geo-Mapping (Leaflet)**: Images with location coordinates (either direct from the API or retrieved incrementally by parsing EXIF GPS data from the original JPEG files) are displayed on an interactive OpenStreetMap.

### Key Features
- **Live Feed Mode**: Simulates a live feed by firing parallel requests across a curated list of generic high-traffic hashtags and sorting by newest extracted timestamps.
- **The Scraper Engine**: Runs in the background (within the tab), sequentially firing queries from a massive internal dictionary (emojis, names, custom terms) and saving all raw image data to the IDB Vault.
- **Smart Pattern Matching**: Supports advanced search queries with wildcards (`*`, `?`), boolean logic (`AND`, `OR`, `NOT`), and exact matching (`"exact phrase"`).
- **Auto-PFP System**: Lazily loads full-resolution profile pictures natively as you scroll by requesting them dynamically when cards enter the viewport.
- **Seen System**: Keeps a permanent cache of `permanentSeenIds` so once an image is cleared, it never shows up again across sessions.
***

**Ready for More Information?**
This covers the basic structure! Are there specific parts you'd like more details on (like how the scraper's backoff logic works, how EXIF GPS is extracted, or exactly how the UI is rendered)? Also, I've received your request for the "Like & Auto-Scrape" feature. Let me know if you want any specific behavior regarding the auto-scraping mechanism (e.g., if you want it visibly downloading in the background, or if it should be completely silent)!
