# VSCO API & Extension Knowledge Base

## Authentication
- Cookie-based session auth — extension uses `credentials: 'include'` on all fetches
- User must be logged in at vsco.co in the same Chrome profile
- No API keys or tokens needed; piggybacks on browser cookies
- 401/403 = logged out or session expired
- Cloudflare protection may trigger on automated/headless requests (not an issue for extension context)

## API Endpoints

### Image Search (v2.0)
```
GET https://vsco.co/api/2.0/search/images?query={q}&size={n}
```
- `query`: any string — emoji, keywords, hashtags, names
- `size`: max results (up to 10,000 per call)
- Returns: `{ results: [ImageObject, ...] }`
- Results are NOT sorted by date — order varies
- Empty query returns nothing; very short queries (1-2 chars) can return massive results

**ImageObject shape:**
```json
{
  "imageId": "67a1b2c3d4e5f6a7b8c9d0e1",  // MongoDB ObjectId (24 hex chars)
  "responsive_url": "//im.vsco.co/1/...",     // CDN image URL (needs protocol prefix)
  "description": "beach vibes ☀️",            // user caption (can be empty)
  "upload_date": 1708920000,                   // Unix timestamp (seconds)
  "image_url": "...",                          // alternative image URL
  "width": 1080,
  "height": 1350,
  "permalink": "https://vsco.co/user/media/67a...",
  "grid": {
    "siteId": 123456,                          // numeric user ID
    "subdomain": "username"                    // VSCO username
  },
  "image_meta": {
    "model": "iPhone 14 Pro",                  // camera/phone model
    "flash_mode": "Off",
    "iso": "100",
    "aperture": "1.78"
  },
  "preset": {
    "short_name": "Matte"                      // VSCO filter/preset name
  },
  "has_location": true,
  "location_coords": "40.7128,-74.0060"       // lat,lng string (or missing)
}
```

### People/Grid Search (v2.0)
```
GET https://vsco.co/api/2.0/search/grids?query={q}&page={p}&size={n}
```
- Returns: `{ results: [PersonObject, ...] }` (or `{ grids: [...] }`)
- Searches usernames, display names, bios
- `page`: pagination (0-indexed)

**PersonObject shape:**
```json
{
  "gridImageId": "67a1b2c3d4e5f6a7b8c9d0e1",  // latest upload ObjectId
  "responsive_url": "//im.vsco.co/...",          // latest upload image
  "gridImage": "abc123def456...",                 // profile pic filename (prefix with img.vsco.co/)
  "userName": "Display Name",
  "siteSubDomain": "username",                    // VSCO handle
  "siteDomain": "vsco.co/username",
  "siteId": 123456,
  "gridName": "Bio text here | travel | photo"   // user bio
}
```

### Profile Media (v3.0)
```
GET https://vsco.co/api/3.0/medias/profile?site_id={siteId}
```
- Returns: `{ media: [{ image: ImageObject }, ...] }`
- Gets all (or recent) uploads for a user
- Each `image` has full metadata including `has_location`, `location_coords`, `image_meta`, `preset`
- `site_profile_image_url` found inside first media item

### Feed (gRPC)
```
POST https://vsco.co/grpc/feed/fetchPersonalFeed
```
- gRPC endpoint; returns personal feed
- Less useful for discovery than search endpoints
- May require specific headers/protobuf encoding

## Data Model

### MongoDB ObjectId as Timestamp
- All image/media IDs are 24-char hex MongoDB ObjectIds
- **First 8 hex chars = Unix timestamp (seconds)** of when the document was created
- This is how the extension extracts upload time without a dedicated timestamp field
- Example: `"679DD280..."` → `parseInt("679DD280", 16)` → `1772003968` → Feb 2026
- This property is used for IDBKeyRange queries (indexed time-based filtering)

### IndexedDB Vault Schema
```
Database: "VSCO_Vault" (version 1)
Object Store: "images"
  keyPath: "imageId"
  No additional indexes
```
- **DO NOT change version or keyPath** — user has 11M+ existing records
- imageId is the primary key (MongoDB ObjectId string)
- Since keys sort lexicographically and ObjectIds start with hex timestamps,
  IDBKeyRange.bound() can efficiently query by time range
