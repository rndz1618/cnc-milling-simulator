# Tahap 6 — Interpreter Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naikkan realisme interpreter CNC: cutter comp G41/G42, arc G18/G19, G4 dwell nyata, G84 tapping, feed hold mid-blok, spindle ramp + ATC sederhana.

**Architecture:** Parser tetap murni/stateless dan hanya menambah entry/field baru. Cutter comp diimplementasikan sebagai modul murni terpisah (`Compensator.js`) yang berjalan di koordinat WORK tepat setelah `parseGCode` dan sebelum `sim.loadMoves`. Simulator mengonsumsi entry `dwell`/`tool` lewat satu timer, plus `updateSpindle(dt)` untuk ramp. Semua posisi internal tetap koordinat MESIN (invarian).

**Tech stack:** JavaScript ES modules, Vite, Node (unit test tanpa framework di `tests/run.mjs`), Playwright headless smoke.

**Spec:** `docs/SPEC-tahap6-interpreter-realism.md`

## Global Constraints

- Invarian (AGENTS.md + PLAN-LANJUTAN §1): posisi internal = koordinat MESIN; transform work→machine saat eksekusi (`moveTarget`); blok yang men-alarm tidak dieksekusi; Parser stateless; Simulator tidak parsing teks.
- Bahasa kerja Indonesia, istilah teknis English. Hindari merek (pakai "Haas-style"/"Fanuc-compatible").
- Gate: task Parser/murni → `npm test` hijau; task Simulator/integrasi/UI → `npm test` lalu `npm run verify` hijau. Commit kecil, pesan jelas.
- Commit terakhir gelombang WAJIB menyentuh `HANDOFF.md`.
- Lingkungan lambat (GL software): `npm run verify` ~2–4 min; smoke pakai `page.evaluate` (bukan `page.click`); jangan backgrounding server (`&` menggantung shell tool).

## File Structure

- `src/machine/Parser.js` (modify) — entry `comp`/`dwell`, arc plane-aware, G84.
- `src/machine/Compensator.js` (create) — `applyCutterComp` murni.
- `src/machine/MachineState.js` (modify) — `spindleTarget`.
- `src/sim/Simulator.js` (modify) — timer dwell/ATC, `updateSpindle`, `feedHold`.
- `src/view/Scene.js` (modify) — `animateToolChange`.
- `src/main.js` (modify) — panggil Compensator, wire feed hold, ramp, ATC.
- `tests/run.mjs` (modify) — unit test baru.
- `scripts/verify.mjs` (modify) — smoke FEED HOLD + RPM.
- `package.json`, `README.md`, `HANDOFF.md`, `AGENTS.md` (modify) — rilis 0.11.0.

## Review Focus

Kelas input / mode gagal yang spec implikasikan tetapi tak dimiliki satu fitur saja:
1. Comp engage/lukai lalu G40 tanpa gerak berikutnya (flush chain tak boleh crash/drop entry).
2. Arc G18/G19 yang menempuh >180° atau lingkaran penuh (arah & pusat benar).
3. `G4` dengan `P<=0` atau tanpa P (tidak boleh menggantung simulasi).
4. Feed hold / dwell / timer ATC di batas blok (resume dari titik berhenti tetap benar).
5. M6 saat comp aktif, atau `D` menunjuk tool tanpa data (radius default, tanpa crash).

---

### Task 1: Parser — entry cutter comp + parsing D

**Files:**
- Modify: `src/machine/Parser.js` (blok G40/G41/G42 ~baris 210–219; parsing D ~baris 203)
- Test: `tests/run.mjs`

**Interfaces:**
- Produces: entry `{ type:'comp', side:'left'|'right'|null, d:number|null, line:number, raw:string }`.
  - `G40` → `side:null`; `G41` → `'left'`; `G42` → `'right'`.
  - `d = <nilai D> ?? <tool aktif modal saat itu>` (Parser sudah melacak variabel `tool`).
  - Bila `G41`/`G42` ditemui saat `plane !== 17` → `blockAlarm` `{code:'G41'|'G42', msg:'CUTTER COMP HANYA G17'}` (blok tidak dieksekusi, pola alarm existing).
- Tidak lagi mengemit alarm "belum didukung" untuk 41/42.

- [ ] **Step 1: Write the failing test** — tambah di `tests/run.mjs` (sebelum laporan):
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `compEntries` kosong / `d` undefined.

