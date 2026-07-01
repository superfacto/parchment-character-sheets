// Parchment — app shell & UI (SPEC groups A/B/C). Vanilla JS, no framework.
import { computeAll, evalRoll, previewRoll } from './engine.js';
import { dnd5eCharacter, blankCharacter, newId } from './preset.js';
import * as store from './store.js';

// --- tiny DOM helper -------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(c));
  return node;
}
const $ = (sel) => document.querySelector(sel);

// --- state -----------------------------------------------------------------
const state = {
  save: store.load(),
  view: 'home',        // 'home' | 'sheet'
  mode: 'play',        // 'play' | 'edit'
  pageIndex: 0,
  overlay: null,       // { type, ... }
  toast: null,
  resizing: null,      // widget id currently in drag-to-resize mode
  theme: store.loadTheme(),
  rollAnim: store.loadRollAnim(),
  rollLog: [],
};

// Selectable colour schemes. sw = [paper, ink, accent] for the picker preview.
const THEMES = [
  { id: 'parchment', name: '5e Sheet', sw: ['#ece3cf', '#221c12', '#7a2b2b'] },
  { id: 'midnight',  name: 'Midnight',  sw: ['#221d19', '#ece6da', '#d0704a'] },
  { id: 'forest',    name: 'Forest',    sw: ['#e7ece0', '#212a1d', '#436f3c'] },
  { id: 'ocean',     name: 'Ocean',     sw: ['#e5ecf0', '#1c2530', '#256b7a'] },
  { id: 'rose',      name: 'Rose',      sw: ['#f3e8eb', '#2c2125', '#a63b5e'] },
];
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  if (t.id === 'parchment') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t.id;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = t.sw[2];   // accent drives the browser UI colour
}

function activeChar() {
  return state.save.characters.find((c) => c.id === state.save.activeCharacterId) || null;
}
function commit() {
  store.save(state.save);
  render();
}
// Like commit(), but writes synchronously — for deletes and other destructive
// changes that must survive an immediate reload.
function commitNow() {
  store.saveNow(state.save);
  render();
}
function toast(msg) {
  state.toast = msg;
  render();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { state.toast = null; render(); }, 1800);
}

// Computed-value cache for the active character (recomputed each render; the
// kernel is fast and calc results are never persisted — SPEC §6.3).
let computed = { results: new Map(), details: new Map() };
function recompute() {
  const c = activeChar();
  computed = c ? computeAll(c.values) : { results: new Map(), details: new Map() };
}
function valueById(id) { return activeChar()?.values.find((v) => v.id === id); }

