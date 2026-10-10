# Tahap 7 — Fixture Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ubah satu-stok hardcoded jadi editor fixture: beberapa ragum + stok per WCS, material visual, skenario tersimpan, dan wizard touch-off kontak.

**Architecture:** Model fixture murni di `src/machine/Fixtures.js`; satu `FixtureManager` memiliki `Map<wcs, VoxelStock>` + vise per fixture; `Simulator` memotong via hook `resolveStock(wcs)` (fallback ke `this.stock` lama agar regresi aman); helper touch-off murni di `src/machine/TouchOff.js`; UI baru sub-tab FIXTURE + bilah skenario di `main.js`/`index.html`.

**Tech Stack:** Vanilla ESM + Three.js; test harness `tests/run.mjs` (tanpa framework, helper `eq/ok/close`); smoke Playwright di `scripts/verify.mjs`.

**Spec:** `docs/SPEC-tahap7-fixture-editor.md`

## Global Constraints

- Invarian `PLAN-LANJUTAN.md` §1: posisi internal = koordinat MESIN; `machine = work + wcsOffset`; transform di eksekusi; blok alarm tak dieksekusi; Parser stateless; Simulator tak parsing teks.
- UI & pesan dalam Bahasa Indonesia; hindari nama merek (pakai "ragum"/"vise", "catok").
- Gate: perubahan murni → `npm test` hijau; perubahan Simulator/UI → `npm test` lalu `npm run verify` hijau (jalankan `npm run verify` sebagai `timeout 420 npm run verify`; env sering lambat/swap penuh — retry saat lengang).
- Versi rilis akhir: `0.12.0`. Commit terakhir gelombang HARUS menyentuh `HANDOFF.md`.
- Migrasi wajib: config stok lama (satu stok) tetap jalan; pertahankan localStorage `cnc-sim-wcs`, `cnc-sim-tools`; tambah `cnc-sim-scenarios`.
- WCS valid: G54–G59 (maks 6 fixture). `machine.wcs.G55` default `(0,-90,0)`.

## Review Focus

- Program memakai WCS tanpa fixture (mis. G57 saat hanya G54/G55 punya fixture) → tidak crash, hanya tidak memotong apa pun.
- Fixture dengan WCS invalid atau dobel → `normalizeFixtures` membuang; program tetap jalan.
- localStorage skenario/config korup → fallback aman (satu fixture G54), tanpa crash.
- Touch-off pada fixture tanpa stok / edge tak valid → tombol nonaktif, tidak menghasilkan offset `NaN`.
- Program satu-fixture lama tetap identik (tanpa regresi posisi/stok).

---

### Task 1: Model fixture murni

**Files:**
- Create: `src/machine/Fixtures.js`
- Test: `tests/run.mjs` (tambah blok test baru)

**Interfaces:**
- Produces:
  - `MATERIALS: Record<'alum'|'steel'|'plastic', {label:string,color:string}>`
  - `defaultVise(): { jawWidth:150, jawHeight:40, opening:90, baseH:40 }`
  - `makeFixture(partial): Fixture` — isi default, `id` unik (`'fx'+n`)
  - `stockOriginFor(fixture, wcsOffset): {x,y,z}` — mesin; top-center/top-corner/custom (sama dengan `applyStockSetup` `main.js:450`)
  - `normalizeFixtures(raw): Fixture[]` — buang WCS invalid/dobel, isi default
  - `migrateLegacyStock(old): Fixture[]` — `old = {sizeX,sizeY,sizeZ,placement,originX,originY,originZ}` → satu fixture G54
  - `materialColor(material): string`
- `Fixture` = `{ id, wcs, name, vise, stock:{sizeX,sizeY,sizeZ,material}, placement, offset:{x,y,z} }`

- [ ] **Step 1: Tulis test gagal** di `tests/run.mjs` (blok baru sebelum penjumlahan akhir):

