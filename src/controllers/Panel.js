/**
 * Panel.js — controller profile: batas CONFIG vs CODE.
 *
 * CONFIG (JSON, mis. haas-style.json) menentukan: struktur, label, urutan, id,
 * pane, view, nama action, daftar DRO, subtab setup, mode default.
 * CODE (di sini + main.js) menyediakan: validasi profil (normalizeProfile,
 * murni tanpa DOM) dan implementasi tiap action (registry di main.js).
 *
 * Perilaku tidak berasal dari data murni tanpa berubah jadi bahasa program;
 * batas ini sengaja. Action tak dikenal → fallback aman di main.js.
 */

export const DEFAULT_PROFILE = {
  name: 'fallback',
  version: 1,
  default: 'mem',
  modes: [
    { id: 'edit', label: 'EDIT', pane: 'program', view: 'editor' },
    { id: 'mem', label: 'MEM', pane: 'program', view: 'lines' },
    { id: 'mdi', label: 'MDI', pane: 'program', view: 'mdi' },
    { id: 'jog', label: 'JOG', pane: 'jog' },
    { id: 'setup', label: 'SETUP', pane: 'setup' }
  ],
  droModes: [
    { id: 'work', label: 'WORK' },
    { id: 'machine', label: 'MACHINE' },
    { id: 'operator', label: 'OPERATOR' },
    { id: 'dtg', label: 'DTG' }
  ],
  setupSubs: [
    { id: 'work', label: 'WORK' },
    { id: 'tool', label: 'TOOL' },
    { id: 'stock', label: 'STOCK' }
  ],
  softkeys: [
    { f: 1, label: 'OFFSET', action: 'open-offset' },
    { f: 2, label: 'CURNT CMDS', action: 'current-cmds' },
    { f: 3, label: 'ALARM', action: 'alarm' },
    { f: 4, label: 'GRAPH', action: 'graph' },
    { f: 5, label: 'TRAINING', action: 'training' },
    { f: 6, label: 'COOLANT', action: 'coolant' },
    { f: 7, label: 'SINGLE BLK', action: 'single-block' },
    { f: 8, label: 'DRY RUN', action: 'dry-run' }
  ]
};

function dedupeById(list, key) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = item[key];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function normModes(raw) {
  const src = Array.isArray(raw) ? raw : [];
  const modes = src
    .filter((m) => m && typeof m.id === 'string' && m.id)
    .map((m) => {
      const mode = {
        id: m.id,
        label: m.label || m.id.toUpperCase(),
        pane: m.pane || 'program'
      };
      if (m.view) mode.view = m.view;
      return mode;
    });
  const unique = dedupeById(modes, 'id');
  return unique.length ? unique : DEFAULT_PROFILE.modes.map((m) => ({ ...m }));
}

function normDro(raw) {
  const src = Array.isArray(raw) ? raw : [];
  const list = src
    .filter((d) => d && typeof d.id === 'string' && d.id)
    .map((d) => ({ id: d.id, label: d.label || d.id.toUpperCase() }));
  const unique = dedupeById(list, 'id');
  return unique.length ? unique : DEFAULT_PROFILE.droModes.map((d) => ({ ...d }));
}

function normSubs(raw) {
  const src = Array.isArray(raw) ? raw : [];
  const list = src
    .filter((s) => s && typeof s.id === 'string' && s.id)
    .map((s) => ({ id: s.id, label: s.label || s.id.toUpperCase() }));
  const unique = dedupeById(list, 'id');
  return unique.length ? unique : DEFAULT_PROFILE.setupSubs.map((s) => ({ ...s }));
}

function normSoftkeys(raw) {
  const src = Array.isArray(raw) ? raw : [];
  const list = [];
  for (const s of src) {
    if (!s || !Number.isInteger(s.f)) continue;
    const f = Math.min(8, Math.max(1, s.f));
    list.push({ f, label: s.label || 'F' + f, action: s.action ?? null });
  }
  const unique = dedupeById(list, 'f');
  return unique.length ? unique : DEFAULT_PROFILE.softkeys.map((s) => ({ ...s }));
}

/**
 * Validasi & normalisasi profil mentah. Selalu mengembalikan bentuk yang aman
 * dipakai renderer. Murni (tanpa DOM / efek samping).
 */
export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') {
    return structuredClone(DEFAULT_PROFILE);
  }
  const modes = normModes(raw.modes);
  const ids = modes.map((m) => m.id);
  const def = ids.includes(raw.default) ? raw.default : modes[0].id;
  return {
    name: typeof raw.name === 'string' && raw.name ? raw.name : DEFAULT_PROFILE.name,
    version: Number.isInteger(raw.version) ? raw.version : DEFAULT_PROFILE.version,
    default: def,
    modes,
    droModes: normDro(raw.droModes),
    setupSubs: normSubs(raw.setupSubs),
    softkeys: normSoftkeys(raw.softkeys)
  };
}

/**
 * Muat profil dari file JSON. Gagal fetch/parse → reject (pemanggil pakai
 * DEFAULT_PROFILE sebagai fallback).
 */
export async function loadController(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('controller ' + res.status + ' ' + url);
  return normalizeProfile(await res.json());
}

function fillButtons(host, items, make) {
  host.innerHTML = '';
  for (const item of items) host.appendChild(make(item));
}

function makeTab(cls, attr, value, label, active) {
  const b = document.createElement('button');
  b.className = cls + (active ? ' active' : '');
  b.setAttribute(attr, value);
  b.textContent = label;
  return b;
}

export function renderModeTabs(profile, active) {
  const host = document.getElementById('modeTabs');
  if (!host) return;
  fillButtons(host, profile.modes, (m) =>
    makeTab('mode-tab', 'data-mode', m.id, m.label, m.id === active)
  );
}

export function renderDroTabs(profile, active) {
  const host = document.getElementById('droTabs');
  if (!host) return;
  fillButtons(host, profile.droModes, (d) =>
    makeTab('dro-tab', 'data-dro', d.id, d.label, d.id === active)
  );
}

export function renderSoftkeys(profile) {
  const host = document.getElementById('softkeys');
  if (!host) return;
  fillButtons(host, profile.softkeys, (s) => {
    const b = document.createElement('button');
    b.className = 'sk';
    b.setAttribute('data-sk', 'f' + s.f);
    if (s.action) b.setAttribute('data-action', s.action);
    b.innerHTML = 'F' + s.f + '<br/><span class="sk-lbl" id="sk' + s.f + '"></span>';
    b.querySelector('.sk-lbl').textContent = s.label;
    return b;
  });
}

export function renderSetupSubs(profile, active) {
  const host = document.getElementById('setupSubs');
  if (!host) return;
  fillButtons(host, profile.setupSubs, (s) =>
    makeTab('subtab', 'data-sub', s.id, s.label, s.id === active)
  );
}