// A value's rolls, normalised to [{name, expr}]. Supports the multi-roll
// `rolls` array (weapons: Attack + Damage), the legacy single `roll` string,
// and a widget-level `rollOverride` when the value itself carries no roll.
function rollsFor(v, w) {
  if (v?.rolls?.length) return v.rolls.filter((r) => r && r.expr);
  if (v?.roll) return [{ name: '', expr: v.roll }];
  if (w?.rollOverride) return [{ name: '', expr: w.rollOverride }];
  return [];
}
// resolve used by previewRoll: numeric computed values only, else bail to dice-only.
function rollResolve(name) {
  const r = computed.results.get(name);
  if (typeof r === 'number') return r;
  throw new Error(`bad ref ${name}`);
}
// Sensible defaults when binding a new widget to a value: rollable/calc values
// open the detail panel; a weapon (text + rolls) goes full-width.
function newBoundWidget(v) {
  const hasRolls = !!(v.rolls?.length || v.roll);
  const isWeapon = v.kind === 'text' && hasRolls;
  return { id: newId('w'), kind: 'bound', ref: v.id, cols: isWeapon ? 2 : 1, rows: 1, tap: (hasRolls || v.kind === 'calc') ? 'detail' : 'none' };
}
// Scaffold a "weapon" value (text + Attack/Damage rolls) and a full-width widget.
function addWeapon(page) {
  const c = activeChar();
  const name = prompt('Weapon name?', 'Longsword');
  if (name == null) return;
  const nm = name.trim() || 'Weapon';
  const base = (nm.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')) || 'weapon';
  let id = base, i = 2;
  while (c.values.some((x) => x.id === id)) id = `${base}_${i++}`;
  const abilityMod = c.values.some((x) => x.id === 'str_mod') ? 'str_mod' : '0';
  const prof = c.values.some((x) => x.id === 'proficiency_bonus') ? ' + proficiency_bonus' : '';
  const val = {
    id, label: nm, kind: 'text', text: nm, description: '', group: 'Attacks',
    rolls: [{ name: 'Attack', expr: `1d20 + ${abilityMod}${prof}` }, { name: 'Damage', expr: `1d8 + ${abilityMod}` }],
  };
  c.values.push(val);
  page.widgets.push(newBoundWidget(val));
  commit();
  openValueEditor(val); // open so the dice/ability can be tweaked immediately
}

// --- render dispatch -------------------------------------------------------
function render() {
  recompute();
  if (state.mode !== 'edit') state.resizing = null;
  const app = $('#app');
  app.innerHTML = '';
  // Overlays/toasts live on <body>, not inside #app — clear the stale ones so
  // closing an overlay actually removes it (and re-renders don't stack copies).
  document.querySelectorAll('body > .scrim, body > .toast').forEach((n) => n.remove());
  const frame = el('div', { class: `frame ${state.mode === 'edit' && state.view === 'sheet' ? 'edit' : ''}` });
  if (state.view === 'home' || !activeChar()) frame.append(renderHome());
  else frame.append(...renderSheet());
  app.append(frame);
  if (state.overlay) {
    const ov = renderOverlay();
    // Only play the rise/fade entrance on first mount — re-renders (typing in a
    // field, tapping builder chips) must not replay it and flicker.
    if (state._overlayMounted) ov.classList.add('no-anim');
    state._overlayMounted = true;
    document.body.append(ov);
  } else {
    state._overlayMounted = false;
  }
  if (state.toast) document.body.append(el('div', { class: 'toast', text: state.toast }));
}

// ======================================================================= HOME
function renderHome() {
  const wrap = el('div', { class: 'home' });
  wrap.append(el('div', { class: 'home-hd' }, [
    el('div', {}, [
      el('h1', { text: 'Parchment' }),
      el('p', { class: 'tagline', text: 'Your character sheets — on paper, offline.' }),
    ]),
    el('button', { class: 'iconbtn', title: 'Appearance', onclick: openThemePicker }, '🎨'),
  ]));
  wrap.append(el('div', { class: 'warnbanner' }, [
    el('span', { text: '⚠' }),
    el('span', { text: 'Characters live only in this browser. Clearing site data erases them — export a JSON backup to keep them safe.' }),
  ]));

  if (!state.save.characters.length) {
    wrap.append(el('div', { class: 'empty', text: 'No characters yet. Tap + New to begin.' }));
  }
  for (const c of state.save.characters) {
    const active = c.id === state.save.activeCharacterId;
    const level = c.values.find((v) => v.id === 'level')?.value;
    const row = el('div', { class: `charrow ${active ? 'active' : ''}`, onclick: () => openCharacter(c.id) }, [
      el('div', { class: 'activedot' }),
      el('div', { class: 'cmeta' }, [
        el('div', { class: 'cname', text: c.name }),
        el('div', { class: 'csub' }, [
          el('span', { class: 'pill', text: c.preset || 'custom' }),
          level != null ? el('span', { text: `  Level ${level}` }) : null,
        ]),
      ]),
      el('button', { class: 'rowdel', title: `Delete ${c.name}`, onclick: (e) => { e.stopPropagation(); confirmDeleteCharacter(c); } }, '🗑'),
      el('div', { class: 'cgo', text: '›' }),
    ]);
    wrap.append(row);
  }

  wrap.append(el('div', { style: 'display:flex;gap:10px;margin-top:16px' }, [
    el('button', { class: 'btn ghost', onclick: openShare, text: '↥ Share / Backup' }),
    el('button', { class: 'btn ghost', onclick: openPrivacy, text: '🔒 Privacy' }),
  ]));

  const container = el('div', { style: 'position:relative;flex:1;display:flex;flex-direction:column;overflow:hidden' }, [wrap]);
  container.append(el('button', { class: 'fab', text: '+ New', onclick: openNewCharacter }));
  return container;
}

function openCharacter(id) {
  state.save.activeCharacterId = id;
  state.view = 'sheet';
  state.pageIndex = 0;
  state.mode = 'play';
  commit();
}

// ====================================================================== SHEET
function renderSheet() {
  const c = activeChar();
  const page = c.pages[Math.min(state.pageIndex, c.pages.length - 1)] || c.pages[0];

  // App bar
  const appbar = el('div', { class: 'appbar' }, [
    el('button', { class: 'iconbtn', text: '☰', onclick: openMenu }),
    el('div', { class: 'name' }, [c.name, el('span', { class: 'sub', text: c.preset || 'custom' })]),
    el('div', { class: 'toggle' }, [
      el('button', { class: state.mode === 'play' ? 'on' : '', text: 'Play', onclick: () => { state.mode = 'play'; render(); } }),
      el('button', { class: state.mode === 'edit' ? 'on' : '', text: 'Edit', onclick: () => { state.mode = 'edit'; render(); } }),
    ]),
  ]);

  // Page tabs
  const pagebar = el('div', { class: 'pagebar' });
  c.pages.forEach((p, i) => {
    pagebar.append(el('button', {
      // In edit mode, tapping the active tab opens page options (rename/move/delete).
      class: `tab ${i === state.pageIndex ? 'on' : ''} ${state.mode === 'edit' && i === state.pageIndex ? 'editable' : ''}`,
      text: p.name,
      onclick: () => { if (state.mode === 'edit' && i === state.pageIndex) openPageOptions(p, i); else { state.pageIndex = i; render(); } },
    }));
  });
  if (state.mode === 'edit') pagebar.append(el('button', { class: 'tab add', text: '+ Page', onclick: addPage }));

  // Sheet body
  const sheet = el('div', { class: 'sheet' });
  const grid = el('div', { class: 'grid' });
  page.widgets.forEach((w, i) => grid.append(renderWidget(w, i, page)));
  if (state.mode === 'edit') grid.append(el('button', { class: 'addtile', text: '+ Add widget', onclick: () => openAddWidget(page) }));
  sheet.append(grid);

  // Dots indicator
  if (c.pages.length > 1) {
    const dots = el('div', { class: 'dots' });
    c.pages.forEach((_, i) => dots.append(el('div', { class: `dot ${i === state.pageIndex ? 'on' : ''}` })));
    sheet.append(dots);
  }

  enableSwipe(sheet, c.pages.length);

  // One-time hint so the tap-to-detail/roll markers are discoverable.
  if (state.mode === 'play' && !store.getFlag('rollhint')) {
    store.setFlag('rollhint');
    setTimeout(() => toast('Tap any card for details & to roll 🎲 · swipe for pages · Edit to rearrange'), 500);
  }
  return [appbar, pagebar, sheet];
}

function renderWidget(w, index, page) {
  const editing = state.mode === 'edit';
  const play = state.mode === 'play';

  if (w.kind === 'label') {
    const node = el('div', { class: 'wdg label' }, [el('div', { class: 'lbl', text: w.title || 'Section' })]);
    setSpan(node, w);
    if (editing) decorateEdit(node, w, index, page);
    return node;
  }

  const v = valueById(w.ref);
  const node = el('div', { class: 'wdg' });
  setSpan(node, w);

  if (!v) {
    node.append(el('div', { class: 'wl', text: w.ref || '—' }), el('div', { class: 'wv err', text: 'ERR' }));
    if (editing) decorateEdit(node, w, index, page);
    return node;
  }

  const label = w.title || v.label;
  node.append(el('div', { class: 'wl', text: label }));

  const rolls = rollsFor(v, w);
  // In play mode a widget is either directly editable (opt-in per widget) or a
  // clean read-only face you tap to open Details. Editing lives behind the
  // "editable in play" tick; everything else opens Details (rolls live there).
  const editableFace = play && w.editableInPlay;
  const weaponFace = v.kind === 'text' && rolls.length && play && !editableFace;
  let tappable = play;   // read-only faces open Details on tap

  if (w.face === 'stat' && play) {
    // Classic 5e ability box: big modifier (hero) over the score.
    node.classList.add('statface');
    const mod = valueById(w.secondaryRef);
    node.append(el('div', { class: `statmod ${mod && displayValue(mod) === 'ERR' ? 'err' : ''}`, text: mod ? displayValue(mod) : '—' }));
    if (editableFace) {
      const pill = el('button', { class: 'statscore', title: 'Edit score' }, String(v.value ?? 0));
      pill.addEventListener('click', (e) => { e.stopPropagation(); editInline(pill, v, 'number'); });
      node.append(pill);
    } else {
      node.append(el('div', { class: 'statscore static', text: String(v.value ?? 0) }));
    }
    // The whole card still opens Details (to roll the check).
  } else if (editableFace && v.kind === 'number') {
    // Directly editable number with a −/+ stepper (HP-style quick adjust).
    node.classList.add('num'); tappable = false;
    const input = el('input', {
      type: 'number', value: v.value ?? 0, inputmode: 'numeric',
      onchange: (e) => { v.value = e.target.value === '' ? 0 : Number(e.target.value); commit(); },
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    const step = (d) => (e) => { e.stopPropagation(); v.value = (Number(v.value) || 0) + d; commit(); };
    node.append(el('div', { class: 'steprow' }, [
      el('button', { class: 'step', text: '−', onclick: step(-1) }), input,
      el('button', { class: 'step', text: '+', onclick: step(1) }),
    ]));
  } else if (editableFace && v.kind === 'text') {
    tappable = false;
    if ((w.rows || 2) >= 4) {
      const ta = el('textarea', { rows: Math.max(2, Math.round((w.rows || 4) / 2) * 2), oninput: (e) => { v.text = e.target.value; store.save(state.save); } }, []);
      ta.value = v.text || '';
      ta.addEventListener('click', (e) => e.stopPropagation());
      node.append(ta);
    } else {
      const inp = el('input', { class: 'inlinetext-live', value: v.text || '', oninput: (e) => { v.text = e.target.value; store.save(state.save); } });
      inp.addEventListener('click', (e) => e.stopPropagation());
      node.append(inp);
    }
  } else if (weaponFace) {
    // A weapon/item shows a computed roll summary — "1d20 + 5" / "1d8 + 3".
    const rows = el('div', { class: 'rollrows' });
    rolls.forEach((r) => rows.append(el('div', { class: 'rollrow' }, [
      el('span', { class: 'rn', text: r.name || 'Roll' }),
      el('span', { class: 'rp', text: previewRoll(r.expr, rollResolve) }),
    ])));
    node.append(rows);
  } else {
    const disp = displayValue(v);
    node.append(el('div', { class: `wv ${v.kind === 'text' ? 'text' : ''} ${disp === 'ERR' ? 'err' : ''}`, text: disp }));
  }

  if (w.secondaryRef && w.face !== 'stat' && !weaponFace) {
    const s = valueById(w.secondaryRef);
    if (s) node.append(el('div', { class: 'ws', text: `${s.label}: ${displayValue(s)}` }));
  }

  // Proficiency dot (official-sheet style): a fillable circle wired to a boolean
  // value. Tapping it in play mode toggles proficiency, which re-derives the mod.
  if (play && w.profRef) {
    const profV = valueById(w.profRef);
    if (profV && profV.kind === 'bool') {
      node.classList.add('has-prof');
      const dot = el('button', { class: `profdot ${profV.value ? 'on' : ''}`, title: profV.value ? 'Proficient — tap to clear' : 'Not proficient — tap to add', 'aria-pressed': String(!!profV.value) });
      dot.addEventListener('click', (e) => { e.stopPropagation(); profV.value = !profV.value; commit(); });
      node.append(dot);
    }
  }

  if (tappable) {
    node.append(el('div', { class: 'marker', text: rolls.length ? '🎲' : 'ⓘ' }));
    node.classList.add('tappable');
    node.addEventListener('click', () => openDetail(v, label, rolls));
  }

  if (editing) decorateEdit(node, w, index, page);
  return node;
}

// Place a widget on the 4-column fine grid. Columns 1–4 (1 = half of old
// "small"); rows are a growable floor so tall faces never clip. Labels keep
// their natural height.
function setSpan(node, w) {
  node.style.gridColumn = `span ${Math.max(1, Math.min(4, w.cols || 2))}`;
  if (w.kind !== 'label') node.style.gridRow = `span ${Math.max(1, w.rows || 2)}`;
}

// Format a number the 5e way when the value is flagged `signed`: +3 / +0 / −1.
function signedStr(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }
function displayValue(v) {
  let out;
  if (v.kind === 'calc') { const r = computed.results.get(v.id); out = r === undefined ? 'ERR' : r; }
  else if (v.kind === 'text') return v.text || '—';
  else if (v.kind === 'bool') return v.value ? 'Yes' : 'No';
  else out = v.value ?? 0;
  if (out === 'ERR') return 'ERR';
  if (v.signed && typeof out === 'number') return signedStr(out);
  return String(out);
}

// Swap a read-only face for an inline editor (number or single-line text).
function editInline(targetEl, v, kind = 'number') {
  if (!targetEl) return;
  const input = el('input', { class: kind === 'number' ? 'inlinenum' : 'inlinetext' });
  if (kind === 'number') { input.type = 'number'; input.inputMode = 'numeric'; input.value = v.value ?? 0; }
  else { input.type = 'text'; input.value = v.text || ''; }
  targetEl.replaceWith(input);
  input.focus(); input.select();
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  input.addEventListener('blur', () => {
    if (kind === 'number') v.value = input.value === '' ? 0 : Number(input.value);
    else v.text = input.value;
    commit();
  }, { once: true });
}

// --- edit-mode widget chrome ----------------------------------------------
// Move handle sits centered over the card; a gear (top-right) opens config and a
// resize icon (bottom-right) toggles drag-to-resize. Size lives on the card, not
// in a menu.
function decorateEdit(node, w, index, page) {
  node.classList.add('editing');
  node.classList.remove('num');
  const resizing = state.resizing === w.id;
  if (resizing) node.classList.add('resizing');

  const handle = el('div', { class: 'drag center', text: '✥', title: 'Drag to move' });
  node.append(handle);
  enableDragReorder(node, handle, index, page);

  node.append(el('button', { class: 'wbtn cfg', text: '⚙', title: 'Configure', onclick: (e) => { e.stopPropagation(); openWidgetConfig(w, page); } }));

  const rz = el('button', { class: `wbtn rz ${resizing ? 'on' : ''}`, text: '⤡', title: 'Resize', onclick: (e) => { e.stopPropagation(); state.resizing = resizing ? null : w.id; render(); } });
  node.append(rz);
  if (resizing) {
    const grip = el('div', { class: 'resizegrip', title: 'Drag to resize' });
    node.append(grip);
    enableResize(node, grip, w);
  }
}

// Drag the bottom-right grip to resize; spans snap to whole grid cells (4 cols
// wide, a growable row unit tall). Live-preview via inline style, commit on drop.
function enableResize(node, grip, w) {
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const grid = node.closest('.grid');
    const gap = 10;
    const colUnit = (grid.getBoundingClientRect().width - gap * 3) / 4 + gap; // colW + gap
    const rowUnit = 40 + gap;                                                 // auto-row floor + gap
    const rect = node.getBoundingClientRect();
    let cols = w.cols || 2, rows = w.rows || 2;
    const move = (ev) => {
      cols = Math.max(1, Math.min(4, Math.round((ev.clientX - rect.left + gap) / colUnit)));
      rows = Math.max(1, Math.min(16, Math.round((ev.clientY - rect.top + gap) / rowUnit)));
      node.style.gridColumn = `span ${cols}`;
      node.style.gridRow = `span ${rows}`;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      w.cols = cols; w.rows = rows; commit();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

// --- pointer-based drag reorder (works on touch + mouse) -------------------
let drag = null;
function enableDragReorder(node, handle, index, page) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = { page, from: index, node };
    node.classList.add('dragging');
    const move = (ev) => {
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.wdg');
      document.querySelectorAll('.wdg.dragover').forEach((n) => n.classList.remove('dragover'));
      if (target && target !== node) target.classList.add('dragover');
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.wdg');
      const cards = [...node.parentNode.querySelectorAll('.wdg')];
      const to = target ? cards.indexOf(target) : -1;
      if (to >= 0 && to !== index) {
        const [moved] = page.widgets.splice(index, 1);
        page.widgets.splice(to, 0, moved);
        commit();
      } else { node.classList.remove('dragging'); render(); }
      drag = null;
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}

// --- horizontal page swipe -------------------------------------------------
function enableSwipe(sheet, pageCount) {
  let x0 = null, y0 = null;
  sheet.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && state.pageIndex < pageCount - 1) { state.pageIndex++; render(); }
      else if (dx > 0 && state.pageIndex > 0) { state.pageIndex--; render(); }
    }
    x0 = null;
  }, { passive: true });
}

// ==================================================================== OVERLAYS
function closeOverlay() { state.overlay = null; render(); }
function renderOverlay() {
  const o = state.overlay;
  const scrim = el('div', { class: `scrim ${o.center ? 'center' : ''}`, onclick: (e) => { if (e.target === scrim) closeOverlay(); } });
  scrim.append(o.render());
  return scrim;
}
function sheetCard(children) { return el('div', { class: 'sheetcard' }, children); }

// Reusable styled confirmation dialog (replaces native confirm()).
function confirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm }) {
  state.overlay = {
    center: true,
    render: () => sheetCard([
      el('h2', { text: title }),
      el('p', { class: 'desc', text: message }),
      el('div', { class: 'btnrow' }, [
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeOverlay }),
        el('button', { class: 'btn destruct', text: confirmLabel, onclick: () => onConfirm() }),
      ]),
    ]),
  };
  render();
}

// A2 — Roll result. d20 rolls also offer Advantage / Disadvantage (2d20kh1/kl1),
// which the engine already supports; every roll is recorded to the roll log.
const MODES = { normal: { label: 'Normal', sub: (e) => e }, adv: { label: 'Advantage', sub: (e) => e.replace(/\b[12]?d20\b/i, '2d20kh1') }, dis: { label: 'Disadvantage', sub: (e) => e.replace(/\b[12]?d20\b/i, '2d20kl1') } };
function openRoll(v, expr, label) {
  const hasD20 = /d20/i.test(expr);
  const roll = (e) => evalRoll(e, (name) => {
    const r = computed.results.get(name);
    if (typeof r === 'number') return r;
    throw new Error(`bad ref ${name}`);
  });
  const doRoll = (mode) => {
    const e = MODES[mode].sub(expr);
    let res; try { res = roll(e); } catch { res = { total: 'ERR', display: 'unknown reference', parts: [] }; }
    logRoll({ label, mode, expr: e, total: res.total, display: res.display });
    return res;
  };
  const initial = doRoll('normal');
  state.overlay = {
    center: true,
    render() {
      const tray = el('div', { class: 'dice-tray' });
      const bigEl = el('div', { class: 'rollbig' });
      const breakEl = el('div', { class: 'rollbreak' });
      const modeEl = el('p', { class: 'desc rollmode' });
      const ctx = { tray, bigEl, breakEl, res: initial, timers: [] };
      const play = (res, mode) => { ctx.res = res; breakEl.innerHTML = formatBreak(res); modeEl.textContent = `${MODES[mode].sub(expr)}${mode !== 'normal' ? `  ·  ${MODES[mode].label}` : ''}`; animateRoll(diceFromParts(res.parts), ctx); };
      const go = (mode) => play(doRoll(mode), mode);
      requestAnimationFrame(() => play(initial, 'normal'));
      const actions = [];
      if (hasD20) {
        actions.push(el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn primary', text: '⬆ Advantage', onclick: () => go('adv') }),
          el('button', { class: 'btn primary', text: '⬇ Disadvantage', onclick: () => go('dis') }),
        ]));
      }
      actions.push(el('div', { class: 'btnrow' }, [
        el('button', { class: 'btn ghost', text: '🎲 Roll again', onclick: () => go('normal') }),
        el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay }),
      ]));
      return sheetCard([el('h2', { text: `${label} — Roll` }), modeEl, tray, bigEl, breakEl, ...actions]);
    },
  };
  render();
}