```js
// ---------- Tahap 7: model fixture ----------
{
  const F = await import('../src/machine/Fixtures.js');
  const { makeFixture, stockOriginFor, migrateLegacyStock, normalizeFixtures, materialColor, MATERIALS } = F;
  const f = makeFixture({ wcs: 'G54', stock: { sizeX: 120, sizeY: 60, sizeZ: 30 }, placement:'top-center' });
  const o = stockOriginFor(f, { x: 0, y: -90, z: 0 });
  eq(o, { x: -60, y: -120, z: -30 }, 'Fixtures: top-center origin');
  const corner = makeFixture({ stock: { sizeX: 80, sizeY: 60, sizeZ: 20 }, placement: 'top-corner' });
  eq(stockOriginFor(corner, { x: 10, y: 20, z: 30 }), { x: 10, y: 20, z: 10 }, 'Fixtures: top-corner origin');
  const fx = migrateLegacyStock({ sizeX: 80, sizeY: 60, sizeZ: 20, placement: 'top-corner', originX: 1, originY: 2, originZ: 3 });
  eq(fx.length, 1); eq(fx[0].wcs, 'G54');
  const norm = normalizeFixtures([{ wcs: 'G60' }, { wcs: 'G54' }, { wcs: 'G54' }]);
  eq(norm.length, 1); eq(norm[0].wcs, 'G54'); // buang invalid + dobel
  eq(materialColor('alum'), MATERIALS.alum.color);
  eq(materialColor('xyz'), MATERIALS.alum.color); // fallback
}
```

- [ ] **Step 2: Run test** — `npm test` → FAIL (`Cannot find module ./machine/Fixtures.js`).

- [ ] **Step 3: Implement `src/machine/Fixtures.js`** dengan interface di atas. `stockOriginFor`:
  - top-center: `x=o.x-sizeX/2, y=o.y-sizeY/2, z=o.z-sizeZ`
  - top-corner: `x=o.x, y=o.y, z=o.z-sizeZ`
  - custom: `{x:fixture.offset.x, y:fixture.offset.y, z:fixture.offset.z}`

- [ ] **Step 4: Run test** — `npm test` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/machine/Fixtures.js tests/run.mjs
git commit -m "feat(fixtures): model fixture murni + migrasi stok lama"
```

---

### Task 2: Helper touch-off murni

**Files:**
- Create: `src/machine/TouchOff.js`
- Test: `tests/run.mjs`

**Interfaces:**
- Produces:
  - `EDGES = ['x-','x+','y-','y+','z-top']`
  - `edgePlane(edge, origin, size): { axis:'x'|'y'|'z', value:number }` — mesin; `x-=origin.x`, `x+=origin.x+size.x`, `y-=origin.y`, `y+=origin.y+size.y`, `z-top=origin.z+size.z`
  - `contactOffset(edge, toolRadius, machinePos): { axis, value }` — nilai WCS: `x- = machinePos.x+toolRadius`, `x+ = machinePos.x-toolRadius`, `y- = machinePos.y+toolRadius`, `y+ = machinePos.y-toolRadius`, `z-top = machinePos.z`
  - `checkContact(edge, toolRadius, machinePos, plane, eps=0.05): boolean` — jarak permukaan tool ke bidang ≤ eps

- [ ] **Step 1: Tulis test gagal**
```js
{
  const t = await import('../src/machine/TouchOff.js');
  const origin = { x: -50, y: -30, z: -20 }, size = { x: 100, y: 60, z: 20 };
  eq(t.edgePlane('x-', origin, size), { axis:'x', value:-50 });
  eq(t.edgePlane('x+', origin, size), { axis:'x', value:50 });
  eq(t.edgePlane('z-top', origin, size), { axis:'z', value:0 });
  // tool center 3mm dari tepi kiri, radius 3 → offset = -50
  eq(t.contactOffset('x-', 3, { x:-53, y:0, z:0 }), { axis:'x', value:-50 });
  eq(t.contactOffset('x+', 3, { x:53, y:0, z:0 }), { axis:'x', value:50 });
  ok(t.checkContact('x-', 3, { x:-53 }, { axis:'x', value:-50 }) === true);
  ok(t.checkContact('x-', 3, { x:-60 }, { axis:'x', value:-50 }) === false);
}
```

- [ ] **Step 2: Run** `npm test` → FAIL (module hilang).
- [ ] **Step 3: Implement `src/machine/TouchOff.js`** sesuai interface.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/machine/TouchOff.js tests/run.mjs
git commit -m "feat(touchoff): helper edge-plane + contact offset"
```

---

### Task 3: FixtureManager + hook `resolveStock` di Simulator

