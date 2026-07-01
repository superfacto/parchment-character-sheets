// Parchment — app shell & UI (SPEC groups A/B/C). Vanilla JS, no framework.
import { computeAll, evalRoll } from './engine.js';
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
};

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

// --- render dispatch -------------------------------------------------------
function render() {
  recompute();
  const app = $('#app');
  app.innerHTML = '';
  // Overlays/toasts live on <body>, not inside #app — clear the stale ones so
  // closing an overlay actually removes it (and re-renders don't stack copies).
  document.querySelectorAll('body > .scrim, body > .toast').forEach((n) => n.remove());
  const frame = el('div', { class: `frame ${state.mode === 'edit' && state.view === 'sheet' ? 'edit' : ''}` });
  if (state.view === 'home' || !activeChar()) frame.append(renderHome());
  else frame.append(...renderSheet());
  app.append(frame);
  if (state.overlay) document.body.append(renderOverlay());
  if (state.toast) document.body.append(el('div', { class: 'toast', text: state.toast }));
}

// ======================================================================= HOME
function renderHome() {
  const wrap = el('div', { class: 'home' });
  wrap.append(el('h1', { text: 'Parchment' }));
  wrap.append(el('p', { class: 'tagline', text: 'Your character sheets — on paper, offline.' }));
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
      class: `tab ${i === state.pageIndex ? 'on' : ''}`, text: p.name,
      onclick: () => { state.pageIndex = i; render(); },
      ...(state.mode === 'edit' ? { ondblclick: () => renamePage(p) } : {}),
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
  return [appbar, pagebar, sheet];
}

