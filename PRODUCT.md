# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-specified: Next.js frontend, lightweight DB, Node backend + workers (Nest or Express), Docker packaging for homelabs.
Delegated details: Next.js 16 App Router + Tailwind v4 (UI), NestJS (API, workers, scheduler — chosen over bare Express for module structure and a documented public API), SQLite via Drizzle + better-sqlite3 in WAL mode (single file in the data volume, zero extra containers), SQLite-backed job queue (no Redis). Shipped as one Docker image, one port, one `/data` volume, pnpm monorepo.

## Users

- **Primary:** a homelab owner who hops between Spotify, YouTube Music and Apple Music and wants the same playlists and liked songs everywhere without thinking about it. Technical, self-hosts other services, runs it behind a reverse proxy (often with forward-auth like Authentik).
- **Household members:** additional local users on the same instance (e.g. a partner), each linking their own streaming accounts. Admin creates them.
- **Other services / scripts:** machine clients that read the clean canonical lists or trigger syncs over the REST API with an API key, or receive webhooks.
- **Other self-hosters:** people who find the project and deploy it to their own homelab; first-run experience and packaging must work without reading source.

## Product Purpose

Keep one clean, deduplicated canonical version of each playlist (and liked songs) and continuously reconcile it with every linked streaming service on a schedule. Success: the user edits a playlist on whichever service they're using today, and within one sync cycle every other service matches — no duplicates, no silently lost tracks, no babysitting.

## Positioning

Unlike one-shot transfer tools (TuneMyMusic, Soundiiz), it runs continuously on the user's own hardware, does true two-way merge with a canonical list, removes duplicates as policy rather than as a manual step, and exposes the clean list as an API for the rest of the homelab.

## Operating Context

- Runs as a Docker container on a homelab host (Proxmox LXC, Unraid, Synology, plain Docker), usually behind a reverse proxy with HTTPS; sometimes accessed by LAN IP over plain HTTP.
- Users visit occasionally: to link accounts, pick playlists to sync, review unmatched tracks, check that runs are healthy. Most of the time it works unattended.
- Streaming providers impose real limits the product must surface honestly: Apple Music's API is add-only for library playlists (no removals/deletes), Spotify requires HTTPS or loopback redirect URIs and per-instance developer apps, YouTube Music has no official music API.

## Capabilities and Constraints

- **Sync model (confirmed):** two-way merge. Canonical list lives in the app; adds and removes on any linked service propagate to all others. Additions win over removals in the same cycle. A mass-deletion guard aborts any run that would remove more than a configured share of a list.
- **Dedupe:** duplicates collapse automatically (same recording via ISRC or normalized title/artist/duration); policy configurable for versions (remaster vs. live/remix).
- **Liked songs / library** sync as a special list alongside playlists.
- **Match review queue:** low-confidence or unmatched tracks are queued; user picks a candidate, pastes a link, or ignores.
- **Schedules:** per-playlist or global intervals; manual "sync now".
- **Public REST API** with per-user API keys (read / read-write scopes), OpenAPI document; **outgoing webhooks** on sync events; **exports** as JSON, CSV, JSPF.
- **Accounts:** household multi-user with local logins; first run creates the admin; optional trusted-header auth for reverse-proxy forward-auth.
- **Apple Music:** bring-your-own MusicKit key (Team ID, Key ID, .p8) entered by the instance admin; add-only on Apple side, pending removals flagged for manual action.
- **Provider credentials** (Spotify client ID/secret, Apple key, YouTube auth) are configured in the UI and stored encrypted, so deployment needs minimal env config.

## Brand Commitments

Working name "Crossfade" (chosen by Claude, not yet confirmed by the user; rename is cheap).

## Evidence on Hand

None. No users, testimonials, benchmarks or screenshots exist; do not fabricate any. Provider logos are trademarks — reference services by name and neutral marks, not official logo artwork, unless the user supplies brand-guideline-compliant assets.

## Product Principles

1. **Never lose a track silently.** Every removal, dedupe and skipped match is recorded and reversible or reviewable.
2. **Honest about provider limits.** If a service can't do something, say so where it matters instead of failing quietly.
3. **Unattended by default.** The best session is one where nothing needs attention; when something does, it's obvious and specific.
4. **Homelab-native.** One container, one volume, sane defaults, works behind a reverse proxy, data stays on the user's box.
5. **The clean list is the product.** UI, API and exports all present the same canonical list.
