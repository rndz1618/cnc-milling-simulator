/**
 * Unit test parser & state — jalankan: npm test
 * Golden file: program O20018 dari handoff (kasus nyata Jack).
 */
import { parseGCode } from '../src/machine/Parser.js';
import { createMachineState, moveTarget, workCoords, outOfTravel } from '../src/machine/MachineState.js';
import * as THREE from 'three';
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

function close(actual, expected, tol, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const okLen = actual.length === expected.length;
  const within = actual.every((v, i) => Math.abs(v - expected[i]) <= tol);
  if (okLen && within) { pass++; }
  else {
    fail++;
    failures.push(label + '\n    expected: ' + e + '\n    actual:   ' + a);
  }
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

// G119 = sistem koordinat kerja #16 (dialek Haas mill) → WCS valid, BUKAN alarm.
// (Bug lama: G110–G129 di luar whitelist → "Unknown G-code".)
ok(!r.alarms.some((a) => a.code === 'G119'),
  'O20018: G119 dikenali sebagai WCS #16 (tidak alarm)');
const g119 = r.moves.find((m) => m.wcs === 'G119' && m.type === 'rapid');
ok(g119 && g119.x === 0 && g119.y === 0,
  'O20018: blok G119 menghasilkan rapid X0 Y0 di WCS G119');

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

// ---------- G110–G129: sistem koordinat kerja tambahan (Haas mill #7–#26) ----------
const gw = parseGCode('G00 G90 G110 X10. Y10.\nG01 G119 X5. Y5. F100\nG130 X1.');
eq(gw.alarms.filter((a) => a.code === 'G130').length, 1,
  'G130 (di luar G110–G129) tetap alarm');
eq(gw.alarms.length, 1, 'G110/G119 tidak memunculkan alarm lain');
const m110 = gw.moves.find((m) => m.wcs === 'G110' && m.type === 'rapid');
const m119 = gw.moves.find((m) => m.wcs === 'G119' && m.type === 'feed');
ok(m110, 'blok G110 ter-tag WCS G110');
ok(m119, 'blok G119 ter-tag WCS G119');
const stw = createMachineState();
eq(moveTarget(m110, stw), { x: 10, y: 10, z: 0 },
  'WCS G110 default offset 0 → work=machine');

// Profil non-Haas bisa mematikan rentang G110–G129 (nomor itu dipakai Siemens
// untuk pole, Mazak untuk cross-machining) → harus tetap alarm, bukan diam-diam
// ditafsirkan jadi work offset.
const gwOff = parseGCode('G00 G90 G110 X10.', { extraWcs: { disabled: true } });
eq(gwOff.alarms.filter((a) => a.code === 'G110').length, 1,
  'profil tanpa extraWcs: G110 tetap UNKNOWN (tidak salah tafsir)');
const gwOn = parseGCode('G00 G90 G110 X10.', { extraWcs: { from: 110, to: 129 } });
ok(gwOn.moves.some((m) => m.wcs === 'G110'),
  'profil Haas: G114 tetap WCS (extraWcs eksplisit)');

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

// ---------- Potongan dangkal (regresi Jack: Z-0.35 res 1.0 → tak terpotong) ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const s = new VoxelStock({ sizeX: 40, sizeY: 40, sizeZ: 20, res: 1.0, originX: 0, originY: 0, originZ: -20 });
  s.cutSegment(10, 10, 5, 10, 10, -0.35, 6);
  ok(s.remainingRatio < 1,
    'cut dangkal Z-0.35 (res 1.0) benar-benar menghapus voxel (ratio=' + s.remainingRatio.toFixed(3) + ')');
  const { ix, iy, iz } = s.worldToVoxel(10, 10, -0.35);
  ok(s.grid[s.idx(ix, iy, iz)] === 0,
    'voxel tempat ujung tool Z-0.35 terhapus');
  ok(s.grid[s.idx(ix, iy, iz - 1)] === 1,
    'voxel DI BAWAH muka potong (lebih dalam) tetap ada — bukan plunge-through');
  // Kedalaman besar harus tetap menghapus cukup banyak.
  const d = new VoxelStock({ sizeX: 40, sizeY: 40, sizeZ: 20, res: 1.0, originX: 0, originY: 0, originZ: -20 });
  d.cutSegment(10, 10, 5, 10, 10, -10.5, 6);
  ok(d.remainingRatio < 0.98, 'cut dalam Z-10.5 menghapus volume besar (ratio=' + d.remainingRatio.toFixed(3) + ')');
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
  const m = normalizeProfile({ modes: [{ id: 'foo', pane: 'nope', view: 'nope' }] }).modes[0];
  eq([m.pane, m.view], ['program', 'lines'], 'normalize: pane/view tak dikenal dijepit ke default');
  const custom = normalizeProfile({
    modes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    softkeys: [{ f: 1 }, { f: 2 }, { f: 3 }, { f: 4 }, { f: 5 }, { f: 6 }]
  });
  eq([custom.modes.length, custom.softkeys.length], [3, 6], 'normalize: profil non-default dibiarkan (data-driven)');
}
{
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  let threw = false;
  try { await loadController('/missing.json'); } catch { threw = true; }
  globalThis.fetch = origFetch;
  ok(threw, 'loadController: reject saat HTTP gagal');
}

