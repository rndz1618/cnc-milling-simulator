// v0.9.0 — mesin koordinat mesin (Tahap 1+3+2)
// Semua posisi = koordinat MESIN. DRO WORK = machine − offset WCS.
import { boundsFromPoints, formatStockSize } from './stock/fitStock.js';
import { parseGCode } from './machine/Parser.js';
import { applyCutterComp } from './machine/Compensator.js';
import {
  makeFixture, normalizeFixtures, serializeScenario, parseScenario, MATERIALS, stockOriginFor
} from './machine/Fixtures.js';
import { edgePlane, contactOffset, checkContact, surfaceCoord } from './machine/TouchOff.js';
import { escapeHtml } from './util/html.js';
import { FixtureManager } from './sim/FixtureManager.js';
import { createMeshService } from './stock/MeshService.js';
import {
  createMachineState,
  workCoords,
  machineCoords,
  moveTarget,
  MACHINE_PROFILE,
  WCS_NAMES
} from './machine/MachineState.js';
import { Simulator } from './sim/Simulator.js';
import {
  createScene,
  createToolMesh,
  setToolGeometry,
  setToolPosition,
  animateToolChange,
  buildToolpathLines,
  createWorkZeroMarker,
  createVise
} from './view/Scene.js';
import * as THREE from 'three';
import {
  trainState, markTrain, openTraining, closeTraining, resetTraining, renderTrainSteps
} from './train.js';
import {
  normalizeProfile, loadController,
  renderModeTabs, renderDroTabs, renderSoftkeys, renderSetupSubs
} from './controllers/Panel.js';

const SAMPLE = `; Contour + Pocket — Tool D6 | Z0 = top of stock (G54)
G21 G90 G17 G54
T1 M6
S12000 M3
G0 Z50
G0 X0 Y0

; Approach
G0 X10 Y10
G0 Z5
G1 Z-2 F200

; Outer contour (linear + G2 arcs)
G1 X85 F800
G2 X90 Y15 I0 J5
G1 Y65
G2 X85 Y70 I-5 J0
G1 X15
G2 X10 Y65 I0 J-5
G1 Y15
G2 X15 Y10 I5 J0

; Pocket
G0 Z5
G0 X25 Y25
G1 Z-5 F150
G1 X75 F600
G1 Y55
G1 X25
G1 Y25

; Finish
G0 Z5
G0 X20 Y20
G1 Z-5 F120
G1 X80 F400
G1 Y60
G1 X20
G1 Y20

G0 Z50
G0 X0 Y0
M5
M30
`;

const container = document.getElementById('canvas-container');
const { scene, camera, renderer, controls, bed, grid } = createScene(container);

// ---------- Stock setup (fixture G54 default) ----------
const stockSetup = {
  placement: 'top-center', // 'top-center' | 'top-corner' | 'custom'
  sizeX: 100, sizeY: 80, sizeZ: 20,
  originX: -50, originY: -40, originZ: -20
};

function fixtureFromStockSetup() {
  return makeFixture({
    wcs: 'G54', name: 'Ragum 1',
    stock: { sizeX: stockSetup.sizeX, sizeY: stockSetup.sizeY, sizeZ: stockSetup.sizeZ },
    placement: stockSetup.placement,
    // offset hanya absolut untuk placement 'custom'; preset memakai geser operator.
    offset: stockSetup.placement === 'custom'
      ? { x: stockSetup.originX, y: stockSetup.originY, z: stockSetup.originZ }
      : { x: 0, y: 0, z: 0 }
  });
}

let wcsMarkersGroup = null;

// ---------- Tool ----------
const toolMesh = createToolMesh({ diameter: 12, flute: 36, overall: 100 });
scene.add(toolMesh);

// Magazine 20 tool (realita mesin CNC rata-rata) — dia/flute/overall dipakai
// toolSpec 3D; length diisi operator via TOOL OFFSET MEASURE.
const toolTable = {
  1: { length: 0, dia: 6, flute: 18, overall: 80, type: 'End Mill' },
  2: { length: 0, dia: 10, flute: 30, overall: 95, type: 'End Mill' },
  3: { length: 0, dia: 12, flute: 36, overall: 100, type: 'End Mill' },
  4: { length: 0, dia: 16, flute: 40, overall: 100, type: 'End Mill' },
  5: { length: 0, dia: 20, flute: 45, overall: 110, type: 'End Mill' },
  6: { length: 0, dia: 3, flute: 12, overall: 60, type: 'End Mill' },
  7: { length: 0, dia: 4, flute: 14, overall: 65, type: 'End Mill' },
  8: { length: 0, dia: 8, flute: 24, overall: 90, type: 'End Mill' },
  9: { length: 0, dia: 25, flute: 50, overall: 120, type: 'Face Mill' },
  10: { length: 0, dia: 50, flute: 60, overall: 130, type: 'Face Mill' },
  11: { length: 0, dia: 6, flute: 18, overall: 80, type: 'Ball Nose' },
  12: { length: 0, dia: 10, flute: 30, overall: 95, type: 'Ball Nose' },
  13: { length: 0, dia: 12.5, flute: 40, overall: 110, type: 'Drill' },
  14: { length: 0, dia: 8.5, flute: 35, overall: 100, type: 'Drill' },
  15: { length: 0, dia: 5, flute: 25, overall: 85, type: 'Drill' },
  16: { length: 0, dia: 6, flute: 20, overall: 90, type: 'Tap M6' },
  17: { length: 0, dia: 10, flute: 20, overall: 90, type: 'Chamfer' },
  18: { length: 0, dia: 2, flute: 8, overall: 55, type: 'Engraver' },
  19: { length: 0, dia: 14, flute: 35, overall: 105, type: 'Roughing' },
  20: { length: 0, dia: 16, flute: 40, overall: 105, type: 'Roughing' }
};

// ---------- State ----------
const machine = createMachineState();

// Service worker greedy-mesh (Tahap 8). `__meshWorkerActive` di-set dari hasil
// ROUND-TRIP probe nyata (geometri 2×2×2 → balasan buffer), bukan sekadar
// keberadaan `Worker`: verify.mjs menunggu flag ini ter-definisi sebagai gerbang.
const meshService = (typeof Worker !== 'undefined') ? createMeshService() : null;
if (meshService) {
  meshService.request({
    grid: new Uint8Array(8).fill(1), nx: 2, ny: 2, nz: 2,
    originX: 0, originY: 0, originZ: 0, res: 1
  }).then((g) => {
    window.__meshWorkerActive = !!(g && g.position);
  }).catch(() => {
    window.__meshWorkerActive = false;
  });
} else {
  window.__meshWorkerActive = false;
}