- [ ] **Step 3: Implement** — di loop `gCodes`: tangkap `D` (`nd`) saat parsing token; ganti cabang `g === 41/42` agar mengemit `{type:'comp', ...}` dan cabang `g === 40` mengemit `side:null`. Tentukan `side` dari kode; hitung `d = nd !== null ? nd : tool` (bila `tool===0` → `null`). Cek `plane` untuk alarm.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (semua test sebelumnya tetap hijau).

- [ ] **Step 5: Commit**
```bash
git add src/machine/Parser.js tests/run.mjs
git commit -m "feat(parser): entry comp G41/G42/G40 + parsing D"
```

---

### Task 2: `Compensator.js` + integrasi loadProgram

**Files:**
- Create: `src/machine/Compensator.js`
- Modify: `src/main.js` (`loadProgram`, ~baris 711–716)
- Test: `tests/run.mjs`

**Interfaces:**
- Produces: `export function applyCutterComp(moves, { getRadius })` → `Array<move>` baru.
  - Consumes entry `comp` (Task 1).
  - Offset hanya `rapid`/`feed` non-`machine` (koordinat WORK), X/Y saja; Z & field lain diteruskan.
  - Entry non-gerak (`tool`,`coolant`,`toolcomp`,`dwell`,`stop`,`alarm`,`comp`) diteruskan apa adanya, urutan dijaga.
- Pemanggil di `main.js` `loadProgram`:
```js
const parsed = parseGCode(text);
const comped = applyCutterComp(parsed.moves || [], {
  getRadius: (d) => (toolTable[d]?.dia ?? 6) / 2
});
allMoves = comped;
```

**Algoritma `applyCutterComp` (tidak ditentukan signature+test):**
- Lintasi stream; lacak `side` dan `radius=getRadius(d)` dari entry `comp`.
- Kumpulkan rantai motion kompensasi berurutan (buffer). Rantai `flush` saat: entry `comp` baru, entry non-gerak, entry `machine:true`, atau akhir stream.
- `flush`: bangun titik program `q[0..n]` (`q[0]` = endpoint motion terakhir sebelum rantai — lacak lintas seluruh stream), lalu untuk tiap segmen `i` hitung garis offset = titik + `radius * normal(side)` (`left` = `(-dy,dx)/len`, `right` = `(dy,-dx)/len`).
  - Node output untuk motion `i` = perpotongan garis offset `i` dan `i+1` (miter); untuk motion terakhir = `q[n] + off_n`. Bila segmen sejajar (determinan ~0) pakai `q[i+1]+off_i`.
  - Emit motion hasil dengan x/y = node, Z dan field lain dari move asli.

