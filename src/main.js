import { VoxelStock } from './stock/VoxelStock.js';
import { parseGCode } from './machine/Parser.js';
import { createMachineState, updateWorkCoords } from './machine/MachineState.js';
import { Simulator } from './sim/Simulator.js';
import {
  createScene,
  createToolMesh,
  setToolPosition,
  buildToolpathLines
} from './view/Scene.js';

const SAMPLE = `; Contour + Pocket – Stock 100x80x20 | Tool D6
; Z0 = top of stock
G21 G90 G17 G54
T1 M6
S12000 M3
G0 Z50
G0 X0 Y0

; Approach
G0 X10 Y10
G0 Z5
G1 Z-2 F200

; Outer contour
G1 X90 F800
G1 Y70
G1 X10
G1 Y10

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
const { scene, camera, renderer, controls } = createScene(container);

const stock = new VoxelStock({
  sizeX: 100, sizeY: 80, sizeZ: 20, res: 1.0,
  originX: 0, originY: 0, originZ: -20
});
stock.updateMesh(scene, true);

const toolMesh = createToolMesh();
scene.add(toolMesh);

let toolpathGroup = null;
const machine = createMachineState();

const wcsTable = {
  G54: { x: 0, y: 0, z: 0 },
  G55: { x: 0, y: 0, z: 0 },
  G56: { x: 0, y: 0, z: 0 }
};
let activeWcs = 'G54';
const toolTable = {
  1: { length: 0, dia: 6, type: 'End Mill' },
  2: { length: 0, dia: 10, type: 'End Mill' },
  3: { length: 0, dia: 3, type: 'Drill' }
};
let activeTool = 1;
let droMode = 'work';

const sim = new Simulator({
  stock,
  machine,
  onUpdate: refreshUI,
  onLine: highlightLine
});

const $ = (id) => document.getElementById(id);

function fmt(n) {
  return (n ?? 0).toFixed(3);
}

function refreshUI() {
  const w = updateWorkCoords(machine);
  if (droMode === 'machine') {
    if ($('droX')) $('droX').textContent = fmt(machine.x);
    if ($('droY')) $('droY').textContent = fmt(machine.y);
    if ($('droZ')) $('droZ').textContent = fmt(machine.z);
  } else {
    if ($('droX')) $('droX').textContent = fmt(w.x);
    if ($('droY')) $('droY').textContent = fmt(w.y);
    if ($('droZ')) $('droZ').textContent = fmt(w.z);
  }

  if ($('simStatus')) {
    $('simStatus').textContent = sim.playing
      ? 'RUN'
      : (sim.index >= sim.moves.length && sim.moves.length ? 'DONE' : 'IDLE');
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

  setToolPosition(toolMesh, machine.x, machine.y, machine.z);

  if ($('btnPlay')) $('btnPlay').disabled = sim.playing;
  if ($('btnPause')) $('btnPause').disabled = !sim.playing;
  if ($('btnStop')) $('btnStop').disabled = !sim.playing && sim.index === 0;
}

function highlightLine(lineNum) {
  const info = $('lineInfo');
  if (info) info.textContent = lineNum != null ? 'Baris aktif: ' + lineNum : 'Baris aktif: —';
  document.querySelectorAll('.gline').forEach((el) => {
    el.classList.remove('active');
    if (lineNum != null && +el.dataset.line === lineNum) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

function showLinesView(text) {
  const lines = text.split(/\r?\n/);
  const wrap = $('gcodeLines');
  if (!wrap) return;
  wrap.innerHTML = lines.map((t, i) =>
    '<div class="gline" data-line="' + (i + 1) + '"><span class="ln">' + (i + 1) +
    '</span><span class="tx">' + t.replace(/</g, '<') + '</span></div>'
  ).join('');
  if ($('gcodeInput')) $('gcodeInput').style.display = 'none';
  wrap.style.display = 'block';
}

function showEditView() {
  if ($('gcodeInput')) $('gcodeInput').style.display = 'block';
  if ($('gcodeLines')) $('gcodeLines').style.display = 'none';
}

function loadProgram() {
  const text = ($('gcodeInput') && $('gcodeInput').value) || SAMPLE;
  const { moves, totalTime } = parseGCode(text);
  sim.loadMoves(moves, totalTime);
  if ($('lineCount')) $('lineCount').textContent = moves.length + ' gerakan';

  if (toolpathGroup) {
    scene.remove(toolpathGroup);
    toolpathGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    toolpathGroup = null;
  }
  toolpathGroup = buildToolpathLines(moves);
  scene.add(toolpathGroup);

  stock.reset();
  stock.updateMesh(scene, true);
  showLinesView(text);
  refreshUI();
}

if ($('btnLoad')) $('btnLoad').addEventListener('click', loadProgram);
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

if ($('btnPlay')) $('btnPlay').addEventListener('click', () => { sim.play(); refreshUI(); });
if ($('btnPause')) $('btnPause').addEventListener('click', () => { sim.pause(); refreshUI(); });
if ($('btnStop')) $('btnStop').addEventListener('click', () => { sim.stop(); refreshUI(); });
if ($('btnStep')) $('btnStep').addEventListener('click', () => { sim.step(); refreshUI(); });
if ($('btnReset')) $('btnReset').addEventListener('click', () => {
  sim.stop();
  stock.reset();
  stock.updateMesh(scene, true);
  refreshUI();
});

const chkSB = $('chkSingleBlock');
if (chkSB) chkSB.addEventListener('change', (e) => { sim.singleBlock = e.target.checked; });
const chkDR = $('chkDryRun');
if (chkDR) chkDR.addEventListener('change', (e) => { sim.dryRun = e.target.checked; });

const speedSlider = $('speedSlider');
if (speedSlider) {
  speedSlider.addEventListener('input', (e) => {
    sim.simSpeed = +e.target.value;
    if ($('speedLabel')) $('speedLabel').textContent = (+e.target.value).toFixed(1) + '×';
  });
}
const feedOvr = $('feedOverride');
if (feedOvr) {
  feedOvr.addEventListener('input', (e) => {
    sim.feedOvr = +e.target.value / 100;
    if ($('feedVal')) $('feedVal').textContent = e.target.value + '%';
  });
}
const rapidOvr = $('rapidOverride');
if (rapidOvr) {
  rapidOvr.addEventListener('input', (e) => {
    sim.rapidOvr = +e.target.value / 100;
    if ($('rapidVal')) $('rapidVal').textContent = e.target.value + '%';
  });
}

if ($('btnResetView')) $('btnResetView').addEventListener('click', () => {
  camera.position.set(160, 110, 200);
  controls.target.set(50, 0, 40);
  controls.update();
});
if ($('btnTopView')) $('btnTopView').addEventListener('click', () => {
  camera.position.set(50, 180, 40);
  controls.target.set(50, 0, 40);
  controls.update();
});
if ($('btnIsoView')) $('btnIsoView').addEventListener('click', () => {
  camera.position.set(160, 110, 200);
  controls.target.set(50, 0, 40);
  controls.update();
});

document.querySelectorAll('.mode-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const modeName = btn.dataset.mode;
    if ($('simMode')) $('simMode').textContent = modeName.toUpperCase();
    const prog = $('panelProgram');
    const setup = $('panelSetup');
    if (modeName === 'setup') {
      if (prog) prog.style.display = 'none';
      if (setup) setup.style.display = 'flex';
    } else {
      if (prog) prog.style.display = 'flex';
      if (setup) setup.style.display = 'none';
    }
  });
});

document.querySelectorAll('.subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const sub = btn.dataset.sub;
    if ($('setupWork')) $('setupWork').style.display = sub === 'work' ? 'flex' : 'none';
    if ($('setupTool')) $('setupTool').style.display = sub === 'tool' ? 'flex' : 'none';
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

document.querySelectorAll('#workOffsetTable tbody tr').forEach((row) => {
  row.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    document.querySelectorAll('#workOffsetTable tbody tr').forEach((r) => r.classList.remove('active-row'));
    row.classList.add('active-row');
    activeWcs = row.dataset.wcs;
  });
  row.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      wcsTable[row.dataset.wcs][inp.dataset.axis] = parseFloat(inp.value) || 0;
    });
  });
  const zeroBtn = row.querySelector('.btn-set-zero');
  if (zeroBtn) {
    zeroBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wcs = row.dataset.wcs;
      wcsTable[wcs] = { x: machine.x, y: machine.y, z: machine.z };
      row.querySelectorAll('input').forEach((inp) => {
        inp.value = wcsTable[wcs][inp.dataset.axis].toFixed(3);
      });
      document.querySelectorAll('#workOffsetTable tbody tr').forEach((r) => r.classList.remove('active-row'));
      row.classList.add('active-row');
      activeWcs = wcs;
    });
  }
});

if ($('btnApplyWcs')) {
  $('btnApplyWcs').addEventListener('click', () => {
    const o = wcsTable[activeWcs];
    machine.g54 = { x: o.x, y: o.y, z: o.z };
    refreshUI();
  });
}

document.querySelectorAll('#toolOffsetTable tbody tr').forEach((row) => {
  row.addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    document.querySelectorAll('#toolOffsetTable tbody tr').forEach((r) => r.classList.remove('active-row'));
    row.classList.add('active-row');
    activeTool = +row.dataset.tool;
  });
  row.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      toolTable[+row.dataset.tool][inp.dataset.field] = parseFloat(inp.value) || 0;
    });
  });
});

if ($('btnApplyTool')) {
  $('btnApplyTool').addEventListener('click', () => {
    const t = toolTable[activeTool];
    machine.tool = activeTool;
    machine.toolLength = t.length;
    machine.toolDiameter = t.dia;
    refreshUI();
  });
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    if (sim.playing) sim.pause();
    else sim.play();
    refreshUI();
  }
});

let last = performance.now();
function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sim.tick(dt);
  stock.updateMesh(scene);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

if ($('gcodeInput')) $('gcodeInput').value = SAMPLE;
loadProgram();
requestAnimationFrame(animate);