const fixtures = new FixtureManager({ scene, machine, createVise, meshService });
let fixtureState = [fixtureFromStockSetup()];
fixtures.build(normalizeFixtures(fixtureState));
let stock = fixtures.stockFor('G54');
let activeTool = 1;
let droMode = 'work';
let jogInc = 0.1;
let currentMode = 'mem';
let profile = normalizeProfile(null);
let lastActiveLine = null;
let alarmHistory = [];
let toolpathGroup = null;
let trailGroup = null;
let graphVisible = true;
let allMoves = [];        // entri parser (work coords + tag)
let machineMoves = [];    // entri + target machine (untuk preview/trail/fit)
let currentController = 'haas-style';
const LS_WCS = 'cnc-sim-wcs';
const LS_TOOLS = 'cnc-sim-tools';

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n ?? 0).toFixed(3);
// Versi badge ikut package.json lewat define Vite; guard agar aman di luar Vite.
if ($('appVersion')) $('appVersion').textContent = 'v' + (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev');

function loadPersistedOffsets() {
  try {
    const w = JSON.parse(localStorage.getItem(LS_WCS) || 'null');
    if (w && typeof w === 'object') {
      for (const k of WCS_NAMES) {
        if (w[k] && machine.wcs[k]) {
          machine.wcs[k].x = +w[k].x || 0;
          machine.wcs[k].y = +w[k].y || 0;
          machine.wcs[k].z = +w[k].z || 0;
        }
      }
    }
    const t = JSON.parse(localStorage.getItem(LS_TOOLS) || 'null');
    if (t && typeof t === 'object') {
      for (const k of Object.keys(toolTable)) {
        if (t[k]) {
          toolTable[k].length = +t[k].length || 0;
          toolTable[k].dia = +t[k].dia || toolTable[k].dia;
          toolTable[k].flute = +t[k].flute || toolTable[k].flute;
          toolTable[k].overall = +t[k].overall || toolTable[k].overall;
        }
      }
    }
  } catch (_) {}
}

function savePersistedOffsets() {
  try {
    localStorage.setItem(LS_WCS, JSON.stringify(machine.wcs));
    localStorage.setItem(LS_TOOLS, JSON.stringify(toolTable));
  } catch (_) {}
}

function syncOffsetInputsFromTables() {
  document.querySelectorAll('#workOffsetTable tbody tr').forEach((row) => {
    const o = machine.wcs[row.dataset.wcs];
    if (!o) return;
    row.querySelectorAll('input').forEach((inp) => {
      const ax = inp.dataset.axis;
      if (ax) inp.value = o[ax];
    });
  });
  document.querySelectorAll('#toolOffsetTable tbody tr').forEach((row) => {
    const t = toolTable[row.dataset.tool];
    if (!t) return;
    row.querySelectorAll('input').forEach((inp) => {
      const f = inp.dataset.field;
      if (f && t[f] != null) inp.value = t[f];
    });
  });
}

// Baris tabel tool dirender dari toolTable (magazine 20), bukan HTML hardcode.
// Dipanggil di sini (top-level) sebelum binding baris di bawah agar event terpasang.
function renderToolTable() {
  const tbody = document.querySelector('#toolOffsetTable tbody');
  if (!tbody) return;
  tbody.innerHTML = Object.keys(toolTable).map((n) => {
    const t = toolTable[n];
    return '<tr data-tool="' + n + '"' + (+n === activeTool ? ' class="active-row"' : '') + '>' +
      '<td>T' + n + '</td>' +
      '<td><input type="number" step="0.001" value="' + t.length + '" data-field="length" /></td>' +
      '<td><input type="number" step="0.1" value="' + t.dia + '" data-field="dia" /></td>' +
      '<td><input type="number" step="1" value="' + t.flute + '" data-field="flute" /></td>' +
      '<td><input type="number" step="1" value="' + t.overall + '" data-field="overall" /></td>' +
      '</tr>';
  }).join('');
}
renderToolTable();

// ---------- Alarm ----------
function pushAlarm(msg, line) {
  const entry = { t: new Date().toLocaleTimeString(), msg, line: line ?? null };
  alarmHistory.unshift(entry);
  if (alarmHistory.length > 30) alarmHistory.pop();
  if ($('sbAlarm')) {
    $('sbAlarm').textContent = 'ALARM: ' + msg;
    $('sbAlarm').className = 'sb-item alarm';
  }
}

function clearAlarms() {
  alarmHistory = [];
  if ($('sbAlarm')) {
    $('sbAlarm').textContent = 'NO ALARMS';
    $('sbAlarm').className = 'sb-item ok';
  }
}

function showAlarmPanel() {
  let panel = $('alarmPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'alarmPanel';
    panel.className = 'alarm-panel';
    panel.innerHTML =
      '<div class="alarm-panel-hdr"><span>ALARM / MESSAGES</span>' +
      '<button class="btn btn-sm" id="btnAlarmClose">✕</button></div>' +
      '<div class="alarm-panel-body" id="alarmPanelBody"></div>' +
      '<div class="alarm-panel-foot">' +
      '<button class="btn btn-sm" id="btnAlarmClear">Clear All</button></div>';
    document.body.appendChild(panel);
    panel.querySelector('#btnAlarmClose').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('#btnAlarmClear').onclick = () => {
      clearAlarms();
      renderAlarmList();
    };
  }
  renderAlarmList();
  panel.style.display = 'flex';
}

function renderAlarmList() {
  const body = $('alarmPanelBody');
  if (!body) return;
  if (!alarmHistory.length) {
    body.innerHTML = '<div class="alarm-empty">NO ALARMS — sistem siap</div>';
    return;
  }
  body.innerHTML = alarmHistory.map((a) =>
    '<div class="alarm-row">' +
    '<span class="alarm-time">' + a.t + '</span>' +
    (a.line != null ? '<span class="alarm-ln">N' + a.line + '</span>' : '') +
    '<span class="alarm-msg">' + a.msg.replace(/</g, '&lt;') + '</span></div>'
  ).join('');
}

// ---------- CURNT CMDS (F2): halaman kode G/M aktif ----------
function activeCodeList() {
  const m = machine;
  const rows = [
    ['Motion', m.motion || 'G0'],
    ['Plane', m.plane || 'G17'],
    ['Units', m.units === 'in' ? 'G20 (inch)' : 'G21 (mm)'],
    ['WCS', m.activeWcs || 'G54'],
    ['Position', 'ABS G90'],
    ['Tool', 'T' + (m.tool ?? 1)],
    ['Tool Offset', m.hNum ? 'H' + String(m.hNum).padStart(2, '0') : 'G49'],
    ['Spindle', (m.spindleOn ? 'S' + (m.spindle ?? 0) + ' ' : '') + 'M' + (m.spindleDir === 4 ? 4 : 3) + (m.spindleOn ? '' : ' (off)')],
    ['Coolant', m.coolant ? 'M08' : 'M09'],
    ['Feed', (m.feed ?? 0).toFixed(0) + ' mm/min']
  ];
  return rows;
}

function showCurrentCmds() {
  let panel = $('cmdsPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cmdsPanel';
    panel.className = 'alarm-panel';
    panel.innerHTML =
      '<div class="alarm-panel-hdr"><span>CURNT CMDS — ACTIVE CODES</span>' +
      '<button class="btn btn-sm" id="btnCmdsClose">✕</button></div>' +
      '<div class="alarm-panel-body" id="cmdsPanelBody"></div>';
    document.body.appendChild(panel);
    panel.querySelector('#btnCmdsClose').onclick = () => { panel.style.display = 'none'; };
  }
  renderCurrentCmds();
  panel.style.display = 'flex';
}

function renderCurrentCmds() {
  const body = $('cmdsPanelBody');
  if (!body) return;
  body.innerHTML = activeCodeList().map(([k, v]) =>
    '<div class="alarm-row"><span class="alarm-time">' + k + '</span>' +
    '<span class="alarm-msg">' + String(v) + '</span></div>'
  ).join('');
}

// ---------- Tool ----------
function applyToolFromTable(toolNum) {
  const t = toolTable[toolNum];
  if (!t) return;
  machine.tool = toolNum;
  machine.toolLength = t.length;
  machine.toolDiameter = t.dia;
  machine.toolSpec = { dia: t.dia, flute: t.flute, overall: t.overall };   // dipakai _checkRapidCrash (HOLDER CRASH)
  setToolGeometry(toolMesh, {
    diameter: t.dia, flute: t.flute, overall: t.overall
  });
  activeTool = toolNum;
  if ($('simTool')) $('simTool').textContent = 'T' + toolNum + ' Ø' + t.dia;
  document.querySelectorAll('#toolOffsetTable tbody tr').forEach((row) => {
    row.classList.toggle('active-row', +row.dataset.tool === +toolNum);
  });
}

// ---------- Simulator ----------
const sim = new Simulator({
  stock,
  machine,
  resolveStock: (wcs) => fixtures.stockFor(wcs),
  onResetStocks: () => fixtures.reset(),
  onUpdate: refreshUI,
  onLine: highlightLine,
  onAlarm: (msg, line) => {
    pushAlarm(msg, line);
    showAlarmPanel();
  },
  onTool: (t) => {
    if (toolTable[t]) applyToolFromTable(t);
    animateToolChange(toolMesh);
  },
  onToolComp: (h) => {
    if (!h) {
      machine.hNum = 0;
      machine.hOffset = 0;
      return;
    }
    const t = toolTable[h];
    if (!t || !t.length) {
      sim.alarm(
        'TOOL OFFSET H' + String(h).padStart(2, '0') +
        ' BELUM DIATUR — isi panjang tool di OFFSET → TOOL (F1)',
        null
      );
      return;
    }
    machine.hNum = h;
    machine.hOffset = t.length;
    if ($('sbMsg')) $('sbMsg').textContent = 'G43 H' + String(h).padStart(2, '0') + ' aktif (offset ' + t.length + ' mm)';
  },
  onCoolant: (on) => {
    machine.coolant = on;
    document.querySelectorAll('.sk[data-sk="f6"]').forEach((b) => {
      b.classList.toggle('active', on);
    });
    const lbl = $('sk6');
    if (lbl) lbl.textContent = on ? 'CLNT ON' : 'COOLANT';
  },
  onMessage: (msg) => {
    if ($('sbMsg')) $('sbMsg').textContent = msg;
  }
});

// ---------- Toolpath helpers ----------
function computeMachineMoves() {
  machineMoves = allMoves.map((m) => {
    const t = moveTarget(m, machine);
    return { x: t.x, y: t.y, z: t.z, type: m.type, line: m.line };
  });
}

function rebuildPreview() {
  disposeGroup(toolpathGroup);
  toolpathGroup = null;
  if (!machineMoves.length) return;
  toolpathGroup = buildToolpathLines(machineMoves, {
    start: { x: machine.x, y: machine.y, z: machine.z }
  });
  toolpathGroup.visible = graphVisible && !sim.playing;
  scene.add(toolpathGroup);
}

function disposeGroup(g) {
  if (!g) return;
  scene.remove(g);
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

function rebuildTrail() {
  disposeGroup(trailGroup);
  trailGroup = null;
  if (!machineMoves.length || sim.index <= 0) return;
  const done = machineMoves.slice(0, sim.index);
  const cur = allMoves[sim.index];
  const liveEnd = (sim.playing && cur)
    ? { x: machine.x, y: machine.y, z: machine.z, type: cur.type || 'feed' }
    : null;
  trailGroup = buildToolpathLines(done, { mode: 'trail', rapidClearance: 15, liveEnd });
  scene.add(trailGroup);
}

// ---------- WCS markers + vise ----------
function rebuildWcsMarkers() {
  disposeGroup(wcsMarkersGroup);
  wcsMarkersGroup = new THREE.Group();
  for (const w of WCS_NAMES) {
    const off = machine.wcs[w];
    const active = w === machine.activeWcs;
    if (!active && off.x === 0 && off.y === 0 && off.z === 0 && w !== 'G54') continue;
    const marker = createWorkZeroMarker(active ? 20 : 9, w);
    marker.position.set(off.x, off.z, off.y);
    if (!active) marker.scale.setScalar(0.6);
    wcsMarkersGroup.add(marker);
  }
  scene.add(wcsMarkersGroup);
}

function frameStock() {
  const b = fixtures.frameBounds();
  if (!b) return;
  controls.target.set(b.x, b.z, b.y);
  camera.position.set(b.x + b.span * 0.9, b.z + b.span * 0.7, b.y + b.span * 1.1);
  controls.update();
}

// ---------- Fixture layout ----------
function nextFreeWcs(list) {
  const used = new Set(list.map((f) => f.wcs));
  return ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].find((w) => !used.has(w)) || null;
}

function fixtureRowHtml(f, idx) {
  const opt = (v, label, sel) => '<option value="' + v + '"' + (v === sel ? ' selected' : '') + '>' + label + '</option>';
  const wcsOpts = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map((w) => opt(w, w, f.wcs)).join('');
  const matOpts = Object.keys(MATERIALS).map((m) => opt(m, MATERIALS[m].label, f.stock.material)).join('');
  const placeOpts = ['top-center', 'top-corner', 'custom']
    .map((p) => opt(p, p === 'custom' ? 'Manual' : p, f.placement)).join('');
  return '' +
    '<div class="fx-row" data-idx="' + idx + '">' +
    '<div class="fx-head"><b>' + escapeHtml(f.name) + '</b>' +
    '<select data-field="wcs">' + wcsOpts + '</select></div>' +
    '<div class="stock-grid">' +
    '<label>X <input type="number" data-field="stockX" value="' + f.stock.sizeX + '" /></label>' +
    '<label>Y <input type="number" data-field="stockY" value="' + f.stock.sizeY + '" /></label>' +
    '<label>Z <input type="number" data-field="stockZ" value="' + f.stock.sizeZ + '" /></label>' +
    '</div>' +
    '<div class="stock-grid">' +
    '<label>Material <select data-field="material">' + matOpts + '</select></label>' +
    '<label>Posisi <select data-field="placement">' + placeOpts + '</select></label>' +
    '</div>' +
    '<div class="stock-grid">' +
    '<label>Geser X <input type="number" step="0.5" data-field="offX" value="' + ((f.offset && f.offset.x) || 0) + '" /></label>' +
    '<label>Geser Y <input type="number" step="0.5" data-field="offY" value="' + ((f.offset && f.offset.y) || 0) + '" /></label>' +
    '</div>' +
    '<div class="stock-grid">' +
    '<label>Jaw W <input type="number" data-field="jawWidth" value="' + f.vise.jawWidth + '" /></label>' +
    '<label>Jaw H <input type="number" data-field="jawHeight" value="' + f.vise.jawHeight + '" /></label>' +
    '<label>Opening <input type="number" data-field="opening" value="' + f.vise.opening + '" /></label>' +
    '<label>Base H <input type="number" data-field="baseH" value="' + f.vise.baseH + '" /></label>' +
    '</div></div>';
}

function renderFixtureList() {
  const host = $('fixtureList');
  if (!host) return;
  host.innerHTML = fixtureState.map(fixtureRowHtml).join('');
}

function applyFixtureField(f, field, raw) {
  const num = parseFloat(raw);
  if (field === 'wcs') f.wcs = raw;
  else if (field === 'material') f.stock.material = raw;
  else if (field === 'placement') {
    // Pindah ke 'custom' tanpa input offset → stok lompat ke origin mesin (M5).
    // Bekukan origin saat ini sebagai offset absolut supaya stok tidak melompat.
    if (raw === 'custom' && f.placement !== 'custom') {
      const cur = stockOriginFor(f, machine.wcs[f.wcs] || { x: 0, y: 0, z: 0 });
      f.offset = { x: cur.x, y: cur.y, z: cur.z };
    }
    f.placement = raw;
  }
  else if (field === 'offX') f.offset.x = num || 0;
  else if (field === 'offY') f.offset.y = num || 0;
  else if (field === 'stockX') f.stock.sizeX = Math.max(10, num || f.stock.sizeX);
  else if (field === 'stockY') f.stock.sizeY = Math.max(10, num || f.stock.sizeY);
  else if (field === 'stockZ') f.stock.sizeZ = Math.max(5, num || f.stock.sizeZ);
  else if (field === 'jawWidth') f.vise.jawWidth = Math.max(20, num || f.vise.jawWidth);
  else if (field === 'jawHeight') f.vise.jawHeight = Math.max(5, num || f.vise.jawHeight);
  else if (field === 'opening') f.vise.opening = Math.max(10, num || f.vise.opening);
  else if (field === 'baseH') f.vise.baseH = Math.max(5, num || f.vise.baseH);
}

function rebuildFixtures(fit = true, render = true) {
  fixtures.build(normalizeFixtures(fixtureState));
  fixtureState = fixtures.entries.map((e) => e.fixture);
  stock = fixtures.stockFor(machine.activeWcs) || fixtures.stockFor('G54') || stock;
  fixtures.setVisible(!sim.dryRun);
  if (render) renderFixtureList();
  if ($('stockInfo')) {
    $('stockInfo').textContent = fixtureState.length + ' fixture' +
      (stock ? ' | origin mesin: ' + stock.originX.toFixed(1) + ', ' + stock.originY.toFixed(1) + ', ' + stock.originZ.toFixed(1) : '');
  }
  if (fit) frameStock();
  refreshUI();
}

function applyFixtureLayout(list) {
  const norm = normalizeFixtures(list);
  fixtureState = norm.length ? norm : [fixtureFromStockSetup()];
  rebuildFixtures(true);
}

// ---------- Stock setup (fixture G54 — jalur auto-fit/legacy) ----------
function applyStockSetup(fitToView = true) {
  const f = fixtureFromStockSetup();
  const cur = fixtureState.find((x) => x.wcs === 'G54');
  if (cur) { cur.stock = { ...cur.stock, ...f.stock }; cur.placement = f.placement; cur.offset = f.offset; }
  else fixtureState.unshift(f);
  fixtures.build(normalizeFixtures(fixtureState));
  fixtureState = fixtures.entries.map((e) => e.fixture);
  stock = fixtures.stockFor('G54') || stock;
  fixtures.setVisible(!sim.dryRun);
  renderFixtureList();
  if ($('stockSizeLabel')) {
    $('stockSizeLabel').textContent = Math.round(stockSetup.sizeX) + '\u00d7' +
      Math.round(stockSetup.sizeY) + '\u00d7' + Math.round(stockSetup.sizeZ);
  }
  if ($('stockInfo')) {
    $('stockInfo').textContent = 'origin mesin: ' + stock.originX.toFixed(1) + ', ' +
      stock.originY.toFixed(1) + ', ' + stock.originZ.toFixed(1);
  }
  if (fitToView) frameStock();
  refreshUI();
}

// ---------- UI ----------
function setGraphVisible(vis) {
  graphVisible = !!vis;
  if (toolpathGroup) toolpathGroup.visible = graphVisible && !sim.playing;
  document.querySelectorAll('.sk[data-sk="f4"]').forEach((b) => {
    b.classList.toggle('active', graphVisible);
  });
  const lbl = $('sk4');
  if (lbl) lbl.textContent = graphVisible ? 'GRAPH ON' : 'GRAPH';
  if ($('sbMsg')) $('sbMsg').textContent = graphVisible ? 'GRAPH ON — path preview' : 'GRAPH OFF';
}

function applyDryRun(on) {
  sim.dryRun = !!on;
  const c = $('chkDryRun');
  if (c) c.checked = !!on;
  document.querySelectorAll('.sk[data-sk="f8"]').forEach((b) => {
    b.classList.toggle('active', !!on);
  });
  const lbl = $('sk8');
  if (lbl) lbl.textContent = on ? 'DRY ON' : 'DRY RUN';
  fixtures.setVisible(!on);
  if ($('sbMsg')) $('sbMsg').textContent = on ? 'DRY RUN — material hidden' : 'DRY RUN OFF';
  updateStatusBar();
}

function updateActiveCodes() {
  const codes = $('activeCodes');
  if (codes) {
    const chips = [];
    chips.push('<span class="code-chip">G90</span>');
    chips.push('<span class="code-chip accent">' + machine.activeWcs + '</span>');
    chips.push('<span class="code-chip">G17</span>');
    chips.push('<span class="code-chip">G21</span>');
    if (machine.hNum > 0) {
      chips.push('<span class="code-chip">G43 H' + String(machine.hNum).padStart(2, '0') + '</span>');
    }
    if (machine.feed > 0) {
      chips.push('<span class="code-chip">F' + Math.round(machine.feed) + '</span>');
    }
    codes.innerHTML = chips.join('');
  }

  const ti = $('activeToolInfo');
  if (ti) {
    const sp = machine.spindleOn
      ? '<span class="code-chip on">M' + machine.spindleDir + ' S' + (machine.spindle || 0) + '</span>'
      : '<span class="code-chip">M5</span>';
    const clnt = machine.coolant
      ? '<span class="code-chip on">M8 CLNT</span>' : '';
    ti.innerHTML =
      '<span class="code-chip accent">T' + (machine.tool || 1) + '</span>' +
      '<span class="code-chip">H' + String(machine.tool || 1).padStart(2, '0') + '</span>' +
      '<span class="code-chip">D' + String(machine.tool || 1).padStart(2, '0') + '</span>' +
      sp + clnt;
  }

  if ($('hdrSpindle')) {
    $('hdrSpindle').textContent = machine.spindleOn
      ? 'S' + (machine.spindle || 0)
      : 'S OFF';
    $('hdrSpindle').style.color = machine.spindleOn ? '#3fb950' : '';
  }
}

function updateStatusBar() {
  const flags = [];
  if (sim.singleBlock) flags.push('SINGLE BLOCK');
  if (sim.dryRun) flags.push('DRY RUN');
  if (sim.state === 'alarm') flags.push('ALARM');
  else if (sim.playing) flags.push('CYCLE ON');
  else if (sim.state === 'hold' && sim.holdReason === 'feed') flags.push('FEED HOLD');
  if ($('sbFlags')) $('sbFlags').textContent = flags.length ? flags.join(' · ') : '—';
  if ($('hdrMode')) $('hdrMode').textContent = currentMode.toUpperCase();
}

function refreshUI() {
  // DRO — semua turunan dari koordinat mesin
  if (droMode === 'machine') {
    const mc = machineCoords(machine);
    if ($('droX')) $('droX').textContent = fmt(mc.x);
    if ($('droY')) $('droY').textContent = fmt(mc.y);
    if ($('droZ')) $('droZ').textContent = fmt(mc.z);
  } else if (droMode === 'operator') {
    // OPERATOR — mirror work untuk sekarang; bisa disetel relatif
    const wc = workCoords(machine);
    if ($('droX')) $('droX').textContent = fmt(wc.x);
    if ($('droY')) $('droY').textContent = fmt(wc.y);
    if ($('droZ')) $('droZ').textContent = fmt(wc.z);
  } else if (droMode === 'dtg') {
    const d = machine.dtg || { x: 0, y: 0, z: 0 };
    if ($('droX')) $('droX').textContent = fmt(d.x);
    if ($('droY')) $('droY').textContent = fmt(d.y);
    if ($('droZ')) $('droZ').textContent = fmt(d.z);
  } else {
    const wc = workCoords(machine);
    if ($('droX')) $('droX').textContent = fmt(wc.x);
    if ($('droY')) $('droY').textContent = fmt(wc.y);
    if ($('droZ')) $('droZ').textContent = fmt(wc.z);
  }
  if ($('droDtg')) {
    const d = machine.dtg || { x: 0, y: 0, z: 0 };
    $('droDtg').textContent =
      'X' + fmt(d.x) + '  Y' + fmt(d.y) + '  Z' + fmt(d.z);
  }

  if ($('simStatus')) {
    $('simStatus').textContent =
      sim.state === 'alarm' ? 'ALARM'
        : sim.playing ? 'RUN'
          : (sim.moves.length && sim.index >= sim.moves.length ? 'DONE' : sim.state.toUpperCase());
  }
  if ($('simTool')) {
    $('simTool').textContent = 'T' + (machine.tool || 1) + ' Ø' + (machine.toolDiameter || 6);
  }
  if ($('stockLeft')) {
    $('stockLeft').textContent = Math.round(stock.remainingRatio * 100) + '%';
  }
  if ($('stockInfo') && stock) {
    $('stockInfo').textContent = fixtureState.length + ' fixture | origin mesin: ' +
      stock.originX.toFixed(1) + ', ' + stock.originY.toFixed(1) + ', ' + stock.originZ.toFixed(1);
  }

  const pct = sim.moves.length ? Math.min(100, (sim.index / sim.moves.length) * 100) : 0;
  if ($('progressBar')) $('progressBar').style.width = pct + '%';
  if ($('progressText')) $('progressText').textContent = Math.round(pct) + '%';

  const total = sim.totalTime || 1;
  const elapsed = sim.elapsed || 0;
  const fmtT = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  };
  if ($('timeText')) $('timeText').textContent = fmtT(elapsed) + ' / ' + fmtT(total);
  if ($('hdrTime')) $('hdrTime').textContent = fmtT(elapsed);

  setToolPosition(toolMesh, machine.x, machine.y, machine.z);
  updateActiveCodes();
  updateStatusBar();

  // CURNT CMDS live: re-render tiap tick kalau panel sedang terbuka.
  const cmds = $('cmdsPanel');
  if (cmds && cmds.style.display !== 'none') renderCurrentCmds();

  if (toolpathGroup) toolpathGroup.visible = graphVisible && !sim.playing;

  if ($('btnPlay')) $('btnPlay').disabled = sim.playing;
  if ($('btnPause')) $('btnPause').disabled = !sim.playing;
  if ($('btnStop')) $('btnStop').disabled = !sim.playing && sim.index === 0 && sim.state !== 'alarm';
}