function renderWidget(w, index, page) {
  if (w.kind === 'label') {
    const node = el('div', { class: 'wdg label c2' }, [el('div', { class: 'lbl', text: w.title || 'Section' })]);
    if (state.mode === 'edit') decorateEdit(node, w, index, page);
    return node;
  }

  const v = valueById(w.ref);
  const spanClass = `${(w.cols || 1) >= 2 ? 'c2' : ''} ${w.rows === 2 ? 'r2' : w.rows >= 3 ? 'r3' : ''}`;
  const node = el('div', { class: `wdg ${spanClass}` });

  if (!v) {
    node.append(el('div', { class: 'wl', text: w.ref || '—' }), el('div', { class: 'wv err', text: 'ERR' }));
    if (state.mode === 'edit') decorateEdit(node, w, index, page);
    return node;
  }

  const label = w.title || v.label;
  node.append(el('div', { class: 'wl', text: label }));

  // Display face derived from bound value kind (§9).
  const numberHasTap = v.kind === 'number' && w.tap && w.tap !== 'none';
  if (v.kind === 'number' && state.mode === 'play' && !numberHasTap) {
    // No tap action → the number is directly editable inline (quick HP edits etc).
    node.classList.add('num');
    const input = el('input', {
      type: 'number', value: v.value ?? 0, inputmode: 'numeric',
      onchange: (e) => { v.value = e.target.value === '' ? 0 : Number(e.target.value); commit(); },
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    node.append(input);
  } else if (numberHasTap && state.mode === 'play') {
    // Tap is reserved for the roll/detail action; editing is via the ✎ affordance
    // (SPEC §9: "editable inline via tap-hold or an edit affordance").
    node.append(el('div', { class: 'wv', text: String(v.value ?? 0) }));
    const pencil = el('button', { class: 'editnum', text: '✎', title: 'Edit value' });
    pencil.addEventListener('click', (e) => { e.stopPropagation(); editNumberInline(node, v); });
    node.append(pencil);
  } else if (v.kind === 'text' && (w.rows || 1) >= 2 && state.mode === 'play' && w.tap === 'none') {
    const ta = el('textarea', { rows: (w.rows || 2) * 2, oninput: (e) => { v.text = e.target.value; store.save(state.save); } }, []);
    ta.value = v.text || '';
    ta.addEventListener('click', (e) => e.stopPropagation());
    node.append(ta);
  } else {
    const disp = displayValue(v);
    node.append(el('div', { class: `wv ${v.kind === 'text' ? 'text' : ''} ${disp === 'ERR' ? 'err' : ''}`, text: disp }));
  }

  if (w.secondaryRef) {
    const s = valueById(w.secondaryRef);
    if (s) node.append(el('div', { class: 'ws', text: `${s.label}: ${displayValue(s)}` }));
  }

  // Tap markers
  if (state.mode === 'play' && w.tap && w.tap !== 'none') {
    const rollExpr = w.rollOverride || v.roll;
    if (w.tap === 'roll' && rollExpr) node.append(el('div', { class: 'marker', text: w.rollOverride ? '⬡' : '⚔' }));
    if (w.tap === 'detail') node.append(el('div', { class: 'marker', text: 'ⓘ' }));
    node.classList.add('tappable');
    node.addEventListener('click', () => {
      if (w.tap === 'roll' && rollExpr) openRoll(v, rollExpr, label);
      else if (w.tap === 'detail') openDetail(v, label);
    });
  }

  if (state.mode === 'edit') decorateEdit(node, w, index, page);
  return node;
}

function displayValue(v) {
  if (v.kind === 'calc') { const r = computed.results.get(v.id); return r === undefined ? 'ERR' : String(r); }
  if (v.kind === 'text') return v.text || '—';
  return String(v.value ?? 0);
}

// Swap a read-only number face for an inline editor (used when the widget's
// plain tap is reserved for a roll/detail action).
function editNumberInline(node, v) {
  const wv = node.querySelector('.wv');
  if (!wv) return;
  const input = el('input', { class: 'inlinenum', type: 'number', inputmode: 'numeric' });
  input.value = v.value ?? 0;
  wv.replaceWith(input);
  input.focus(); input.select();
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  input.addEventListener('blur', () => { v.value = input.value === '' ? 0 : Number(input.value); commit(); }, { once: true });
}

// --- edit-mode widget chrome ----------------------------------------------
function decorateEdit(node, w, index, page) {
  node.classList.add('editing');
  node.classList.remove('num');
  // replace any live input face with a static one in edit mode
  const handle = el('div', { class: 'drag', text: '⠿', title: 'Drag to reorder' });
  node.prepend(handle);
  const size = w.cols >= 2 && w.rows >= 3 ? 'L' : w.cols >= 2 ? 'M' : 'S';
  node.append(el('div', { class: 'editrow' }, [
    el('span', { class: 'szchip', text: size }),
    el('button', { class: 'cfg', text: 'Edit', onclick: (e) => { e.stopPropagation(); openWidgetConfig(w, page); } }),
  ]));
  enableDragReorder(node, handle, index, page);
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

// A2 — Roll result
function openRoll(v, expr, label) {
  const doRoll = () => evalRoll(expr, (name) => {
    const r = computed.results.get(name);
    if (typeof r === 'number') return r;
    throw new Error(`bad ref ${name}`);
  });
  let result;
  try { result = doRoll(); } catch { result = { total: 'ERR', display: 'unknown reference', parts: [] }; }
  state.overlay = {
    center: true,
    render() {
      let res = result;
      const bigEl = el('div', { class: 'rollbig', text: res.total });
      const breakEl = el('div', { class: 'rollbreak', html: formatBreak(res) });
      const rerender = () => { try { res = doRoll(); } catch { res = { total: 'ERR', display: '—', parts: [] }; } bigEl.textContent = res.total; breakEl.innerHTML = formatBreak(res); };
      return sheetCard([
        el('h2', { text: `${label} — Roll` }),
        el('p', { class: 'desc', text: expr }),
        bigEl, breakEl,
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn primary', text: '↻ Roll again', onclick: rerender }),
          el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay }),
        ]),
      ]);
    },
  };
  render();
}
function formatBreak(res) {
  if (!res.parts || !res.parts.length) return res.display || '—';
  const segs = res.parts.map((p) => p.rolls ? `${p.label} <b>(${p.rolls.join('+')})</b>` : `${p.label} <b>(${p.value})</b>`);
  return `${segs.join('<span class="op"> + </span>')}<span class="op"> = </span><b>${res.total}</b>`;
}

