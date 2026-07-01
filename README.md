# Parchment — D&D Character Sheet Builder

A mobile-first, offline PWA for building and using tabletop-RPG character sheets. Vanilla JS,
no build step, no dependencies, no backend.

## Run it

- **Served (full PWA):** `cd app && python3 -m http.server 8777` → open `http://localhost:8777/`
- **Zero-setup:** double-click **`parchment-offline.html`** (single self-contained file; drops the
  installable/offline PWA layer but the app works fully). Chrome recommended.

See [`app/README.md`](app/README.md) for a feature walkthrough and file map, and `SPEC.md` for the
authoritative product & technical spec the app is built to.

---

The sections below are the original design handoff (spec + wireframes) the implementation was built from.

## Overview
Parchment is a **mobile-first, installable PWA** for building and using tabletop-RPG character
sheets. It is not a hard-coded 5e sheet — it is a small generic engine that stores named
**values**, computes some from others via **formulas**, rolls **dice**, and displays everything
through configurable **widgets** arranged on swipeable **pages**. It ships with a full **D&D 5e
preset** so it is useful on first launch. No backend, no accounts — data lives in browser-local
storage and is shared by exporting/importing JSON files.

## Source of truth
- **`SPEC.md`** is the complete, scope-locked product & technical spec. It is authoritative for the
  data model, the two-context math engine, persistence/sharing, MVP scope, and build sequence.
  **Read it first and build to it.** The wireframes below never override it.
- **`Parchment Wireframes.dc.html`** is a low-fidelity wireframe map of the UI, keyed to SPEC
  section numbers. Use it for layout, screen inventory, and flow — not for final styling.

## About the design files
The files in this bundle are **design references authored in HTML** — a low-fi prototype showing
intended structure and behavior, not production code to copy. The task is to **implement the
product described in `SPEC.md`, using the wireframes as the layout guide**, in an appropriate
codebase. No app code exists yet, so choose the stack per SPEC §16 (recommended: a light
vanilla/small-framework SPA, system-font stack, no CDN deps so it works offline).

`Parchment Wireframes.dc.html` is a "Design Component" and depends on `support.js` (included) plus
a Google Fonts link for the sketch font. It opens directly in a browser for viewing. You are not
shipping this file — treat its markup as annotated reference only.

## Fidelity
**Low-fidelity (wireframes).** Layout, screen inventory, component placement, and flow are
intentional and should be followed. Styling is a guide only — apply the aesthetic brief from
SPEC §8.3: **aged parchment + ink + a single oxblood accent**, mimicking a paper sheet; a faint
graph-paper grid appears only in edit mode and fades in play mode. Bold in one place, quiet
everywhere else.

## Screens / Views
Screen ids match the badges in the wireframe file.

**A — Play mode**
- **A1 Character sheet** — the main view. App bar (menu · character name · Play/Edit toggle), page
  tabs + swipe with a dots indicator, and a 2-column responsive widget stack (SPEC §8.1). number
  widgets are inline-editable; calc widgets are read-only and auto-update; ⬡ marks tap:roll, ⚔ an
  inherited weapon roll (§9).
- **A2 Roll result** — overlay showing the full breakdown, never a bare total: `1d20 (14) +
  str_mod (3) = 17`, with Roll again / Close (§6.4).
- **A3 Detail (calc)** — overlay revealing a computed value's formula (`= 10 + dex_mod (2)`) and
  description (§9, §6.3). Cycles / bad refs render `ERR` here.
- **A4 Second page** — same character, a different page (Combat): pages are ordered widget lists
  (§5.4). v1 saves/skills are raw ability mods (no proficiency toggle yet, §10).

**B — Edit mode (full editing is in v1 scope)**
- **B1 Edit mode** — faint graph grid on; widgets read as draggable index cards with a ⠿ handle
  and an S/M/L size chip; "+ Add widget" tile; page tabs gain a "+ Page" affordance (§8.1–8.3).
- **B2 Widget config** — bottom sheet: bind value (ref), optional secondaryRef, size S/M/L, tap
  action none/detail/roll, and rollOverride. Display face derives from the bound value's kind;
  display × tap are two independent axes; rollOverride wins else value.roll (§9).
