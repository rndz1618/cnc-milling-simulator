// v0.9.0 — mesin koordinat mesin (Tahap 1+3+2)
// Semua posisi = koordinat MESIN. DRO WORK = machine − offset WCS.
import { VoxelStock } from './stock/VoxelStock.js';
import { boundsFromPoints, formatStockSize } from './stock/fitStock.js';
import { parseGCode } from './machine/Parser.js';
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
  buildToolpathLines,
  createWorkZeroMarker,
  createVise
} from './view/Scene.js';
import * as THREE from 'three';
import {
  trainState, markTrain, openTraining, closeTraining, resetTraining, renderTrainSteps
} from './train.js';

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

// ---------- Stock (ruang mesin) ----------
const stock = new VoxelStock({
  sizeX: 100, sizeY: 80, sizeZ: 20, res: 1.0,
  originX: -50, originY: -40, originZ: -20
});
stock.updateMesh(scene, true);

const stockSetup = {
  placement: 'top-center', // 'top-center' | 'top-corner' | 'custom'
  sizeX: 100, sizeY: 80, sizeZ: 20,
  originX: -50, originY: -40, originZ: -20
};

let viseGroup = null;
let wcsMarkersGroup = null;

// ---------- Tool ----------
const toolMesh = createToolMesh({ diameter: 12, flute: 36, overall: 100 });
scene.add(toolMesh);

const toolTable = {
  1: { length: 0, dia: 6, flute: 18, overall: 80, type: 'End Mill' },
  2: { length: 0, dia: 10, flute: 30, overall: 95, type: 'End Mill' },
  3: { length: 0, dia: 12, flute: 36, overall: 100, type: 'End Mill' }
};

// ---------- State ----------
const machine = createMachineState();
let activeTool = 1;
let droMode = 'work';
let jogInc = 0.1;
let currentMode = 'edit';
let lastActiveLine = null;
let alarmHistory = [];
let toolpathGroup = null;
let trailGroup = null;
let graphVisible = true;
let allMoves = [];        // entri parser (work coords + tag)
let machineMoves = [];    // entri + target machine (untuk preview/trail/fit)

const LS_WCS = 'cnc-sim-wcs';
const LS_TOOLS = 'cnc-sim-tools';

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n ?? 0).toFixed(3);

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
  if ($('stockX')) $('stockX').value = stockSetup.sizeX;
  if ($('stockY')) $('stockY').value = stockSetup.sizeY;
  if ($('stockZ')) $('stockZ').value = stockSetup.sizeZ;
  syncStockPlacementInputs();
}

function syncStockPlacementInputs() {
  const sel = $('stockPlacement');
  if (sel) sel.value = stockSetup.placement;
  const custom = stockSetup.placement === 'custom';
  ['stockOx', 'stockOy', 'stockOz'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.disabled = !custom;
      el.parentElement.style.opacity = custom ? '1' : '0.45';
    }
  });
  if ($('stockOx')) $('stockOx').value = stockSetup.originX;
  if ($('stockOy')) $('stockOy').value = stockSetup.originY;
  if ($('stockOz')) $('stockOz').value = stockSetup.originZ;
}

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

// ---------- Tool ----------
function applyToolFromTable(toolNum) {
  const t = toolTable[toolNum];
  if (!t) return;
  machine.tool = toolNum;
  machine.toolLength = t.length;
  machine.toolDiameter = t.dia;
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
  onUpdate: refreshUI,
  onLine: highlightLine,
  onAlarm: (msg, line) => {
    pushAlarm(msg, line);
    showAlarmPanel();
  },
  onTool: (t) => {
    if (toolTable[t]) applyToolFromTable(t);
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
    const marker = createWorkZeroMarker(active ? 20 : 9);
    marker.position.set(off.x, off.z, off.y);
    if (!active) marker.scale.setScalar(0.6);
    wcsMarkersGroup.add(marker);
  }
  scene.add(wcsMarkersGroup);
}

function rebuildVise() {
  disposeGroup(viseGroup);
  viseGroup = createVise({
    spanX: stock.sizeX + 10,
    yMin: stock.originY,
    yMax: stock.originY + stock.sizeY,
    topZ: stock.originZ
  });
  viseGroup.position.x = stock.originX + stock.sizeX / 2;
  scene.add(viseGroup);
}

function frameStock() {
  const cx = stock.originX + stock.sizeX / 2;
  const cy = stock.originY + stock.sizeY / 2;
  const cz = stock.originZ + stock.sizeZ / 2;
  const span = Math.max(stock.sizeX, stock.sizeY, stock.sizeZ * 2);
  controls.target.set(cx, cz, cy);
  camera.position.set(cx + span * 0.9, cz + span * 0.7, cy + span * 1.1);
  controls.update();
}