function highlightLine(lineNum) {
  const info = $('lineInfo');
  if (info) {
    info.textContent = lineNum != null ? 'Baris aktif: ' + lineNum : 'Baris aktif: —';
    info.classList.toggle('line-live', lineNum != null && sim && sim.playing);
  }
  if (lineNum === lastActiveLine) return;
  lastActiveLine = lineNum;
  const lines = document.querySelectorAll('.gline');
  let activeEl = null;
  lines.forEach((el) => {
    const ln = +el.dataset.line;
    el.classList.remove('active', 'done');
    if (lineNum != null) {
      if (ln < lineNum) el.classList.add('done');
      if (ln === lineNum) {
        el.classList.add('active');
        activeEl = el;
      }
    }
  });
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function setProgramView(view) {
  const pane = $('panelProgram');
  if (!pane) return;
  pane.querySelectorAll('[data-view]').forEach((v) => {
    v.classList.toggle('view-hidden', v.dataset.view !== view);
  });
  if ($('progActions')) $('progActions').classList.toggle('pane-hidden', view === 'mdi');
}

function showLinesView(text) {
  const lines = text.split(/\r?\n/);
  const wrap = $('gcodeLines');
  if (!wrap) return;
  wrap.innerHTML = lines.map((t, i) =>
    '<div class="gline" data-line="' + (i + 1) + '"><span class="ln">' + (i + 1) +
    '</span><span class="tx">' + t.replace(/</g, '&lt;') + '</span></div>'
  ).join('');
  setProgramView('lines');
}

function showEditView() {
  applyMode('edit');
}

// ---------- Mode / pane / view (data-driven) ----------
function applyMode(id) {
  const mode = profile.modes.find((m) => m.id === id) || profile.modes[0];
  currentMode = mode.id;
  document.querySelectorAll('#modeTabs .mode-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode.id);
  });
  document.querySelectorAll('[data-pane]').forEach((p) => {
    p.classList.toggle('pane-hidden', p.dataset.pane !== mode.pane);
  });
  if (mode.pane === 'program') setProgramView(mode.view || 'lines');
  if ($('simMode')) $('simMode').textContent = mode.id.toUpperCase();
  updateStatusBar();
}