// In-memory roll log (last 30 this session).
function logRoll(entry) {
  state.rollLog.unshift(entry);
  if (state.rollLog.length > 30) state.rollLog.length = 30;
}

// Expand a roll breakdown into individual dice ({sides, val}) for the tray.
function diceFromParts(parts) {
  const out = [];
  for (const p of (parts || [])) {
    if (!p.rolls) continue;
    const m = /d(\d+)/i.exec(p.label);
    const sides = m ? +m[1] : 6;
    p.rolls.forEach((val) => out.push({ sides, val }));
  }
  return out;
}

// Flat dice that wiggle while the face number flickers, then settle on the real
// value (the value is the engine's; the flicker is cosmetic). Honours the
// user's animation toggle and the OS reduced-motion setting.
function animateRoll(dice, ctx) {
  ctx.timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
  ctx.timers = [];
  const { tray, bigEl, breakEl } = ctx;
  tray.innerHTML = '';
  const faces = dice.map((d) => {
    const face = el('span', { class: 'dieface', text: String(d.val) });
    tray.append(el('div', { class: `die` }, [face, el('span', { class: 'dielabel', text: 'd' + d.sides })]));
    return face;
  });
  const dieEls = [...tray.querySelectorAll('.die')];
  const setFinal = () => {
    dieEls.forEach((d, i) => { d.classList.remove('rolling'); d.style.animationDelay = ''; faces[i].textContent = String(dice[i].val); d.classList.add('settle'); });
    bigEl.classList.remove('rolling'); bigEl.textContent = String(ctx.res.total);
    breakEl.classList.remove('pending');
  };
  const animate = state.rollAnim && dice.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate) { setFinal(); return; }
  bigEl.classList.add('rolling'); bigEl.textContent = '…';
  breakEl.classList.add('pending');
  dieEls.forEach((d, i) => { d.classList.add('rolling'); d.style.animationDelay = (i * 60) + 'ms'; });
  const iv = setInterval(() => {
    faces.forEach((f, i) => { f.textContent = String(1 + Math.floor(Math.random() * dice[i].sides)); });
  }, 55);
  ctx.timers.push(iv);
  ctx.timers.push(setTimeout(() => { clearInterval(iv); setFinal(); }, 720));
}
function formatBreak(res) {
  if (!res.parts || !res.parts.length) return res.display || '—';
  const segs = res.parts.map((p) => p.rolls ? `${p.label} <b>(${p.rolls.join('+')})</b>` : `${p.label} <b>(${p.value})</b>`);
  return `${segs.join('<span class="op"> + </span>')}<span class="op"> = </span><b>${res.total}</b>`;
}

// A3 — Detail. Shows the value + its formula/description, and a Roll button per
// available roll (a weapon offers Attack and Damage). Rolling is a deliberate
// second tap, never click-and-insta.
function openDetail(v, label, rolls = []) {
  state.overlay = {
    center: true,
    render() {
      const kids = [el('h2', { text: label })];
      // For a weapon (text + rolls) the raw string is uninteresting; show the
      // roll summaries instead. Otherwise show the value big.
      if (v.kind === 'text' && rolls.length) {
        kids.push(el('div', { class: 'rollrows detail-rolls' }, rolls.map((r) =>
          el('div', { class: 'rollrow' }, [el('span', { class: 'rn', text: r.name || 'Roll' }), el('span', { class: 'rp', text: previewRoll(r.expr, rollResolve) })]))));
      } else {
        kids.push(el('div', { class: `detail-val ${displayValue(v) === 'ERR' ? 'err' : ''}`, text: displayValue(v) }));
      }
      if (v.kind === 'calc') {
        const det = computed.details.get(v.id) || {};
        const result = computed.results.get(v.id);
        if (det.error) kids.push(el('div', { class: 'formula' }, [el('span', { class: 'err', text: `ERR — ${det.error}` })]));
        else kids.push(el('div', { class: 'formula', text: `= ${v.formula}  →  ${result}` }));
      }
      if (v.description) kids.push(el('p', { class: 'desc', style: 'margin-top:12px', text: v.description }));

      const actions = rolls.map((r) =>
        el('button', { class: 'btn primary', text: `🎲 ${r.name || 'Roll'}`, onclick: () => openRoll(v, r.expr, r.name ? `${label} — ${r.name}` : label) }));
      actions.push(el('button', { class: `btn ${rolls.length ? 'ghost' : 'primary'}`, text: 'Close', onclick: closeOverlay }));
      kids.push(el('div', { class: 'btncol' }, actions));
      return sheetCard(kids);
    },
  };
  render();
}

// --- Menu ------------------------------------------------------------------
function openMenu() {
  state.overlay = {
    render: () => sheetCard([
      el('h2', { text: 'Menu' }),
      el('div', { class: 'menu-list' }, [
        el('button', { onclick: () => { closeOverlay(); state.view = 'home'; render(); } }, [el('span', { class: 'mi', text: '⌂' }), 'Characters']),
        el('button', { onclick: () => { closeOverlay(); openRollLog(); } }, [el('span', { class: 'mi', text: '🎲' }), 'Roll log']),
        el('button', { onclick: () => { closeOverlay(); openShare(); } }, [el('span', { class: 'mi', text: '↥' }), 'Share & backup']),
        el('button', { onclick: () => { closeOverlay(); openThemePicker(); } }, [el('span', { class: 'mi', text: '🎨' }), 'Appearance']),
        el('button', { onclick: () => { closeOverlay(); state.mode = state.mode === 'edit' ? 'play' : 'edit'; render(); } }, [el('span', { class: 'mi', text: '✎' }), state.mode === 'edit' ? 'Exit edit mode' : 'Edit this sheet']),
        el('button', { onclick: () => { closeOverlay(); duplicateCharacter(); } }, [el('span', { class: 'mi', text: '⧉' }), 'Duplicate character']),
        el('button', { onclick: () => { closeOverlay(); openPrivacy(); } }, [el('span', { class: 'mi', text: '🔒' }), 'Privacy']),
        el('button', { class: 'danger', onclick: () => { const c = activeChar(); if (c) confirmDeleteCharacter(c); } }, [el('span', { class: 'mi', text: '🗑' }), 'Delete character']),
      ]),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay })]),
    ]),
  };
  render();
}

// --- Roll log --------------------------------------------------------------
function openRollLog() {
  state.overlay = {
    render() {
      const kids = [el('h2', { text: '🎲 Roll log' }), el('p', { class: 'desc', text: 'Recent rolls this session (not saved).' })];
      if (!state.rollLog.length) kids.push(el('div', { class: 'empty', text: 'No rolls yet.' }));
      else {
        const list = el('div', { class: 'roll-log' });
        state.rollLog.forEach((r) => list.append(el('div', { class: 'log-row' }, [
          el('div', { class: 'log-hd' }, [
            el('span', { class: 'log-label', text: r.label }),
            r.mode && r.mode !== 'normal' ? el('span', { class: 'log-mode', text: r.mode === 'adv' ? 'ADV' : 'DIS' }) : null,
            el('span', { class: 'log-total', text: r.total }),
          ]),
          el('div', { class: 'log-break', text: r.display }),
        ])));
        kids.push(list);
      }
      const btns = [];
      if (state.rollLog.length) btns.push(el('button', { class: 'btn ghost', text: 'Clear', onclick: () => { state.rollLog = []; render(); } }));
      btns.push(el('button', { class: 'btn primary', text: 'Close', onclick: closeOverlay }));
      kids.push(el('div', { class: 'btnrow' }, btns));
      return sheetCard(kids);
    },
  };
  render();
}

// --- Duplicate the active character ----------------------------------------
function duplicateCharacter() {
  const c = activeChar();
  if (!c) return;
  const copy = JSON.parse(JSON.stringify(c));
  copy.id = newId('char');
  copy.name = `${c.name} (copy)`;
  copy.createdAt = new Date().toISOString();
  copy.pages.forEach((p) => { p.id = newId('page'); p.widgets.forEach((w) => { w.id = newId('w'); }); });
  const at = state.save.characters.findIndex((x) => x.id === c.id);
  state.save.characters.splice(at + 1, 0, copy);
  state.save.activeCharacterId = copy.id;
  state.pageIndex = 0;
  commitNow();
  toast('Character duplicated.');
}

// --- Appearance / theme picker ---------------------------------------------
function openThemePicker() {
  state.overlay = {
    render: () => sheetCard([
      el('h2', { text: '🎨 Appearance' }),
      el('p', { class: 'desc', text: 'Pick a colour scheme. It applies instantly and is remembered on this device.' }),
      el('div', { class: 'theme-grid' }, THEMES.map((t) =>
        el('button', {
          class: `theme-opt ${state.theme === t.id ? 'on' : ''}`,
          onclick: () => { state.theme = t.id; store.saveTheme(t.id); applyTheme(t.id); render(); },
        }, [
          el('span', { class: 'theme-preview' }, t.sw.map((c) => el('i', { style: `background:${c}` }))),
          el('span', { class: 'theme-nm', text: t.name }),
          state.theme === t.id ? el('span', { class: 'chk', text: '✓' }) : null,
        ])
      )),
      el('div', { class: 'toggle-row' }, [
        el('div', {}, [
          el('div', { class: 'theme-nm', text: 'Dice roll animation' }),
          el('div', { class: 'desc', style: 'margin:0', text: 'Dice wiggle and flicker before showing the result.' }),
        ]),
        el('button', {
          class: `switch ${state.rollAnim ? 'on' : ''}`, role: 'switch', 'aria-checked': String(state.rollAnim),
          onclick: () => { state.rollAnim = !state.rollAnim; store.saveRollAnim(state.rollAnim); render(); },
        }, el('span', { class: 'knob' })),
      ]),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn primary', text: 'Done', onclick: closeOverlay })]),
    ]),
  };
  render();
}