// ---------- Tahap 6: cutter comp entry ----------
const comp = parseGCode('T1 M6\nG0 X0 Y0\nG41 D1\nG1 X10 F100\nG40\nM30');
const compEntries = comp.moves.filter((m) => m.type === 'comp');
eq(compEntries.map((e) => e.side), ['left', null], 'G41 → comp left; G40 → null');
eq(compEntries[0].d, 1, 'G41 D1 → d=1');
ok(comp.alarms.length === 0, 'G41/G42 tidak lagi men-alarm');
const compDefault = parseGCode('T3 M6\nG41\nG1 X5 F100\nM30');
eq(compDefault.moves.find((m) => m.type === 'comp').d, 3, 'G41 tanpa D → default tool aktif');
const compPlane = parseGCode('G18 G41 D1\nG1 X5 F100\nM30');
ok(compPlane.alarms.some((a) => a.code === 'G41'), 'G41 di plane G18 → alarm');

// ---------- Tahap 6: Compensator ----------
const { applyCutterComp } = await import('../src/machine/Compensator.js');
const compProgram = parseGCode('T1 M6\nG0 X-5 Y0\nG41 D1\nG1 X10 F100\nG1 X10 Y10\nG40\nM30');
const comped = applyCutterComp(compProgram.moves || [], { getRadius: () => 3 });
const compedMotion = comped.filter((m) => m.type === 'rapid' || m.type === 'feed');
eq(compedMotion.length, 3, 'Comp: 3 motion (rapid + 2 feed)');
close(compedMotion.map((m) => m.x), [-5, 7, 7], 1e-6, 'Comp left: X offset (lead-in & miter)');
close(compedMotion.map((m) => m.y), [0, 3, 10], 1e-6, 'Comp left: Y offset');
const plainProgram = parseGCode('T1 M6\nG0 X-5 Y0\nG1 X10 F100\nG1 X10 Y10\nG1 Y0 F100\nM30');
const plainComped = applyCutterComp(plainProgram.moves || [], { getRadius: () => 3 });
eq(plainComped.filter((m) => m.type === 'rapid' || m.type === 'feed').map((m) => [m.x, m.y]),
  [[-5, 0], [10, 0], [10, 10], [10, 0]], 'Comp non-aktif → path identik');

// Comp: gerak tanpa perpindahan XY (plunge/retract) pertahankan offset (tak gouge ke kontur mentah).
{
  const zc = applyCutterComp(
    parseGCode('G0 X0 Y0\nG41 D1\nG1 X10 F100\nG1 Y10\nG1 Z5\nG40\nM30').moves,
    { getRadius: () => 3 }
  ).filter((m) => m.type === 'feed');
  close([zc[zc.length - 1].x, zc[zc.length - 1].y], [7, 10], 1e-6,
    'Comp: Z move pertahankan offset (bukan titik mentah)');
}
// Comp: ganti plane ke non-G17 saat comp aktif → alarm (spec §5.2).
{
  const ps = parseGCode('G17 G41 D1\nG1 X10 Y10 F100\nG18\nG1 X20 Z5\nG40\nM30');
  ok(ps.alarms.some((a) => a.msg === 'CUTTER COMP HANYA G17'),
    'Comp: ganti plane saat comp aktif → alarm');
}

// ---------- Tahap 6: arc G18/G19 ----------
const segsOf = (p) => p.moves.filter((m) => m.type === 'feed');
const g18 = parseGCode('G0 X0 Y2 Z0\nG18 G2 X0 Z10 I0 K5 F100\nM30');
ok(!g18.alarms.length, 'G18: tanpa alarm');
ok(segsOf(g18).length >= 8, 'G18: arc di-expand jadi ≥8 segmen');
const mid18 = segsOf(g18).reduce((a, b) => (Math.abs(b.x) > Math.abs(a.x) ? b : a));
ok(Math.abs(Math.abs(mid18.x) - 5) < 1e-6, 'G18: titik tengah X=±5');
ok(Math.abs(mid18.z - 5) < 1e-6, 'G18: titik tengah Z=5');
ok(segsOf(g18).every((s) => Math.abs(s.y - 2) < 1e-9), 'G18: Y tetap 2');
const g19 = parseGCode('G0 X2 Y0 Z0\nG19 G2 Y0 Z10 J0 K5 F100\nM30');
ok(!g19.alarms.length, 'G19: tanpa alarm');
const mid19 = segsOf(g19).reduce((a, b) => (Math.abs(b.y) > Math.abs(a.y) ? b : a));
ok(Math.abs(Math.abs(mid19.y) - 5) < 1e-6 && Math.abs(mid19.z - 5) < 1e-6, 'G19: tengah Y±5 Z5');
ok(segsOf(g19).every((s) => Math.abs(s.x - 2) < 1e-9), 'G19: X tetap 2');

