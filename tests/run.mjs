/**
 * Unit test parser & state — jalankan: npm test
 * Golden file: program O20018 dari handoff (kasus nyata Jack).
 */
import { parseGCode } from '../src/machine/Parser.js';
import { createMachineState, moveTarget, workCoords, outOfTravel } from '../src/machine/MachineState.js';
import { normalizeProfile, loadController } from '../src/controllers/Panel.js';

let pass = 0, fail = 0;
const failures = [];

/** hanya entri gerak (rapid/feed/home) — bukan tool/stop/alarm dsb. */
function motionOf(parsed) {
  return parsed.moves.filter((m) =>
    m.type === 'rapid' || m.type === 'feed' || m.type === 'home');
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else {
    fail++;
    failures.push(label + '\n    expected: ' + e + '\n    actual:   ' + a);
  }
}

function ok(cond, label) {
  if (cond) pass++;
  else { fail++; failures.push(label); }
}

// ---------- Golden: O20018 ----------
const O20018 = `%
O20018
(MALE BOX AI 535-18-01/51)
(26-03-2026)
G28 G91 Z0
(BOX LOCK 18)
(X0. TENGAH KLEM)
(Y0. TENGAH KLEM)
(Z0. ATAS KLEM)

T3 M06
(VHM D12MM)
(RAGUM KIRI)
G00 G90 G54 X-87. Y13.2 S2500 M03
G43 Z. H03 D03 M08
G01 Z-31.33 F1000.
G01 X-80. F700.
G01 X-45. Y-8.95 F150.
G01 X-80. Y5.75
G01 X-45. Y-16.3
G00 Z100.
G00 X35. Y13.45
G00 Z2.
G01 Z-31.27 F1000.
G01 X45. F700.
G01 X80. Y-9.1 F150.
G01 X45. Y5.85
G01 X80. Y-16.25
G00 Z100.
G28 G91 Z0
G00 G90 G119 X0 Y0

M01

(RAGUM KANAN)

T3 M06
(VHM D12MM)
G00 G90 G55 X-87. Y-22. S2500 M03
G43 Z. H03 D03 M08
G01 Z-30.35 F1000.
G01 X-80. F500.
G01 X-45. Y2.25 F150.
G00 Z100.
M30
%`;

const r = parseGCode(O20018);

// Kriteria Tahap 3 handoff: bare decimal
ok(r.moves.some((m) => m.type === 'rapid' && m.z === 0),
  'O20018: "G43 Z." → Z0 (bare decimal)');

// G119 memunculkan alarm DAN blok tidak dieksekusi
ok(r.alarms.some((a) => a.code === 'G119'),
  'O20018: alarm untuk G119');
ok(!r.moves.some((m) => m.x === 0 && m.y === 0 && m.type === 'rapid' && !m.machine),
  'O20018: blok G119 TIDAK menghasilkan move X0 Y0');

// WCS ter-tag per move
const firstG54 = r.moves.find((m) => m.type === 'feed');
eq(firstG54?.wcs, 'G54', 'O20018: move pertama G54');
const g55 = r.moves.find((m) => m.wcs === 'G55' && m.type === 'feed');
ok(g55 && g55.y === -22, 'O20018: blok G55 ter-tag G55 (y=-22 work)');

// Transform G55 saat eksekusi: offset default G55 = (0,-90,0)
const st0 = createMachineState();
const t55 = moveTarget(g55, st0);
eq([t55.x, t55.y], [-87, -112], 'G55: work(-87,-22) → mesin(-87,-112) dengan offset (0,-90,0)');
const w55 = workCoords({ ...st0, x: t55.x, y: t55.y, z: t55.z, activeWcs: 'G55' });
eq([w55.x, w55.y], [-87, -22], 'DRO WORK G55 kembali (-87,-22)');

// M01 menghasilkan optional stop
ok(r.moves.some((m) => m.type === 'stop' && m.optional),
  'O20018: M01 → stop optional');

// G28 → entri home (bukan move koordinat palsu)
eq(r.moves.filter((m) => m.type === 'home').length, 2, 'O20018: dua blok G28 → 2 entri home');
const home1 = r.moves.find((m) => m.type === 'home');
eq(home1.axes, ['z'], 'O20018: "G28 G91 Z0" → home sumbu Z saja');
const stH = createMachineState();
stH.x = -87; stH.y = 13.2; stH.z = -31.33;
const th = moveTarget(home1, stH);
eq(th.z, 150, 'G28 Z: Z menuju home mesin (150), XY tetap');