**Files:**
- Create: `src/sim/FixtureManager.js`
- Modify: `src/sim/Simulator.js` (konstruktor ~L27; `stop()` L85-86; `play()` L110-111; cut L238 & L318; `_checkRapidCrash` L402-421)
- Test: `tests/run.mjs`

**Interfaces:**
- Consumes: `stockOriginFor` (Task 1), `createVise(params)` dari `src/view/Scene.js`.
- Produces:
  - `class FixtureManager { constructor({ scene, machine }); build(fixtures); stockFor(wcs); fixtureFor(wcs); stocks(); reset(); setVisible(v); remainingRatio; frameBounds(); rebuild(); dispose(); }`
- `Simulator` konstruktor terima `resolveStock` (opsi) + `onResetStocks` (opsi). `Simulator._stockFor(m)` = `resolveStock ? resolveStock(m.wcs||machine.activeWcs) : this.stock`. Reset pakai `onResetStocks ? onResetStocks() : (this.stock.reset(), this.stock._dirty=true)`.

- [ ] **Step 1: Tulis test gagal** — dua stok independen via `resolveStock`:
```js
{
  const A = new VoxelStock({ sizeX:60,sizeY:40,sizeZ:10, res:2, originX:0, originY:0, originZ:-10 });
  const B = new VoxelStock({ sizeX:60,sizeY:40,sizeZ:10, res:2, originX:0, originY:-90, originZ:-10 });
  const machine = createMachineState();
  const res = (wcs) => (wcs === 'G55' ? B : A);
  const sim = new Simulator({ stock: A, machine, resolveStock: res, onResetStocks: () => { A.reset(); B.reset(); } });
  const before = A.remainingRatio;
  sim.loadMoves(parseGCode('G00 G90 G54 X5 Y5 Z0\nG01 Z-5 F100\nG01 X15\nG00 Z5\nG55 X5 Y5 Z0\nG01 Z-5\nG01 X15').moves);
  while (sim.index < sim.moves.length) sim.step();
  ok(A.remainingRatio < before && B.remainingRatio < before, 'dua stok terpotong');
  ok(Math.abs(A.remainingRatio - B.remainingRatio) < 0.05, 'potongan simetris dua stok');
  // WCS tanpa fixture → null, program tetap jalan tanpa crash
  const mgr = new FixtureManager({ scene: null, machine: createMachineState() });
  mgr.build([makeFixture({ wcs: 'G54' })]);
  ok(mgr.stockFor('G57') === null, 'stockFor WCS tanpa fixture → null');
}
```

- [ ] **Step 2: Run** `npm test` → FAIL (resolveStock diabaikan → B tak terpotong / assertion gagal).
- [ ] **Step 3: Implement** `FixtureManager` (Map<wcs,VoxelStock>; `build` memakai `stockOriginFor` + `wcsOffset(machine, wcs)` + `createVise` per fixture; mesh hanya bila `scene`) dan ubah `Simulator` agar semua cut/reset lewat `_stockFor`/`onResetStocks`. `remainingRatio` = rata-rata volume-terbobot `1 - remainingRatio` per stok (atau rata-rata sederhana bila volume 0).
- [ ] **Step 4: Run** `npm test` → PASS (termasuk seluruh test lama).
- [ ] **Step 5: Commit**
```bash
git add src/sim/FixtureManager.js src/sim/Simulator.js tests/run.mjs
git commit -m "feat(sim): FixtureManager + resolveStock per-WCS"
```

---

### Task 4: main.js pakai FixtureManager (satu→banyak stok)

**Files:**
- Modify: `src/main.js` (buang `const stock = new VoxelStock(...)` L85-89; `rebuildVise` L427; `frameStock` L439; `applyStockSetup` L450-488; status L606; dry-run L477/512; konstruksi `Simulator` L323)

**Interfaces:**
- Consumes: `FixtureManager` (Task 3), `Fixtures.js` (Task 1).
- Produces: `fixtures` (FixtureManager instance) dipakai modul lain; `applyFixtureLayout(list)` membangun ulang & re-render.