// A3 — Detail (calc / description)
function openDetail(v, label) {
  state.overlay = {
    center: true,
    render() {
      const kids = [el('h2', { text: label })];
      if (v.kind === 'calc') {
        const det = computed.details.get(v.id) || {};
        const result = computed.results.get(v.id);
        if (det.error) kids.push(el('div', { class: 'formula' }, [el('span', { class: 'err', text: `ERR — ${det.error}` })]));
        else kids.push(el('div', { class: 'formula', text: `= ${v.formula}  →  ${result}` }));
      }
      if (v.description) kids.push(el('p', { class: 'desc', style: 'margin-top:12px', text: v.description }));
      if (v.kind !== 'calc' && !v.description) kids.push(el('p', { class: 'desc', text: 'No details.' }));
      kids.push(el('div', { class: 'btnrow' }, [el('button', { class: 'btn primary', text: 'Close', onclick: closeOverlay })]));
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
        el('button', { onclick: () => { closeOverlay(); openShare(); } }, [el('span', { class: 'mi', text: '↥' }), 'Share & backup']),
        el('button', { onclick: () => { closeOverlay(); state.mode = state.mode === 'edit' ? 'play' : 'edit'; render(); } }, [el('span', { class: 'mi', text: '✎' }), state.mode === 'edit' ? 'Exit edit mode' : 'Edit this sheet']),
        el('button', { onclick: () => { closeOverlay(); openPrivacy(); } }, [el('span', { class: 'mi', text: '🔒' }), 'Privacy']),
        el('button', { class: 'danger', onclick: () => { const c = activeChar(); if (c) confirmDeleteCharacter(c); } }, [el('span', { class: 'mi', text: '🗑' }), 'Delete character']),
      ]),
      el('div', { class: 'btnrow' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeOverlay })]),
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
        'Once the page has loaded, the app makes no requests to any third party. It uses your device’s system fonts (no web-font CDN) and works fully offline. Installed as a home-screen app, even its own files are served from an on-device cache.'),

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
  let name = '';
  let start = 'dnd5e';
  state.overlay = {
    render() {
      const nameInput = el('input', { placeholder: 'e.g. Thordak', value: name, oninput: (e) => { name = e.target.value; } });
      const pick = (val) => { start = val; render(); };
      return sheetCard([
        el('h2', { text: 'New character' }),
        el('div', { class: 'field' }, [el('label', { text: 'Name' }), nameInput]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Start from' }),
          el('div', { class: 'seg' }, [
            el('button', { class: start === 'dnd5e' ? 'on' : '', text: '● D&D 5e preset', onclick: () => pick('dnd5e') }),
            el('button', { class: start === 'blank' ? 'on' : '', text: '○ Blank', onclick: () => pick('blank') }),
          ]),
          el('div', { class: 'hint', text: start === 'dnd5e' ? 'Full 5e sheet — abilities, saves, skills, attacks. Editable after.' : 'An empty sheet with a single notes widget.' }),
        ]),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeOverlay }),
          el('button', { class: 'btn primary', text: 'Create', onclick: () => {
            const nm = name.trim() || (start === 'dnd5e' ? 'New Hero' : 'New Character');
            const c = start === 'dnd5e' ? dnd5eCharacter(nm) : blankCharacter(nm);
            state.save.characters.push(c);
            state.save.activeCharacterId = c.id;
            state.overlay = null; state.view = 'sheet'; state.pageIndex = 0; state.mode = 'play';
            commit();
          } }),
        ]),
      ]);
    },
  };
  render();
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
function renamePage(p) {
  const c = activeChar();
  const choice = prompt(`Rename page "${p.name}" (or type DELETE to remove it):`, p.name);
  if (choice == null) return;
  if (choice.trim().toUpperCase() === 'DELETE') {
    if (c.pages.length <= 1) { toast('A character needs at least one page.'); return; }
    c.pages = c.pages.filter((x) => x.id !== p.id);
    state.pageIndex = 0;
  } else {
    p.name = choice.trim() || p.name;
  }
  commit();
}

