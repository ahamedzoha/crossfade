---
name: Crossfade
description: Stage Setlist. A warm deck-black shell, printer-paper setlists, marker strikes, and spike-tape tabs that only ever mean a service or a state.
colors:
  deck: "#16130f"
  n1: "#1f1b16"
  n2: "#2b261f"
  n3: "#433c33"
  n4: "#5c544a"
  n5: "#8a8175"
  n6: "#b4aca0"
  n7: "#e3dfd7"
  paper: "#f6f5f1"
  paper-2: "#ecebe5"
  ink: "#111111"
  tape-spotify: "#3ad65b"
  tape-youtube: "#ff5a1f"
  tape-apple: "#ff3d8b"
  tape-warn: "#f4e400"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(34px, 6vw, 46px)"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.005em"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.005em"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "0.01em"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
  note:
    fontFamily: "Shantell Sans, ui-rounded, cursive"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.15
rounded:
  square: "2px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "18px"
components:
  button-primary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    height: "40px"
    padding: "0 18px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    height: "40px"
    padding: "0 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    height: "40px"
    padding: "0 18px"
  button-warn:
    backgroundColor: "{colors.tape-warn}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    height: "40px"
    padding: "0 18px"
  field:
    backgroundColor: "{colors.n1}"
    textColor: "{colors.paper}"
    rounded: "{rounded.square}"
    height: "40px"
    padding: "0 12px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  tape-spotify:
    backgroundColor: "{colors.tape-spotify}"
    textColor: "{colors.ink}"
    height: "16px"
    padding: "0 5px"
---

# Design System: Crossfade

## Overview

**Creative North Star: "Stage Setlist"**

Each canonical playlist is the band's setlist: printed in bold caps on paper, taped to a dark stage deck. Nothing leaves a list without a visible marker strike and a handwritten margin note saying why. The shell is warm black, the lists live on printer-paper sheets, and colour is rationed to spike-tape tabs that only ever mean a service or an attention state.

The system is dense and operational: a desk-first tool that also works on a phone. Surfaces are square, edges are hairlines, and nothing glows. It refuses the zinc dashboard with stat-card rows and service-logo dots; providers are named in text and tape, never with official logos.

**Key Characteristics:**
- One warm neutral ramp (deck to paper); the only light surfaces are paper sheets.
- Colour appears only as tape: three services plus yellow for attention.
- Archivo heavy caps for titles and numbers; Shantell Sans only for margin notes.
- Square 2px corners, hairline rules, shallow paper shadow.
- Motion is ink drawing and tape pressing down; content never fades in from nothing.

## Colors

A warm black deck, off-white paper, and four fluorescent tape colours used as meaning, never decoration.

### Primary
- **Marker Ink** (`ink`): text and rules on paper, the strike stroke, ink buttons, focus rings on paper.
- **Printer Paper** (`paper`): list sheets, the primary button on the deck, focus ring on the deck.

### Secondary
- **Spotify Green** (`tape-spotify`), **YouTube Orange-Red** (`tape-youtube`), **Apple Pink** (`tape-apple`): service tabs and per-service proof only.

### Tertiary
- **Caution Yellow** (`tape-warn`): needs-attention state, review blocks, text highlight in margin notes, text selection, caret, the warn button.

### Neutral
- **Stage Deck** (`deck`): page and shell background.
- **Deck Steps** (`n1` to `n7`): the fixed ramp. n1/n2 for fields and hairlines on the deck, n3 to n5 for borders, gaffer tape and muted text, n6/n7 for secondary text and row rules on paper.
- **Paper Shade** (`paper-2`): hover and skeleton on sheets.

### Named Rules
**The Tape Means Something Rule.** Tape colour appears only for a service or an attention state. A tape that is merely pretty is a defect.
**The One Ramp Rule.** Neutrals come from the single deck ramp; do not introduce a new grey.

## Typography

**Display Font:** Archivo (variable width axis; falls back to system sans)
**Body Font:** Archivo
**Label/Mono Font:** Archivo for labels; system monospace stack available for technical strings
**Margin Notes:** Shantell Sans (500 and 700), only for handwritten annotations and the plus mark

**Character:** Printed show-sheet caps against a human marker hand. The width axis is stretched (106 to 118%) on display type.

### Hierarchy
- **Display** (900, 34px mobile / 46px desktop, 1, uppercase, stretch 112 to 118%): the status claim and the playlist name on a sheet.
- **Headline** (900, 26 to 28px mobile, 34px desktop for large page titles, 1, uppercase): page titles.
- **Title** (800, 22px desktop / 17px mobile, 1.05, uppercase): track titles on setlist rows.
- **Body** (400 to 500, 12.5 to 14px, 1.45): rows, forms, descriptions; tabular numerals everywhere. Prose caps at about 60ch.
- **Label** (700, 11px, 0.12em tracking, uppercase): field labels, axis labels, section headings in the side column.
- **Note** (Shantell 500, 14px, rotated -1.2deg): margin notes explaining a strike, with a yellow marker highlight.