// ---------- Stock setup ----------
function applyStockSetup(fitToView = true) {
  const g54 = machine.wcs.G54;
  let ox, oy, oz;
  if (stockSetup.placement === 'top-center') {
    ox = g54.x - stockSetup.sizeX / 2;
    oy = g54.y - stockSetup.sizeY / 2;
    oz = g54.z - stockSetup.sizeZ;
  } else if (stockSetup.placement === 'top-corner') {
    ox = g54.x;
    oy = g54.y;
    oz = g54.z - stockSetup.sizeZ;
  } else {
    ox = stockSetup.originX;
    oy = stockSetup.originY;
    oz = stockSetup.originZ;
  }
  stockSetup.originX = ox;
  stockSetup.originY = oy;
  stockSetup.originZ = oz;
  stock.resize({
    sizeX: stockSetup.sizeX,
    sizeY: stockSetup.sizeY,
    sizeZ: stockSetup.sizeZ,
    originX: ox, originY: oy, originZ: oz
  }, scene);
  stock.reset();
  stock.updateMesh(scene, true);
  if (stock.mesh) stock.mesh.visible = !sim.dryRun;
  rebuildVise();
  syncStockPlacementInputs();
  if ($('stockSizeLabel')) {
    $('stockSizeLabel').textContent = Math.round(stockSetup.sizeX) + '\u00d7' +
      Math.round(stockSetup.sizeY) + '\u00d7' + Math.round(stockSetup.sizeZ);
  }
  if ($('stockInfo')) {
    $('stockInfo').textContent = 'origin mesin: ' + ox.toFixed(1) + ', ' + oy.toFixed(1) + ', ' + oz.toFixed(1);
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
  if (stock.mesh) stock.mesh.visible = !on;
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

function showLinesView(text) {
  const lines = text.split(/\r?\n/);
  const wrap = $('gcodeLines');
  if (!wrap) return;
  wrap.innerHTML = lines.map((t, i) =>
    '<div class="gline" data-line="' + (i + 1) + '"><span class="ln">' + (i + 1) +
    '</span><span class="tx">' + t.replace(/</g, '&lt;') + '</span></div>'
  ).join('');
  if ($('gcodeInput')) $('gcodeInput').style.display = 'none';
  wrap.style.display = 'block';
}

function showEditView() {
  if ($('gcodeInput')) $('gcodeInput').style.display = 'block';
  if ($('gcodeLines')) $('gcodeLines').style.display = 'none';
}

// ---------- Load program ----------
function loadProgram() {
  const text = ($('gcodeInput') && $('gcodeInput').value) || SAMPLE;
  const parsed = parseGCode(text);
  allMoves = parsed.moves || [];
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
  if (currentMode !== 'setup') return;
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
if ($('btnPause')) $('btnPause').addEventListener('click', () => { sim.pause(); refreshUI(); });
if ($('btnStop')) $('btnStop').addEventListener('click', () => {
  sim.stop();
  disposeGroup(trailGroup);
  trailGroup = null;
  if (toolpathGroup) toolpathGroup.visible = graphVisible;
  if (stock.mesh) stock.mesh.visible = !sim.dryRun;
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
  camera.position.set(
    stock.originX + stock.sizeX / 2,
    stock.originZ + Math.max(stock.sizeX, stock.sizeY) * 1.6,
    stock.originY + stock.sizeY / 2
  );
  controls.target.set(
    stock.originX + stock.sizeX / 2,
    stock.originZ + stock.sizeZ / 2,
    stock.originY + stock.sizeY / 2
  );
  controls.update();
});
if ($('btnIsoView')) $('btnIsoView').addEventListener('click', frameStock);

document.querySelectorAll('.mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
    if ($('simMode')) $('simMode').textContent = currentMode.toUpperCase();
    const prog = $('panelProgram');
    const setup = $('panelSetup');
    if (currentMode === 'setup') {
      if (prog) prog.style.display = 'none';
      if (setup) setup.style.display = 'flex';
    } else {
      if (prog) prog.style.display = 'flex';
      if (setup) setup.style.display = 'none';
    }
    updateStatusBar();
  });
});

document.querySelectorAll('.subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const sub = btn.dataset.sub;
    const panes = ['work', 'tool', 'jog', 'stock'];
    panes.forEach((p) => {
      const el = $('setup' + p.charAt(0).toUpperCase() + p.slice(1));
      if (el) el.style.display = sub === p ? 'flex' : 'none';
    });
  });
});