// ============================================================ ADD WIDGET (B4)
function openAddWidget(page) {
  let query = '';
  state.overlay = {
    render() {
      const c = activeChar();
      const matches = c.values.filter((v) => (v.label + ' ' + v.id).toLowerCase().includes(query.toLowerCase()));
      const list = el('div', { class: 'menu-list' });
      matches.slice(0, 30).forEach((v) => list.append(el('button', {
        onclick: () => { page.widgets.push({ id: newId('w'), kind: 'bound', ref: v.id, cols: 1, rows: 1, tap: v.roll ? 'roll' : v.kind === 'calc' ? 'detail' : 'none' }); state.overlay = null; commit(); },
      }, [el('span', { class: 'mi', text: v.kind === 'calc' ? 'ƒ' : v.kind === 'text' ? 'T' : '#' }), `${v.label}  `, el('span', { class: 'pill', text: v.id })])));
      if (!matches.length) list.append(el('div', { class: 'empty', text: 'No values match.' }));

      return sheetCard([
        el('h2', { text: 'Add widget' }),
        el('div', { class: 'field' }, [el('input', { placeholder: 'Search values…', value: query, oninput: (e) => { query = e.target.value; render(); } })]),
        el('div', { class: 'btnrow', style: 'margin-bottom:10px' }, [
          el('button', { class: 'btn ghost', text: '+ New value', onclick: () => openValueEditor(null, (v) => { page.widgets.push({ id: newId('w'), kind: 'bound', ref: v.id, cols: 1, rows: 1, tap: v.roll ? 'roll' : v.kind === 'calc' ? 'detail' : 'none' }); }) }),
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
      const size = w.cols >= 2 && w.rows >= 3 ? 'L' : w.cols >= 2 ? 'M' : 'S';
      const setSize = (s) => { if (s === 'S') { w.cols = 1; w.rows = 1; } else if (s === 'M') { w.cols = 2; w.rows = 1; } else { w.cols = 2; w.rows = 3; } commit(); };
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

      return sheetCard([
        el('h2', { text: 'Configure widget' }),
        el('p', { class: 'desc', text: v ? `Display face follows the bound value's kind (${v.kind}).` : 'Bind this widget to a value.' }),
        el('div', { class: 'field' }, [el('label', { text: 'Bound value (ref)' }), refSel]),
        el('div', { class: 'field' }, [el('label', { text: 'Secondary value (optional)' }), secSel]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Size' }),
          el('div', { class: 'seg small' }, ['S', 'M', 'L'].map((s) => el('button', { class: size === s ? 'on' : '', text: s, onclick: () => setSize(s) }))),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Tap action' }),
          el('div', { class: 'seg small' }, ['none', 'detail', 'roll'].map((t) => el('button', { class: (w.tap || 'none') === t ? 'on' : '', text: t, onclick: () => { w.tap = t; commit(); } }))),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Roll override (else uses value.roll)' }),
          el('input', { placeholder: v?.roll ? `inherits: ${v.roll}` : 'e.g. 1d20 + str_mod', value: w.rollOverride || '', oninput: (e) => { w.rollOverride = e.target.value || undefined; store.save(state.save); } }),
          el('div', { class: 'hint', text: 'rollOverride wins; otherwise the bound value’s own roll is used.' }),
        ]),
        el('div', { class: 'btnrow' }, [
          el('button', { class: 'btn danger', text: 'Remove', onclick: () => removeWidget(w, page) }),
          el('button', { class: 'btn ghost', text: 'Edit value…', onclick: () => v && openValueEditor(v) }),
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

// ============================================================ VALUE EDITOR (B3)
const SLUG_RE = /^[a-z][a-z0-9_]*$/;
function openValueEditor(existing, onCreate) {
  const c = activeChar();
  const creating = !existing;
  // working copy
  const v = existing || { id: '', label: '', kind: 'number', value: 0, text: '', formula: '', roll: '', description: '', group: '' };
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

      const kindSeg = el('div', { class: 'seg' }, ['number', 'text', 'calc'].map((k) => el('button', { class: v.kind === k ? 'on' : '', text: k, onclick: () => { v.kind = k; render(); } })));

      const kindFields = el('div');
      if (v.kind === 'number') kindFields.append(field('Value', el('input', { type: 'number', value: v.value ?? 0, oninput: (e) => { v.value = Number(e.target.value); } })));
      if (v.kind === 'text') kindFields.append(field('Text', el('input', { value: v.text || '', oninput: (e) => { v.text = e.target.value; } })));
      if (v.kind === 'calc') kindFields.append(field('Formula (no dice)', el('input', { value: v.formula || '', placeholder: '10 + dex_mod', oninput: (e) => { v.formula = e.target.value; render(); } }), err ? `ERR — ${err}` : 'Deterministic. Other values may depend on this.'));

      return sheetCard([
        el('h2', { text: creating ? 'New value' : 'Edit value' }),
        field(creating ? 'ID (slug, permanent)' : 'ID (locked)', idField, creating ? 'Lowercase, starts with a letter. Cannot change later.' : 'Immutable — rename the label instead.'),
        field('Label', el('input', { value: v.label || '', placeholder: 'Display name', oninput: (e) => { v.label = e.target.value; } })),
        field('Kind', kindSeg),
        kindFields,
        field('Roll (optional, dice allowed)', el('input', { value: v.roll || '', placeholder: '1d20 + str_mod', oninput: (e) => { v.roll = e.target.value; } }), 'A tappable dice expression. Nothing may depend on it.'),
        field('Description (shown on detail)', el('input', { value: v.description || '', oninput: (e) => { v.description = e.target.value; } })),
        field('Group (editor organisation)', el('input', { value: v.group || '', oninput: (e) => { v.group = e.target.value; } })),
        el('div', { class: 'btnrow' }, [
          !creating ? el('button', { class: 'btn danger', text: 'Delete', onclick: () => deleteValue(v) }) : null,
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeOverlay }),
          el('button', { class: 'btn primary', text: 'Save', onclick: () => saveValue() }),
        ]),
      ]);

      function saveValue() {
        // normalise empties
        if (v.kind !== 'number') v.value = undefined;
        if (v.kind !== 'text') v.text = v.kind === 'text' ? v.text : undefined;
        if (v.kind !== 'calc') v.formula = undefined;
        if (!v.roll) delete v.roll;
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
  const dependents = c.values.filter((x) => x.kind === 'calc' && new RegExp(`\\b${v.id}\\b`).test(x.formula || ''));
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

// --- boot ------------------------------------------------------------------
if (new URLSearchParams(location.search).get('sheet') && state.save.activeCharacterId) state.view = 'sheet';
render();
// expose a little for console tinkering
window.parchment = { state, store };