- [ ] **Step 1: Write the failing test** — tambah helper di atas `tests/run.mjs`:
```js
function close(actual, expected, tol, label) {
  const a = actual, e = expected;
  const good = a.length === e.length && a.every((v, i) => Math.abs(v - e[i]) <= tol);
  if (good) pass++;
  else { fail++; failures.push(label + '\n    expected: ' + JSON.stringify(e) + '\n    actual:   ' + JSON.stringify(a)); }
}
```
Lalu test:
```js
// ---------- Tahap 6: Compensator ----------
const { applyCutterComp } = await import('../src/machine/Compensator.js');
{
  const src = parseGCode('G0 X0 Y0\nG41 D1\nG1 X10 Y0 F100\nG1 X10 Y10\nG40\nG1 Y0 F100\nM30').moves;
  const out = applyCutterComp(src, { getRadius: () => 3 });
  const mot = out.filter((m) => m.type === 'rapid' || m.type === 'feed');
  eq(mot.length, 4, 'Comp: 4 motion (rapid + 3 feed)');
  close(mot.map((m) => m.x), [0, 7, 7, 10], 1e-6, 'Comp left: X miter offset');
  close(mot.map((m) => m.y), [0, 3, 10, 0], 1e-6, 'Comp left: Y miter offset');
  const plain = parseGCode('G0 X0 Y0\nG1 X10 Y0 F100\nG1 X10 Y10\nG1 Y0 F100\nM30').moves;
  const out2 = applyCutterComp(plain, { getRadius: () => 3 });
  eq(out2.filter((m) => m.type === 'rapid' || m.type === 'feed').map((m) => [m.x, m.y]),
    [[0, 0], [10, 0], [10, 10], [10, 0]], 'Comp non-aktif → path identik');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — modul `Compensator.js` tidak ada.

- [ ] **Step 3: Implement** `src/machine/Compensator.js` (export `applyCutterComp`) sesuai algoritma di atas; panggil dari `loadProgram` di `src/main.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/machine/Compensator.js src/main.js tests/run.mjs
git commit -m "feat(comp): applyCutterComp G41/G42 (pass murni, lead-in/out, miter)"
```

---

### Task 3: Parser — arc plane-aware G18/G19

**Files:**
- Modify: `src/machine/Parser.js` (`expandArc` ~baris 105–135; call site ~baris 347; cabang plane ~baris 219)
- Test: `tests/run.mjs`

**Interfaces:**
- `expandArc(x0, y0, z0, x1, y1, z1, i, j, k, r, cw, plane, segs = 24)` → `[{x,y,z}]`.
  - `G17`: pusat dari (I,J); Z linear.
  - `G18`: pusat dari (I,K); Y konstan (ambil `y0`).
  - `G19`: pusat dari (J,K), X konstan.
- Entry motion tetap `{x,y,z,...}` (tanpa perubahan bentuk).
- R-form tetap didukung per-plane.

- [ ] **Step 1: Write the failing test**:
```js
// ---------- Tahap 6: arc G18/G19 ----------
const segsOf = (p) => p.moves.filter((m) => m.type === 'feed');
const g18 = parseGCode('G0 X0 Y2 Z0\nG18 G2 X0 Z10 I0 K5 F100\nM30');
ok(!g18.alarms.length, 'G18: tanpa alarm');
ok(segsOf(g18).length >= 8, 'G18: arc di-expand jadi ≥8 segmen');
const mid18 = segsOf(g18)[Math.floor(segsOf(g18).length / 2)];
ok(Math.abs(Math.abs(mid18.x) - 5) < 1e-6, 'G18: titik tengah X=±5');
ok(Math.abs(mid18.z - 5) < 1e-6, 'G18: titik tengah Z=5');
ok(segsOf(g18).every((s) => Math.abs(s.y - 2) < 1e-9), 'G18: Y tetap 2');
const g19 = parseGCode('G0 X2 Y0 Z0\nG19 G2 Y0 Z10 J0 K5 F100\nM30');
ok(!g19.alarms.length, 'G19: tanpa alarm');
const mid19 = segsOf(g19)[Math.floor(segsOf(g19).length / 2)];
ok(Math.abs(Math.abs(mid19.y) - 5) < 1e-6 && Math.abs(mid19.z - 5) < 1e-6, 'G19: tengah Y±5 Z5');
ok(segsOf(g19).every((s) => Math.abs(s.x - 2) < 1e-9), 'G19: X tetap 2');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — G18/G19 saat ini tetap diekspansi di XY (atau alarm).

- [ ] **Step 3: Implement** — generalisasi `expandArc` untuk plane G17/G18/G19 (pilih dua sumbu bidang + sumbu linier; winding CW/CCW sesuai orientasi plane; R-form per-plane). Update call site agar mengirim `nk` dan `plane`. `KNOWN_G` sudah punya 17/18/19.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/machine/Parser.js tests/run.mjs
git commit -m "feat(parser): arc G18/G19 (plane-aware expandArc)"
```

---

### Task 4: Parser — G4 dwell entry

**Files:**
- Modify: `src/machine/Parser.js` (cabang `g === 4` ~baris 217)
- Test: `tests/run.mjs`

**Interfaces:**
- Produces: `{ type:'dwell', p:number, line:number, raw:string }`. `p` = nilai `P` dalam detik; fallback `X` (detik). Bila tak ada P/X → `p = 0`.

- [ ] **Step 1: Write the failing test**
```js
// ---------- Tahap 6: G4 dwell ----------
const dw = parseGCode('G4 P1.5\nG0 X5\nM30');
eq(dw.moves.find((m) => m.type === 'dwell')?.p, 1.5, 'G4 P1.5 → dwell p=1.5');
const dw0 = parseGCode('G4\nG0 X5\nM30');
eq(dw0.moves.find((m) => m.type === 'dwell')?.p, 0, 'G4 tanpa P → dwell p=0');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — tak ada entry `dwell`.