// ---------- Tahap 6: G4 dwell ----------
const dw = parseGCode('G4 P1.5\nG0 X5\nM30');
eq(dw.moves.find((m) => m.type === 'dwell')?.p, 1.5, 'G4 P1.5 → dwell p=1.5');
const dw0 = parseGCode('G4\nG0 X5\nM30');
eq(dw0.moves.find((m) => m.type === 'dwell')?.p, 0, 'G4 tanpa P → dwell p=0');

// H3: G4 X = waktu (detik), JANGAN dikonversi unit meski mode G20 (inch).
const dwIn = parseGCode('G20\nG4 X0.5\nM30');
eq(dwIn.moves.find((m) => m.type === 'dwell')?.p, 0.5, 'H3: G4 X0.5 di G20 → dwell 0.5s (bukan 12.7)');
const dwInP = parseGCode('G20\nG4 P0.5\nM30');
eq(dwInP.moves.find((m) => m.type === 'dwell')?.p, 0.5, 'H3: G4 P0.5 di G20 → dwell 0.5s');

// ---------- Tahap 6: G84 tapping ----------
const tap = parseGCode('G0 X0 Y0 Z0\nG84 X5 Y5 Z-10 R2 F100\nM30');
const tapMoves = tap.moves.filter((m) => m.type === 'feed');
ok(!tap.alarms.length, 'G84: tanpa alarm');
eq(tapMoves[0].spindleDir, 3, 'G84: feed masuk spindleDir 3');
eq(tapMoves[tapMoves.length - 1].spindleDir, 4, 'G84: feed keluar spindleDir 4 (balik)');
eq(tapMoves[tapMoves.length - 1].z, 2, 'G84: keluar ke level R (G99)');
const tapQ = parseGCode('G84 X5 Y5 Z-10 R2 Q1 F100\nM30');
ok(tapQ.alarms.some((a) => a.code === 'G84'), 'G84 + Q → alarm TANPA PECK');

// ---------- Tahap 6: dwell + ATC timer ----------
{
  const machine = createMachineState();
  const stock = new VoxelStock({ sizeX: 100, sizeY: 100, sizeZ: 20, res: 2, originX: 0, originY: 0, originZ: -20 });
  stock.updateMesh({ add() {}, remove() {}, traverse() {} }, true);
  const sim = new Simulator({
    stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm() {}, onTool() {}, onToolComp() {}, onCoolant() {}
  });
  sim.dryRun = true;
  const tools = [];
  const sim2 = new Simulator({
    stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm() {}, onTool: (t) => tools.push(t), onToolComp() {}, onCoolant() {}
  });
  sim2.dryRun = true;
  sim.loadMoves(parseGCode('G4 P0.2\nG0 X10\nM30').moves, 0);
  sim.play();
  ok(sim.timerKind === 'dwell' && sim.timer > 0, 'dwell: play memicu timer');
  let g = 0;
  while (sim.playing && g++ < 1000) sim.tick(0.05);
  ok(sim.state === 'done', 'dwell: selesai setelah waktu habis');
  ok(sim.elapsed >= 0.2 - 1e-6, 'dwell: elapsed menghitung durasi');
  sim2.loadMoves(parseGCode('T2 M6\nG0 X5\nM30').moves, 0);
  sim2.play();
  ok(sim2.timerKind === 'atc' && tools[0] === 2, 'ATC: M6 memicu timer + onTool');
}

// ---------- Tahap 6: spindle ramp + feed hold ----------
{
  const machine = createMachineState();
  const stock = new VoxelStock({ sizeX: 100, sizeY: 100, sizeZ: 20, res: 2, originX: -50, originY: -50, originZ: -20 });
  stock.updateMesh({ add() {}, remove() {}, traverse() {} }, true);
  const sim = new Simulator({
    stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm() {}, onTool() {}, onToolComp() {}, onCoolant() {}
  });
  sim.dryRun = true;
  machine.spindleTarget = 6000;
  sim.updateSpindle(0.1);
  ok(machine.spindle > 0 && machine.spindle < 6000, 'ramp: naik bertahap, belum penuh');
  for (let i = 0; i < 100; i++) sim.updateSpindle(0.05);
  eq(machine.spindle, 6000, 'ramp: mencapai target');
  sim.loadMoves(parseGCode('G0 X-100\nG0 X0\nM30').moves, 0);
  sim.play();
  sim.tick(0.01);
  const before = sim.progress;
  sim.feedHold();
  ok(sim.state === 'hold' && sim.holdReason === 'feed', 'feed hold → state hold + alasan');
  ok(sim.progress >= before, 'feed hold: progress dipertahankan');
  sim.play();
  let g = 0;
  while (sim.playing && g++ < 100000) sim.tick(0.05);
  ok(sim.index >= sim.moves.length, 'resume: menyelesaikan seluruh move');
}