// --- Privacy ---------------------------------------------------------------
function privSection(title, body) {
  return el('div', { class: 'privsec' }, [el('h3', { text: title }), el('p', { text: body })]);
}
function openPrivacy() {
  state.overlay = {
    render: () => sheetCard([
      el('h2', { text: '🔒 Privacy' }),
      el('p', { class: 'desc', text: 'Short version: everything you create stays on this device. Parchment has no servers and no accounts, and it never sends your data anywhere.' }),

      privSection('Where your data lives',
        'Your characters, values, layouts, and dice results are saved only in this browser’s local storage, on this device. There is no cloud copy and no database — nobody else has your data because there is nowhere else for it to be.'),

      privSection('No accounts, no servers',
        'The app is just static files (HTML, CSS, JavaScript). There is no sign-up, no login, and no backend for it to talk to. The people who made it cannot see anything you enter.'),

      privSection('No tracking, ever',
        'No analytics, no advertising, no cookies, no fingerprinting, and no third-party scripts. Nothing about who you are or how you use the app is measured, logged, or transmitted.'),

      privSection('No network calls',
        'Once the page has loaded, the app makes no requests to any third party. It uses your device’s system fonts (no web-font CDN) and sends nothing about you anywhere. After the first visit it can run fully offline, and installed as a home-screen app even its own files are served from an on-device cache.'),

      privSection('Hosting & server logs',
        'Parchment is served as plain static files from a web host (Netlify). As with every website, loading it means your browser connects to that host, which may keep standard access logs — typically your IP address, the time, and which files were requested. That is ordinary web-server metadata, not the contents of your sheets: your characters, values, and rolls never leave your device. As an extra guarantee, the host sends a strict Content-Security-Policy that blocks the page from contacting any third party at all — so the app cannot phone home even in principle. Opening the offline single-file version instead involves no host whatsoever.'),

      privSection('Sharing is entirely your choice',
        'The only way data leaves this device is if YOU export a JSON file — a character, a full backup, or a shareable pack — and send it somewhere yourself. Those files are plain, unencrypted JSON: once you share one, it goes wherever you send it, so treat backups like any other personal file. Importing only reads a file you pick; it never uploads anything.'),

      privSection('Losing your data',
        'Because everything is local, clearing this browser’s site data — or deleting the browser / app — permanently erases your characters. There is no way to recover them unless you exported a backup. Export a JSON backup regularly; that file is your only copy.'),

      privSection('Deleting your data',
        'Delete individual characters from the character list or the sheet menu. To remove everything at once, clear this site’s data in your browser settings. Nothing is stored anywhere else, so there is nothing else to erase.'),

      privSection('Open source',
        'Parchment is open source, so you can verify all of the above yourself: github.com/superfacto/parchment-character-sheets'),

      el('div', { class: 'btnrow' }, [el('button', { class: 'btn primary', text: 'Close', onclick: closeOverlay })]),
    ]),
  };
  render();
}

function confirmDeleteCharacter(c) {
  confirmDialog({
    title: `Delete “${c.name}”?`,
    message: 'This permanently removes the character from this device and cannot be undone. Export a backup first if you might want it back.',
    confirmLabel: '🗑 Delete character',
    onConfirm: () => deleteCharacter(c.id),
  });
}
function deleteCharacter(id) {
  const wasActive = state.save.activeCharacterId === id;
  state.save.characters = state.save.characters.filter((x) => x.id !== id);
  if (wasActive) { state.save.activeCharacterId = state.save.characters[0]?.id || null; state.view = 'home'; }
  state.overlay = null;
  commitNow();
}

// ============================================================ NEW CHARACTER (C2)
function openNewCharacter() {
  state.overlay = {
    render: () => sheetCard([
      el('h2', { text: 'New character' }),
      el('p', { class: 'desc', text: 'Guided 5e build, a ready-made 5e sheet, or an empty canvas.' }),
      el('div', { class: 'menu-list startlist' }, [
        el('button', { onclick: () => { closeOverlay(); openBuilder(); } }, [el('span', { class: 'mi', text: '✦' }), el('div', {}, [el('div', { class: 'opt-t', text: 'D&D 5e — guided builder' }), el('div', { class: 'opt-d', text: 'Pick class, level & ability scores. Fills the sheet for you.' })])]),
        el('button', { onclick: () => quickCreate('dnd5e') }, [el('span', { class: 'mi', text: '●' }), el('div', {}, [el('div', { class: 'opt-t', text: 'D&D 5e — preset sheet' }), el('div', { class: 'opt-d', text: 'The full 5e layout with default scores. Edit anything after.' })])]),
        el('button', { onclick: () => quickCreate('blank') }, [el('span', { class: 'mi', text: '○' }), el('div', {}, [el('div', { class: 'opt-t', text: 'Blank' }), el('div', { class: 'opt-d', text: 'An empty sheet with a single notes widget.' })])]),
      ]),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeOverlay })]),
    ]),
  };
  render();
}

function quickCreate(kind) {
  const c = kind === 'dnd5e' ? dnd5eCharacter('New Hero') : blankCharacter('New Character');
  state.save.characters.push(c);
  state.save.activeCharacterId = c.id;
  state.overlay = null; state.view = 'sheet'; state.pageIndex = 0; state.mode = 'play';
  commit();
}