- [ ] **Step 3: Implement** — pada cabang `g === 4`, emit entry `dwell` dengan `p = np ?? nx ?? 0` (P/X). Lanjutkan block (jangan `continue` agar blok lain di baris sama tetap diproses).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/machine/Parser.js tests/run.mjs
git commit -m "feat(parser): G4 dwell sebagai entry waktu simulasi"
```

---

### Task 5: Parser — G84 tapping

**Files:**
- Modify: `src/machine/Parser.js` (`KNOWN_G` ~baris 98–101; ekspansi cycle ~baris 296–312 & `expandCycleHole` ~379)
- Test: `tests/run.mjs`

**Interfaces:**
- `KNOWN_G` ditambah `84`.
- G84 = canned cycle: rapid XY → rapid R → **feed** turun ke Z membawa `spindleDir` modal saat ini → **feed** keluar ke level retract membawa `spindleDir` lawan (3↔4). Modal `spindleDir` Parser tidak berubah.
- `G84 Q…` → alarm `{code:'G84', msg:'G84 TANPA PECK (Q TIDAK DIDUKUNG)'}`.

- [ ] **Step 1: Write the failing test**
```js
// ---------- Tahap 6: G84 tapping ----------
const tap = parseGCode('G0 X0 Y0\nG99 G84 X10 Y10 Z-10 R2 F100\nG80\nM30');
const tapHole = tap.moves.filter((m) => m.x === 10 && m.y === 10);
const down = tapHole.find((m) => m.type === 'feed' && m.z === -10);
const out = tapHole.find((m) => m.type === 'feed' && m.z === 2);
eq([down.spindleDir, out.spindleDir], [3, 4], 'G84: turun M3, keluar M4 (balik)');
ok(!tap.alarms.length, 'G84: tanpa alarm');
const tapQ = parseGCode('G0 X0 Y0\nG99 G84 X10 Y10 Z-10 R2 Q3 F100\nM30');
ok(tapQ.alarms.some((a) => a.code === 'G84'), 'G84 dengan Q → alarm peck');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `KNOWN_G` belum punya 84 (alarm `G84` tak dikenal).