// ---------- Tahap 6: regresi stream comp + dwell di Simulator ----------
{
  const machine = createMachineState();
  const stock = new VoxelStock({ sizeX: 100, sizeY: 100, sizeZ: 20, res: 2, originX: 0, originY: 0, originZ: -20 });
  stock.updateMesh({ add() {}, remove() {}, traverse() {} }, true);
  const mkSim = () => {
    const s = new Simulator({
      stock, machine: createMachineState(), onUpdate() {}, onLine() {}, onMessage() {},
      onAlarm() {}, onTool() {}, onToolComp() {}, onCoolant() {}
    });
    s.dryRun = true;
    return s;
  };
  const runAll = (sim) => { sim.play(); let g = 0; while (sim.playing && g++ < 100000) sim.tick(0.05); return g; };

  // C1: entry comp tak boleh dieksekusi sebagai gerak (dulu → NaN).
  const comped = applyCutterComp(
    parseGCode('G0 X-5\nG41 D1\nG1 X10\nG1 X10 Y10\nG40\nM30').moves,
    { getRadius: () => 3 }
  );
  const simC = mkSim();
  simC.loadMoves(comped, 0);
  runAll(simC);
  ok([simC.machine.x, simC.machine.y, simC.machine.z].every(Number.isFinite), 'comp: koordinat tetap finite (tanpa NaN)');
  ok(simC.state === 'done', 'comp: program selesai');

  // C2: dwell lalu stop — dulu M30 dieksekusi sebagai gerak → NaN.
  const simD = mkSim();
  simD.loadMoves(parseGCode('G4 P0.3\nM30').moves, 0);
  runAll(simD);
  ok([simD.machine.x, simD.machine.y, simD.machine.z].every(Number.isFinite), 'dwell+end: koordinat finite');
  ok(simD.state === 'done', 'dwell+end: selesai');

  // C2b: dwell lalu M00 harus tetap berhenti di M00 (bukan dilewati).
  const simE = mkSim();
  simE.loadMoves(parseGCode('G4 P0.2\nM00\nG0 X5\nM30').moves, 0);
  simE.play();
  for (let i = 0; i < 50; i++) simE.tick(0.05);
  ok(simE.state === 'hold', 'dwell lalu M00: berhenti di M00');
}

// ---------- Tahap 7: model fixture ----------
{
  const { makeFixture, stockOriginFor, migrateLegacyStock, normalizeFixtures, materialColor, MATERIALS } =
    await import('../src/machine/Fixtures.js');
  const f = makeFixture({ wcs: 'G54', stock: { sizeX: 120, sizeY: 60, sizeZ: 30 }, placement: 'top-center' });
  const o = stockOriginFor(f, { x: 0, y: -90, z: 0 });
  eq({ x: o.x, y: o.y, z: o.z }, { x: -60, y: -120, z: -30 }, 'Fixtures: top-center origin');
  const corner = makeFixture({ stock: { sizeX: 80, sizeY: 60, sizeZ: 20 }, placement: 'top-corner' });
  eq(stockOriginFor(corner, { x: 10, y: 20, z: 30 }), { x: 10, y: 20, z: 10 }, 'Fixtures: top-corner origin');
  const shifted = makeFixture({ stock: { sizeX: 100, sizeY: 80, sizeZ: 20 }, placement: 'top-center', offset: { x: 5, y: -7, z: 0 } });
  eq(stockOriginFor(shifted, { x: 0, y: 0, z: 0 }), { x: -45, y: -47, z: -20 }, 'Fixtures: geser offset top-center');
  const fx = migrateLegacyStock({ sizeX: 80, sizeY: 60, sizeZ: 20, placement: 'top-corner', originX: 1, originY: 2, originZ: 3 });
  eq(fx.length, 1); eq(fx[0].wcs, 'G54');
  const norm = normalizeFixtures([{ wcs: 'G60' }, { wcs: 'G54' }, { wcs: 'G54' }]);
  eq(norm.length, 1); eq(norm[0].wcs, 'G54');
  eq(materialColor('alum'), MATERIALS.alum.color);
  eq(materialColor('xyz'), MATERIALS.alum.color);
}

// ---------- Tahap 7: touch-off ----------
{
  const t = await import('../src/machine/TouchOff.js');
  const origin = { x: -50, y: -30, z: -20 }, size = { x: 100, y: 60, z: 20 };
  eq(t.edgePlane('x-', origin, size), { axis: 'x', value: -50 });
  eq(t.edgePlane('x+', origin, size), { axis: 'x', value: 50 });
  eq(t.edgePlane('z-top', origin, size), { axis: 'z', value: 0 });
  eq(t.contactOffset('x-', 3, { x: -53, y: 0, z: 0 }), { axis: 'x', value: -50 });
  eq(t.contactOffset('x+', 3, { x: 53, y: 0, z: 0 }), { axis: 'x', value: 50 });
  ok(t.checkContact('x-', 3, { x: -53 }, { axis: 'x', value: -50 }) === true);
  ok(t.checkContact('x-', 3, { x: -60 }, { axis: 'x', value: -50 }) === false);
}

