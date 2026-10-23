# Progress

Last updated 2026-10-24. Status: **early alpha**, running locally and live-tested against YouTube Music and Apple Music (web session).

## What exists

- **Sync engine.** Two-way merge per canonical playlist: pull → diff against each service's last snapshot → apply adds (adds win) and removals → dedupe → push → re-snapshot. It has a mass-deletion guard, dry runs, per-link directions (two-way, read only, mirror), and a liked/favorites collection usable as a link in any playlist. Each service gets a search budget of 150 new searches per run, paced 250 ms apart, and matching pauses on HTTP 429.
- **Providers.**
  - Spotify: OAuth, with a paste-back flow for plain-HTTP LAN installs, on the Feb 2026 Web API endpoints.
  - YouTube Music: cookie session via youtubei.js. Likes and unlikes go through the YouTube Music web client, because the library's TV-client path rejects cookie sessions.
  - Apple Music, two ways: an official MusicKit key (add-only), or a web session that borrows the music.apple.com web player's token plus the `media-user-token` cookie and can remove tracks. Liked on Apple means Favorite Songs.
- **Matching.** ISRC first, then scored title, artist, version and duration. Low-confidence matches and misses go to a review queue, which works one decision at a time with keyboard shortcuts.
- **App.**
  - Pages: Overview, Liked Songs, Playlists (create, link, strike and restore, schedule, export), Review, Runs, Connections, API & Webhooks, Settings and an in-app Guide.
  - Album art everywhere.
  - "Create and preview" (a dry-run first sync).
- **Platform.** Household multi-user, optional trusted-header auth, API keys with read and write scopes, signed webhooks, an OpenAPI document, exports (JSON, CSV, JSPF, M3U), an SQLite job queue with crash recovery, and a scheduler.
- **Packaging.** One Docker image (Next standalone on :8080 proxying to Nest on loopback) with PUID/PGID handling. CI and multi-arch GHCR workflows are written.
- **Design.** The "Stage Setlist" world is documented in `DESIGN.md`, with the direction contract in `apps/web/.impeccable/surfaces/`.

## Verified

- `pnpm test`: 22 engine and matching tests. They cover merge, add and remove propagation, the guard, dry run, dedupe, adds beating removals, the add-only fallback, liked unlike rules, and in-service duplicates.
- Docker image: builds; it was tested for health, first-run setup through the public port, volume persistence and graceful stop. That run predates the artwork, Apple web session and liked changes, so rebuild and recheck it.
- Live, on 2026-10-23 and 24:
  - YouTube Music: cookie connect (from a private window), playlist import (38 tracks in 577 ms) and album art all work. Re-liking an already-liked song through the fixed client path works.
  - Apple Music web session: connect, playlist listing and Favorite Songs detection all work.
  - Liked Songs merge: reads 418 YouTube likes and 620 Apple favorites into one 913-track list. No writes have completed yet (see below).

## Not tested live yet

- Spotify end to end. It needs a Premium account to own the developer app.
- Apple: creating a playlist, removing tracks (`DELETE …/tracks?ids[library-songs]=…&mode=all`), favoriting and un-favoriting, MusicKit-key mode.
- YouTube: unlike, creating playlists, removing tracks.
- Webhooks, API keys against real data, trusted-header auth, a second household user.

## Open issues and next steps

1. **Liked Songs sync is paused locally** (`sync_enabled = 0`). To resume: tick Sync automatically, run a Dry run, then Sync now. Apple searches hit HTTP 429 around 00:20; the engine now defers instead of retrying.
2. **Non-music items in YouTube likes.** Videos such as "Nature sounds…" end up in Review as no-match on Apple. Consider skipping `non_music_track` items in liked syncs, or adding a filter.
3. **Search budget is hard-coded** (150 per service per run). Make it a setting, and show "still to match" on the playlist page.
4. **Docker.** Rebuild and recheck the image. After the first Actions run, set the GHCR package to public so `docker pull` works without logging in.
5. **Design.**
   - The type sizes in use are wider than `DESIGN.md`'s documented ramp; the detector reports this as advisories.
   - Hook findings on the decision mocks in `.impeccable/mocks/decision/` are waiting on a decision (ignore that folder or not).
6. **Dev quirk.** After `pnpm db:generate`, restart the API: `nest --watch` can boot before the migration file exists.
7. **Name.** "Crossfade" hasn't been confirmed.
8. **Pins.** `youtubei.js` is pinned to `~18.2.0`; 18.3.0 was a day old at the time.
9. **Rejected.** A Spotify web-session connector would mean getting around Spotify's TOTP token lock, which is against its terms.

## Local dev notes

- `.env` (gitignored) sets `APP_URL=http://127.0.0.1:3000` and `DATA_DIR=<repo>/data`. Open the app at 127.0.0.1, not localhost: Spotify only allows loopback IPs for http redirects.
- `data/` holds real connections encrypted with `data/.secret-key`. Neither is committed.
- Demo data: `pnpm --filter @crossfade/api demo:seed` into an empty `DATA_DIR`, then run with `WORKER_DISABLED=1` and sign in as demo / crossfade-demo.