- `sourceQuery` field added by scraper to track which search term found each image

### chrome.storage.local
- `permanentSeenIds`: Array of imageIds the user has "cleared" (hidden)
- `scrapeHistory`: Object mapping search terms → last-scraped timestamp
- `customQueue`: Array of user-added priority search terms
- `challengeStoredResults`: LEGACY — migrated to IndexedDB on first load

## Rate Limiting & Performance

### API Behavior
- No official rate limit documentation
- 429 responses observed under heavy load
- ~2 second delay between scraper queries works reliably
- Exponential backoff implemented: 2s → 4s → 8s → ... → 60s max
- Each search query can return up to 10,000 results
- Parallel requests work fine (extension fires 20 feed queries simultaneously)

### Performance with Large Vaults
- 11M+ records in IndexedDB is viable with key range queries
- **Never load all keys into memory** — use count() for display, key ranges for filtering
- Cursor-based full scans of 11M records will hang the tab
- `timeToObjectIdPrefix(ms)` converts timestamp to hex for IDBKeyRange.bound()
- Session dedup during scraping uses a small Set (cleared each run)

## Image URLs
- `responsive_url` from API usually starts with `//im.vsco.co/` (needs `https:` prefix)
- Profile pics: `img.vsco.co/{gridImage}` (gridImage is just a filename/ID)
- Original images for EXIF: `https://i.vsco.co/{imageId}`
- Default avatars: URLs containing `rassets.vsco.co/avatars/` — skip these

## EXIF GPS Extraction
- Fetch original JPEG from `https://i.vsco.co/{imageId}`
- Parse with EXIF.js library (included in extension)
- GPS stored as DMS (Degrees/Minutes/Seconds) + reference (N/S/E/W)
- Convert to decimal degrees: `dd = d + m/60 + s/3600` (negate for S/W)
- Some images have `location_coords` in API response — use that first, EXIF as fallback
- `location_coords` can be: string "lat,lng", array [lat,lng], object {lat,lng}, or microdegrees (divide by 1e5/1e6/1e7)

## Search Term Strategy
The scraper uses several categories of search terms:
- **Emojis**: Singles, doubles, triples, random pairs (~200 combinations)
- **Keywords**: Social media handles (ig, snap, tt), seasons, moods, locations, activities
- **Names**: ~800+ common first names
- **Custom**: User-added priority terms (scraped first)
- **Random**: Generated 1-3 char strings from alphanumeric + special chars
- Total queue: ~1500+ unique terms per full run
- Full scrape takes ~1-2 hours at 2s delay

## Extension Architecture
```
manifest.json (MV3, permissions: cookies, storage, unlimitedStorage)
├── newtab.html/js/css  — Main UI (replaces Chrome new tab)
│   ├── Search engine (pattern matching, boolean logic)
│   ├── Scraper engine (queue, backoff, state machine)
│   ├── IndexedDB vault (11M+ images, key range queries)
│   ├── Auto-PFP system (IntersectionObserver + fetch queue)
│   ├── Leaflet geo-mapper (EXIF GPS + API coords)
│   └── People/Bio search (grid API + profile expansion)
├── vsco-bio-inject.js  — Content script (injects API bio on profile pages)
├── exif.js             — EXIF metadata parser (minified)
├── leaflet.js/css      — OpenStreetMap library
└── images/             — Leaflet marker icons
```

## Known Quirks
- API sometimes returns `grids` instead of `results` for people search
- `upload_date` field exists but ObjectId timestamp is more reliable
- Profile pics via gridImage need `img.vsco.co/` prefix, not `im.vsco.co/`
- Some ObjectIds in the DB may not be 24-char hex (edge cases from profile entries)
- `description` field is often empty — many VSCO users don't caption
- The gRPC feed endpoint exists but is less useful than search for discovery