// ---------- Tahap 7: multi-stok (resolveStock) ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const { Simulator } = await import('../src/sim/Simulator.js');
  const { FixtureManager } = await import('../src/sim/FixtureManager.js');
  const { makeFixture } = await import('../src/machine/Fixtures.js');
  const A = new VoxelStock({ sizeX: 60, sizeY: 40, sizeZ: 10, res: 2, originX: 0, originY: 0, originZ: -10 });
  const B = new VoxelStock({ sizeX: 60, sizeY: 40, sizeZ: 10, res: 2, originX: 0, originY: -90, originZ: -10 });
  const res = (wcs) => (wcs === 'G55' ? B : A);
  const sim = new Simulator({ stock: A, machine: createMachineState(), resolveStock: res, onResetStocks: () => { A.reset(); B.reset(); } });
  const before = A.remainingRatio;
  sim.loadMoves(parseGCode('G00 G90 G54 X5 Y5 Z0\nG01 Z-5 F100\nG01 X15\nG00 Z5\nG55 X5 Y5 Z0\nG01 Z-5\nG01 X15').moves);
  let g = 0;
  while (sim.index < sim.moves.length && g++ < 100000) sim.step();
  ok(A.remainingRatio < before && B.remainingRatio < before, 'dua stok terpotong');
  ok(Math.abs(A.remainingRatio - B.remainingRatio) < 0.05, 'potongan simetris dua stok');
  const mgr = new FixtureManager({ scene: null, machine: createMachineState() });
  mgr.build([makeFixture({ wcs: 'G54' })]);
  ok(mgr.stockFor('G57') === null, 'stockFor WCS tanpa fixture → null');
}

// ---------- W1/H2: offset WCS berubah → stok geser, cut dipertahankan ----------
{
  const { FixtureManager } = await import('../src/sim/FixtureManager.js');
  const { makeFixture } = await import('../src/machine/Fixtures.js');
  const machine = createMachineState();
  const mgr = new FixtureManager({ scene: null, machine });
  mgr.build([makeFixture({ wcs: 'G54' })]);
  const s = mgr.stockFor('G54');
  const x0 = s.originX, y0 = s.originY;
  s.cutCylinder(s.originX + 10, s.originY + 10, s.originZ, 3);
  const cut0 = s.remainingRatio;
  machine.wcs.G54 = { x: 25, y: -5, z: 4 };
  mgr.reposition();
  eq(s.originX, x0 + 25, 'H2: origin stok ikut offset WCS (+X)');
  eq(s.originY, y0 - 5, 'H2: origin stok ikut offset WCS (−Y)');
  eq(s.remainingRatio, cut0, 'H2: material terpotong dipertahankan saat reposition');
}

// ---------- Tahap 7: vise ber-parameter ----------
{
  const { createVise } = await import('../src/view/Scene.js');
  const g1 = createVise({ jawWidth: 100, jawHeight: 40, opening: 60, baseH: 40, centerX: 0, yMin: -30, yMax: 30, topZ: 0 });
  const g2 = createVise({ jawWidth: 200, jawHeight: 40, opening: 60, baseH: 40, centerX: 0, yMin: -30, yMax: 30, topZ: 0 });
  g1.updateMatrixWorld(true); g2.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(g1), b2 = new THREE.Box3().setFromObject(g2);
  ok((b2.max.x - b2.min.x) > (b1.max.x - b1.min.x), 'vise melebar dengan jawWidth');
}

// ---------- Tahap 7: skenario ----------
{
  const { serializeScenario, parseScenario, makeFixture } = await import('../src/machine/Fixtures.js');
  const s = { fixtures: [makeFixture({ wcs: 'G54' })], program: 'G0 X0', wcs: { G54: { x: 0, y: 0, z: 0 } }, tools: [{ n: 1 }] };
  const back = parseScenario(serializeScenario(s));
  eq(back.program, 'G0 X0'); eq(back.fixtures.length, 1); eq(back.tools.length, 1);
  ok(parseScenario('{bukan json') === null, 'skenario korup → null');
  ok(parseScenario('null') === null, 'skenario null → null');
}

// ---------- Tahap 7: skenario golden 2-ragum ----------
{
  const { Simulator } = await import('../src/sim/Simulator.js');
  const { FixtureManager } = await import('../src/sim/FixtureManager.js');
  const { makeFixture, serializeScenario, parseScenario } = await import('../src/machine/Fixtures.js');
  const program = 'G00 G90 G54 X0 Y0 Z5\nG01 Z-6 F120\nG01 X40\nG00 Z10\nG55 X0 Y0 Z5\nG01 Z-2 F120\nG01 X40\nG00 Z10';
  const scenario = {
    fixtures: [
      makeFixture({ wcs: 'G54' }),
      makeFixture({ wcs: 'G55', name: 'Ragum 2' })
    ],
    program,
    wcs: { G54: { x: 0, y: 0, z: 0 }, G55: { x: 0, y: 0, z: 0 } },
    tools: [{ n: 1 }]
  };
  const back = parseScenario(serializeScenario(scenario));
  eq(back.program, program, 'skenario reproduksi program 2-ragum');
  eq(back.fixtures.length, 2, 'skenario reproduksi layout 2 ragum');

  const machine = createMachineState();
  const mgr = new FixtureManager({ scene: null, machine });
  mgr.build(back.fixtures);
  const A = mgr.stockFor('G54'), B = mgr.stockFor('G55');
  ok(A && B, 'dua stok per WCS tersedia');
  const sim = new Simulator({ stock: A, machine, resolveStock: (wcs) => mgr.stockFor(wcs), onResetStocks: () => mgr.stocks().forEach((s) => s.reset()) });
  sim.loadMoves(parseGCode(program).moves);
  let g = 0;
  while (sim.index < sim.moves.length && g++ < 100000) sim.step();
  ok(A.remainingRatio < 1 && B.remainingRatio < 1, 'dua stok terpotong independen');
  ok(A.remainingRatio < B.remainingRatio, 'potongan G54 lebih dalam → sisa lebih kecil (' + A.remainingRatio + ' vs ' + B.remainingRatio + ')');
}

