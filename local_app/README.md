# VSCO Live Feed — Local App

A normal localhost replacement for the extension UI. The app keeps VSCO authentication inside a dedicated `vsco.co` tab in the user's existing Chrome session and stores saved items in SQLite.

## Run

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:5058`.

Chrome must be running with its existing remote-debugging endpoint and logged in to VSCO. The server never reads or copies browser cookies.

## Implemented

- Image search
- People search
- Bio search
- Incremental result rendering
- Local SQLite Vault
- Extension-export import API (`POST /api/import`)

Other sidebar modules remain visible as migration boundaries and will move over independently instead of returning to one monolithic script.