### Named Rules
**The Hand Is For Notes Rule.** Shantell Sans appears only as a margin note or the plus mark; never for UI chrome.
**The Caps Are Printed Rule.** Uppercase heavy Archivo is for titles and numbers; running text stays sentence case.

## Layout

Desktop-first, two regions: a 200px deck rail, then a main column beside a 308px deck column (`minmax(0,1fr) 308px`). Content containers run 760 to 1180px depending on the page. A setlist row is a six-column grid (plus, number, title, duration, tabs, note), with a seventh 76px actions column on editable sheets so rows line up. Rhythm is tight: 8 to 10px column gaps, 54px minimum row height, hairline row dividers.

Below 760px the row collapses to number, title and duration on the first line with tabs and note stacked beneath; the column header hides, empty notes disappear, and row actions appear only in edit mode. Very long sheets use content-visibility to skip off-screen rows.

## Elevation & Depth

Hybrid, mostly flat. The deck has no shadows; depth comes from paper sitting on a dark ground. Sheets carry one soft drop shadow and tape carries a 1px under-line. Nothing glows.

- **Sheet** (`0 1px 1px rgb(0 0 0 / 0.35), 0 18px 32px -18px rgb(0 0 0 / 0.75)`): paper sheets on the deck.
- **Tape** (`0 1px 0 rgb(0 0 0 / 0.18)`): tabs and paper-slip buttons.
- **Press-in** (`0 10px 14px rgb(0 0 0 / 0.35)` easing to rest): a newly placed element pressing down.

### Named Rules
**The Paper Sits Down Rule.** Only paper sheets get the lifted shadow; no other surface rises.

## Shapes

Square. Controls, fields, checks and keys use a 2px corner; tape and sheets are perfectly rectangular. Selection controls on review use round radio marks as an exception. Tape corners (masking tape pieces at +/-36 degrees) pin sheets; sheets may tilt -0.25deg. Edges are 1px hairlines; the setlist header rule is 2px ink.

## Components

### Buttons
- **Shape:** square (2px), 40px tall, 14px bold, 18px side padding; sm 32px, xs 26px.
- **Primary (on deck):** paper slip with ink text; **Ink** is the primary on paper sheets.
- **Ghost / Outline / Quiet:** 1px inset stroke on deck (ghost), 1.5px ink stroke on paper (outline), borderless (quiet).
- **Warn:** yellow with ink text, for the single attention action.
- **States:** hover shifts the fill one step; active presses down 1px and scales to 0.985; disabled filled buttons empty out to an outline instead of turning grey.

### Tape (tabs and tags)
16px tall, 9px heavy caps, ink text on service or warn colour. Variants: gaffer grey (neutral), hazard stripes (broken), dashed outline (missing), line-through outline (struck).

### Fields
40px, 2px corner, n1 fill with 1px inset n3 stroke on the deck; white fill with a warm grey stroke on paper. Focus becomes a 2px inset paper (deck) or ink (paper) stroke. Checks are 18px squares in currentColor.

### Setlist Sheet and Rows
The signature component: a taped paper sheet with a ruled header, large caps titles, a to-scale duration ruler, tape tabs per service and a margin note column.

### Strike
A hand-drawn ink path (3.4px, round caps) across number, title and duration, never across tabs or notes. It draws on in 520ms with expo-out easing; restoring peels it back. Struck titles stay on one line.

### Navigation
Deck rail with caps labels; the active item is differentiated by paper fill or ink-on-paper treatment (see the shell component). On phones the rail collapses to the shell's compact navigation.

## Do's and Don'ts

### Do:
- **Do** put lists on paper sheets and everything else on the deck.
- **Do** show proof for any status claim with per-service tape.
- **Do** draw a strike and write a margin note when a row is removed or deduped.
- **Do** draw durations and run times to true scale.
- **Do** keep focus rings 2px: paper on the deck, ink on paper.
- **Do** honour prefers-reduced-motion; animations shorten to 1ms.

### Don't:
- **Don't** use tape colours for decoration or for anything that is not a service or an attention state.
- **Don't** use official provider logos; name providers in text and tape.
- **Don't** round corners beyond 2px, add glows, or add new shadows.
- **Don't** fade content in from nothing; ink draws and tape presses.
- **Don't** build stat-card rows or a zinc dashboard.
- **Don't** use Shantell Sans outside margin notes.