// ---------- Tahap 8: profil tool ----------
{
  const { toolProfile, radiusAt, sampleCollision } = await import('../src/machine/ToolProfile.js');
  const p = toolProfile({ dia: 12, flute: 36, overall: 100 });
  eq(p.r, 6, 'ToolProfile: r = dia/2');
  eq(p.fluteLen, 36, 'ToolProfile: fluteLen');
  eq(p.shankLen, 39.2, 'ToolProfile: shankLen = overall-flute-collet-stub');
  eq(p.shankR, 6.12, 'ToolProfile: shankR = max(r*1.02,6)');
  eq(p.colletR, 11, 'ToolProfile: colletR = max(shankR*1.3,11)');
  eq(radiusAt(p, 10), 6, 'ToolProfile: radius di flute');
  eq(radiusAt(p, 40), 6.12, 'ToolProfile: radius di shank');
  eq(radiusAt(p, 90), 11, 'ToolProfile: radius di holder');
  eq(radiusAt(p, 200), null, 'ToolProfile: di atas overall → null');

  // Holdout: hanya holder yang kena (flute di atas stok) → HOLDER CRASH
  const solid = () => true;                       // semua titik = material
  const high = () => false;                       // semua titik kosong
  eq(sampleCollision(high, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, p), null,
    'ToolProfile: di udara → null');
  eq(sampleCollision(solid, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, p), 'RAPID CRASH',
    'ToolProfile: flute kena → RAPID CRASH');
  // flute ([100,136]) di bawah material; holder bawah (100+75.2=175.2) kena material-atas
  const holderOnly = (x, y, z) => z > 140;       // material hanya tinggi di atas
  eq(sampleCollision(holderOnly, { x: 0, y: 0, z: 100 }, { x: 10, y: 0, z: 100 }, p), 'HOLDER CRASH',
    'ToolProfile: hanya holder kena → HOLDER CRASH');
  // Regresi: flute harus dicek di ujung, bukan hanya tengah → plunge vertikal.
  eq(sampleCollision(solid, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, p), 'RAPID CRASH',
    'ToolProfile: plunge vertikal ke stok pejal → RAPID CRASH');
  // Stok tipis 5 mm (muka atas z=0, bawah z=-5): bug lama (probe tengah flute)
  // melewatkannya; probe di ujung flute harus menangkapnya.
  const shallow = (x, y, z) => z > -5 && z < 0;
  eq(sampleCollision(shallow, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -5 }, p), 'RAPID CRASH',
    'ToolProfile: embed flute dangkal (tip turun 5 mm) → RAPID CRASH');
}

// ---------- Tahap 8: greedy mesher ----------
{
  const { buildGreedyGeometry, COLOR_RAW, COLOR_CUT } = await import('../src/stock/greedyMesh.js');
  const solid = { grid: new Uint8Array(4 * 4 * 4).fill(1), nx: 4, ny: 4, nz: 4,
    originX: 0, originY: 0, originZ: 0, res: 1 };
  const g = buildGreedyGeometry(solid);
  ok(!!g, 'greedy: solid grid menghasilkan geometri');
  const tri = g.position.length / 9;
  ok(tri <= 12, 'greedy: kubus solid ≤ 12 triangle (naif 192), dapat ' + tri);
  eq(g.normal.length, g.position.length, 'greedy: panjang normal = position');
  eq(g.color.length, g.position.length, 'greedy: panjang color = position');
  // semua raw (belum ada potongan)
  const hasCut = Array.from(g.color).some((c) => Math.abs(c - COLOR_CUT[0]) < 1e-6);
  ok(!hasCut, 'greedy: belum dipotong → tanpa warna cut');

  const carved = new Uint8Array(4 * 4 * 4).fill(1);
  carved[0] = carved[1] = 0;                     // buang 2 voxel di sudut
  const g2 = buildGreedyGeometry({ ...solid, grid: carved });
  const colors = Array.from(g2.color);
  ok(colors.some((c) => Math.abs(c - COLOR_RAW[0]) < 1e-6), 'greedy: ada sisi raw (luar)');
  ok(colors.some((c) => Math.abs(c - COLOR_CUT[0]) < 1e-6), 'greedy: ada sisi cut (galian)');
  const contrast = Math.hypot(COLOR_RAW[0] - COLOR_CUT[0], COLOR_RAW[1] - COLOR_CUT[1], COLOR_RAW[2] - COLOR_CUT[2]);
  ok(contrast > 0.4, 'greedy: warna cut kontras vs raw (jarak ' + contrast.toFixed(2) + ')');
  const empty = buildGreedyGeometry({ ...solid, grid: new Uint8Array(4 * 4 * 4) });
  ok(empty === null, 'greedy: grid kosong → null');
}