- [ ] **Step 3: Implement** — tambah `84` ke `KNOWN_G`; tangani G84 di blok canned cycle (set `cycle={g:84,z,r,f}`; tolak bila ada `nq`); di `expandCycleHole`: untuk `g===84` emit feed turun `spindleDir` modal + feed keluar `spindleDir` lawan (bukan rapid). Arah lawan dari `meta().spindleDir`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/machine/Parser.js tests/run.mjs
git commit -m "feat(parser): G84 tapping (feed masuk/keluar + balik spindle)"
```

---

### Task 6: Simulator — timer dwell & ATC

**Files:**
- Modify: `src/sim/Simulator.js` (constructor; `_advanceEntries` ~126–160; `tick` ~213; `step` ~183)
- Test: `tests/run.mjs`

**Interfaces:**
- Field baru: `this.timer = 0`, `this.timerKind = null` (`'dwell'|'atc'`). Konstanta `ATC_TIME = 1.0`.
- `_advanceEntries`: `dwell` → `this.timer = e.p`, `timerKind='dwell'`, `index++`, `return true` (bila `p<=0` → skip tanpa timer). `tool` → `onTool(e.tool)`; bila tidak alarm, `this.timer = ATC_TIME`, `timerKind='atc'`, `index++`, `return true`.
- `tick(dt)`: bila `timer>0` → `timer -= dt*simSpeed`; `timerKind==='dwell'` → `elapsed += dt*simSpeed`; bila masih `>0` → `onUpdate(); return`; bila habis → `timer=0; timerKind=null` lalu lanjut proses move.
- `step()`: bila `timer>0` → konsumsi instan (`dwell` → `elapsed += timer`), clear, lalu lanjut.
- `reset()`/`stop()`: set `timer=0; timerKind=null`.

- [ ] **Step 1: Write the failing test** — pakai pola Simulator existing (`VoxelStock` + scene stub), `sim.dryRun = true`:
```js
// ---------- Tahap 6: dwell + ATC timer ----------
{
  const machine = createMachineState();
  const stock = new VoxelStock({ sizeX: 100, sizeY: 100, sizeZ: 20, res: 2, originX: -50, originY: -50, originZ: -20 });
  stock.updateMesh({ add() {}, remove() {}, traverse() {} }, true);
  const sim = new Simulator({ stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm() {}, onTool() {}, onToolComp() {}, onCoolant() {} });
  sim.dryRun = true;
  const tools = [];
  const sim2 = new Simulator({ stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm() {}, onTool: (t) => tools.push(t), onToolComp() {}, onCoolant() {} });
  sim2.dryRun = true;
  sim.loadMoves(parseGCode('G4 P0.2\nG0 X10\nM30').moves, 0);
  sim.play();
  ok(sim.timerKind === 'dwell' && sim.timer > 0, 'dwell: play memicu timer');
  let g = 0; while (sim.playing && g++ < 1000) sim.tick(0.05);
  ok(sim.state === 'done', 'dwell: selesai setelah waktu habis');
  ok(sim.elapsed >= 0.2 - 1e-6, 'dwell: elapsed menghitung durasi');
  sim2.loadMoves(parseGCode('T2 M6\nG0 X5\nM30').moves, 0);
  sim2.play();
  ok(sim2.timerKind === 'atc' && tools[0] === 2, 'ATC: M6 memicu timer + onTool');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `sim.timerKind` undefined.

- [ ] **Step 3: Implement** sesuai Interfaces, lalu update handler `tool` & tambah cabang `dwell` di `_advanceEntries`, guard timer di `tick`/`step`, reset timer di `reset`/`stop`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/sim/Simulator.js tests/run.mjs
git commit -m "feat(sim): timer dwell & ATC (jeda waktu simulasi)"
```

---

### Task 7: Simulator — spindle ramp + feed hold

**Files:**
- Modify: `src/machine/MachineState.js` (`createMachineState` ~baris 28–50)
- Modify: `src/sim/Simulator.js` (constructor; `_applyMeta`; methods baru; `play`)
- Test: `tests/run.mjs`

**Interfaces:**
- `createMachineState()` menambah `spindleTarget: 0`.
- `_applyMeta(m)`: bila `m.spindle != null` → set `machine.spindleTarget = m.spindle`; `machine.spindleOn = target > 0`; `spindleDir` tetap instan. **Jangan** set `machine.spindle` langsung.
- `updateSpindle(dt)`: `machine.spindle` bergerak linear menuju `machine.spindleTarget` dengan laju `MACHINE_PROFILE.maxRpm/1.5` per detik (time constant penuh ~1.5 s); clamp tepat di target; `spindleOn = target>0`.
- `feedHold()` = `pause()` + `this.holdReason = 'feed'`. `play()` meng-clear `this.holdReason`.
- `reset()`/`stop()`: `machine.spindleTarget = 0` (atau biarkan; pilih: set `spindle=0; spindleTarget=0`).

- [ ] **Step 1: Write the failing test**
```js
// ---------- Tahap 6: spindle ramp + feed hold ----------
{
  const machine = createMachineState();
  const stock = new VoxelStock({ sizeX: 100, sizeY: 100, sizeZ: 20, res: 2, originX: -50, originY: -50, originZ: -20 });
  stock.updateMesh({ add() {}, remove() {}, traverse() {} }, true);
  const sim = new Simulator({ stock, machine, onUpdate() {}, onLine() {}, onMessage() {},
    onAlarm() {}, onTool() {}, onToolComp() {}, onCoolant() {} });
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
  let g = 0; while (sim.playing && g++ < 100000) sim.tick(0.05);
  ok(sim.index >= sim.moves.length, 'resume: menyelesaikan seluruh move');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `updateSpindle`/`feedHold` tidak ada; `spindleTarget` undefined.

- [ ] **Step 3: Implement** sesuai Interfaces (`MachineState.js` + `Simulator.js`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/machine/MachineState.js src/sim/Simulator.js tests/run.mjs
git commit -m "feat(sim): spindle ramp + feed hold (pause mid-blok)"
```

---

### Task 8: UI — FEED HOLD, status flag, RPM aktual, animasi ATC

**Files:**
- Modify: `src/main.js` (animate ~1175; `onTool` ~329; `updateStatusBar` ~553; `btnPause` handler ~818; `animate` loop)
- Modify: `src/view/Scene.js` (tambah `animateToolChange`)
- Test: `scripts/verify.mjs`

**Interfaces:**
- `Scene.js`: `export function animateToolChange(toolMesh)` — animasi visual (angkat `toolMesh` ~15 mm lalu turun), sekali jalan; tidak mengubah koordinat mesin.
- `main.js`: `$('btnPause')` → `sim.feedHold()`; `updateStatusBar()` tambah flag `FEED HOLD` saat `sim.state==='hold' && sim.holdReason==='feed'`; `animate()` panggil `sim.updateSpindle(dt)`; `onTool` juga memanggil `animateToolChange(toolMesh)`.
- `#hdrSpindle` menampilkan `machine.spindle` (nilai ter-ramp) — sudah membaca `machine.spindle`, cukup pastikan bukan nilai target.

- [ ] **Step 1: Extend smoke test** — di `scripts/verify.mjs`, di dalam `page.evaluate` shell respond, tambah:
```js
out.feedHoldLabel = document.querySelector('#btnPause')?.textContent?.trim() || '';
```
dan setelah menjalankan program (blok `run`), tambah:
```js
hdrSpindle: document.querySelector('#hdrSpindle')?.textContent,
```
Setelah `run`, tambah cek (di `problems`): 
```js
if (!shell.feedHoldLabel.includes('FEED HOLD')) problems.push('tombol FEED HOLD tidak ada');
if (!/^S\d+/.test(run.hdrSpindle || '')) problems.push('RPM aktual tidak tampil (hdrSpindle=' + run.hdrSpindle + ')');
```
(Catatan: `run` harus memuat `hdrSpindle`.)

- [ ] **Step 2: Run verify to see it fail**

Run: `timeout 300 npm run verify`
Expected: FAIL — `problems` memuat "tombol FEED HOLD tidak ada" atau "RPM aktual tidak tampil" (tergantung implementasi; bila label sudah "FEED HOLD", gunakan cek status hold sebagai gantinya).

- [ ] **Step 3: Implement** — `src/view/Scene.js`: tambah `animateToolChange`; `src/main.js`: ganti handler `#btnPause` → `sim.feedHold()`, panggil `sim.updateSpindle(dt)` di `animate()`, panggil `animateToolChange(toolMesh)` di `onTool`, tambah flag `FEED HOLD` di `updateStatusBar`. Import `animateToolChange` di `main.js`.

- [ ] **Step 4: Run verify to make sure it passes**

Run: `timeout 300 npm run verify`
Expected: `smoke OK …` lalu `VERIFY HIJAU ✓`.

- [ ] **Step 5: Commit**
```bash
git add src/main.js src/view/Scene.js scripts/verify.mjs
git commit -m "feat(ui): FEED HOLD, RPM ramp aktual, animasi ATC"
```

---

### Task 9: Rilis v0.11.0 + handoff

**Files:**
- Modify: `package.json` (version → `0.11.0`), `README.md` (versi + jumlah test), `AGENTS.md` (jumlah test), `HANDOFF.md` (status gelombang, commit, tugas berikutnya), `docs/PLAN-LANJUTAN.md` (tandai Tahap 6 selesai bila sesuai).
- Test: seluruh suite.

**Interfaces:** tidak ada API baru; hanya metadata/versi.

- [ ] **Step 1: Bump versi & sinkronkan hitungan test** — set `package.json` `"version": "0.11.0"`; ganti angka jumlah test di `README.md`/`AGENTS.md` dengan jumlah `npm test` sekarang (jalankan `npm test` dulu untuk membacanya); perbarui badge/versi di README.

- [ ] **Step 2: Update `HANDOFF.md`** — status Tahap 6 selesai, daftar commit gelombang, gate verify, tugas berikutnya (Tahap 7).

- [ ] **Step 3: Run full verification**

Run: `timeout 300 npm run verify`
Expected: `npm test` hijau, build sukses, `smoke OK …`, `VERIFY HIJAU ✓`.

- [ ] **Step 4: Commit (WAJIB menyentuh HANDOFF.md)**

Run: `git add -A && git commit -m "release: v0.11.0 — interpreter realism (comp, G18/19, dwell, G84, feed hold, spindle/ATC)"`
Expected: commit terakhir gelombang menyentuh `HANDOFF.md`.

---

## Self-Review

- **Spec coverage:** cutter comp (T1+T2), G18/G19 (T3), G4 dwell (T4+T6), G84 (T5), feed hold (T7+T8), spindle ramp (T7+T8), ATC (T6+T8), rilis/handoff (T9). Semua kriteria §2 spec punya task.
- **Type consistency:** entry `comp`/`dwell` didefinisikan T1/T4 dan dikonsumsi T2/T6; `spindleTarget` didefinisikan T7; `applyCutterComp`/`getRadius` konsisten T2; `updateSpindle`/`feedHold`/`timer` konsisten T6/T7/T8.
- **Review Focus:** (1) flush chain → T1/T2; (2) arc >180° → T3; (3) G4 P<=0 → T4 (entry) + T6 (skip timer); (4) hold/timer di batas blok → T6/T7; (5) M6 saat comp & D tanpa data → T2 (`getRadius` default) + T6.
- **Proportion:** plan ini menentukan signature, nama test, dan algoritma yang tak terderivasi (comp miter, arc plane) — bukan transkrip penuh.