// --- Guided 5e character builder -------------------------------------------
// Content mirrors the core PHB. Saving-throw proficiencies and background skill
// pairs (2014) are the standard rules; 2024 species speeds/traits and the
// 2024-background ability boosts are modelled faithfully but simplified (see the
// in-flow notes) and — like everything here — stay fully editable after.
const BUILD_CLASSES = [
  { name: 'Barbarian', hd: 12, prime: ['str'], saves: ['str', 'con'], skills: { n: 2, from: ['animal_handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] } },
  { name: 'Bard', hd: 8, prime: ['cha'], saves: ['dex', 'cha'], skills: { n: 3, from: 'any' } },
  { name: 'Cleric', hd: 8, prime: ['wis'], saves: ['wis', 'cha'], skills: { n: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] } },
  { name: 'Druid', hd: 8, prime: ['wis'], saves: ['int', 'wis'], skills: { n: 2, from: ['arcana', 'animal_handling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] } },
  { name: 'Fighter', hd: 10, prime: ['str', 'dex'], saves: ['str', 'con'], skills: { n: 2, from: ['acrobatics', 'animal_handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] } },
  { name: 'Monk', hd: 8, prime: ['dex', 'wis'], saves: ['str', 'dex'], skills: { n: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] } },
  { name: 'Paladin', hd: 10, prime: ['str', 'cha'], saves: ['wis', 'cha'], skills: { n: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] } },
  { name: 'Ranger', hd: 10, prime: ['dex', 'wis'], saves: ['str', 'dex'], skills: { n: 3, from: ['animal_handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] } },
  { name: 'Rogue', hd: 8, prime: ['dex'], saves: ['dex', 'int'], skills: { n: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight_of_hand', 'stealth'] } },
  { name: 'Sorcerer', hd: 6, prime: ['cha'], saves: ['con', 'cha'], skills: { n: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] } },
  { name: 'Warlock', hd: 8, prime: ['cha'], saves: ['wis', 'cha'], skills: { n: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] } },
  { name: 'Wizard', hd: 6, prime: ['int'], saves: ['int', 'wis'], skills: { n: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] } },
];
// 2014 races carry the ability score increases (asi); asiFlex = extra +1s to
// place anywhere (Half-Elf/Variant Human); skillFlex = free skill choices.
const RACES_2014 = [
  { name: 'Hill Dwarf', asi: { con: 2, wis: 1 }, speed: 25, skills: [], note: 'Darkvision, Dwarven Resilience' },
  { name: 'Mountain Dwarf', asi: { str: 2, con: 2 }, speed: 25, skills: [], note: 'Darkvision, armor training' },
  { name: 'High Elf', asi: { dex: 2, int: 1 }, speed: 30, skills: ['perception'], note: 'Darkvision, a wizard cantrip' },
  { name: 'Wood Elf', asi: { dex: 2, wis: 1 }, speed: 35, skills: ['perception'], note: 'Darkvision, Mask of the Wild' },
  { name: 'Lightfoot Halfling', asi: { dex: 2, cha: 1 }, speed: 25, skills: [], note: 'Lucky, Naturally Stealthy' },
  { name: 'Stout Halfling', asi: { dex: 2, con: 1 }, speed: 25, skills: [], note: 'Lucky, Stout Resilience' },
  { name: 'Human', asi: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30, skills: [], note: '+1 to every ability' },
  { name: 'Variant Human', asi: {}, asiFlex: 2, skillFlex: 1, speed: 30, skills: [], note: '+1 to two abilities, a skill, and a feat' },
  { name: 'Dragonborn', asi: { str: 2, cha: 1 }, speed: 30, skills: [], note: 'Breath weapon, damage resistance' },
  { name: 'Forest Gnome', asi: { int: 2, dex: 1 }, speed: 25, skills: [], note: 'Darkvision, Gnome Cunning' },
  { name: 'Rock Gnome', asi: { int: 2, con: 1 }, speed: 25, skills: [], note: 'Darkvision, tinker' },
  { name: 'Half-Elf', asi: { cha: 2 }, asiFlex: 2, skillFlex: 2, speed: 30, skills: [], note: '+2 CHA, +1 to two others, two skills' },
  { name: 'Half-Orc', asi: { str: 2, con: 1 }, speed: 30, skills: ['intimidation'], note: 'Relentless Endurance, Savage Attacks' },
  { name: 'Tiefling', asi: { int: 1, cha: 2 }, speed: 30, skills: [], note: 'Darkvision, Hellish Resistance' },
];
// 2024 species grant NO ability increases (those come from the background).
// size/speed/darkvision(dv)/traits verified via dndbeyond + thegamer (darkvision
// reconciled to 5e canon where the two sources disagreed). hpPerLevel encodes
// Dwarven Toughness (+1 HP/level), applied on create.
const SPECIES_2024 = [
  { name: 'Human', asi: {}, size: 'Medium', speed: 30, dv: 0, skills: [], skillFlex: 1, note: 'Resourceful (Heroic Inspiration), Skillful (one skill), Versatile (a bonus Origin feat).' },
  { name: 'Elf', asi: {}, size: 'Medium', speed: 30, dv: 60, skills: [], note: 'Darkvision 60. Elven Lineage (spells), Fey Ancestry, Keen Senses (choose Insight/Perception/Survival), Trance.' },
  { name: 'Dwarf', asi: {}, size: 'Medium', speed: 30, dv: 120, hpPerLevel: 1, skills: [], note: 'Darkvision 120. Dwarven Resilience (poison), Dwarven Toughness (+1 HP/level, applied), Stonecunning.' },
  { name: 'Halfling', asi: {}, size: 'Small', speed: 30, dv: 0, skills: [], note: 'Brave, Halfling Nimbleness, Luck (reroll 1s), Naturally Stealthy.' },
  { name: 'Dragonborn', asi: {}, size: 'Medium', speed: 30, dv: 0, skills: [], note: 'Draconic Ancestry, Breath Weapon, damage resistance, Draconic Flight at level 5.' },
  { name: 'Gnome', asi: {}, size: 'Small', speed: 30, dv: 60, skills: [], note: 'Darkvision 60. Gnomish Cunning (adv. on INT/WIS/CHA saves), Gnomish Lineage (Forest/Rock).' },
  { name: 'Orc', asi: {}, size: 'Medium', speed: 30, dv: 120, skills: [], note: 'Darkvision 120. Adrenaline Rush (bonus-action Dash + temp HP), Relentless Endurance.' },
  { name: 'Tiefling', asi: {}, size: 'Medium', speed: 30, dv: 60, skills: [], note: 'Darkvision 60. Fiendish Legacy (resistance + spells), Otherworldly Presence (Thaumaturgy).' },
  { name: 'Goliath', asi: {}, size: 'Medium', speed: 35, dv: 0, skills: [], note: 'Giant Ancestry (choose a benefit), Large Form at level 5, Powerful Build.' },
  { name: 'Aasimar', asi: {}, size: 'Medium', speed: 30, dv: 60, skills: [], note: 'Darkvision 60. Celestial Resistance, Healing Hands, Light Bearer, Celestial Revelation at level 3.' },
];
// Concise effect text for the 2024 Origin feats (from the background tables).
// Tough and Alert are applied mechanically on create; the rest are recorded so
// the sheet describes them rather than just naming them.
const FEAT_TEXT = {
  'Magic Initiate (Cleric)': 'Learn two Cleric cantrips and one 1st-level Cleric spell; cast that spell once per long rest for free (or with slots).',
  'Magic Initiate (Druid)': 'Learn two Druid cantrips and one 1st-level Druid spell; cast that spell once per long rest for free (or with slots).',
  'Magic Initiate (Wizard)': 'Learn two Wizard cantrips and one 1st-level Wizard spell; cast that spell once per long rest for free (or with slots).',
  Crafter: "Proficiency with three kinds of Artisan's Tools; a 20% discount on nonmagical gear; craft faster.",
  Skilled: 'Proficiency in any three skills or tools of your choice.',
  Alert: 'Add your Proficiency Bonus to Initiative (applied); you can swap initiative with a willing ally.',
  Musician: 'Proficiency with three musical instruments; grant Heroic Inspiration to allies after a rest.',
  Tough: 'Your hit point maximum increases by 2 × your level (applied).',
  Healer: "Use a Healer's Kit to restore hit points to a creature; stabilise a dying creature to 1 HP.",
  Lucky: 'You have Luck Points equal to your Proficiency Bonus; spend them for Advantage or to impose Disadvantage.',
  'Savage Attacker': "Once per turn, reroll your weapon's damage dice and use either result.",
  'Tavern Brawler': 'Unarmed strikes deal more damage and can shove; reroll 1s on unarmed damage; proficiency with improvised weapons.',
};
// 2014 backgrounds grant two fixed skill proficiencies.
const BG_2014 = [
  { name: 'Acolyte', skills: ['insight', 'religion'] }, { name: 'Charlatan', skills: ['deception', 'sleight_of_hand'] },
  { name: 'Criminal', skills: ['deception', 'stealth'] }, { name: 'Entertainer', skills: ['acrobatics', 'performance'] },
  { name: 'Folk Hero', skills: ['animal_handling', 'survival'] }, { name: 'Guild Artisan', skills: ['insight', 'persuasion'] },
  { name: 'Hermit', skills: ['medicine', 'religion'] }, { name: 'Noble', skills: ['history', 'persuasion'] },
  { name: 'Outlander', skills: ['athletics', 'survival'] }, { name: 'Sage', skills: ['arcana', 'history'] },
  { name: 'Sailor', skills: ['athletics', 'perception'] }, { name: 'Soldier', skills: ['athletics', 'intimidation'] },
  { name: 'Urchin', skills: ['sleight_of_hand', 'stealth'] },
];
// 2024 backgrounds (PHB 2024): each lists three abilities (assign +2/+1 or
// +1/+1/+1 among them), an Origin feat, two fixed skills, and a tool. Verified
// against roll20.net/dnd/2024-backgrounds and arcaneeye.com (they agree).
const BG_2024 = [
  { name: 'Acolyte', abilities: ['int', 'wis', 'cha'], feat: 'Magic Initiate (Cleric)', skills: ['insight', 'religion'], tool: "Calligrapher's Supplies" },
  { name: 'Artisan', abilities: ['str', 'dex', 'int'], feat: 'Crafter', skills: ['investigation', 'persuasion'], tool: "Artisan's Tools" },
  { name: 'Charlatan', abilities: ['dex', 'con', 'cha'], feat: 'Skilled', skills: ['deception', 'sleight_of_hand'], tool: 'Forgery Kit' },
  { name: 'Criminal', abilities: ['dex', 'con', 'int'], feat: 'Alert', skills: ['sleight_of_hand', 'stealth'], tool: "Thieves' Tools" },
  { name: 'Entertainer', abilities: ['str', 'dex', 'cha'], feat: 'Musician', skills: ['acrobatics', 'performance'], tool: 'Musical Instrument' },
  { name: 'Farmer', abilities: ['str', 'con', 'wis'], feat: 'Tough', skills: ['animal_handling', 'nature'], tool: "Carpenter's Tools" },
  { name: 'Guard', abilities: ['str', 'int', 'wis'], feat: 'Alert', skills: ['athletics', 'perception'], tool: 'Gaming Set' },
  { name: 'Guide', abilities: ['dex', 'con', 'wis'], feat: 'Magic Initiate (Druid)', skills: ['stealth', 'survival'], tool: "Cartographer's Tools" },
  { name: 'Hermit', abilities: ['con', 'wis', 'cha'], feat: 'Healer', skills: ['medicine', 'religion'], tool: 'Herbalism Kit' },
  { name: 'Merchant', abilities: ['con', 'int', 'cha'], feat: 'Lucky', skills: ['animal_handling', 'persuasion'], tool: "Navigator's Tools" },
  { name: 'Noble', abilities: ['str', 'int', 'cha'], feat: 'Skilled', skills: ['history', 'persuasion'], tool: 'Gaming Set' },
  { name: 'Sage', abilities: ['con', 'int', 'wis'], feat: 'Magic Initiate (Wizard)', skills: ['arcana', 'history'], tool: "Calligrapher's Supplies" },
  { name: 'Sailor', abilities: ['str', 'dex', 'wis'], feat: 'Tavern Brawler', skills: ['acrobatics', 'perception'], tool: "Navigator's Tools" },
  { name: 'Scribe', abilities: ['dex', 'int', 'wis'], feat: 'Skilled', skills: ['investigation', 'perception'], tool: "Calligrapher's Supplies" },
  { name: 'Soldier', abilities: ['str', 'dex', 'con'], feat: 'Savage Attacker', skills: ['athletics', 'intimidation'], tool: 'Gaming Set' },
  { name: 'Wayfarer', abilities: ['dex', 'wis', 'cha'], feat: 'Lucky', skills: ['insight', 'stealth'], tool: "Thieves' Tools" },
];

const STD_ARRAY = [15, 14, 13, 12, 10, 8];
// [shortKey (mod id prefix / scores key), label, full ability value id]
const ABILITY_KEYS = [['str', 'STR', 'strength'], ['dex', 'DEX', 'dexterity'], ['con', 'CON', 'constitution'], ['int', 'INT', 'intelligence'], ['wis', 'WIS', 'wisdom'], ['cha', 'CHA', 'charisma']];
const ALL_SKILLS = [['acrobatics', 'Acrobatics'], ['animal_handling', 'Animal Handling'], ['arcana', 'Arcana'], ['athletics', 'Athletics'], ['deception', 'Deception'], ['history', 'History'], ['insight', 'Insight'], ['intimidation', 'Intimidation'], ['investigation', 'Investigation'], ['medicine', 'Medicine'], ['nature', 'Nature'], ['perception', 'Perception'], ['performance', 'Performance'], ['persuasion', 'Persuasion'], ['religion', 'Religion'], ['sleight_of_hand', 'Sleight of Hand'], ['stealth', 'Stealth'], ['survival', 'Survival']];
const SKILL_LABEL = Object.fromEntries(ALL_SKILLS);
const ABIL_LABEL = Object.fromEntries(ABILITY_KEYS.map(([k, l]) => [k, l]));
function abilityMod(score) { return Math.floor((score - 10) / 2); }
function hpFor(hd, conMod, level) {
  const avg = Math.floor(hd / 2) + 1;                    // fixed average per level
  return (hd + conMod) + (level - 1) * (avg + conMod);
}
function assignStdArray(scores, cls) {
  const order = [...new Set([...cls.prime, 'con', 'dex', 'wis', 'str', 'int', 'cha'])];
  STD_ARRAY.forEach((val, i) => { if (order[i]) scores[order[i]] = val; });
}
// Where the flexible ability boosts come from: racial choice (2014) or the
// background boost (2024). pool = points to place, cap = max into one ability,
// abilities = which ability keys are eligible.
function flexSpec(data) {
  if (data.ed === '2024') return { pool: data.bg ? 3 : 0, cap: 2, abilities: (data.bg && data.bg.abilities) || [], label: 'Background ability boost — assign +2 and +1 (or +1/+1/+1)' };
  const f = data.race && data.race.asiFlex || 0;
  const fixed = fixedAsi(data);
  const abilities = ABILITY_KEYS.map(([k]) => k).filter((k) => !fixed[k]); // “other” abilities
  return { pool: f, cap: 1, abilities, label: 'Racial ability choice — place your +1s' };
}
function fixedAsi(data) { return (data.ed === '2014' && data.race && data.race.asi) || {}; }
function finalScore(data, k) { return (data.base[k] || 10) + (fixedAsi(data)[k] || 0) + (data.flex[k] || 0); }
function raceList(data) { return data.ed === '2024' ? SPECIES_2024 : RACES_2014; }
function bgList(data) { return data.ed === '2024' ? BG_2024 : BG_2014; }
// Skills granted automatically (race/species + fixed background), for locking.
function grantedSkills(data) {
  const s = new Set([...(data.race && data.race.skills || []), ...(data.bg && data.bg.skills || [])]);
  return s;
}
// Free skill picks available beyond class skills (racial + 2024 background).
function freeSkillCount(data) { return (data.race && data.race.skillFlex || 0) + (data.bg && data.bg.skillFlex || 0); }

function openBuilder() {
  const data = {
    ed: '2014', name: '', cls: BUILD_CLASSES.find((c) => c.name === 'Fighter'), level: 1,
    base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, flex: {},
    race: null, bg: null, classSkills: [], freeSkills: [],
  };
  let step = 0;
  const resetForEdition = () => { data.race = null; data.bg = null; data.flex = {}; data.freeSkills = []; };
  const steps = () => ['Basics', data.ed === '2024' ? 'Species' : 'Race', 'Background', 'Abilities', 'Proficiencies', 'Review'];

  // A reusable skill-picker section.
  function skillPicker(title, ids, chosen, max, locked) {
    const left = max - chosen.length;
    const wrap = el('div', { class: 'pick-sec' }, [el('div', { class: 'pick-h' }, [el('span', { text: title }), el('span', { class: 'pick-left', text: left > 0 ? `${left} left` : 'done' })])]);
    const chips = el('div', { class: 'skill-chips' });
    ids.forEach((id) => {
      const isLocked = locked.has(id);
      const on = isLocked || chosen.includes(id);
      const chip = el('button', { class: `chip ${on ? 'on' : ''} ${isLocked ? 'locked' : ''}`, text: SKILL_LABEL[id] || id, disabled: isLocked || (!on && left <= 0) });
      if (!isLocked) chip.addEventListener('click', () => {
        const at = chosen.indexOf(id);
        if (at >= 0) chosen.splice(at, 1); else if (left > 0) chosen.push(id);
        render();
      });
      chips.append(chip);
    });
    wrap.append(chips);
    return wrap;
  }

  state.overlay = {
    render() {
      const S = steps();
      const kids = [el('div', { class: 'wiz-steps' }, S.map((s, i) => el('span', { class: `wiz-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`, text: s })))];

      if (step === 0) {                                   // Basics
        kids.push(el('h2', { text: 'Basics' }));
        kids.push(el('div', { class: 'field' }, [
          el('label', { text: 'Rules edition' }),
          el('div', { class: 'seg' }, [
            el('button', { class: data.ed === '2014' ? 'on' : '', text: '2014 (Race)', onclick: () => { if (data.ed !== '2014') { data.ed = '2014'; resetForEdition(); render(); } } }),
            el('button', { class: data.ed === '2024' ? 'on' : '', text: '2024 (Species)', onclick: () => { if (data.ed !== '2024') { data.ed = '2024'; resetForEdition(); render(); } } }),
          ]),
          el('div', { class: 'hint', text: data.ed === '2014' ? 'Ability bonuses come from your race.' : 'Species give traits only; ability bonuses come from your background.' }),
        ]));
        const nameInput = el('input', { placeholder: 'e.g. Thordak', value: data.name, oninput: (e) => { data.name = e.target.value; } });
        kids.push(field('Name', nameInput));
        kids.push(el('div', { class: 'field' }, [
          el('label', { text: 'Class' }),
          el('div', { class: 'class-grid' }, BUILD_CLASSES.map((cl) => el('button', { class: data.cls.name === cl.name ? 'on' : '', text: cl.name, onclick: () => { data.cls = cl; data.classSkills = []; render(); } }))),
        ]));
        kids.push(el('div', { class: 'field' }, [
          el('label', { text: `Level — ${data.level}` }),
          el('input', { type: 'range', min: 1, max: 20, value: data.level, oninput: (e) => { data.level = Number(e.target.value); render(); } }),
        ]));
        kids.push(el('div', { class: 'hint', text: `${data.cls.name}: d${data.cls.hd} hit die · saves ${data.cls.saves.map((a) => a.toUpperCase()).join(' & ')}` }));
      } else if (step === 1) {                            // Race / Species
        kids.push(el('h2', { text: data.ed === '2024' ? 'Species' : 'Race' }));
        kids.push(el('div', { class: 'pick-list' }, raceList(data).map((r) => {
          const bonus = data.ed === '2014'
            ? Object.entries(r.asi).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(' ') + (r.asiFlex ? ` · +${r.asiFlex} free` : '')
            : `${r.size} · ${r.dv ? `Darkvision ${r.dv} ft` : 'no darkvision'}`;
          return el('button', { class: `pick ${data.race && data.race.name === r.name ? 'on' : ''}`, onclick: () => { data.race = r; data.freeSkills = []; data.flex = {}; render(); } }, [
            el('div', { class: 'pick-t', text: r.name }),
            el('div', { class: 'pick-d', text: `Speed ${r.speed} ft · ${bonus}${r.skills && r.skills.length ? ' · ' + r.skills.map((s) => SKILL_LABEL[s]).join(', ') : ''}` }),
            el('div', { class: 'pick-d', text: r.note }),
          ]);
        })));
      } else if (step === 2) {                            // Background
        kids.push(el('h2', { text: 'Background' }));
        kids.push(el('div', { class: 'pick-list' }, bgList(data).map((b) => {
          const kids2 = [el('div', { class: 'pick-t', text: b.name })];
          if (data.ed === '2014') {
            kids2.push(el('div', { class: 'pick-d', text: `Skills: ${b.skills.map((s) => SKILL_LABEL[s]).join(', ')}` }));
          } else {
            kids2.push(el('div', { class: 'pick-d', text: `${b.abilities.map((a) => a.toUpperCase()).join(' / ')} · ${b.feat}` }));
            kids2.push(el('div', { class: 'pick-d', text: `${b.skills.map((s) => SKILL_LABEL[s]).join(', ')} · ${b.tool}` }));
          }
          return el('button', { class: `pick ${data.bg && data.bg.name === b.name ? 'on' : ''}`, onclick: () => { data.bg = b; data.freeSkills = []; data.flex = {}; render(); } }, kids2);
        })));
        if (data.ed === '2024') kids.push(el('div', { class: 'hint', text: 'Ability boost uses the three listed abilities. The Origin feat is saved into Features & Traits and the tool is noted (Parchment has no separate feat/tool system yet).' }));
      } else if (step === 3) {                            // Abilities
        const spec = flexSpec(data);
        const used = Object.values(data.flex).reduce((a, b) => a + b, 0);
        const remaining = spec.pool - used;
        kids.push(el('h2', { text: 'Ability scores' }));
        kids.push(el('div', { class: 'btnrow', style: 'margin-bottom:10px' }, [
          el('button', { class: 'btn ghost', text: 'Standard array', onclick: () => { assignStdArray(data.base, data.cls); render(); } }),
          el('button', { class: 'btn ghost', text: 'Reset to 10', onclick: () => { ABILITY_KEYS.forEach(([k]) => { data.base[k] = 10; }); render(); } }),
        ]));
        ABILITY_KEYS.forEach(([k, lbl]) => {
          const bonus = (fixedAsi(data)[k] || 0) + (data.flex[k] || 0);
          const total = finalScore(data, k);
          kids.push(el('div', { class: 'abrow' }, [
            el('span', { class: 'ab-l', text: lbl }),
            el('button', { class: 'step', text: '−', onclick: () => { data.base[k] = Math.max(1, data.base[k] - 1); render(); } }),
            el('span', { class: 'ab-v', text: String(data.base[k]) }),
            el('button', { class: 'step', text: '+', onclick: () => { data.base[k] = Math.min(20, data.base[k] + 1); render(); } }),
            el('span', { class: 'ab-bonus', text: bonus ? `+${bonus}` : '' }),
            el('span', { class: 'ab-total', text: `= ${total}` }),
            el('span', { class: 'ab-m', text: signedStr(abilityMod(total)) }),
          ]));
        });
        if (spec.pool > 0) {
          kids.push(el('div', { class: 'flex-box' }, [
            el('div', { class: 'pick-h' }, [el('span', { text: spec.label }), el('span', { class: 'pick-left', text: `${remaining} left` })]),
            el('div', { class: 'flex-grid' }, spec.abilities.map((k) => el('div', { class: 'flexrow' }, [
              el('span', { class: 'ab-l', text: ABIL_LABEL[k] }),
              el('button', { class: 'step', text: '−', disabled: !(data.flex[k] > 0), onclick: () => { data.flex[k] = (data.flex[k] || 0) - 1; if (!data.flex[k]) delete data.flex[k]; render(); } }),
              el('span', { class: 'ab-v', text: `+${data.flex[k] || 0}` }),
              el('button', { class: 'step', text: '+', disabled: remaining <= 0 || (data.flex[k] || 0) >= spec.cap, onclick: () => { data.flex[k] = (data.flex[k] || 0) + 1; render(); } }),
            ]))),
          ]));
        }
        kids.push(el('div', { class: 'hint', text: 'Base uses the standard array by default; bonuses from your ' + (data.ed === '2024' ? 'background' : 'race') + ' are shown as “= total”.' }));
      } else if (step === 4) {                            // Proficiencies
        kids.push(el('h2', { text: 'Proficiencies' }));
        kids.push(el('div', { class: 'prof-note', text: `Saving throws (from ${data.cls.name}): ${data.cls.saves.map((a) => a.toUpperCase()).join(' & ')} — set automatically.` }));
        const locked = grantedSkills(data);
        if (locked.size) kids.push(el('div', { class: 'prof-note', text: `Granted skills: ${[...locked].map((s) => SKILL_LABEL[s]).join(', ')}` }));
        const classFrom = data.cls.skills.from === 'any' ? ALL_SKILLS.map(([id]) => id) : data.cls.skills.from;
        kids.push(skillPicker(`${data.cls.name} skills — choose ${data.cls.skills.n}`, classFrom, data.classSkills, data.cls.skills.n, locked));
        const free = freeSkillCount(data);
        if (free > 0) {
          const lockedPlusClass = new Set([...locked, ...data.classSkills]);
          kids.push(skillPicker(`Extra proficiencies — choose ${free} (any)`, ALL_SKILLS.map(([id]) => id), data.freeSkills, free, lockedPlusClass));
        }
      } else {                                            // Review
        const total = (k) => finalScore(data, k);
        const hp = hpFor(data.cls.hd, abilityMod(total('con')), data.level);
        const skills = new Set([...grantedSkills(data), ...data.classSkills, ...data.freeSkills]);
        kids.push(el('h2', { text: 'Review' }));
        kids.push(el('div', { class: 'review' }, [
          revRow('Name', data.name.trim() || 'New Hero'),
          revRow(data.ed === '2024' ? 'Species' : 'Race', data.race ? data.race.name : '—'),
          revRow('Background', data.bg ? data.bg.name : '—'),
          revRow('Class & level', `${data.cls.name} ${data.level}`),
          data.ed === '2024' && data.bg ? revRow('Origin feat', data.bg.feat) : null,
          revRow('Scores', ABILITY_KEYS.map(([k, l]) => `${l} ${total(k)}`).join('  ·  ')),
          revRow('Max HP', String(hp)),
          revRow('Saves', data.cls.saves.map((a) => a.toUpperCase()).join(', ')),
          revRow('Skills', skills.size ? [...skills].map((s) => SKILL_LABEL[s]).join(', ') : '—'),
        ]));
        kids.push(el('div', { class: 'hint', text: 'Creates a full 5e sheet with these values and proficiency dots pre-filled. Everything stays editable.' }));
      }

      const nav = [el('button', { class: 'btn ghost', text: step === 0 ? 'Cancel' : 'Back', onclick: () => { if (step === 0) closeOverlay(); else { step--; render(); } } })];
      if (step < S.length - 1) nav.push(el('button', { class: 'btn primary', text: 'Next', onclick: () => { step++; render(); } }));
      else nav.push(el('button', { class: 'btn primary', text: 'Create character', onclick: () => createFromBuilder(data) }));
      kids.push(el('div', { class: 'btnrow' }, nav));
      return sheetCard(kids);
    },
  };
  render();
}
function revRow(k, v) { return el('div', { class: 'rev-row' }, [el('span', { class: 'rev-k', text: k }), el('span', { class: 'rev-v', text: v })]); }
function createFromBuilder(data) {
  const c = dnd5eCharacter(data.name.trim() || 'New Hero');
  const set = (id, patch) => { const v = c.values.find((x) => x.id === id); if (v) Object.assign(v, patch); };
  set('char_class', { text: data.cls.name });
  set('level', { value: data.level });
  if (data.race) set('race', { text: data.race.name });
  if (data.bg) set('background', { text: data.bg.name });
  if (data.race && data.race.speed) set('speed', { value: data.race.speed });
  ABILITY_KEYS.forEach(([k, , full]) => set(full, { value: finalScore(data, k) }));

  // Species/race traits + the 2024 Origin feat text land in Features & Traits;
  // the tool proficiency in Equipment (no dedicated feat/tool system yet).
  const feature = [];
  if (data.race && data.race.note) feature.push(`${data.race.name}: ${data.race.note}`);
  const feat = data.ed === '2024' && data.bg ? data.bg.feat : null;
  if (feat) feature.push(`Origin feat — ${feat}: ${FEAT_TEXT[feat] || '(see the PHB).'}`);
  if (feature.length) set('features', { text: feature.join('\n\n') });
  if (data.ed === '2024' && data.bg && data.bg.tool) set('equipment', { text: `Tool proficiency: ${data.bg.tool}` });

  // HP + the mechanically-clean bonuses: Dwarven Toughness (+1/level) and the
  // Tough feat (+2/level). Alert adds proficiency to Initiative.
  let hp = hpFor(data.cls.hd, abilityMod(finalScore(data, 'con')), data.level);
  if (data.race && data.race.hpPerLevel) hp += data.race.hpPerLevel * data.level;
  if (feat === 'Tough') hp += 2 * data.level;
  set('hp_max', { value: hp });
  set('hp_current', { value: hp });
  if (feat === 'Alert') set('initiative', { formula: 'dex_mod + proficiency_bonus' });
  // Proficiency dots: class saving throws + all granted/chosen skills.
  data.cls.saves.forEach((ab) => set(`save_${ab}_prof`, { value: true }));
  new Set([...grantedSkills(data), ...data.classSkills, ...data.freeSkills]).forEach((id) => set(`${id}_prof`, { value: true }));
  state.save.characters.push(c);
  state.save.activeCharacterId = c.id;
  state.overlay = null; state.view = 'sheet'; state.pageIndex = 0; state.mode = 'play';
  commit();
  toast(`Created ${c.name} — level ${data.level} ${data.cls.name}.`);
}

// ================================================================ PAGES (edit)
function addPage() {
  const c = activeChar();
  const name = prompt('New page name?', `Page ${c.pages.length + 1}`);
  if (name == null) return;
  c.pages.push({ id: newId('page'), name: name.trim() || `Page ${c.pages.length + 1}`, widgets: [] });
  state.pageIndex = c.pages.length - 1;
  commit();
}
function openPageOptions(p, i) {
  const c = activeChar();
  const movePage = (delta) => {
    const j = i + delta;
    if (j < 0 || j >= c.pages.length) return;
    const [pg] = c.pages.splice(i, 1);
    c.pages.splice(j, 0, pg);
    state.pageIndex = j;
    state.overlay = null; // close options (indices shifted); reopen to move again
    commit();
  };
  state.overlay = {
    render: () => sheetCard([
      el('h2', { text: `Page: ${p.name}` }),
      el('div', { class: 'menu-list' }, [
        el('button', { onclick: () => { const nm = prompt('Rename page', p.name); if (nm != null) { p.name = nm.trim() || p.name; commit(); } } }, [el('span', { class: 'mi', text: '✎' }), 'Rename']),
        el('button', { disabled: i === 0, onclick: () => movePage(-1) }, [el('span', { class: 'mi', text: '◀' }), 'Move left']),
        el('button', { disabled: i === c.pages.length - 1, onclick: () => movePage(1) }, [el('span', { class: 'mi', text: '▶' }), 'Move right']),
        el('button', { class: 'danger', onclick: () => {
          if (c.pages.length <= 1) { toast('A character needs at least one page.'); return; }
          confirmDialog({ title: `Delete page “${p.name}”?`, message: 'The page and its widget layout are removed (the underlying values stay).', confirmLabel: '🗑 Delete page', onConfirm: () => { c.pages = c.pages.filter((x) => x.id !== p.id); state.pageIndex = 0; commit(); } });
        } }, [el('span', { class: 'mi', text: '🗑' }), 'Delete page']),
      ]),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay })]),
    ]),
  };
  render();
}

// ============================================================ ADD WIDGET (B4)
function openAddWidget(page) {
  let query = '';
  state.overlay = {
    render() {
      const c = activeChar();
      const list = el('div', { class: 'menu-list' });
      // Rebuild only the results list on keystroke (avoids a full re-render that
      // would destroy the search input and drop focus mid-type).
      const refreshList = () => {
        list.innerHTML = '';
        const matches = c.values.filter((v) => (v.label + ' ' + v.id).toLowerCase().includes(query.toLowerCase()));
        matches.slice(0, 30).forEach((v) => list.append(el('button', {
          onclick: () => { page.widgets.push(newBoundWidget(v)); state.overlay = null; commit(); },
        }, [el('span', { class: 'mi', text: v.kind === 'calc' ? 'ƒ' : v.kind === 'text' ? 'T' : v.kind === 'bool' ? '☑' : '#' }), `${v.label}  `, el('span', { class: 'pill', text: v.id })])));
        if (!matches.length) list.append(el('div', { class: 'empty', text: 'No values match.' }));
      };
      refreshList();

      return sheetCard([
        el('h2', { text: 'Add widget' }),
        el('div', { class: 'field' }, [el('input', { placeholder: 'Search values…', value: query, oninput: (e) => { query = e.target.value; refreshList(); } })]),
        el('div', { class: 'btnrow', style: 'margin-bottom:10px' }, [
          el('button', { class: 'btn ghost', text: '⚔ Weapon', onclick: () => addWeapon(page) }),
          el('button', { class: 'btn ghost', text: '+ Value', onclick: () => openValueEditor(null, (v) => { page.widgets.push(newBoundWidget(v)); }) }),
          el('button', { class: 'btn ghost', text: '+ Label', onclick: () => { const t = prompt('Label text?', 'Section'); if (t != null) { page.widgets.push({ id: newId('w'), kind: 'label', title: t || 'Section', cols: 2 }); state.overlay = null; commit(); } } }),
        ]),
        list,
        el('div', { class: 'btnrow' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay })]),
      ]);
    },
  };
  render();
}

// =========================================================== WIDGET CONFIG (B2)
function openWidgetConfig(w, page) {
  state.overlay = {
    render() {
      const c = activeChar();
      const v = valueById(w.ref);
      const valueOptions = (sel, allowNone) => el('select', {
        onchange: (e) => sel(e.target.value || undefined),
      }, [
        allowNone ? el('option', { value: '', text: '— none —' }) : null,
        ...c.values.map((vv) => el('option', { value: vv.id, text: `${vv.label} (${vv.id})`, ...(0) })),
      ]);

      if (w.kind === 'label') {
        return sheetCard([
          el('h2', { text: 'Label widget' }),
          el('div', { class: 'field' }, [el('label', { text: 'Text' }), el('input', { value: w.title || '', oninput: (e) => { w.title = e.target.value; store.save(state.save); } })]),
          el('div', { class: 'btnrow' }, [
            el('button', { class: 'btn danger', text: 'Remove', onclick: () => removeWidget(w, page) }),
            el('button', { class: 'btn primary', text: 'Done', onclick: () => { closeOverlay(); } }),
          ]),
        ]);
      }

      const refSel = valueOptions((id) => { w.ref = id; commit(); }, false);
      refSel.value = w.ref || '';
      const secSel = valueOptions((id) => { w.secondaryRef = id; commit(); }, true);
      secSel.value = w.secondaryRef || '';
      const boolVals = c.values.filter((x) => x.kind === 'bool');
      const profSel = el('select', { onchange: (e) => { w.profRef = e.target.value || undefined; commit(); } }, [
        el('option', { value: '', text: '— none —' }),
        ...boolVals.map((x) => el('option', { value: x.id, text: `${x.label} (${x.id})` })),
      ]);
      profSel.value = w.profRef || '';

      return sheetCard([
        el('h2', { text: 'Configure widget' }),
        el('p', { class: 'desc', text: v ? `Tap this card in play mode to open its details. Resize it with the ⤡ handle on the card.` : 'Bind this widget to a value.' }),
        el('div', { class: 'field' }, [el('label', { text: 'Bound value (ref)' }), refSel]),
        el('div', { class: 'field' }, [el('label', { text: 'Secondary value (optional)' }), secSel]),
        el('div', { class: 'toggle-row', style: 'margin-top:2px' }, [
          el('div', {}, [
            el('div', { class: 'theme-nm', text: 'Editable in play mode' }),
            el('div', { class: 'desc', style: 'margin:0', text: 'Adjust this value directly on the sheet (e.g. HP −/+, notes). Off = read-only, tap for details.' }),
          ]),
          el('button', {
            class: `switch ${w.editableInPlay ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!w.editableInPlay),
            onclick: () => { w.editableInPlay = !w.editableInPlay; commit(); },
          }, el('span', { class: 'knob' })),
        ]),
        boolVals.length ? el('div', { class: 'field', style: 'margin-top:14px' }, [
          el('label', { text: 'Proficiency dot (boolean value)' }),
          profSel,
          el('div', { class: 'hint', text: 'Shows a fillable ● on the card; tapping it toggles that boolean (e.g. save/skill proficiency).' }),
        ]) : null,
        el('div', { class: 'field', style: `margin-top:${boolVals.length ? 0 : 14}px` }, [
          el('label', { text: 'Roll override (else uses value’s own roll)' }),
          el('input', { placeholder: v?.roll ? `inherits: ${v.roll}` : 'e.g. 1d20 + str_mod', value: w.rollOverride || '', oninput: (e) => { w.rollOverride = e.target.value || undefined; store.save(state.save); } }),
          el('div', { class: 'hint', text: 'Adds a roll button in this card’s details. The value’s own rolls also appear.' }),
        ]),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn ghost', text: '⧉ Duplicate', onclick: () => duplicateWidget(w, page) }),
          el('button', { class: 'btn ghost', text: 'Edit value…', onclick: () => v && openValueEditor(v) }),
        ]),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn danger', text: 'Remove', onclick: () => removeWidget(w, page) }),
          el('button', { class: 'btn primary', text: 'Done', onclick: closeOverlay }),
        ]),
      ]);
    },
  };
  render();
}
function removeWidget(w, page) {
  page.widgets = page.widgets.filter((x) => x.id !== w.id);
  closeOverlay(); commit();
}
function duplicateWidget(w, page) {
  const copy = { ...JSON.parse(JSON.stringify(w)), id: newId('w') };
  const at = page.widgets.findIndex((x) => x.id === w.id);
  page.widgets.splice(at + 1, 0, copy);
  closeOverlay(); commit();
}

// ============================================================ VALUE EDITOR (B3)
const SLUG_RE = /^[a-z][a-z0-9_]*$/;
function openValueEditor(existing, onCreate) {
  const c = activeChar();
  const creating = !existing;
  // Edit a deep clone so "Cancel" truly discards; committed back on Save.
  const v = existing ? JSON.parse(JSON.stringify(existing)) : { id: '', label: '', kind: 'number', value: 0, text: '', formula: '', description: '', group: '' };
  // Normalise to the multi-roll array (migrating a legacy single `roll`).
  if (!Array.isArray(v.rolls)) v.rolls = v.roll ? [{ name: '', expr: v.roll }] : [];
  let idDraft = v.id;

  state.overlay = {
    render() {
      const validate = () => {
        // live-validate the formula/roll -> show ERR hint
        if (v.kind === 'calc') {
          const test = computeAll([...c.values.filter((x) => x.id !== v.id), { ...v, id: v.id || '__tmp__' }]);
          const r = test.results.get(v.id || '__tmp__');
          const d = test.details.get(v.id || '__tmp__');
          return r === 'ERR' ? (d?.error || 'error') : null;
        }
        return null;
      };
      const err = validate();

      const idField = creating
        ? el('input', { placeholder: 'lowercase_slug', value: idDraft, oninput: (e) => { idDraft = e.target.value; } })
        : el('input', { class: 'locked', value: v.id, readonly: true, title: 'Value ids are immutable — formulas reference them.' });

      const kindSeg = el('div', { class: 'seg' }, ['number', 'text', 'calc', 'bool'].map((k) => el('button', { class: v.kind === k ? 'on' : '', text: k, onclick: () => { v.kind = k; render(); } })));

      const kindFields = el('div');
      if (v.kind === 'number') kindFields.append(field('Value', el('input', { type: 'number', value: v.value ?? 0, oninput: (e) => { v.value = Number(e.target.value); } })));
      if (v.kind === 'text') kindFields.append(field('Text', el('input', { value: v.text || '', oninput: (e) => { v.text = e.target.value; } })));
      if (v.kind === 'bool') kindFields.append(el('div', { class: 'toggle-row', style: 'margin-top:2px' }, [
        el('div', {}, [
          el('div', { class: 'theme-nm', text: 'Default state' }),
          el('div', { class: 'desc', style: 'margin:0', text: 'A checkbox/dot value. Reads as 1 (on) or 0 (off) inside formulas — e.g. proficient × proficiency_bonus.' }),
        ]),
        el('button', { class: `switch ${v.value ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!v.value), onclick: () => { v.value = !v.value; render(); } }, el('span', { class: 'knob' })),
      ]));
      if (v.kind === 'calc') {
        // Build the formula field by hand so keystrokes update only the ERR hint
        // (not a full re-render, which would destroy the input and drop focus).
        const fInput = el('input', { value: v.formula || '', placeholder: '10 + dex_mod' });
        const fHint = el('div', { class: 'hint' });
        const upd = () => { const e2 = validate(); fHint.textContent = e2 ? `ERR — ${e2}` : 'Deterministic. Other values may depend on this.'; fHint.classList.toggle('err', !!e2); };
        fInput.addEventListener('input', () => { v.formula = fInput.value; upd(); });
        upd();
        kindFields.append(el('div', { class: 'field' }, [el('label', { text: 'Formula (no dice)' }), fInput, fHint]));
      }

      return sheetCard([
        el('h2', { text: creating ? 'New value' : 'Edit value' }),
        field(creating ? 'ID (slug, permanent)' : 'ID (locked)', idField, creating ? 'Lowercase, starts with a letter. Cannot change later.' : 'Immutable — rename the label instead.'),
        field('Label', el('input', { value: v.label || '', placeholder: 'Display name', oninput: (e) => { v.label = e.target.value; } })),
        field('Kind', kindSeg),
        kindFields,
        el('div', { class: 'field' }, [
          el('label', { text: 'Rolls (dice allowed) — e.g. Attack, Damage' }),
          ...v.rolls.map((r, i) => el('div', { class: 'rolledit' }, [
            el('input', { class: 'rn-in', placeholder: 'Name', value: r.name || '', oninput: (e) => { r.name = e.target.value; } }),
            el('input', { class: 're-in', placeholder: '1d20 + str_mod', value: r.expr || '', oninput: (e) => { r.expr = e.target.value; } }),
            el('button', { class: 'rrm', text: '×', title: 'Remove roll', onclick: () => { v.rolls.splice(i, 1); render(); } }),
          ])),
          el('button', { class: 'btn ghost', style: 'margin-top:4px', text: '+ Add roll', onclick: () => { v.rolls.push({ name: '', expr: '' }); render(); } }),
          el('div', { class: 'hint', text: 'Each roll becomes its own button in the detail view. Nothing may depend on a roll.' }),
        ]),
        field('Description (shown on detail)', el('input', { value: v.description || '', oninput: (e) => { v.description = e.target.value; } })),
        field('Group (editor organisation)', el('input', { value: v.group || '', oninput: (e) => { v.group = e.target.value; } })),
        el('div', { class: 'btnrow' }, [
          !creating ? el('button', { class: 'btn danger', text: 'Delete', onclick: () => deleteValue(v) }) : null,
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeOverlay }),
          el('button', { class: 'btn primary', text: 'Save', onclick: () => saveValue() }),
        ]),
      ]);

      function saveValue() {
        // normalise fields to the chosen kind
        if (v.kind === 'number') { v.value = Number(v.value) || 0; v.text = undefined; v.formula = undefined; }
        else if (v.kind === 'bool') { v.value = !!v.value; v.text = undefined; v.formula = undefined; }
        else if (v.kind === 'text') { v.value = undefined; v.formula = undefined; }
        else if (v.kind === 'calc') { v.value = undefined; v.text = undefined; }
        delete v.roll; // standardise on the rolls[] array
        v.rolls = (v.rolls || []).filter((r) => r && r.expr && r.expr.trim())
          .map((r) => ({ name: (r.name || '').trim(), expr: r.expr.trim() }));
        if (!v.rolls.length) delete v.rolls;
        if (creating) {
          const id = (idDraft || '').trim();
          if (!SLUG_RE.test(id)) { toast('ID must be a lowercase slug (a–z, 0–9, _).'); return; }
          if (c.values.some((x) => x.id === id)) { toast(`ID "${id}" already exists.`); return; }
          v.id = id;
          if (!v.label) v.label = id;
          c.values.push(v);
          state.overlay = null;
          commit();
          if (onCreate) { onCreate(v); }
          return;
        }
        // Write the edited clone back over the live value (id is immutable).
        const at = c.values.findIndex((x) => x.id === v.id);
        if (at >= 0) c.values[at] = v; else c.values.push(v);
        closeOverlay(); commit();
      }
    },
  };
  render();
}
function field(label, input, hint) {
  return el('div', { class: 'field' }, [el('label', { text: label }), input, hint ? el('div', { class: `hint ${/^ERR/.test(hint) ? 'err' : ''}`, text: hint }) : null]);
}
function deleteValue(v) {
  const c = activeChar();
  const rx = new RegExp(`\\b${v.id}\\b`);
  // Anything that references this id: calc formulas, rolls, or legacy roll.
  const dependents = c.values.filter((x) => x.id !== v.id && (
    (x.kind === 'calc' && rx.test(x.formula || '')) ||
    (x.rolls || []).some((r) => rx.test(r.expr || '')) ||
    rx.test(x.roll || '')
  ));
  confirmDialog({
    title: `Delete value “${v.label || v.id}”?`,
    message: dependents.length
      ? `${dependents.length} formula(s) reference “${v.id}” and will show ERR after deletion. Widgets bound to it are removed.`
      : 'Removes the value and any widgets bound to it. This cannot be undone.',
    confirmLabel: '🗑 Delete value',
    onConfirm: () => {
      c.values = c.values.filter((x) => x.id !== v.id);
      c.pages.forEach((p) => {
        p.widgets = p.widgets.filter((w) => !(w.kind === 'bound' && w.ref === v.id));
        p.widgets.forEach((w) => { if (w.secondaryRef === v.id) w.secondaryRef = undefined; });
      });
      closeOverlay(); commitNow();
    },
  });
}

// ============================================================ SHARE / IMPORT (C3/C4)
function openShare() {
  state.overlay = {
    render() {
      const c = activeChar();
      const items = [];
      if (c) {
        items.push(el('button', { onclick: () => { const { filename, json } = store.exportCharacter(c); store.download(filename, json); toast('Character exported.'); } }, [el('span', { class: 'mi', text: '☺' }), `Export “${c.name}”`]));
        items.push(el('button', { onclick: () => { const { filename, json } = store.exportPack(c, c.name); store.download(filename, json); toast('Pack exported.'); } }, [el('span', { class: 'mi', text: '❑' }), 'Export as pack (values + layout)']));
      }
      items.push(el('button', { onclick: () => { const { filename, json } = store.exportEverything(state.save); store.download(filename, json); toast('Full backup exported.'); } }, [el('span', { class: 'mi', text: '⛃' }), 'Export everything (backup)']));
      items.push(el('button', { onclick: pickImportFile }, [el('span', { class: 'mi', text: '↧' }), 'Import a .json file']));

      return sheetCard([
        el('h2', { text: 'Share & backup' }),
        el('p', { class: 'desc', text: 'JSON files are the only backup and the share format — no server, no accounts.' }),
        el('div', { class: 'menu-list' }, items),
        el('div', { class: 'btnrow' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay })]),
      ]);
    },
  };
  render();
}