// ---------- Tahap 8: VoxelStock greedy ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const { COLOR_CUT } = await import('../src/stock/greedyMesh.js');
  const s = new VoxelStock({ sizeX: 10, sizeY: 10, sizeZ: 10, res: 5, originX: 0, originY: 0, originZ: 0 });
  const geo = s.buildGeometry();
  const tri = (geo.attributes.position?.count || 0) / 3;
  ok(tri > 0 && tri <= 12, 'VoxelStock: stok solid → greedy ≤ 12 triangle, dapat ' + tri);
  // cut lalu rebuild: ada warna cut (bukan hanya raw).
  // Catatan: brief memakai radius 2, tapi pada res 5 pusat voxel di 2.5 →
  // jarak ke garis y=0 adalah 2.55 (> 2) sehingga tak ada voxel tersentuh;
  // radius 3 agar potongan benar-benar menyentuh grid.
  ok(s.cutSegment(0, 0, 0, 10, 0, 0, 3), 'VoxelStock: cut mengubah grid');
  const geo2 = s.buildGeometry();
  const col = geo2.attributes.color.array;
  const cutR = COLOR_CUT[0];
  ok(Array.from(col).some((c, i) => i % 3 === 0 && Math.abs(c - cutR) < 1e-6),
    'VoxelStock: setelah potong ada warna machined (cut)');
}

// ---------- Tahap 8: holder crash ----------
{
  const { Simulator } = await import('../src/sim/Simulator.js');
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const machine = createMachineState();
  machine.toolDiameter = 12;
  machine.toolSpec = { dia: 12, flute: 36, overall: 100 };
  const stock = new VoxelStock({ sizeX: 160, sizeY: 40, sizeZ: 120, res: 4, originX: -80, originY: -20, originZ: -120 });
  // Galian slot sempit (~16 lebar) di x=0,y=0 turun ke Z=-100: flute (Ø12) bisa masuk, holder (Ø22) TIDAK.
  stock.cutSegment(0, 0, 0, 0, 0, -100, 8);
  const alarms = [];
  const sim = new Simulator({ stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm: (m) => alarms.push(m), onTool() {}, onToolComp() {}, onCoolant() {} });
  machine.wcs.G54 = { x: 0, y: 0, z: 0 };
  // Ujung tool turun ke Z=-80: flute ([-80,-44]) di dalam slot yang dibersihkan s/d -100 → aman;
  // muka bawah holder di Z=-80+36+39.2=-4.8 (radius colletR=11) menabrak dinding slot → HOLDER CRASH.
  sim.loadMoves(parseGCode('G00 G90 G54 X0 Y0 Z5\nG00 Z-80\nM30').moves, 0);
  sim.play();
  let g = 0; while (sim.playing && g++ < 100000) sim.tick(0.05);
  ok(sim.state === 'alarm', 'Holder crash: rapid ke slot sempit → alarm');
  ok((alarms[0] || '').includes('HOLDER CRASH'),
    'Holder crash: pesan HOLDER CRASH (bukan RAPID), dapat: ' + (alarms[0] || '').slice(0, 60));
}

// ---------- Tahap 8: MeshService ----------
{
  const { createMeshService } = await import('../src/stock/MeshService.js');
  // Worker tiruan: balas dengan buffer sederhana
  class FakeWorker {
    constructor() { FakeWorker.last = this; this.onmessage = null; }
    postMessage(msg) { this._sent = msg; }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
  }
  const svc = createMeshService({ WorkerCtor: FakeWorker });
  const grid = new Uint8Array(8);
  const p = svc.request({ grid, nx: 2, ny: 2, nz: 2, originX: 0, originY: 0, originZ: 0, res: 1 });
  const sent = FakeWorker.last._sent;
  ok(typeof sent.id !== 'undefined', 'MeshService: kirim id');
  FakeWorker.last.reply({ id: sent.id, position: new Float32Array([0, 0, 0]), normal: new Float32Array([0, 1, 0]), color: new Float32Array([1, 1, 1]) });
  const res = await p;
  ok(res && res.position.length === 3, 'MeshService: reply → resolve buffer');

  const p2 = svc.request({ grid, nx: 2, ny: 2, nz: 2, originX: 0, originY: 0, originZ: 0, res: 1 });
  const id2 = FakeWorker.last._sent.id;
  FakeWorker.last.reply({ id: id2, error: 'boom' });
  let threw = false; try { await p2; } catch { threw = true; }
  ok(threw, 'MeshService: reply error → reject');
  svc.dispose();
  ok(FakeWorker.last.terminated === true, 'MeshService: dispose men-terminate worker');

  const none = createMeshService({ WorkerCtor: null });
  let threw2 = false; try { await none.request({ grid, nx: 2, ny: 2, nz: 2, originX: 0, originY: 0, originZ: 0, res: 1 }); } catch { threw2 = true; }
  ok(threw2, 'MeshService: tanpa Worker → reject (pemanggil fallback sinkron)');

  // Worker gagal load/crash → pending request harus reject (bukan menggantung).
  const svcErr = createMeshService({ WorkerCtor: FakeWorker });
  const pErr = svcErr.request({ grid, nx: 2, ny: 2, nz: 2, originX: 0, originY: 0, originZ: 0, res: 1 });
  FakeWorker.last.onerror({ message: 'load gagal' });
  let threw3 = false; try { await pErr; } catch (e) { threw3 = e.message === 'load gagal'; }
  ok(threw3, 'MeshService: worker onerror → reject pending');
  let threw4 = false; try { await svcErr.request({ grid, nx: 2, ny: 2, nz: 2, originX: 0, originY: 0, originZ: 0, res: 1 }); } catch { threw4 = true; }
  ok(threw4, 'MeshService: setelah onerror → request berikutnya reject');
  svcErr.dispose();
}

