# Character Sheet Builder — Product & Technical Spec

**Working title:** *Parchment* (placeholder — veto anytime)
**Version:** 0.1 (scope-locked, pre-build)
**Owner:** —
**Origin:** Concept pitched by a collaborator — "a truly good D&D character sheet app" with drag-and-drop widget layouts, custom calculations, and JSON-based sharing.
**Status:** Spec approved for kernel build. No application code written yet.

---

## 1. One-paragraph summary

A mobile-first web app (installable PWA) for building and using tabletop RPG character sheets. It is **not** a hard-coded 5e sheet — it is a small generic engine that stores named **values**, computes some of them from others via **formulas**, and displays them through configurable **widgets** arranged on swipeable **pages**. It ships with a full **D&D 5e preset** so it's useful on day one, but every value, formula, widget, and layout is editable. Data lives locally in the browser (many characters supported) and is shared between players by exporting/importing **JSON files**. There is no backend, no accounts, and no hosting requirement beyond serving static files.

---

## 2. Goals & non-goals

### Goals
- Usable on a phone, offline, at the table (basement game, no signal).
- Ships knowing 5e — no blank-slate setup tax before first use.
- Generic underneath: store values, compute values from values, roll dice, bind values to widgets, arrange widgets into layouts.
- Full layout editing in v1: add / remove / reorder / resize / configure widgets and pages.
- Many characters per device.
- Share characters, layouts, and items as JSON files (Messenger / AirDrop / email — any file transport).

### Non-goals (explicitly out — see §12)
- Public app, accounts, cloud sync, or a shared marketplace.
- A polished "build any TTRPG from scratch" authoring experience (the engine is generic; the *authoring UX* is deferred).
- Magic items that automatically inject stat modifiers.
- Skins / themes.
- Freeform pixel-positioned canvas (deliberately replaced by a responsive stack — see §8).

---

## 3. Platform & constraints

| Constraint | Decision | Rationale |
|---|---|---|
| Primary target | Mobile phone (portrait) | The primary use case; the hardest layout target |
| Delivery | Web app, installable **PWA** | Home-screen install + offline at the table |
| Backend | **None** | Group tool, not a public product |
| Persistence | Browser-local + JSON export/import | No server; JSON doubles as the share format |
| Offline | Must fully function offline after first load | Service worker caches the app shell |
| Hosting | Any static host (Netlify) | Single-page app, no server code |
| Dependencies | Minimize; prefer self-contained | Runs offline, hosts trivially, ages well |

---

## 4. Core concepts (glossary)

| Term | Definition |
|---|---|
| **Save file** | The entire local dataset (all characters). Also the export/backup format. |
| **Character** | One sheet. Owns its own values and pages. |
| **Value** | A named field. Three kinds: `number`, `text`, `calc`. The single source of truth for a piece of data. |
| **Formula** | A deterministic expression on a `calc` value (e.g. `10 + dex_mod`). **No dice allowed.** |
| **Roll** | A dice expression triggered by tapping (e.g. `1d20 + str_mod`). Random. **Cannot be depended on.** |
| **Widget** | A panel on a page. Displays a value and defines what tapping it does. |
| **Page** | One swipeable layout — an ordered list of widgets. |
| **Pack** | A shareable bundle of values (and optionally a page). Used to send a character, a layout, or a single item to another player. |
| **Preset** | A named starting bundle shipped with the app. v1 ships `dnd5e`. |

---

## 5. Data model & JSON schema

This schema is simultaneously the **in-memory model**, the **local save format**, and the **share format**. One shape, three jobs. Real files are plain JSON — comments below are annotation only.

### 5.1 Save file (root object; also the export format)
```jsonc
{
  "schemaVersion": 1,
  "exportedAt": "2026-07-01T09:00:00Z",   // ISO 8601, informational
  "activeCharacterId": "char_ab12",
  "characters": [ /* Character[] */ ]
}
```

