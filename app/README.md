# Parchment — local build

A working local implementation of the app in `../SPEC.md`: a mobile-first,
offline PWA D&D character-sheet builder. Vanilla JS, no build step, no CDN, no
backend. Data lives in browser local storage; JSON files are the share/backup format.

## Run it

It uses ES modules + a service worker, so it must be *served* (not opened via
`file://`). From this `app/` folder:

```bash
python3 -m http.server 8777
# then open http://localhost:8777/  on your phone or desktop
```

(Any static server works — `npx serve`, etc.) Add the deep-link `?sheet=1` to
boot straight into the active character.

### Or: no server at all (`../parchment-offline.html`)

Double-click **`parchment-offline.html`** (in the project root) to run with zero
setup — it's a single self-contained file (CSS + all JS inlined). It drops the
PWA layer (offline caching + home-screen install need an http origin), but the
app itself — sheets, engine, editing, autosave, JSON export/import — works fully.

- Rebuild it after editing any module: `node build-standalone.mjs`.
- **Chrome**: works, incl. `localStorage` autosave (verified). **Safari**: may
  block `localStorage` under `file://`, so autosave/import might not persist —
  use the served version above if so.

To install as a home-screen app, serve over HTTPS or `localhost` and use the
browser's "Add to Home Screen" / install prompt.

## Try this

1. **+ New** → name it, pick **D&D 5e preset** → Create.
2. Play mode: tap an ability (⬡) to roll a check — you get the full breakdown
   `1d20 (14) + str_mod (3) = 17`, not a bare total. Tap **AC** (ⓘ) to see its
   formula. Edit a **Strength** number and watch STR Mod / AC recompute live.
3. Swipe left/right (or the tabs) between **Core / Combat / Skills**.
4. **Edit**: the graph-paper grid fades in. Drag the ⠿ handle to reorder, tap
   **Edit** on a widget to rebind/resize/set tap action, **+ Add widget** to
   bind or create a value, **+ Page** to add a page.
5. **Menu → Share & backup**: export a character / everything / a pack, or import
   a `.json`. Importing a pack into a character is non-destructive (id collisions
   get suffixed, e.g. `longsword_2`).

## Files

| File | Role |
|---|---|
| `engine.js` | The two-context math kernel (SPEC §6): tokenizer → shunting-yard → RPN. No `eval()`. Calc formulas reject dice; rolls return a breakdown. Dependency graph + cycle detection → `ERR`. |
| `engine.test.mjs` | Headless kernel tests. Run: `node engine.test.mjs` (23 assertions, incl. the §15 canonical fragment). |
| `preset.js` | The shipped 5e preset + blank-character factory. |
| `store.js` | Local autosave, JSON export (character / everything / pack), and non-destructive import. |
| `app.js` | UI: play/edit modes, widgets, roll/detail overlays, character list, value/widget editors, share/import. |
| `styles.css` | Parchment + ink + oxblood aesthetic; graph grid only in edit mode. |
| `index.html` / `manifest.webmanifest` / `sw.js` / `icon.svg` | PWA shell + offline service worker. |

## What's in vs. deferred

In (per SPEC §12): number/text/calc values, the no-`eval` cycle-safe formula
engine, dice roller with breakdown (incl. `kh`/`kl` advantage/disadvantage),
configurable widgets, multi-page swipe, full layout editing, many characters,
local autosave + JSON export/import, non-destructive pack import, the editable 5e
preset, and the installable offline PWA.

Deferred (roadmap §13): proficiency toggles (saves/skills ship as raw ability
mods), roll-into-a-value, stat-modifying magic items, skins, party view.