- [ ] **Step 1: Ganti pemakaian `stock`** — buat `FixtureManager`, panggil `build(initialFixtures())` di startup; `Simulator` dikonstruksi dengan `resolveStock: (wcs)=>fixtures.stockFor(wcs)` dan `onResetStocks: ()=>fixtures.reset()`. `updateStatus` pakai `fixtures.remainingRatio`. Dry-run/visible → `fixtures.setVisible(!dryRun)`. `frameStock` → `fixtures.frameBounds` (implement `frameBounds()` di manager bila belum). Fit stok lama tetap menghasilkan satu fixture G54 identik.
- [ ] **Step 2: Jalankan gate** — `timeout 420 npm run verify` → hijau (regresi satu-fixture tetap lulus termasuk smoke O20018). Perbaiki sampai hijau.
- [ ] **Step 3: Commit**
```bash
git add src/main.js src/sim/FixtureManager.js
git commit -m "refactor(main): stok tunggal → FixtureManager multi-fixture"
```

---

### Task 5: `createVise` ber-parameter + warna stok per material

**Files:**
- Modify: `src/view/Scene.js` (`createVise`), `src/stock/VoxelStock.js` (opsi warna raw)
- Modify: `src/main.js` (`rebuildVise` pakai parameter fixture)
- Test: `tests/run.mjs`

**Interfaces:**
- Consumes: `fixture.vise {jawWidth,jawHeight,opening,baseH}`, `materialColor` (Task 1).
- Produces: `createVise({ jawWidth, jawHeight, opening, baseH, centerX, yMin, yMax, topZ }) -> THREE.Group`; `VoxelStock` konstruktor opsi `colorRaw?:[r,g,b]`.

- [ ] **Step 1: Tulis test gagal** — geometri vise skala dengan `jawWidth`:
```js
{
  const { createVise } = await import('../src/view/Scene.js');
  const g1 = createVise({ jawWidth:100, jawHeight:40, opening:60, baseH:40, centerX:0, yMin:-30, yMax:30, topZ:0 });
  const g2 = createVise({ jawWidth:200, jawHeight:40, opening:60, baseH:40, centerX:0, yMin:-30, yMax:30, topZ:0 });
  g1.updateMatrixWorld(true); g2.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(g1), b2 = new THREE.Box3().setFromObject(g2);
  ok((b2.max.x - b2.min.x) > (b1.max.x - b1.min.x), 'vise melebar dengan jawWidth');
}
```
(Tambah `import * as THREE from 'three';` bila belum ada di `tests/run.mjs`.)

- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** parameterisasi `createVise`; teruskan `colorRaw` di `VoxelStock`; `rebuildVise` di `main.js` memakai `fixture.vise` + `materialColor(fixture.stock.material)`.
- [ ] **Step 4: Run** `npm test` → PASS, lalu `timeout 420 npm run verify` → hijau.
- [ ] **Step 5: Commit**
```bash
git add src/view/Scene.js src/stock/VoxelStock.js src/main.js tests/run.mjs
git commit -m "feat(vise): geometri vise ber-parameter + warna stok per material"
```

---

### Task 6: Sub-tab FIXTURE (daftar & editor) + skenario localStorage

**Files:**
- Modify: `index.html` (sub-tab STOCK → FIXTURE, daftar fixture + editor + bilah skenario), `src/style.css`
- Modify: `src/main.js` (wiring), `src/machine/Fixtures.js` (`serializeScenario`/`parseScenario`)
- Test: `tests/run.mjs` (round-trip skenario) + `scripts/verify.mjs` (smoke)

**Interfaces:**
- Produces:
  - `serializeScenario({fixtures,program,wcs,tools}): string`
  - `parseScenario(text): {fixtures,program,wcs,tools}|null` (null bila korup)
- UI id kontrak: `#fixtureList`, `#fxAdd`, `#fxRemove`, `#scenarioName`, `#scenarioSave`, `#scenarioLoad`, `#scenarioDelete`.

- [ ] **Step 1: Tulis test gagal** — round-trip + korup:
```js
{
  const { serializeScenario, parseScenario } = await import('../src/machine/Fixtures.js');
  const s = { fixtures:[makeFixture({ wcs:'G54' })], program:'G0 X0', wcs:{ G54:{x:0,y:0,z:0} }, tools:[{ n:1 }] };
  const back = parseScenario(serializeScenario(s));
  eq(back.program, 'G0 X0'); eq(back.fixtures.length, 1);
  ok(parseScenario('{bukan json') === null, 'skenario korup → null');
}
```
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** serialize/parse + UI: daftar fixture (tambah/hapus ≤6, pilih WCS, vise params, ukuran stok, material, placement, Apply), bilah skenario Save/Load/Delete ke `cnc-sim-scenarios`. Load memanggil `applyFixtureLayout` + set WCS + tools + program.
- [ ] **Step 4: Tambah smoke** di `scripts/verify.mjs` (pola `page.evaluate`): buka sub-tab FIXTURE, `#fxAdd` menaikkan jumlah mesh vise/stok, Save lalu Load skenario tak crash.
- [ ] **Step 5: Run** `timeout 420 npm run verify` → hijau.
- [ ] **Step 6: Commit**
```bash
git add index.html src/style.css src/main.js src/machine/Fixtures.js tests/run.mjs scripts/verify.mjs
git commit -m "feat(ui): sub-tab FIXTURE + skenario tersimpan"
```