### 5.2 Character
```jsonc
{
  "id": "char_ab12",              // stable unique id
  "name": "Thordak",
  "preset": "dnd5e",              // provenance label, free-form
  "createdAt": "2026-07-01T09:00:00Z",
  "values": [ /* Value[] */ ],
  "pages":  [ /* Page[] */ ]
}
```

### 5.3 Value (single source of truth)
```jsonc
{
  "id": "str_mod",               // slug: ^[a-z][a-z0-9_]*$, unique per character, IMMUTABLE
  "label": "STR Mod",            // human display name, freely editable
  "kind": "calc",                // "number" | "text" | "calc"

  "value": 3,                    // used when kind === "number"
  "text": null,                  // used when kind === "text"
  "formula": "floor((strength - 10) / 2)", // used when kind === "calc"; NO dice

  "roll": null,                  // optional canonical dice expr for this value
  "description": "",             // optional; shown on tap-detail
  "group": "Abilities"           // optional; editor organization only, no runtime effect
}
```

**Field applicability by kind:**

| kind | uses `value` | uses `text` | uses `formula` | may set `roll` |
|---|:---:|:---:|:---:|:---:|
| `number` | ✅ | — | — | ✅ |
| `text` | — | ✅ | — | ✅ |
| `calc` | — | — | ✅ | ✅ |

`roll` is orthogonal to kind — any value can carry a canonical roll (a weapon is a `text` value with a damage `roll`; an ability score is a `number` value with a check `roll`).

### 5.4 Page (a layout)
```jsonc
{
  "id": "page_core",
  "name": "Core",
  "widgets": [ /* Widget[] */ ]  // array order = reading order in the stack
}
```

### 5.5 Widget (display + tap)
```jsonc
{
  "id": "w_str",
  "kind": "bound",               // "bound" (to a value) | "label" (static header/divider)

  "ref": "str_mod",              // primary value id (required when kind === "bound")
  "secondaryRef": "strength",    // optional smaller secondary value shown alongside

  "cols": 1,                     // grid span: 1..2 (phone), up to 4 (tablet). See §8.
  "rows": 1,                     // vertical span; >1 for lists / notes

  "tap": "roll",                 // "none" | "detail" | "roll"
  "rollOverride": "1d20 + str_mod", // if set, used for the roll; else falls back to ref's `roll`

  "title": null                  // display override; for kind:"label", this IS the text
}
```

### 5.6 Pack (shareable bundle)
```jsonc
{
  "kind": "pack",
  "name": "Flametongue Longsword",
  "createdWith": "parchment/0.1",
  "values": [ /* Value[] */ ],   // the item's stats + rolls
  "pages":  [ /* Page[] */ ]     // optional: a whole importable layout
}
```

A pack is deliberately a subset of a character. Exporting a whole character = a save file with one character; exporting one item or one layout = a pack. Import rules in §7.3.

---

## 6. The two-context math system

The engine has **two kinds of math that must never mix.** This is the single most important architectural rule in the spec.

| | **Calc (formula)** | **Roll** |
|---|---|---|
| Lives in | `value.formula` | `value.roll` / `widget.rollOverride` |
| Runs | Automatically, whenever inputs change | Only when the user taps |
| Result | Deterministic (identical every time) | Random (different every tap) |
| Dice allowed? | ❌ Never | ✅ Yes |
| Can other values depend on it? | ✅ Yes | ❌ No |
| Example | `AC = 10 + dex_mod` | `1d20 + dex_mod` |

**The wall:** dice tokens (`NdM`) are a parse error inside a `formula` and legal inside a `roll`. Letting a random value into the deterministic graph would make computed values silently reroll on every redraw — so the grammar itself forbids it.

### 6.1 Shared grammar (both contexts)
- **Numbers:** integers and decimals (`3`, `1.5`).
- **Value references:** bare value ids (`str_mod`, `level`).
- **Operators:** `+ - * / %`, unary minus, parentheses. Standard precedence.
- **Functions:** `floor` `ceil` `round` `abs` `sign` `min` `max` `clamp`.
  - `min`/`max` are variadic; `clamp(x, lo, hi)`.
