// Persistence & sharing (SPEC §7). Local save-file blob + JSON export/import.
import { newId } from './preset.js';

const KEY = 'parchment.savefile.v1';
const THEME_KEY = 'parchment.theme';
export const SCHEMA_VERSION = 1;

// App appearance preference (separate from character data).
export function loadTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'parchment'; } catch { return 'parchment'; }
}
export function saveTheme(id) {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* private mode */ }
}

const ANIM_KEY = 'parchment.rollAnim';
export function loadRollAnim() {
  try { return localStorage.getItem(ANIM_KEY) !== 'off'; } catch { return true; }
}
export function saveRollAnim(on) {
  try { localStorage.setItem(ANIM_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

export function emptySave() {
  return { schemaVersion: SCHEMA_VERSION, exportedAt: null, activeCharacterId: null, characters: [] };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const data = JSON.parse(raw);
    if (!data.characters) return emptySave();
    return data;
  } catch {
    return emptySave();
  }
}

let saveTimer = null;
export function save(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Autosave failed', e);
    }
  }, 250);
}

// Immediate synchronous write — use for destructive/structural changes so a
// quick reload can't lose them (the debounced save() may not have fired yet).
export function saveNow(state) {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Save failed', e);
  }
}

// --- Export ---------------------------------------------------------------
function stamp(char) {
  const slug = (char?.name || 'parchment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${date}`;
}

export function exportCharacter(char) {
  const blob = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), activeCharacterId: char.id, characters: [char] };
  return { filename: `parchment-${stamp(char)}.json`, json: JSON.stringify(blob, null, 2) };
}

export function exportEverything(state) {
  const blob = { ...state, exportedAt: new Date().toISOString() };
  return { filename: `parchment-backup-${new Date().toISOString().slice(0, 10)}.json`, json: JSON.stringify(blob, null, 2) };
}

// A pack: values (and optionally a page). Here we export one character's
// values + all its pages as a portable layout+values pack.
export function exportPack(char, name = char.name) {
  const pack = {
    kind: 'pack',
    name,
    createdWith: 'parchment/0.1',
    values: char.values,
    pages: char.pages,
  };
  return { filename: `parchment-pack-${stamp({ name })}.json`, json: JSON.stringify(pack, null, 2) };
}

export function download(filename, json) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Import ---------------------------------------------------------------
// Returns { type, warnings, apply(state) } — apply mutates a copy and returns it.
export function analyzeImport(data) {
  if (data && data.schemaVersion && data.schemaVersion > SCHEMA_VERSION) {
    return { type: 'refused', reason: `File schema v${data.schemaVersion} is newer than this app (v${SCHEMA_VERSION}). Update the app first.` };
  }
  if (data && data.kind === 'pack') return { type: 'pack', pack: data };
  if (data && Array.isArray(data.characters)) return { type: 'savefile', save: data };
  return { type: 'invalid', reason: 'Unrecognised file — not a Parchment save file or pack.' };
}

// Import a save file: add all characters, never overwrite; reassign ids on collision.
export function importSaveFile(state, incoming) {
  const existing = new Set(state.characters.map((c) => c.id));
  const added = [];
  for (const c of incoming.characters) {
    let char = c;
    if (existing.has(c.id)) char = { ...c, id: newId('char'), name: c.name };
    existing.add(char.id);
    state.characters.push(char);
    added.push(char.id);
  }
  if (!state.activeCharacterId && added.length) state.activeCharacterId = added[0];
  return { added };
}

// Import a pack into a character, non-destructively (SPEC §7.3).
// On value-id collision, import under a suffixed id and rewrite references
// inside the pack's own formulas/rolls/widgets so it stays internally consistent.
export function importPackInto(char, pack, { mode = 'suffix', addPages = true } = {}) {
  const existing = new Set(char.values.map((v) => v.id));
  const rename = new Map();
  const incoming = [];

  for (const v of pack.values) {
    if (!existing.has(v.id)) { incoming.push(v); existing.add(v.id); continue; }
    if (mode === 'skip') continue;
    // suffix
    let i = 2, nid = `${v.id}_${i}`;
    while (existing.has(nid)) { i++; nid = `${v.id}_${i}`; }
    rename.set(v.id, nid);
    existing.add(nid);
    incoming.push({ ...v, id: nid });
  }

  const rewrite = (expr) => {
    if (!expr) return expr;
    let out = expr;
    for (const [from, to] of rename) out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    return out;
  };
  for (const v of incoming) {
    if (v.formula) v.formula = rewrite(v.formula);
    if (v.roll) v.roll = rewrite(v.roll);
  }

  char.values.push(...incoming);

  if (addPages && Array.isArray(pack.pages)) {
    for (const p of pack.pages) {
      const page = {
        id: newId('page'),
        name: p.name || 'Imported',
        widgets: (p.widgets || []).map((w) => ({
          ...w,
          id: newId('w'),
          ref: rename.get(w.ref) || w.ref,
          secondaryRef: rename.get(w.secondaryRef) || w.secondaryRef,
          rollOverride: rewrite(w.rollOverride),
        })),
      };
      char.pages.push(page);
    }
  }
  return { addedValues: incoming.length, renamed: rename.size };
}