- **B3 Value editor** — immutable id (slug, shown locked), editable label, kind segmented
  (number/text/calc) which shows/hides value·text·formula fields, formula (rejects `NdM` dice),
  optional roll, description, group (§5.3, §6). Live-validate to `ERR`.
- **B4 Add widget** — search, bind an existing value, "+ Create new value inline", or add a static
  label/divider widget (kind:"label") (§8.2, §5.5).

**C — Characters, sharing & storage**
- **C1 Character list (home)** — many characters, one active (dot), preset + level per row, a
  warning banner that local data is wipeable, and a "+ New" FAB (§5.1, §7.1).
- **C2 New character** — name field + start-from picker (D&D 5e preset ● / Blank ○), Create (§10, §12).
- **C3 Share & backup** — export this character / everything / a pack; import a .json file;
  human-legible filenames; file-transport sharing, no backend (§5, §5.6, §3, §7.2).
- **C4 Import — conflict** — non-destructive import dialog: on id collision, import under a
  suffixed id (`longsword_2`) or skip; newer schemaVersion is warned & refused (§7.3).

## Interactions & behavior
- **Play/Edit toggle** switches the whole sheet between read/play and full editing.
- **Pages** swipe horizontally; a dots rail shows position.
- **Tap actions** per widget: `none` (static), `detail` (A3 overlay), `roll` (A2 overlay).
- **Edit reorder**: long-press drag within the ordered stack (not XY placement) (§8.1).
- **Size presets** S/M/L map to `cols`/`rows` spans (phone = 2 cols; store raw spans so tablet up
  to 4 cols is future-proof).
- **Autosave** on every mutation (debounced) to local storage (§7.1).
- **Graph grid** visible only in edit mode; fades in play mode (§8.3).
- All roll/detail overlays dim the sheet behind them.

## The engine (most important logic — SPEC §6)
Two kinds of math that must never mix:
- **Calc (`value.formula`)** — deterministic, auto-runs when inputs change, **no dice**, other
  values may depend on it.
- **Roll (`value.roll` / `widget.rollOverride`)** — random, runs only on tap, dice allowed,
  nothing may depend on it.
Implement as tokenizer → shunting-yard → RPN evaluator, **no `eval()`** (imported packs contain
foreign formulas). Build a dependency graph, topologically sort, cache in memory only (never
persist calc results). Cycle / parse error / unknown ref → `ERR` at that value, never a crash.
Roll returns a structured breakdown (§6.4), not just a total. Div/mod by zero → 0.

## State & data model
See SPEC §5 for the full JSON schema (Save file → Character → Value / Page / Widget / Pack) and
§15 for a canonical worked 5e fragment to load and assert against. Key state: the save-file blob
(all characters), `activeCharacterId`, current page index, play/edit mode, and the in-memory
computed-value cache.

## Design tokens (from the wireframe, apply per SPEC §8.3)
- ink `#2a2622` · paper `#efe9dd` · card `#fdfcfa` · line `#c9c0b0` · muted `#8a8377` ·
  **oxblood accent `#7a2b2b`** (also the PWA theme color, §11).
- Radius ~7–10px on fields/widgets, ~30px phone frame. Widget min-height ~64px. Grid gap ~10px.
- Type: final app should use a system-font stack (§16). The wireframe's hand-drawn font (Kalam) is
  a sketch cue only — do not ship it.

## PWA (SPEC §11)
Web app manifest (standalone, portrait, theme = oxblood), a service worker caching the app shell
for full offline use, home-screen installable, zero runtime network dependency (no CDN fonts).

## Build sequence (SPEC §Build-sequence)
1. Headless, tested kernel (value store, formula engine, dice roller, dependency/cycle resolution).
2. Read/play UI (group A) — render pages + widgets, tap actions working, read-only.
3. Persistence — local autosave + JSON export/import + non-destructive pack import (C3/C4).
4. Edit mode (group B).
5. Many characters (C1/C2).
6. PWA (manifest + service worker).
7. 5e preset polish (§10).

## Files
- `SPEC.md` — authoritative product & technical spec (build to this).
- `Parchment Wireframes.dc.html` — low-fi wireframe map, screen ids A1–C4, keyed to SPEC sections.
- `support.js` — runtime the wireframe file needs in order to render in a browser (reference only).