// G43 H03 → entri toolcomp h=3
const tc = r.moves.filter((m) => m.type === 'toolcomp');
eq(tc.length, 2, 'O20018: dua blok G43 → 2 entri toolcomp');
eq(tc[0].h, 3, 'O20018: H03 → h=3');

// T3 M06 → entri tool
eq(r.moves.filter((m) => m.type === 'tool' && m.tool === 3).length, 2,
  'O20018: dua T3 M06 → 2 entri tool');

// ---------- N-line (bug kritis lama) ----------
const nTest = parseGCode('N10 G0 X10\nN20 G1 X20 F100\nM30');
eq(motionOf(nTest).length, 2, 'N-line: program dengan N-numbering tidak hilang');

// ---------- Modal ----------
const modal = parseGCode('G1 X10 F100\nX20\nY30\nM30');
eq(motionOf(modal).length, 3, 'Modal: G1/F modal dipakai ulang');
eq(motionOf(modal)[2].f, 100, 'Modal: F modal 100 di blok ketiga');

// ---------- Kode gerak (untuk CURNT CMDS live) ----------
const codes = parseGCode('G0 X10\nG1 X20 F100\nG2 X30 I5\nM30');
eq(motionOf(codes)[0].g, 0, 'CURNT CMDS: G0 → move.g=0');
eq(motionOf(codes)[1].g, 1, 'CURNT CMDS: G1 → move.g=1');
ok(motionOf(codes).slice(2).every((m) => m.g === 2),
  'CURNT CMDS: tiap segmen busur G2 membawa g=2');

// ---------- G91 incremental ----------
const inc = parseGCode('G0 X10 Y10\nG91 X5\nG90 X0 Y0\nM30');
eq([inc.moves[1].x, inc.moves[1].y], [15, 10], 'G91: incremental dari 10,10 → 15,10');

// ---------- G20 inch ----------
const inch = parseGCode('G20\nG1 X1 F10\nM30');
eq(inch.moves[0].x, 25.4, 'G20: X1 inch → 25.4 mm');
eq(inch.moves[0].f, 254, 'G20: F10 inch/min → 254 mm/min');

// ---------- Canned cycle ----------
const cc = parseGCode('G0 Z5\nG0 X0 Y0\nG99 G81 X10 Y10 Z-5 R2 F100\nX20 Y10\nG80\nM30');
// Lubang 1: rapid XY, rapid R2, feed Z-5, rapid Z kembali ke R (G99)
const hole1 = cc.moves.filter((m) => m.x === 10 && m.y === 10);
eq(hole1.map((m) => m.type), ['rapid', 'rapid', 'feed', 'rapid'], 'G81: urutan rapid-R, feed-Z, rapid-retract');
eq(hole1[2].z, -5, 'G81: kedalaman Z-5');
eq(hole1[3].z, 2, 'G99: retract ke R2');
const hole2 = cc.moves.filter((m) => m.x === 20 && m.y === 10);
eq(hole2.length, 3, 'G81 modal: blok kedua hanya X/Y → lubang berikutnya');
ok(cc.moves.every((m) => m.type !== 'alarm'), 'G81: tanpa alarm');

// G83 peck
const g83 = parseGCode('G0 Z5\nG99 G83 X0 Y0 Z-10 R2 Q4 F100\nG80\nM30');
const feeds83 = g83.moves.filter((m) => m.type === 'feed').map((m) => m.z);
eq(feeds83, [-2, -6, -10], 'G83: peck 4mm dari R2 → Z-2,-6,-10');

// ---------- Alarm menghentikan ----------
const unk = parseGCode('G1 X10 F100\nG45 X20\nG1 X30\nM30');
ok(unk.alarms.length === 1 && unk.alarms[0].code === 'G45', 'G45 tak dikenal → 1 alarm');
const alarmEntry = unk.moves.find((m) => m.type === 'alarm');
ok(!!alarmEntry, 'G45: entri alarm dalam stream (halt runtime)');

// ---------- G43 tanpa H ----------
const noH = parseGCode('G43 Z5\nM30');
ok(noH.alarms.some((a) => a.code === 'G43'), 'G43 tanpa H → alarm');

// ---------- O-sub M97 ----------
const sub = parseGCode(
  'G0 X0 Y0\nO1000\nG91 G1 X5 F100\nG1 Y5\nG90\nM99\nM97 P1000 L2\nM30'
);
const feedSub = sub.moves.filter((m) => m.type === 'feed');
eq(feedSub.length, 4, 'M97 L2: sub 2 gerak inkremental × 2 loop = 4 feed');

