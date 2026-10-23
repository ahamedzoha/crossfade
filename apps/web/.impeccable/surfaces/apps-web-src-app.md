---
version: 1
slug: "apps-web-src-app"
primary_target: "apps/web/src/app"
related_targets: []
---

# Crossfade app surface

Scope: the whole signed-in web app (Overview, Playlists, Playlist setlist, Liked Songs, Review, Runs, Connections, API & Webhooks, Settings) plus first-run setup and login.
Mode: Operate. Desktop-first (homelab owner at a desk in the evening), must work on phone for quick checks.

Audience/job: link streaming accounts, choose playlists to keep in sync, see that every service agrees, act on the one thing that needs attention (review a match, reconnect an expiring account, approve a guarded run).
Constraints: every control is a standard web control; provider names in text, no official logos; Apple add-only must be stated where it matters.

## Direction contract

THESIS: Each canonical playlist is the band's setlist: printed in bold caps, and nothing leaves it without a visible marker strike and a margin note saying why. Refuses the category default of a zinc dashboard with stat-card rows and service-logo dots.

OWN-WORLD: Warm stage-deck black shell (#16130f) on one fixed neutral step ramp; printer-paper sheets (#f6f5f1) are the only light surfaces and hold the lists; marker ink #111. Matte fluorescent spike-tape tabs carry colour and only ever mean a service (green Spotify, red-orange YouTube Music, pink Apple Music) or attention (yellow). Archivo heavy caps, stretched 106–118, for titles and numbers; Shantell Sans only for margin notes. Square corners, hairline rules, nothing glows.

STORY: Glance: do all services agree, and what's the proof. Read: what the last run changed, struck, added, flagged. Act: the single thing that needs them.

FIRST VIEWPORT: 200px deck rail; header spans main+aside with the status claim in 34px caps, per-service proof tapes beneath, next-sync time and Sync now at right. Main: taped paper sheet of the latest run: guide words, 46px playlist name, tally with a to-scale duration bar, track rows with tape tabs, strikes and margin notes. Right 308px deck column: service tapes with health, yellow-taped review block, recent runs drawn as proportional bars.

FORM: Stage Setlist, #7 of the ordered grounded list; seed:674cf8cc06f401c7. Signature interaction: when a row is removed or deduped, a marker strike draws across it (stroke draw-on) and the margin note writes in; restoring peels the strike back. Motion grammar: ink draws, tape presses down; content never fades in from nothing.

Raises kept: guide words on long sheets (Lexicon); review is one decision at a time with the next preloaded (Vertical Feed); every status claim shows its proof (Monochrome Proof); durations and run times drawn to true scale (Dance Score); one neutral ramp, tape colour only for meaning (Exposure Record).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
- Product name "Crossfade" not yet confirmed by the user.