document.querySelectorAll('.dro-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dro-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    droMode = btn.dataset.dro;
    refreshUI();
  });
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
      rebuildPreview();
      rebuildWcsMarkers();
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
      rebuildPreview();
      rebuildWcsMarkers();
      updateActiveCodes();
      refreshUI();
      markTrain('partzero');
      if ($('sbMsg')) $('sbMsg').textContent = wcs + ' ZERO di posisi mesin kini — offset disimpan';
    });
  }
});

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

// Stock controls
if ($('stockPlacement')) {
  $('stockPlacement').addEventListener('change', (e) => {
    stockSetup.placement = e.target.value;
    applyStockSetup(true);
  });
}
if ($('btnApplyStock')) {
  $('btnApplyStock').addEventListener('click', () => {
    stockSetup.sizeX = Math.max(10, parseFloat($('stockX').value) || 100);
    stockSetup.sizeY = Math.max(10, parseFloat($('stockY').value) || 80);
    stockSetup.sizeZ = Math.max(5, parseFloat($('stockZ').value) || 20);
    if (stockSetup.placement === 'custom') {
      stockSetup.originX = parseFloat($('stockOx').value) || 0;
      stockSetup.originY = parseFloat($('stockOy').value) || 0;
      stockSetup.originZ = parseFloat($('stockOz').value) || 0;
    }
    if ($('chkAutoFit')) $('chkAutoFit').checked = false;
    applyStockSetup(true);
    if ($('sbMsg')) $('sbMsg').textContent = 'Stock diterapkan: ' +
      Math.round(stockSetup.sizeX) + '\u00d7' + Math.round(stockSetup.sizeY) + '\u00d7' + Math.round(stockSetup.sizeZ);
  });
}

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

// Softkeys
document.querySelectorAll('.sk').forEach((btn) => {
  btn.addEventListener('click', () => {
    const sk = btn.dataset.sk;
    if (sk === 'f1') {
      document.querySelector('.mode-tab[data-mode="setup"]')?.click();
      document.querySelector('.subtab[data-sub="work"]')?.click();
      if ($('sbMsg')) $('sbMsg').textContent = 'OFFSET — Work Coordinate System (ZERO = touch-off)';
    } else if (sk === 'f2') {
      if ($('sbMsg')) $('sbMsg').textContent = 'CURNT CMDS — ' + machine.activeWcs +
        ' T' + machine.tool + (machine.hNum ? ' G43 H' + String(machine.hNum).padStart(2, '0') : '') +
        ' F' + Math.round(machine.feed) + ' S' + (machine.spindleOn ? machine.spindle : 'OFF');
    } else if (sk === 'f3') {
      showAlarmPanel();
      if ($('sbMsg')) $('sbMsg').textContent = alarmHistory.length
        ? ('ALARM — ' + alarmHistory.length + ' pesan')
        : 'ALARM — NO ALARMS';
    } else if (sk === 'f4') {
      setGraphVisible(!graphVisible);
    } else if (sk === 'f5') {
      openTraining();
    } else if (sk === 'f6') {
      const on = !machine.coolant;
      machine.coolant = on;
      sim.onCoolant(on);
      if ($('sbMsg')) $('sbMsg').textContent = on ? 'COOLANT ON' : 'COOLANT OFF';
    } else if (sk === 'f7') {
      const c = $('chkSingleBlock');
      if (c) {
        c.checked = !c.checked;
        c.dispatchEvent(new Event('change'));
      }
    } else if (sk === 'f8') {
      applyDryRun(!sim.dryRun);
    }
  });
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
    document.querySelector('.mode-tab[data-mode="setup"]')?.click();
  });
}
document.querySelectorAll('.train-goto').forEach((btn) => {
  btn.addEventListener('click', () => {
    const g = btn.dataset.goto;
    if (g === 'partzero') {
      document.querySelector('.mode-tab[data-mode="setup"]')?.click();
      document.querySelector('.subtab[data-sub="work"]')?.click();
    } else if (g === 'toollength') {
      document.querySelector('.mode-tab[data-mode="setup"]')?.click();
      document.querySelector('.subtab[data-sub="tool"]')?.click();
    } else if (g === 'dryrun') {
      applyDryRun(true);
      document.querySelector('.mode-tab[data-mode="operation"]')?.click();
    } else if (g === 'cyclestart') {
      applyDryRun(false);
      document.querySelector('.mode-tab[data-mode="operation"]')?.click();
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
  if (currentMode === 'setup') {
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
  stock.updateMesh(scene);
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
document.querySelectorAll('.sk[data-sk="f4"]').forEach((b) => b.classList.add('active'));
if ($('sk4')) $('sk4').textContent = 'GRAPH ON';
loadPersistedOffsets();
syncOffsetInputsFromTables();
applyStockSetup(true);
if ($('gcodeInput')) $('gcodeInput').value = SAMPLE;
loadProgram();
requestAnimationFrame(animate);