function pickImportFile() {
  const input = $('#file-input');
  input.value = '';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch { toast('Not valid JSON.'); return; }
      handleImport(data);
    };
    reader.readAsText(file);
  };
  input.click();
}

function handleImport(data) {
  const analysis = store.analyzeImport(data);
  if (analysis.type === 'refused' || analysis.type === 'invalid') { alert(analysis.reason); return; }

  if (analysis.type === 'savefile') {
    const { added } = store.importSaveFile(state.save, analysis.save);
    state.overlay = null; state.view = 'home';
    commit();
    toast(`Imported ${added.length} character(s).`);
    return;
  }

  // pack — needs a target character; show conflict-aware dialog (C4)
  const c = activeChar();
  if (!c) { toast('Open a character first to import a pack into it.'); return; }
  openPackImport(c, analysis.pack);
}

function openPackImport(c, pack) {
  // detect collisions
  const existingIds = new Set(c.values.map((v) => v.id));
  const collisions = pack.values.filter((v) => existingIds.has(v.id)).map((v) => v.id);
  let mode = 'suffix';
  state.overlay = {
    render() {
      return sheetCard([
        el('h2', { text: `Import pack: ${pack.name || 'Untitled'}` }),
        el('p', { class: 'desc', text: `${pack.values.length} value(s)${pack.pages ? `, ${pack.pages.length} page(s)` : ''} → into “${c.name}”. Non-destructive: your existing values are never overwritten.` }),
        collisions.length ? el('div', { class: 'warnbanner' }, [el('span', { text: '⚠' }), el('span', { text: `${collisions.length} id collision(s): ${collisions.slice(0, 5).join(', ')}${collisions.length > 5 ? '…' : ''}` })]) : el('p', { class: 'desc', text: 'No id collisions.' }),
        collisions.length ? el('div', { class: 'field' }, [
          el('label', { text: 'On collision' }),
          el('div', { class: 'seg small' }, [
            el('button', { class: mode === 'suffix' ? 'on' : '', text: 'Import suffixed (id_2)', onclick: () => { mode = 'suffix'; render(); } }),
            el('button', { class: mode === 'skip' ? 'on' : '', text: 'Skip colliding', onclick: () => { mode = 'skip'; render(); } }),
          ]),
        ]) : null,
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeOverlay }),
          el('button', { class: 'btn primary', text: 'Import', onclick: () => {
            const res = store.importPackInto(c, pack, { mode, addPages: true });
            state.overlay = null; commit();
            toast(`Added ${res.addedValues} value(s)${res.renamed ? `, ${res.renamed} renamed` : ''}.`);
          } }),
        ]),
      ]);
    },
  };
  render();
}