function applySetupSub(sub) {
  document.querySelectorAll('#setupSubs .subtab').forEach((b) => {
    b.classList.toggle('active', b.dataset.sub === sub);
  });
  ['work', 'tool', 'fixture'].forEach((p) => {
    const el = $('setup' + p.charAt(0).toUpperCase() + p.slice(1));
    if (el) el.style.display = sub === p ? 'flex' : 'none';
  });
}

// ---------- Load program ----------
function loadProgram() {
  const text = ($('gcodeInput') && $('gcodeInput').value) || SAMPLE;
  const parsed = parseGCode(text);
  allMoves = applyCutterComp(parsed.moves || [], {
    getRadius: (d) => (toolTable[d]?.dia ?? 6) / 2
  });
  sim.loadMoves(allMoves, parsed.totalTime || 0);
  computeMachineMoves();

  if (parsed.alarms && parsed.alarms.length) {
    parsed.alarms.forEach((a) => pushAlarm(a.msg + ' (baris ' + a.line + ')', a.line));
  } else if (!alarmHistory.length && $('sbAlarm')) {
    $('sbAlarm').textContent = 'NO ALARMS';
    $('sbAlarm').className = 'sb-item ok';
  }

  const firstTool = allMoves.find((m) => m.type === 'tool')?.tool;
  if (firstTool && toolTable[firstTool]) applyToolFromTable(firstTool);

  if ($('lineCount')) {
    const nMove = allMoves.filter((m) => m.type === 'rapid' || m.type === 'feed').length;
    $('lineCount').textContent = nMove + ' gerakan';
  }

  showLinesView(text);

  disposeGroup(trailGroup);
  trailGroup = null;

  const autoFit = $('chkAutoFit') && $('chkAutoFit').checked;
  if (autoFit && machineMoves.length) {
    const toolR = (machine.toolDiameter || 12) / 2;
    const b = boundsFromPoints(machineMoves, {
      toolRadius: toolR,
      topZ: machine.wcs.G54.z
    });
    if (b) {
      stockSetup.sizeX = b.sizeX;
      stockSetup.sizeY = b.sizeY;
      stockSetup.sizeZ = b.sizeZ;
      stockSetup.placement = 'custom';
      stockSetup.originX = b.originX;
      stockSetup.originY = b.originY;
      stockSetup.originZ = b.originZ;
      if ($('stockX')) $('stockX').value = Math.round(b.sizeX);
      if ($('stockY')) $('stockY').value = Math.round(b.sizeY);
      if ($('stockZ')) $('stockZ').value = Math.round(b.sizeZ);
      applyStockSetup(true);
      if ($('sbMsg')) $('sbMsg').textContent = 'Stock auto-fit: ' + formatStockSize(b);
    }
  } else {
    rebuildPreview();
  }

  rebuildWcsMarkers();
  refreshUI();
}

