# VSCO Tub product contract

VSCO Tub is a visual-discovery workspace for exploring the VSCO community. It
is not primarily an RPC console or a replacement search form.

## The user experience

- **Explore:** search images and people with include/exclude terms, then browse
  a newest-first wall that keeps expanding in bounded batches.
- **Time:** switch the wall between Today, This week, and All time. The active
  window is shown in the result status, and the existing expansion engine keeps
  filling the selected view.
- **Place:** open a map of coordinates actually returned by metadata enrichment;
  points link back to their source media and the map summarizes returned GPS
  coverage by country. Missing coordinates are not invented.
- **Library:** save images, creators, searches, and location/camera context into
  a local collection. The library can be filtered by GPS, country, camera, or
  source search, grouped into browsable sections, and keeps the selected
  filter across sessions.
- **Return:** watch a search for new results and see watched visual worlds in
  the Collection drawer with their freshness state.

## Product boundaries

The interface should feel calm, visual, and user-directed. Small contextual
controls belong on cards; advanced request/schema diagnostics stay behind an
explicit developer surface. Local collection data remains local to the
isolated extension identity. Image enrichment is progressive and bounded, and
the UI distinguishes pending, returned, omitted, and unavailable metadata.
Transient extension-worker disconnects are retried once and shown to users as
a recoverable Tub message; raw transport details remain available only in the
developer diagnostics surface.

## Definition of a trustworthy result

Counts, GPS, country, camera data, and interaction state must come from an
observed response or be labeled unavailable. The extension must not fabricate a
total, infer GPS from a missing gRPC record, or create unbounded background
requests. Release requires syntax/static checks and live authenticated Chrome
QA of the actual unpacked extension. Repository helper scripts must receive
authentication and cookie material through runtime environment variables, never
embedded literals.