// ---------- Tahap 8: VoxelStock async mesh ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const scene = { children: [], add(m) { this.children.push(m); }, remove(m) { this.children = this.children.filter((x) => x !== m); } };
  const calls = [];
  const fake = {
    request(spec) { calls.push(spec); return Promise.resolve({ position: new Float32Array([0,0,0,1,0,0,0,1,0]), normal: new Float32Array([0,1,0,0,1,0,0,1,0]), color: new Float32Array([1,1,1,1,1,1,1,1,1]) }); },
    dispose() {}
  };
  const s = new VoxelStock({ sizeX: 10, sizeY: 10, sizeZ: 10, res: 5, originX: 0, originY: 0, originZ: 0, meshService: fake });
  s.updateMesh(scene, true);
  await new Promise((r) => setTimeout(r, 0));    // tunggu microtask reply
  ok(calls.length === 1, 'VoxelStock async: kirim 1 request ke service');
  ok(!!s.mesh && !!s.mesh.geometry, 'VoxelStock async: mesh terpasang dari reply');
  ok(s.grid.every ? s.grid.length === 8 : true, 'VoxelStock async: grid asli tetap utuh (bukan transfer)');
  ok(s.grid.reduce((a, b) => a + b, 0) > 0, 'VoxelStock async: grid asli tidak kehilangan data');

  // service gagal → fallback sinkron (mesh tetap ada)
  const bad = { request() { return Promise.reject(new Error('x')); }, dispose() {} };
  const s2 = new VoxelStock({ sizeX: 10, sizeY: 10, sizeZ: 10, res: 5, originX: 0, originY: 0, originZ: 0, meshService: bad });
  s2.updateMesh(scene, true);
  await new Promise((r) => setTimeout(r, 0));
  ok(!!s2.mesh && !!s2.mesh.geometry, 'VoxelStock async: service gagal → fallback sinkron');
}

// ---------- Bugfix: mesh tetap ter-update SAAT cutting kontinu (worker async) ----------
// Regresi: token "latest-wins" lama membuang SETIAP balasan worker selama ada
// permintaan lebih baru yang dikirim. Karena worker ~jauh lebih lambat dari
// rebuildIntervalMs, saat cutting kontinu semua balasan basi → mesh hanya
// ter-update ketika cutting berhenti (akhir program). Test: dengan service
// lambat + cutting kontinu, mesh harus ter-update beberapa kali, bukan 0x.
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const { buildGreedyGeometry } = await import('../src/stock/greedyMesh.js');
  const scene = { children: [], add(m) { this.children.push(m); }, remove(m) { this.children = this.children.filter((x) => x !== m); } };
  const DELAY = 40;
  const slow = {
    request(spec) { return new Promise((res) => setTimeout(() => res(buildGreedyGeometry(spec)), DELAY)); },
    dispose() {}
  };
  const s = new VoxelStock({ sizeX: 20, sizeY: 20, sizeZ: 10, res: 2, originX: 0, originY: 0, originZ: -10, meshService: slow });
  s.rebuildIntervalMs = 5;
  let swaps = 0;
  const origSwap = s._swapGeometry.bind(s);
  s._swapGeometry = (g, sc) => { swaps++; return origSwap(g, sc); };
  s.updateMesh(scene, true);
  await new Promise((r) => setTimeout(r, DELAY + 20));
  ok(!!s.mesh && !!s.mesh.geometry, 'mesh kontinu: mesh awal terbentuk');
  swaps = 0;
  for (let i = 0; i < 25; i++) {
    s.cutSegment(i * 0.7, 0, -2, i * 0.7 + 1, 20, -2, 2);   // swath baru tiap iterasi → grid selalu berubah
    await new Promise((r) => setTimeout(r, 12));
    s.updateMesh(scene);
  }
  ok(swaps >= 2, 'mesh kontinu: mesh ter-update saat cutting berjalan (bukan hanya di akhir) — swaps=' + swaps);
}

// ---------- H1: escapeHtml (cegah XSS nama fixture) ----------
{
  const { escapeHtml } = await import('../src/util/html.js');
  eq(escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;', 'escapeHtml: escape & < > " \'');
  eq(escapeHtml('Ragum 1'), 'Ragum 1', 'escapeHtml: teks aman tak berubah');
  eq(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;',
    'escapeHtml: tag berbahaya dinetralkan');
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