// ---------- Jog ----------
function jogAxis(axis, dir) {
  if (currentMode !== 'jog') return;
  const t = MACHINE_PROFILE.travel;
  let v = machine[axis] + dir * jogInc;
  const lo = t[axis][0], hi = t[axis][1];
  if (v < lo || v > hi) {
    pushAlarm('SOFT LIMIT ' + axis.toUpperCase() + ' — JOG DIBATASI TRAVEL MESIN', null);
    v = Math.max(lo, Math.min(hi, v));
  }
  machine[axis] = v;
  machine.dtg = { x: 0, y: 0, z: 0 };
  refreshUI();
}

// ---------- Event wiring ----------
if ($('btnLoad')) $('btnLoad').addEventListener('click', loadProgram);
if ($('btnFitStock')) {
  $('btnFitStock').addEventListener('click', () => {
    if ($('chkAutoFit')) $('chkAutoFit').checked = true;
    loadProgram();
  });
}
if ($('btnExample')) $('btnExample').addEventListener('click', () => {
  if ($('gcodeInput')) $('gcodeInput').value = SAMPLE;
  showEditView();
});
if ($('btnClear')) $('btnClear').addEventListener('click', () => {
  if ($('gcodeInput')) $('gcodeInput').value = '';
  showEditView();
});
if ($('btnEditMode')) $('btnEditMode').addEventListener('click', showEditView);

if ($('fileInput')) $('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    if ($('gcodeInput')) $('gcodeInput').value = r.result;
    showEditView();
  };
  r.readAsText(f);
});