// ---------- M00 / M30 ----------
const stops = parseGCode('G0 X1\nM00\nG0 X2\nM30');
eq(stops.moves.filter((m) => m.type === 'stop').map((m) => m.end),
  [undefined, true], 'M00 → stop, M30 → stop end');

// ---------- G53 ----------
const g53 = createMachineState();
g53.x = 100; g53.y = 50; g53.z = 10;
const mg53 = parseGCode('G53 Z-5\nM30').moves[0];
const tgt53 = moveTarget(mg53, g53);
eq(tgt53.z, -5, 'G53 Z-5: target koordinat mesin langsung');

// ---------- Soft limit ----------
ok(outOfTravel({ x: 999, y: 0, z: 0 }).includes('X'), 'Soft limit: X di luar travel');
ok(outOfTravel({ x: 0, y: 0, z: 0 }).length === 0, 'Soft limit: origin aman');

// ---------- Simulator: soft limit G54.z=150 (skenario touch-off di home) ----------
const { Simulator } = await import('../src/sim/Simulator.js');
const { VoxelStock } = await import('../src/stock/VoxelStock.js');
{
  const machine = createMachineState();
  machine.wcs.G54 = { x: 0, y: 0, z: 150 };
  const stock = new VoxelStock({ sizeX: 100, sizeY: 100, sizeZ: 20, res: 2, originX: 0, originY: 0, originZ: -20 });
  stock.updateMesh({ add() {}, remove() {}, traverse() {} }, true);
  const alarms = [];
  const sim = new Simulator({
    stock, machine,
    onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm: (m) => alarms.push(m),
    onTool() {}, onToolComp() {}, onCoolant() {}
  });
  const p = parseGCode('G0 Z50\nM30');
  sim.loadMoves(p.moves, 0);
  sim.play();
  let guard = 0;
  while (sim.playing && guard++ < 10000) sim.tick(0.05);
  ok(sim.state === 'alarm', 'Sim: G54.z=150 + G0 Z50 → alarm soft limit');
  const msg = alarms[0] || '';
  ok(msg.includes('SOFT LIMIT Z') && msg.includes('200.0') && msg.includes('G54'),
    'Sim: pesan soft limit memuat target Z200 dan offset G54 → "' + msg.slice(0, 90) + '…"');
}

// ---------- Arc G2 (regresi dari SAMPLE) ----------
const arc = parseGCode('G0 X10 Y10\nG2 X20 Y20 I10 J0 F100\nM30');
ok(arc.moves.filter((m) => m.type === 'feed').length >= 8, 'G2 IJ: arc di-expand jadi ≥8 segmen');
const lastArc = arc.moves[arc.moves.length - 2];
eq([lastArc.x, lastArc.y], [20, 20], 'G2: titik akhir arc tepat (20,20)');

// ---------- Controller profile: normalizeProfile ----------
eq(normalizeProfile(null).modes.length, 5, 'normalize: null → 5 mode default');
eq(normalizeProfile(null).default, 'mem', 'normalize: null → default mem');
eq(normalizeProfile({ modes: [] }).modes.length, 5, 'normalize: modes kosong → 5 default');
const sk = normalizeProfile({ softkeys: [
  { f: 12, label: 'X' }, { f: 1, label: 'A' }, { f: 1, label: 'B' }
]}).softkeys;
eq(sk.find((s) => s.f === 8)?.label, 'X', 'normalize: f=12 di-clamp ke 8');
eq(sk.filter((s) => s.f === 1).length, 1, 'normalize: f duplikat di-dedupe');
eq(sk.find((s) => s.f === 1)?.label, 'A', 'normalize: dedupe → entri pertama menang');
eq(normalizeProfile({ modes: [{ id: 'foo' }], default: 'bar' }).default, 'foo', 'normalize: default tak valid → mode pertama');
ok(normalizeProfile({ softkeys: [{ f: 2, label: 'Z', action: 'nope' }] }).softkeys[0].action === 'nope', 'normalize: action tak dikenal aman');
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  let threw = false;
  try { await loadController('/missing.json'); } catch { threw = true; }
  globalThis.fetch = origFetch;
  ok(threw, 'loadController: reject saat HTTP gagal');
}

// ---------- Laporan ----------
console.log('PASS:', pass, ' FAIL:', fail);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
} else {
  console.log('Semua test lulus ✓');
}