---

### Task 7: Wizard touch-off kontak

**Files:**
- Modify: `index.html` + `src/style.css` (overlay wizard), `src/main.js` (wiring jog/kontak/WCS), `src/view/Scene.js` (visual edge-finder bila perlu)
- Consumes: `TouchOff.js` (Task 2)
- Produces: overlay id `#touchoff`, tombol `#toStart`; kontrak: pilih fixture + edge, jog, pada kontak tulis `machine.wcs[activeWcs][axis] = contactOffset(...).value`.

- [ ] **Step 1: Implement** wizard: pilih fixture dari daftar + `EDGES`; tampilkan readout jarak ke `edgePlane`; saat `checkContact` true → tulis offset WCS, tutup dengan pesan sukses. Tombol `#toStart` nonaktif bila fixture tanpa stok.
- [ ] **Step 2: Tambah smoke** (`scripts/verify.mjs`): buka `#touchoff`, pilih fixture+edge, panggil kontak ter-simulasi di posisi kontak → `machine.wcs.G54.x` berubah sesuai `contactOffset`; fixture tanpa stok → `#toStart` disabled.
- [ ] **Step 3: Run** `timeout 420 npm run verify` → hijau.
- [ ] **Step 4: Commit**
```bash
git add index.html src/style.css src/main.js src/view/Scene.js scripts/verify.mjs
git commit -m "feat(touchoff): wizard kontak edge-finder → WCS"
```

---

### Task 8: Skenario golden 2-ragum + rilis v0.12.0

**Files:**
- Test: `tests/run.mjs` (golden scenario), `scripts/verify.mjs` (smoke skenario 2-ragum)
- Modify: `HANDOFF.md`, `README.md`, `AGENTS.md`, `docs/PLAN-LANJUTAN.md` (tandai Tahap 7 selesai), `package.json` (version `0.12.0`)

- [ ] **Step 1: Tulis test golden** — skenario "2-ragum O20018": `build` dua fixture (G54,G55), jalankan program berisi blok G54+G55, assert dua stok `remainingRatio` turun independen dan `parseScenario(serializeScenario(s))` reproduksi layout+program.
- [ ] **Step 2: Run** `npm test` → PASS; tambah smoke skenario 2-ragum di `verify.mjs` → `timeout 420 npm run verify` → hijau.
- [ ] **Step 3: Update metadata** — `package.json` version `0.12.0`; hitungan test di `README.md` & `AGENTS.md`; tandai Tahap 7 SELESAI di `docs/PLAN-LANJUTAN.md` (dan perbaiki "38 unit test" → angka aktual); tulis status + commit + tugas berikutnya (Tahap 8) di `HANDOFF.md`.
- [ ] **Step 4: Commit (commit terakhir gelombang — menyentuh HANDOFF.md)**
```bash
git add -A
git commit -m "release: v0.12.0 — fixture editor (multi-vise, material, skenario, touch-off)"
```
- [ ] **Step 5: Laporkan ke Jack** untuk konfirmasi push ke `main`.

---

## Catatan eksekusi

- Gate per task: murni (`Fixtures.js`, `TouchOff.js`) → `npm test`; Simulator/UI → `npm test` + `timeout 420 npm run verify`.
- `tests/run.mjs` memakai helper `eq/ok/close`; tambahkan blok `{ ... }` sebelum bagian penghitungan hasil. Jaga test lama tetap lulus (regresi satu-fixture adalah syarat keras).
- Jangan commit `package-lock.json` (sengaja).
- Bila `npm run verify` menggantung karena beban mesin, tunggu lalu ulangi — bukan kegagalan kode.