- **Division/modulo by zero → 0** (no crashes at the table).

### 6.2 Roll-only grammar (adds one primitive)
- **Dice:** `NdM` → roll N dice of M sides (`1d20`, `2d6`, `3d8`).
- Combine freely with the shared grammar: `1d20 + str_mod + proficiency_bonus`, `2d6 + 3`.
- A roll returns a **breakdown**, not just a total (see §6.4).

**Advantage/disadvantage** (`2d20` keep-highest/lowest) is a *strongly recommended v1 stretch*, not core v1. It's cheap once the dice primitive exists — reserve grammar `kh`/`kl` (keep-highest / keep-lowest), e.g. `2d20kh1 + dex_mod`. Flag: shipping 5e without advantage feels incomplete, so pull it forward if the dice primitive lands clean.

### 6.3 Evaluation model (calc)
1. On load / edit, parse every `calc` formula and extract its value-id references.
2. Build a dependency graph; **topologically sort** it.
3. Evaluate in dependency order; cache results in memory only (never persisted).
4. On any edit to a `number`/`text` value, recompute only the affected downstream calcs.

**Error handling:**
- **Cycle** (e.g. `a` depends on `b` depends on `a`) → every value in the cycle displays `ERR`; tap-detail explains the cycle.
- **Parse error / unknown reference** → the value displays `ERR`; tap-detail shows the message. Never throw to a blank screen.

### 6.4 Roll result shape
A roll evaluates to a structured breakdown so the UI shows *how* the number happened:
```jsonc
{
  "total": 17,
  "parts": [
    { "label": "1d20", "rolls": [14], "value": 14 },
    { "label": "str_mod", "value": 3 }
  ]
}
```
Display target: `1d20 (14) + str_mod (3) = 17`. Transparency is the entire point of a dice widget — a bare `17` is useless.

### 6.5 Engine implementation notes (prototyped)
Tokenizer → shunting-yard → RPN evaluator. No `eval()`, ever — both for safety (imported packs contain formulas from other people) and correctness. Unary minus handled by previous-token lookahead; functions handled via an argument counter on paren-close. The deterministic core has been prototyped and validated in isolation; the roll context adds only the `NdM` token and the breakdown return shape.

---

## 7. Persistence & sharing

### 7.1 Local storage
- All characters autosave to browser-local storage as one save-file blob.
- Autosave on every mutation (debounced).
- **Known caveat, surfaced in-app:** clearing browser data / site data wipes local storage. JSON export is the backup story — the app should nudge periodic exports and never pretend local storage is permanent.

### 7.2 Export
- **Export character** → a save file containing that one character.
- **Export all** → the full save file (backup / device migration).
- **Export pack** → a pack (one item, or a layout, or a hand-picked set of values).
- Filenames: `parchment-<charname>-<date>.json` etc. Human-legible.

### 7.3 Import & conflict rules
- Importing a **save file** with multiple characters → adds them all; never overwrites existing characters (new ids assigned on collision).
- Importing a **pack** → **non-destructive by default.** On value-id collision, import under a suffixed id (`longsword_2`) and let the user reconcile. Never silently overwrite a player's existing value with an incoming one.
- Schema-version check on import: if `schemaVersion` is newer than the app supports, warn and refuse rather than corrupt.

---

## 8. Layout & the responsive stack (NOT a freeform canvas)

The original mental model was "drag widgets anywhere on a canvas." On a phone that's the worst UX in the app (tiny targets, pinch-zoom fights) and the most expensive to build. **Replaced by a responsive widget stack** — same "build your own layout" feeling, none of the touch-drag misery. This is how iOS widgets and Notion mobile work.

### 8.1 Model
- A page is an **ordered list of widgets** flowing top-to-bottom in a responsive grid.
- Phone grid = 2 columns. Each widget spans `cols` (1–2) and `rows` (1+).
- Editor exposes **S / M / L** size presets that map to spans (S = 1 col, M = full-width `cols:2`, L = full-width taller). Raw `cols`/`rows` are stored so tablet (up to 4 cols) is future-proof.
- **Reorder** by long-press drag within the stack (reordering an ordered list — robust on touch, unlike XY placement).
- **Pages** swipe left/right; a page rail / dots indicator shows position.