if ($('btnPlay')) $('btnPlay').addEventListener('click', () => {
  if (toolpathGroup) toolpathGroup.visible = false;
  sim.play();
  refreshUI();
  if (sim.dryRun) markTrain('dryrun');
  else markTrain('cyclestart');
});
if ($('btnPause')) $('btnPause').addEventListener('click', () => { sim.feedHold(); refreshUI(); });
if ($('btnStop')) $('btnStop').addEventListener('click', () => {
  sim.stop();
  disposeGroup(trailGroup);
  trailGroup = null;
  if (toolpathGroup) toolpathGroup.visible = graphVisible;
  fixtures.setVisible(!sim.dryRun);
  refreshUI();
});
if ($('btnStep')) $('btnStep').addEventListener('click', () => { sim.step(); refreshUI(); });
if ($('btnReset')) $('btnReset').addEventListener('click', () => {
  sim.stop();
  disposeGroup(trailGroup);
  trailGroup = null;
  if (toolpathGroup) toolpathGroup.visible = graphVisible;
  refreshUI();
});

const chkSB = $('chkSingleBlock');
if (chkSB) chkSB.addEventListener('change', (e) => {
  sim.singleBlock = e.target.checked;
  document.querySelectorAll('.sk[data-sk="f7"]').forEach((b) => b.classList.toggle('active', e.target.checked));
  updateStatusBar();
});
const chkDR = $('chkDryRun');
if (chkDR) chkDR.addEventListener('change', (e) => applyDryRun(e.target.checked));
const chkOS = $('chkOptStop');
if (chkOS) chkOS.addEventListener('change', (e) => { machine.optStop = e.target.checked; });

document.querySelectorAll('.ovr-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.ovr;
    const val = parseFloat(btn.dataset.val);
    document.querySelectorAll('.ovr-btn[data-ovr="' + kind + '"]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (kind === 'feed') {
      sim.feedOvr = val / 100;
      if ($('feedVal')) $('feedVal').textContent = val + '%';
    } else if (kind === 'rapid') {
      sim.rapidOvr = val / 100;
      if ($('rapidVal')) $('rapidVal').textContent = val + '%';
    } else if (kind === 'sim') {
      sim.simSpeed = val;
      if ($('speedLabel')) $('speedLabel').textContent = val + '\u00d7';
    }
  });
});
sim.feedOvr = 1;
sim.rapidOvr = 0.5;
sim.simSpeed = 1;

if ($('btnResetView')) $('btnResetView').addEventListener('click', frameStock);
if ($('btnTopView')) $('btnTopView').addEventListener('click', () => {
  const b = fixtures.frameBounds();
  if (!b) return;
  camera.position.set(b.x, b.z + b.span * 1.6, b.y);
  controls.target.set(b.x, b.z, b.y);
  controls.update();
});
if ($('btnIsoView')) $('btnIsoView').addEventListener('click', frameStock);

document.getElementById('modeTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-tab');
  if (btn) applyMode(btn.dataset.mode);
});

document.getElementById('setupSubs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.subtab');
  if (btn) applySetupSub(btn.dataset.sub);
});

document.getElementById('droTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.dro-tab');
  if (!btn) return;
  droMode = btn.dataset.dro;
  document.querySelectorAll('#droTabs .dro-tab').forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  refreshUI();
});

// WCS table: klik baris = aktifkan; ZERO = touch-off (offset = posisi mesin kini);
// edit input offset = ubah offset → preview/trail/marker dihitung ulang.
document.querySelectorAll('#workOffsetTable tbody tr').forEach((row) => {
  row.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    document.querySelectorAll('#workOffsetTable tbody tr').forEach((r) => r.classList.remove('active-row'));
    row.classList.add('active-row');
    machine.activeWcs = row.dataset.wcs;
    updateActiveCodes();
    rebuildWcsMarkers();
    refreshUI();
  });
  row.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      machine.wcs[row.dataset.wcs][inp.dataset.axis] = parseFloat(inp.value) || 0;
      savePersistedOffsets();
      computeMachineMoves();
      fixtures.reposition();
      rebuildPreview();
      rebuildWcsMarkers();
      refreshUI();
    });
  });
  const zeroBtn = row.querySelector('.btn-set-zero');
  if (zeroBtn) {
    zeroBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wcs = row.dataset.wcs;
      machine.wcs[wcs] = { x: machine.x, y: machine.y, z: machine.z };
      row.querySelectorAll('input').forEach((inp) => {
        inp.value = machine.wcs[wcs][inp.dataset.axis].toFixed(3);
      });
      document.querySelectorAll('#workOffsetTable tbody tr').forEach((r) => r.classList.remove('active-row'));
      row.classList.add('active-row');
      machine.activeWcs = wcs;
      savePersistedOffsets();
      computeMachineMoves();
      fixtures.reposition();
      rebuildPreview();
      rebuildWcsMarkers();
      updateActiveCodes();
      refreshUI();
      markTrain('partzero');
      if (Math.abs(machine.wcs[wcs].z) > 50) {
        if ($('sbMsg')) $('sbMsg').textContent = 'PERINGATAN: offset Z ' + wcs + ' besar (' +
          machine.wcs[wcs].z.toFixed(1) + ') — program dengan Z positif bisa SOFT LIMIT. Jog dekat part dulu, lalu touch-off ulang.';
      } else {
        if ($('sbMsg')) $('sbMsg').textContent = wcs + ' ZERO di posisi mesin kini — offset disimpan';
      }
    });
  }
});

if ($('btnResetWcs')) {
  $('btnResetWcs').addEventListener('click', () => {
    for (const w of WCS_NAMES) machine.wcs[w] = { x: 0, y: 0, z: 0 };
    machine.wcs.G55 = { x: 0, y: -90, z: 0 };
    savePersistedOffsets();
    syncOffsetInputsFromTables();
    computeMachineMoves();
    fixtures.reposition();
    rebuildPreview();
    rebuildWcsMarkers();
    if (sim.state === 'alarm' || sim.state === 'hold') sim.stop();
    clearAlarms();
    refreshUI();
    if ($('sbMsg')) $('sbMsg').textContent = 'WCS direset ke default (G54 0,0,0 · G55 0,−90,0) — siap Cycle Start';
  });
}

if ($('btnApplyWcs')) {
  $('btnApplyWcs').addEventListener('click', () => {
    document.querySelectorAll('#workOffsetTable tbody tr').forEach((row) => {
      const wcs = row.dataset.wcs;
      row.querySelectorAll('input').forEach((inp) => {
        const ax = inp.dataset.axis;
        if (ax) machine.wcs[wcs][ax] = parseFloat(inp.value) || 0;
      });
    });
    savePersistedOffsets();
    computeMachineMoves();
    fixtures.reposition();
    rebuildPreview();
    rebuildWcsMarkers();
    markTrain('partzero');
    if ($('sbMsg')) $('sbMsg').textContent = machine.activeWcs + ' applied — toolpath bergeser mengikuti offset';
    refreshUI();
  });
}

// Tool table
document.querySelectorAll('#toolOffsetTable tbody tr').forEach((row) => {
  row.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    applyToolFromTable(+row.dataset.tool);
  });
  row.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      const t = toolTable[+row.dataset.tool];
      const f = inp.dataset.field;
      if (t && f) t[f] = parseFloat(inp.value) || 0;
    });
  });
});

if ($('btnApplyTool')) {
  $('btnApplyTool').addEventListener('click', () => {
    document.querySelectorAll('#toolOffsetTable tbody tr').forEach((row) => {
      const tn = +row.dataset.tool;
      const t = toolTable[tn];
      if (!t) return;
      row.querySelectorAll('input').forEach((inp) => {
        const f = inp.dataset.field;
        if (f) t[f] = parseFloat(inp.value) || t[f];
      });
    });
    applyToolFromTable(activeTool);
    savePersistedOffsets();
    markTrain('toollength');
    if ($('sbMsg')) $('sbMsg').textContent = 'Tool T' + activeTool + ' Ø' + toolTable[activeTool].dia + ' applied & saved';
    refreshUI();
  });
}