// --- one-time layout migration ---------------------------------------------
// v1 used a 2-column grid (cols 1|2, rows 1..3) with a per-widget `tap` enum.
// v2 uses a 4-column fine grid (cols 1–4, rows are a growable floor) and a
// per-widget `editableInPlay` flag; all taps open Details. Scale old layouts
// ×2 and translate `tap:'none'` (directly-editable faces) → editableInPlay.
function migrateSave(save) {
  if (save.layoutScale === 4) return;
  for (const c of save.characters || []) {
    for (const p of c.pages || []) {
      for (const w of p.widgets || []) {
        w.cols = Math.max(1, Math.min(4, (w.cols || 1) * 2));
        w.rows = Math.max(1, (w.rows || 1) * 2);
        if (w.kind === 'bound') w.editableInPlay = (w.tap === undefined || w.tap === 'none');
        delete w.tap;
      }
    }
  }
  save.layoutScale = 4;
}

// Retrofit proficiency onto pre-existing 5e characters: any calc value whose
// formula is exactly a raw ability mod (`str_mod`, `dex_mod`, …) gains a boolean
// `<id>_prof` leaf and `mod + <id>_prof * proficiency_bonus`; widgets bound to it
// get a `profRef`. Purely additive and pattern-matched — leaves edited formulas
// untouched. Runs once (guarded by save.profUpgrade).
function upgradeProficiency(save) {
  if (save.profUpgrade) return;
  const RAW = /^\s*(str|dex|con|int|wis|cha)_mod\s*$/;
  for (const c of save.characters || []) {
    if (c.preset !== 'dnd5e') continue;
    const has = new Set(c.values.map((v) => v.id));
    if (!has.has('proficiency_bonus')) continue;
    const upgraded = new Set();
    for (const v of [...c.values]) {
      if (v.kind !== 'calc') continue;
      const m = RAW.exec(v.formula || '');
      if (!m) continue;
      const profId = `${v.id}_prof`;
      if (has.has(profId)) continue;
      c.values.push({ id: profId, label: `${v.label || v.id} Proficient`, kind: 'bool', value: false, group: v.group });
      has.add(profId);
      v.formula = `${m[1]}_mod + ${profId} * proficiency_bonus`;
      upgraded.add(v.id);
    }
    for (const p of c.pages || []) for (const w of p.widgets || []) {
      if (w.kind === 'bound' && upgraded.has(w.ref) && !w.profRef) w.profRef = `${w.ref}_prof`;
    }
  }
  save.profUpgrade = true;
}

// --- boot ------------------------------------------------------------------
migrateSave(state.save);
upgradeProficiency(state.save);
store.saveNow(state.save);
applyTheme(state.theme);
if (new URLSearchParams(location.search).get('sheet') && state.save.activeCharacterId) state.view = 'sheet';
render();
// expose a little for console tinkering
window.parchment = { state, store };