### 8.2 Editing model (v1 — full editing is in scope)
Edit mode vs. play mode toggle. In edit mode the user can:
- Add a page, rename it, delete it, reorder pages.
- Add a widget → pick an existing value to bind, or create a new value inline.
- Configure a widget: choose `ref` / `secondaryRef`, set size (S/M/L), set `tap` (none/detail/roll), set `rollOverride`.
- Reorder and resize widgets.
- Edit the underlying values: rename `label`, change `kind`, edit `formula` / `roll`, edit `description`.

Creating brand-new value *systems* from scratch is *possible* (nothing blocks it) but the authoring UX stays deliberately rough in v1 — see §12.

### 8.3 Signature interaction (design)
Aesthetic brief: "mimic the paper sheet design." Direction: **aged parchment + ink + a single oxblood accent.** The signature element is a faint **graph-paper grid** that appears only in edit mode (widgets read as index cards being placed on the sheet) and fades away in play mode. Bold in one place; quiet everywhere else.

---

## 9. Widget behaviour (display + tap)

A widget is **a display face + an optional tap action** — two independent axes, mixed freely. This replaces discrete "widget types" with one configurable panel.

**Display face** (derived from the bound value's `kind`):
- `text` → shows the stored string.
- `number` → shows the stored number, editable inline (tap-hold or an edit affordance in play mode).
- `calc` → shows the computed number, read-only, auto-updating.

**Tap action** (`widget.tap`):
- `none` → static display.
- `detail` → expands to show `description` and, for `calc`, the derived breakdown (`10 + dex_mod = 15`).
- `roll` → evaluates `rollOverride` if set, else the bound value's `roll`; shows the roll breakdown (§6.4).

**Roll inheritance rule:** widget uses `rollOverride` if present, else the bound value's `roll`. This lets one value be shown two ways — e.g. an ability score value carries no roll, but its widget overrides `tap:roll` with `1d20 + str_mod` (a check), while a weapon value bakes in `1d8 + str_mod` (damage) that its widget simply inherits.

**Worked widget examples:**

| Widget | Bound value kind | Displays | Tap does |
|---|---|---|---|
| Strength (16) | number | the score | roll `1d20 + str_mod` (override) |
| STR Mod (+3) | calc | computed mod | detail: `floor((16-10)/2)` |
| Armor Class (15) | calc | computed AC | detail: `10 + dex_mod` |
| Longsword | text | "Longsword" | roll `1d8 + str_mod` (inherited) |
| Character name | text | the name | none |

---

## 10. The 5e default preset (`dnd5e`)

Ships pre-loaded so a new character is immediately usable. Fully editable after creation. Minimum contents for v1:

**Values**
- 6 ability scores (`strength`…`charisma`, `number`, default 10).
- 6 ability modifiers (`str_mod`…`cha_mod`, `calc`: `floor((<score> - 10) / 2)`).
- `level` (`number`), `proficiency_bonus` (`calc`: `2 + floor((level - 1) / 4)`).
- `armor_class` (`calc`: `10 + dex_mod`), `initiative` (`calc`: `dex_mod`).
- `hp_current` (`number`), `hp_max` (`number`).
- 6 saving throws (`calc`: `<ability>_mod`, with proficiency toggled in later — see below).
- A representative set of skills (`calc`: `<ability>_mod`), not necessarily all 18 in v1.
- 1–2 example weapons (`text` + damage `roll`) to demonstrate the roll model.

**Pages**
- **Core** — name, class, level, ability scores + mods, proficiency, AC, HP, initiative.
- **Combat** — AC, HP (current/max), initiative, saving throws, attacks.
- **Skills** — the skill values.

**Deferred within 5e (not v1):** proficiency-toggle machinery for saves/skills (needs a boolean value kind + conditional formula, or a `proficient ? bonus : 0` pattern). Ship saves/skills as raw ability mods in v1; layer proficiency in v1.1. Flag: 5e players will expect proficiency — this is the most likely "feels incomplete" gap, second only to advantage.

---

## 11. PWA requirements

- Web app manifest (name, icons, `display: standalone`, portrait orientation, theme color = the oxblood accent).
- Service worker caching the app shell for full offline use after first load.
- Installable to home screen on iOS/Android.
- No network dependency at runtime (no CDN fonts, no external calls) — everything self-contained so a basement game with no signal works.

---

## 12. MVP scope — in vs. out

| ✅ In v1 | ⛔ Deferred |
|---|---|
| `number` / `text` / `calc` values | Polished "build any TTRPG" authoring UX |
| Formula engine (no-`eval`, cycle-safe) | Magic items that auto-modify other stats |
| Dice roller with breakdown | Skins / themes |
| Configurable widget (display + tap) | Freeform XY canvas |
| `none` / `detail` / `roll` tap actions | YAML support |
| Multi-page swipeable layouts | Multi-character combat / initiative tracker |
| **Full layout editing** (add/remove/reorder/resize/configure) | Cloud sync / accounts / marketplace |
| Many characters | Roll-into-a-value (level-up HP capture) |
| Local storage autosave + JSON export/import | Proficiency toggles for saves/skills |
| Non-destructive pack import | Advantage/disadvantage *(stretch — pull forward if cheap)* |
| 5e preset (editable) | |
| PWA (installable, offline) | |

---

## 13. Roadmap (post-v1, in rough priority order)

1. **Advantage/disadvantage** (`kh`/`kl` dice) — if not already pulled into v1.
2. **Proficiency toggles** — boolean value kind + conditional formula; completes 5e saves/skills.
3. **Roll-into-a-value** — a 4th tap action that writes a roll result once into a stored value (level-up HP). Adds a tap type; touches nothing else.
4. **Magic items that modify stats** — items as packs whose values are *referenced* by formulas; schema already supports it, no migration.
5. **System-builder authoring UX** — make defining brand-new value systems pleasant, not just possible.
6. **Skins / themes.**
7. **Multi-character switcher polish / party view.**

Design test this spec is built to pass: **nothing on the roadmap requires a schema change.** New tap types, item modifiers, and shared layouts all fit the existing Value / Widget / Page / Pack shapes.

---

## 14. Decision log (why things are the way they are)

| Decision | Rationale |
|---|---|
| Group tool, JSON sharing, no backend | Deletes auth, hosting, moderation, and formula-sandboxing-against-attackers — the scariest half of the project |
| Blank-canvas engine, 5e preset loaded | 5e *needs* computed values anyway, so generic ≈ same cost as 5e-only; blank slate alone is useless day one |
| Responsive stack, not freeform canvas | Freeform XY is the worst mobile UX and the biggest time sink; stack keeps the spirit, kills the pain |
| Two-context math wall | A random number in the deterministic graph makes computed values reroll on redraw — grammar forbids it |
| Value ids are immutable slugs | Formulas reference ids; renaming should relabel `label`, not break every dependent formula |
| Non-destructive pack import | Never silently overwrite a player's item with an incoming one |
| calc results never persisted | Portable JSON, no stale cached AC in a shared file; always recompute on load |
| Widget `rollOverride` else value `roll` | Lets one value be shown two ways (ability check vs. weapon damage) without duplicating data |
| localStorage + mandatory JSON export | Local storage is wipeable; JSON export is both backup and share format |

---

## 15. Worked example (canonical 5e fragment)

```jsonc
{
  "schemaVersion": 1,
  "activeCharacterId": "char_ab12",
  "characters": [{
    "id": "char_ab12",
    "name": "Thordak",
    "preset": "dnd5e",
    "values": [
      { "id": "strength", "label": "Strength", "kind": "number", "value": 16, "group": "Abilities" },
      { "id": "dexterity", "label": "Dexterity", "kind": "number", "value": 14, "group": "Abilities" },
      { "id": "str_mod", "label": "STR Mod", "kind": "calc", "formula": "floor((strength - 10) / 2)" },
      { "id": "dex_mod", "label": "DEX Mod", "kind": "calc", "formula": "floor((dexterity - 10) / 2)" },
      { "id": "level", "label": "Level", "kind": "number", "value": 3 },
      { "id": "proficiency_bonus", "label": "Prof", "kind": "calc", "formula": "2 + floor((level - 1) / 4)" },
      { "id": "armor_class", "label": "AC", "kind": "calc", "formula": "10 + dex_mod" },
      { "id": "initiative", "label": "Initiative", "kind": "calc", "formula": "dex_mod" },
      { "id": "hp_current", "label": "HP", "kind": "number", "value": 24 },
      { "id": "hp_max", "label": "Max HP", "kind": "number", "value": 24 },
      { "id": "longsword", "label": "Longsword", "kind": "text", "text": "Longsword",
        "roll": "1d8 + str_mod", "description": "Versatile (1d10)" }
    ],
    "pages": [{
      "id": "page_core",
      "name": "Core",
      "widgets": [
        { "id": "w_name", "kind": "bound", "ref": "longsword", "cols": 2, "tap": "detail" },
        { "id": "w_str", "kind": "bound", "ref": "str_mod", "secondaryRef": "strength",
          "cols": 1, "tap": "roll", "rollOverride": "1d20 + str_mod" },
        { "id": "w_dex", "kind": "bound", "ref": "dex_mod", "secondaryRef": "dexterity",
          "cols": 1, "tap": "roll", "rollOverride": "1d20 + dex_mod" },
        { "id": "w_ac", "kind": "bound", "ref": "armor_class", "cols": 1, "tap": "detail" },
        { "id": "w_init", "kind": "bound", "ref": "initiative", "cols": 1, "tap": "roll",
          "rollOverride": "1d20 + initiative" },
        { "id": "w_hp", "kind": "bound", "ref": "hp_current", "secondaryRef": "hp_max",
          "cols": 2, "tap": "none" },
        { "id": "w_sword", "kind": "bound", "ref": "longsword", "cols": 2, "tap": "roll" }
      ]
    }]
  }]
}
```

---

## 16. Recommended tech stack (for the build)

| Concern | Recommendation | Note |
|---|---|---|
| App type | Single-page web app, PWA | Static, offline, home-screen installable |
| Framework | Light — vanilla or a small framework | Minimize deps for offline + longevity; your call at build time |
| Fonts | System font stack | Self-contained, no CDN, works offline |
| Storage | Browser-local + JSON files | No server |
| Engine | Prototyped no-`eval` formula/dice kernel | Build headless + tested first |
| Hosting | Netlify (static) | Matches your existing workflow |

---

## 17. Open questions (nothing blocking — defaults noted)

1. **Name.** "Parchment" is a placeholder. Veto / replace anytime.
2. **Advantage in v1?** Default: stretch goal — pull into v1 if the dice primitive lands clean, since 5e leans on it constantly.
3. **How many skills in the 5e preset?** Default: a representative subset in v1, full 18 once proficiency toggles land.

---

## Build sequence (proposed, for when we start)

1. **Kernel, headless + tested** — value store, formula engine, dice roller, dependency/cycle resolution. Load the §15 example, assert computed values, sample rolls. *(Formula core already prototyped.)*
2. **Read/play UI** — render one character's pages + widgets; tap actions (detail, roll) working. Read-only.
3. **Persistence** — local autosave + JSON export/import + non-destructive pack import.
4. **Edit mode** — add/reorder/resize/configure widgets and pages; edit values/formulas/rolls.
5. **Many characters** — character list, switch, create, delete.
6. **PWA** — manifest + service worker + offline.
7. **5e preset polish** — fill out the shipped values/pages.

Each step is independently testable; the kernel is the only piece with hard logic risk, and it goes first.