// Fixture editor
if ($('fixtureList')) {
  $('fixtureList').addEventListener('input', (e) => {
    const row = e.target.closest('.fx-row');
    const field = e.target.dataset.field;
    if (!row || !field) return;
    const f = fixtureState[+row.dataset.idx];
    if (!f) return;
    applyFixtureField(f, field, e.target.value);
    // select (wcs/material/placement) boleh re-render; input angka jangan (jaga fokus).
    rebuildFixtures(false, field === 'wcs' || field === 'material' || field === 'placement');
  });
}
if ($('fxAdd')) {
  $('fxAdd').addEventListener('click', () => {
    if (fixtureState.length >= 6) { sbMsg('Maksimum 6 fixture'); return; }
    const wcs = nextFreeWcs(fixtureState);
    if (!wcs) { sbMsg('Semua WCS terpakai'); return; }
    fixtureState.push(makeFixture({ wcs, name: 'Ragum ' + (fixtureState.length + 1) }));
    rebuildFixtures(true);
  });
}
if ($('fxRemove')) {
  $('fxRemove').addEventListener('click', () => {
    if (fixtureState.length <= 1) { sbMsg('Minimal 1 fixture'); return; }
    fixtureState.pop();
    rebuildFixtures(true);
  });
}

// Scenarios
const SCENARIO_KEY = 'cnc-sim-scenarios';
function loadScenarioMap() {
  try { return JSON.parse(localStorage.getItem(SCENARIO_KEY)) || {}; }
  catch { return {}; }
}
function saveScenarioMap(map) {
  localStorage.setItem(SCENARIO_KEY, JSON.stringify(map));
}
if ($('scenarioSave')) {
  $('scenarioSave').addEventListener('click', () => {
    const name = ($('scenarioName') && $('scenarioName').value.trim()) || '';
    if (!name) { sbMsg('Isi nama skenario dulu'); return; }
    const map = loadScenarioMap();
    map[name] = serializeScenario({
      fixtures: fixtureState,
      program: ($('gcodeInput') && $('gcodeInput').value) || '',
      wcs: machine.wcs,
      tools: toolTable
    });
    saveScenarioMap(map);
    sbMsg('Skenario tersimpan: ' + name);
  });
}
if ($('scenarioLoad')) {
  $('scenarioLoad').addEventListener('click', () => {
    const name = ($('scenarioName') && $('scenarioName').value.trim()) || '';
    const map = loadScenarioMap();
    const sc = map[name] ? parseScenario(map[name]) : null;
    if (!sc) { sbMsg('Skenario tidak ditemukan: ' + name); return; }
    if (sc.wcs) Object.assign(machine.wcs, sc.wcs);
    if (sc.tools) Object.assign(toolTable, sc.tools);
    if ($('gcodeInput') && typeof sc.program === 'string') {
      $('gcodeInput').value = sc.program;
      loadProgram();
    }
    // setelah loadProgram (auto-fit bisa menimpa G54) — layout skenario yang menang.
    if (Array.isArray(sc.fixtures)) fixtureState = normalizeFixtures(sc.fixtures);
    syncOffsetInputsFromTables();
    rebuildFixtures(true);
    sbMsg('Skenario dimuat: ' + name);
  });
}
if ($('scenarioDelete')) {
  $('scenarioDelete').addEventListener('click', () => {
    const name = ($('scenarioName') && $('scenarioName').value.trim()) || '';
    const map = loadScenarioMap();
    delete map[name];
    saveScenarioMap(map);
    sbMsg('Skenario dihapus: ' + name);
  });
}

// ---------- Touch-off wizard ----------
const TO_INC = 0.5;
const TO_EPS = 0.05;
function toToolRadius() { return (toolTable[machine.tool]?.dia ?? 12) / 2; }
function toCurrentEdge() {
  const sel = $('toEdge');
  return (sel && sel.value) || 'x-';
}
function toAxis(edge) { return edge[0]; }
function toSelectedFixture() {
  const sel = $('toFixture');
  const wcs = sel && sel.value ? sel.value : (fixtureState[0] && fixtureState[0].wcs);
  return fixtureState.find((f) => f.wcs === wcs) || fixtureState[0] || null;
}
function toSelectedStock() {
  return toEdgeGeometry() && toEdgeGeometry().stock;
}
function toEdgeGeometry() {
  const f = toSelectedFixture();
  if (!f) return null;
  const en = fixtures.entries.find((e) => e.fixture.wcs === f.wcs);
  if (!en) return null;
  return {
    stock: en.stock,
    origin: en.origin,
    size: { x: en.stock.sizeX, y: en.stock.sizeY, z: en.stock.sizeZ }
  };
}
function toDistance() {
  const g = toEdgeGeometry();
  const edge = toCurrentEdge();
  if (!g || !edge) return null;
  const plane = edgePlane(edge, g.origin, g.size);
  return plane.value - surfaceCoord(edge, toToolRadius(), machine);
}
function toInContact() {
  const g = toEdgeGeometry();
  const edge = toCurrentEdge();
  if (!g || !edge) return false;
  return checkContact(edge, toToolRadius(), machine, edgePlane(edge, g.origin, g.size), TO_EPS);
}
function toClampTravel(axis, v) {
  const t = MACHINE_PROFILE.travel[axis];
  if (v < t[0]) { pushAlarm('SOFT LIMIT ' + axis.toUpperCase() + ' — TOUCH-OFF DIBATASI', null); return t[0]; }
  if (v > t[1]) { pushAlarm('SOFT LIMIT ' + axis.toUpperCase() + ' — TOUCH-OFF DIBATASI', null); return t[1]; }
  return v;
}
function updateTouchOff() {
  const stock = toSelectedStock();
  const edge = toCurrentEdge();
  const start = $('toStart');
  if (start) start.disabled = !stock || !edge || !toInContact();
  const read = $('toReadout');
  if (read) {
    if (!stock) read.textContent = 'Fixture tanpa stok — tambahkan fixture dulu di tab FIXTURE.';
    else if (!edge) read.textContent = 'Pilih edge permukaan.';
    else {
      const d = toDistance();
      read.textContent = edge.toUpperCase() + ' — jarak ke permukaan: ' + d.toFixed(3) + ' mm' +
        (toInContact() ? '  [KONTAK — SET WCS tersedia]' : '');
    }
  }
}
function toStep(dir) {
  const stock = toSelectedStock();
  const edge = toCurrentEdge();
  if (!stock || !edge) return;
  const axis = toAxis(edge);
  const d = toDistance();
  if (d == null) return;
  if (dir < 0) {
    if (Math.abs(d) <= TO_EPS) return;
    const move = Math.min(TO_INC, Math.max(0.05, Math.abs(d) - TO_EPS));
    machine[axis] = toClampTravel(axis, machine[axis] - Math.sign(d) * move);
  } else {
    machine[axis] = toClampTravel(axis, machine[axis] + TO_INC);
  }
  machine.dtg = { x: 0, y: 0, z: 0 };
  refreshUI();
  updateTouchOff();
}
function toProbe() {
  const g = toEdgeGeometry();
  const edge = toCurrentEdge();
  if (!g || !edge) return;
  const axis = toAxis(edge);
  const plane = edgePlane(edge, g.origin, g.size);
  const r = toToolRadius();
  const x = plane.value - r, y = plane.value + r;
  machine[axis] = toClampTravel(axis,
    edge === 'x-' ? x : edge === 'x+' ? y : edge === 'y-' ? x : edge === 'y+' ? y : plane.value);
  machine.dtg = { x: 0, y: 0, z: 0 };
  refreshUI();
  updateTouchOff();
}
function openTouchOff() {
  applyMode('setup');
  applySetupSub('work');
  const sel = $('toFixture');
  if (sel) {
    sel.innerHTML = '<option value="">— pilih —</option>' +
      fixtureState.map((f) => '<option value="' + f.wcs + '">' + escapeHtml(f.wcs + ' — ' + f.name) + '</option>').join('');
    const pref = (machine.activeWcs && fixtureState.some((f) => f.wcs === machine.activeWcs)) ? machine.activeWcs : (fixtureState[0] && fixtureState[0].wcs);
    sel.value = pref || '';
  }
  const ov = $('touchoffOverlay');
  if (ov) { ov.style.display = 'flex'; ov.setAttribute('aria-hidden', 'false'); }
  updateTouchOff();
}
function closeTouchOff() {
  const ov = $('touchoffOverlay');
  if (ov) { ov.style.display = 'none'; ov.setAttribute('aria-hidden', 'true'); }
}
function touchOffSetWcs() {
  const f = toSelectedFixture();
  const edge = toCurrentEdge();
  if (!f || !edge || !toInContact()) return;
  const off = contactOffset(edge, toToolRadius(), machine);
  machine.wcs[f.wcs] = machine.wcs[f.wcs] || { x: 0, y: 0, z: 0 };
  machine.wcs[f.wcs][off.axis] = off.value;
  savePersistedOffsets();
  computeMachineMoves();
  fixtures.reposition();
  rebuildPreview();
  rebuildWcsMarkers();
  syncOffsetInputsFromTables();
  refreshUI();
  sbMsg('Touch-off set — ' + f.wcs + ' ' + off.axis.toUpperCase() + ' = ' + off.value.toFixed(3));
  closeTouchOff();
}
if ($('btnTouchOff')) $('btnTouchOff').addEventListener('click', openTouchOff);
if ($('toClose')) $('toClose').addEventListener('click', closeTouchOff);
if ($('toIncNeg')) $('toIncNeg').addEventListener('click', () => toStep(-1));
if ($('toIncPos')) $('toIncPos').addEventListener('click', () => toStep(1));
if ($('toProbe')) $('toProbe').addEventListener('click', toProbe);
if ($('toStart')) $('toStart').addEventListener('click', touchOffSetWcs);
if ($('toFixture')) $('toFixture').addEventListener('change', updateTouchOff);
if ($('toEdge')) $('toEdge').addEventListener('change', updateTouchOff);

// Jog
document.querySelectorAll('.jog-inc').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.jog-inc').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    jogInc = parseFloat(btn.dataset.inc);
  });
});
document.querySelectorAll('.jog-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    jogAxis(btn.dataset.axis, parseFloat(btn.dataset.dir));
  });
});
if ($('btnJogHome')) {
  $('btnJogHome').addEventListener('click', () => {
    machine.x = MACHINE_PROFILE.home.x;
    machine.y = MACHINE_PROFILE.home.y;
    machine.z = MACHINE_PROFILE.home.z;
    machine.dtg = { x: 0, y: 0, z: 0 };
    refreshUI();
    if ($('sbMsg')) $('sbMsg').textContent = 'ZERO RETURN — tool di home mesin';
  });
}

// Softkeys — action registry: CONFIG hanya menyebut nama action; kode di sini.
function sbMsg(msg) { if ($('sbMsg')) $('sbMsg').textContent = msg; }

const ACTIONS = {
  'open-offset': () => {
    applyMode('setup');
    applySetupSub('work');
    sbMsg('OFFSET — Work Coordinate System (ZERO = touch-off)');
  },
  'current-cmds': () => {
    showCurrentCmds();
    sbMsg('CURNT CMDS — ' + machine.activeWcs + ' T' + machine.tool +
      (machine.hNum ? ' G43 H' + String(machine.hNum).padStart(2, '0') : '') +
      ' F' + Math.round(machine.feed) + ' S' + (machine.spindleOn ? machine.spindle : 'OFF'));
  },
  'alarm': () => {
    showAlarmPanel();
    sbMsg(alarmHistory.length ? ('ALARM — ' + alarmHistory.length + ' pesan') : 'ALARM — NO ALARMS');
  },
  'graph': () => setGraphVisible(!graphVisible),
  'training': () => openTraining(),
  'coolant': () => {
    const on = !machine.coolant;
    machine.coolant = on;
    sim.onCoolant(on);
    sbMsg(on ? 'COOLANT ON' : 'COOLANT OFF');
  },
  'single-block': () => {
    const c = $('chkSingleBlock');
    if (c) { c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
  },
  'dry-run': () => applyDryRun(!sim.dryRun)
};

document.getElementById('softkeys')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.sk');
  if (!btn) return;
  const action = btn.dataset.action;
  if (!action) return;
  if (Object.prototype.hasOwnProperty.call(ACTIONS, action)) ACTIONS[action]();
  else sbMsg('action "' + action + '" belum diimplementasikan');
});

if ($('btnTrainClose')) $('btnTrainClose').addEventListener('click', closeTraining);
if ($('trainOverlay')) {
  $('trainOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'trainOverlay') closeTraining();
  });
}
if ($('btnTrainReset')) $('btnTrainReset').addEventListener('click', resetTraining);
if ($('btnTrainStart')) {
  $('btnTrainStart').addEventListener('click', () => {
    closeTraining();
    applyMode('setup');
  });
}
document.querySelectorAll('.train-goto').forEach((btn) => {
  btn.addEventListener('click', () => {
    const g = btn.dataset.goto;
    if (g === 'partzero') {
      applyMode('setup');
      applySetupSub('work');
    } else if (g === 'toollength') {
      applyMode('setup');
      applySetupSub('tool');
    } else if (g === 'dryrun') {
      applyDryRun(true);
      applyMode('mem');
    } else if (g === 'cyclestart') {
      applyDryRun(false);
      applyMode('mem');
    }
  });
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (sim.playing) sim.pause();
    else {
      if (toolpathGroup) toolpathGroup.visible = false;
      sim.play();
    }
    refreshUI();
    return;
  }
  if (currentMode === 'jog') {
    const map = {
      ArrowLeft: ['x', -1], ArrowRight: ['x', 1],
      ArrowDown: ['y', -1], ArrowUp: ['y', 1],
      PageDown: ['z', -1], PageUp: ['z', 1]
    };
    if (map[e.code]) {
      e.preventDefault();
      jogAxis(map[e.code][0], map[e.code][1]);
    }
  }
});

// ---------- Loop ----------
let last = performance.now();
let trailAcc = 0;
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sim.tick(dt);
  sim.updateSpindle(dt);
  for (const s of fixtures.stocks()) s.updateMesh(scene);
  trailAcc += dt;
  if (sim.playing && trailAcc > 0.1) {
    trailAcc = 0;
    rebuildTrail();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// ---------- Boot ----------
async function boot() {
  profile = await loadController('./controllers/haas-style.json')
    .catch(() => {
      sbMsg('controller profile gagal dimuat — pakai default');
      return normalizeProfile(null);
    });
  renderModeTabs(profile, profile.default);
  renderDroTabs(profile, 'work');
  renderSoftkeys(profile);
  renderSetupSubs(profile, 'work');
  applySetupSub('work');
  applyMode(profile.default);
  setGraphVisible(true);
  loadPersistedOffsets();
  syncOffsetInputsFromTables();
  applyStockSetup(true);
  if ($('gcodeInput')) $('gcodeInput').value = SAMPLE;
  loadProgram();
  applyMode(profile.default);
  requestAnimationFrame(animate);
}
boot();

// MDI handlers
if ($('btnMdiRun')) {
  $('btnMdiRun').addEventListener('click', () => {
    const val = $('mdiInput')?.value || '';
    if (!val.trim()) return;
    if (sim.state === 'alarm') {
      sim.stop();
    }
    const p = parseGCode(val);
    allMoves = p.moves;
    machineMoves = allMoves.map((e) => {
      const t = moveTarget(e, machine);
      return Object.assign({}, e, { mx: t.x, my: t.y, mz: t.z });
    });
    sim.loadMoves(allMoves, 0);
    sim.play();
  });
}
if ($('btnMdiClear')) {
  $('btnMdiClear').addEventListener('click', () => {
    if ($('mdiInput')) $('mdiInput').value = '';
  });
}
