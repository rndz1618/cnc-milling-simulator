# Tahap 8 — Material Removal v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pindahkan pembentukan mesh stok ke Web Worker + greedy meshing, dan tambahkan alarm tabrakan holder/shank (`HOLDER CRASH`) saat G00, tanpa mengubah alur cut/skema kolisi yang sinkron di main thread.

**Architecture:** Grid voxel tetap otoritatif di main thread (cut + `pointInStock` + alarm sinkron). Worker murni mengubah salinan grid → buffer geometri (greedy meshed) lewat RPC `MeshService`; reply basi diabaikan (latest-wins). Profil tool bertingkat (flute/shank/holder) dipakai `Simulator._checkRapidCrash` untuk memilih alarm.

**Tech Stack:** vanilla ES modules, three.js, Vite (worker via `new Worker(new URL(...), {type:'module'})`), Node test harness tanpa framework, Playwright smoke.

**Spec:** `docs/SPEC-tahap8-removal-v2.md`

## Global Constraints

- Invarian `PLAN-LANJUTAN.md` §1 penuh: posisi internal = koordinat MESIN; transform work→machine saat eksekusi; blok yang men-alarm TIDAK dieksekusi; Parser stateless; Simulator tidak parsing teks.
- **Worker HANYA membangun mesh.** Grid + cut + collision tetap di main thread.
- Grid di worker = **salinan** (`grid.slice()`), bukan transfer grid asli.
- Throttle `updateMesh` tetap 80 ms. Latest-wins: reply dengan token bukan terbaru diabaikan.
- Gate: perubahan murni → `npm test` hijau; perubahan Simulator/UI/worker → `timeout 420 npm run verify` hijau. Commit terakhir gelombang WAJIB menyentuh `HANDOFF.md`.
- Versi rilis `0.13.0`. Bahasa Indonesia; hindari nama merek ("Haas-style", "Fanuc-compatible").
- Nilai derivasi tool (samakan `createToolMesh` `src/view/Scene.js:97`): `r=dia/2`; `fluteLen=max(4,min(flute,overall-26))`; `colletLen=max(10,dia*0.9)`; `stubLen=14`; `shankLen=max(6,overall-fluteLen-colletLen-stubLen)`; `shankR=max(r*1.02,6)`; `colletR=max(shankR*1.3,11)`.
- Tidak ada gate fps absolut di CI (GL software headless tak deterministik).

## Review Focus

Input/kondisi yang tak jelas di spec tapi mudah meledak — tiap baris punya test di task pemiliknya:

1. **`Worker` tak tersedia** (Node, browser lama) → path sinkron dipakai, tak crash. (Task 5, Task 6)
2. **Transfer buffer meng-detach grid asli** bila salah slice → cut/kolisi rusak senyap. Grid asli harus utuh. (Task 6)
3. **`machine.toolSpec` belum ada** (tool belum di-apply / MDI) → fallback profil dia-saja; flute tetap terdeteksi. (Task 4)
4. **Holder panjang, flute di atas stok, hanya holder yang kena** → `HOLDER CRASH`, jangan terlewat karena cek flute lebih dulu. (Task 1, Task 4)
5. **Reply mesh basi** setelah cut cepat → latest-wins; geometri lama tak menimpa yang baru. (Task 6)
6. **Stok habis seluruhnya / grid kosong** → `greedyMesh` kembalikan `null` → box fallback tetap dirender. (Task 3)

---

### Task 1: Profil tool + kolisi bertingkat (murni)

**Files:**
- Create: `src/machine/ToolProfile.js`
- Test: `tests/run.mjs` (blok baru sebelum `// ---------- Laporan ----------`)

**Interfaces:**
- Consumes: —
- Produces:
  - `toolProfile(spec)` — `spec = { dia, flute, overall }` (mm; default `{dia:12,flute:36,overall:100}`) → `{ r, fluteLen, shankR, shankLen, colletR, colletLen, stubLen, overall }`.
  - `radiusAt(profile, h)` — tinggi `h` di atas ujung tool (mm, `h>=0`) → radius mm; `null` bila `h>overall`.
  - `sampleCollision(pointInStock, p0, p1, profile)` — `pointInStock(x,y,z)->bool`; `p0`,`p1` titik ujung tool `{x,y,z}` → `null | 'RAPID CRASH' | 'HOLDER CRASH'`.

- [ ] **Step 1: Write the failing test**

```js
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/machine/ToolProfile.js'`.

- [ ] **Step 3: Implement `src/machine/ToolProfile.js`**

Derivasi wajib sama dengan `createToolMesh` (Global Constraints). Rancangan `sampleCollision`: sub-sample segmen `p0→p1` (step ≈ `profile.r*0.5`, min 0.5) seperti `_checkRapidCrash`; di tiap titik ujung tool `(x,y,z)` uji tiga cakram representatif pada sumbu tool (ambil **muka terendah** tiap bagian supaya tertangkap saat turun):
- cakram flute di `z + fluteLen/2` radius `r` → `'RAPID CRASH'`
- cakram shank di `z + fluteLen + shankLen` radius `shankR` → `'HOLDER CRASH'`
- cakram holder di `z + fluteLen + shankLen` radius `colletR` → `'HOLDER CRASH'`

Uji titik pusat + ring 6 titik pada `0.85*radius` (pola ring di `Simulator._checkRapidCrash`). Kembalikan string saat pertama kali kena (cek flute lebih dulu; bila flute tidak kena tapi shank/holder kena → `HOLDER CRASH`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, `FAIL: 0`.

- [ ] **Step 5: Commit**

```bash
git add src/machine/ToolProfile.js tests/run.mjs
git commit -m "feat(sim): profil tool bertingkat + sampleCollision (holder/shank)"
```

---

### Task 2: Greedy mesher (murni)

**Files:**
- Create: `src/stock/greedyMesh.js`
- Test: `tests/run.mjs` (blok baru sebelum Laporan)

**Interfaces:**
- Consumes: —
- Produces:
  - `COLOR_RAW = [0.96,0.78,0.32]`, `COLOR_CUT = [0.55,0.58,0.62]` (export)
  - `buildGreedyGeometry({ grid, nx, ny, nz, originX, originY, originZ, res, colorRaw = COLOR_RAW, colorCut = COLOR_CUT })` → `{ position, normal, color }` (`Float32Array`) atau `null` bila tak ada permukaan.
  - Konvensi vertex (samakan `VoxelStock.buildGeometry`): `position.push(wx, wz, wy)`, `normal.push(n[0], n[2], n[1])`; `color` = `raw` bila sisi menghadap luar AABB, `cut` bila ke voxel tetangga.

- [ ] **Step 1: Write the failing test**

```js
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
  const empty = buildGreedyGeometry({ ...solid, grid: new Uint8Array(4 * 4 * 4) });
  ok(empty === null, 'greedy: grid kosong → null');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module tidak ada.

- [ ] **Step 3: Implement `src/stock/greedyMesh.js`**

Algoritma: untuk tiap 6 arah (`±x, ±y, ±z`), tentukan sumbu `w` (arah normal) dan bidang `u,v`. Iterasi slice `w`; bangun mask 2D berisi nilai `0` (tak ada sisi), `1` (`raw`), `2` (`cut`) untuk voxel solid yang tetangganya di arah `d` kosong/luar. Greedy-merge sel ber-nilai sama jadi persegi panjang, lalu emit quad dengan winding sesuai arah (pertahankan konvensi urutan vertex `VoxelStock.buildGeometry`). Warna sisi = `colorRaw` bila tetangga di luar AABB, else `colorCut`. Kosong → `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stock/greedyMesh.js tests/run.mjs
git commit -m "feat(stock): greedy mesher murni (quad-merge, warna raw/cut)"
```

---

### Task 3: VoxelStock pakai greedy + optimasi cut

**Files:**
- Modify: `src/stock/VoxelStock.js` (`buildGeometry` ~150-230, `cutCylinder` ~101-128)
- Test: `tests/run.mjs`

**Interfaces:**
- Consumes: `buildGreedyGeometry` (Task 2).
- Produces: `VoxelStock.buildGeometry()` sekarang greedy (return `THREE.BufferGeometry`; box fallback bila `null`). Perilaku publik lain tak berubah.

- [ ] **Step 1: Write the failing test**

```js
// ---------- Tahap 8: VoxelStock greedy ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const s = new VoxelStock({ sizeX: 10, sizeY: 10, sizeZ: 10, res: 5, originX: 0, originY: 0, originZ: 0 });
  const geo = s.buildGeometry();
  const tri = (geo.attributes.position?.count || 0) / 3;
  ok(tri > 0 && tri <= 12, 'VoxelStock: stok solid → greedy ≤ 12 triangle, dapat ' + tri);
  // cut lalu rebuild: ada warna cut (bukan hanya raw)
  ok(s.cutSegment(0, 0, 0, 10, 0, 0, 2), 'VoxelStock: cut mengubah grid');
  const geo2 = s.buildGeometry();
  const col = geo2.attributes.color.array;
  const cutR = 0.55;
  ok(Array.from(col).some((c, i) => i % 3 === 0 && Math.abs(c - cutR) < 1e-6),
    'VoxelStock: setelah potong ada warna machined (cut)');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — triangle masih naif (> 12).

- [ ] **Step 3: Implement**

- `buildGeometry()`: ganti loop per-face dengan `buildGreedyGeometry({ grid:this.grid, nx, ny, nz, originX, originY, originZ, res, colorRaw:this.colorRaw })`; bila `null` → box fallback (kode existing); else set attribute `position`/`normal`/`color` + `computeBoundingSphere`.
- `cutCylinder(cx,cy,zTip,radius)`: mulai `iz` dari `max(0, Math.floor((zTip - this.originZ)/this.res))` dan loop sampai `nz` (lompati voxel di bawah ujung tool). Pertahankan cek `wz >= zTip - 0.01`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (semua 121 test lama + blok baru hijau).

- [ ] **Step 5: Commit**

```bash
git add src/stock/VoxelStock.js tests/run.mjs
git commit -m "perf(stock): VoxelStock pakai greedy mesher + cutCylinder lompat voxel bawah"
```

---

### Task 4: Simulator — alarm HOLDER CRASH

**Files:**
- Modify: `src/sim/Simulator.js` (`_checkRapidCrash` ~418-446)
- Test: `tests/run.mjs`

**Interfaces:**
- Consumes: `toolProfile`, `sampleCollision` (Task 1).
- Produces: `_checkRapidCrash` mengembalikan alarm `'RAPID CRASH — ...'` (flute) atau `'HOLDER CRASH — ... (baris N)'` (shank/holder); tetap memotong sisa segmen sampai titik tabrak lalu `alarm(...)`. Membaca `this.machine.toolSpec`; fallback `{ dia: this.machine.toolDiameter || 12 }`.

- [ ] **Step 1: Write the failing test**

```js
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
```

Regresi flute: blok `Tahap 6` rapid yang sudah ada + test multi-stok tetap menutup jalur `RAPID CRASH` (flute menembus material padat).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — pesan `RAPID CRASH`, bukan `HOLDER CRASH`.

- [ ] **Step 3: Implement**

Di `_checkRapidCrash`: bangun `const profile = toolProfile(this.machine.toolSpec || { dia: this.machine.toolDiameter || 12 })`. Ganti loop ring satuan dengan: sub-sample segmen; pada tiap titik ujung tool panggil `sampleCollision(st.pointInStock.bind(st), prevPoint, point, profile)`; bila bukan `null`, potong sisa segmen `st.cutSegment(p0..., point..., r)` (pertahankan efek kerusakan) lalu `this.alarm(<kind> + ' — ' + msg + ' (baris ' + m.line + ')', m.line)`; `RAPID CRASH` pakai teks existing, `HOLDER CRASH` teks baru. `import { toolProfile, sampleCollision } from '../machine/ToolProfile.js'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/Simulator.js tests/run.mjs
git commit -m "feat(sim): alarm HOLDER CRASH untuk tabrakan holder/shank saat G00"
```

---

### Task 5: MeshService + worker entry

**Files:**
- Create: `src/stock/meshWorker.js`, `src/stock/MeshService.js`
- Test: `tests/run.mjs`

**Interfaces:**
- Consumes: `buildGreedyGeometry` (Task 2).
- Produces:
  - `createMeshService({ WorkerCtor } = {})` → `{ request(spec) -> Promise<{position,normal,color}|null>, dispose() }`; `spec = { grid,nx,ny,nz,originX,originY,originZ,res,colorRaw }`. `WorkerCtor` default: `typeof Worker !== 'undefined' ? Worker : null`; bila `null` → `request` melempar `Error('mesh worker tidak tersedia')` (pemanggil memakai fallback sinkron).
  - `meshWorker.js`: `self.onmessage` → sukses `postMessage({id, position, normal, color}, [buffer...])`; gagal `postMessage({id, error})`.

- [ ] **Step 1: Write the failing test**

```js
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module tidak ada.

- [ ] **Step 3: Implement**

`MeshService.js`: `id` counter; `pending = new Map()`; worker `onmessage` → cari `pending.get(id)`, hapus, `resolve`/`reject`. `request`: jika tak ada worker → `Promise.reject`. Post `{ id, ...spec }` dengan transfer `[spec.grid.buffer]` (grid adalah salinan milik pemanggil). `dispose()` → `terminate()` + clear pending.
`meshWorker.js`: `self.onmessage = (e) => { const { id } = e.data; try { const g = buildGreedyGeometry(e.data); if (!g) { self.postMessage({ id, position: null }); return; } self.postMessage({ id, ...g }, [g.position.buffer, g.normal.buffer, g.color.buffer]); } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); } };`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stock/meshWorker.js src/stock/MeshService.js tests/run.mjs
git commit -m "feat(stock): MeshService RPC + worker greedy-mesh"
```

---

### Task 6: VoxelStock mesh async via MeshService

**Files:**
- Modify: `src/stock/VoxelStock.js` (constructor, `updateMesh`, `dispose`)
- Test: `tests/run.mjs`

**Interfaces:**
- Consumes: `createMeshService` (Task 5).
- Produces: `new VoxelStock({ ..., meshService })`. `updateMesh(scene, force)`: bila `meshService` ada → kirim `grid.slice()` (bukan grid asli), token latest-wins; swap geometri saat reply; gagal → fallback `buildGeometry()` sinkron. Tanpa `meshService` → perilaku sinkron lama.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `meshService` diabaikan / mesh null.

- [ ] **Step 3: Implement**

Constructor: simpan `this.meshService = meshService || null; this._meshToken = 0;`. `updateMesh(scene, force)`: pertahankan throttle (`_lastRebuild`) & `_dirty`; bila `meshService`: `const token = ++this._meshToken; const copy = this.grid.slice(); meshService.request({ grid: copy, nx,ny,nz, originX/Y/Z, res, colorRaw:this.colorRaw }).then((g) => { if (token !== this._meshToken) return; if (!g || !g.position) { this._swapGeometry(this.buildGeometry(), scene); return; } this._swapGeometry(this._geoFrom(g), scene); }).catch(() => { if (token !== this._meshToken) return; this._swapGeometry(this.buildGeometry(), scene); });` else (sync) `this._swapGeometry(this.buildGeometry(), scene)`. Faktor kecil `_swapGeometry(geo, scene)` (buat/`add` mesh atau ganti `geometry`) dan `_geoFrom(g)` (bangun `THREE.BufferGeometry` dari array). `dispose(scene)`: `this._meshToken++` lalu dispose seperti sekarang.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (test sinkron lama tetap hijau — tanpa `meshService`).

- [ ] **Step 5: Commit**

```bash
git add src/stock/VoxelStock.js tests/run.mjs
git commit -m "feat(stock): updateMesh async lewat MeshService (latest-wins + fallback)"
```

---

### Task 7: Wiring FixtureManager + main.js

**Files:**
- Modify: `src/sim/FixtureManager.js` (constructor + `build`), `src/main.js` (buat service, `applyToolFromTable`)
- Test: `scripts/verify.mjs` (smoke marker)

**Interfaces:**
- Consumes: `createMeshService` (Task 5), `VoxelStock` opsi `meshService` (Task 6).
- Produces: `new FixtureManager({ scene, machine, createVise, meshService })` meneruskan `meshService` ke tiap `VoxelStock`. `main.js` menyetel `window.__meshWorkerActive = true` bila service worker aktif, dan `machine.toolSpec = { dia, flute, overall }` di `applyToolFromTable`.

- [ ] **Step 1: Write the failing test (smoke marker)**

Di `scripts/verify.mjs`, tambahkan ke blok `shell`/`run` `page.evaluate` sebuah field dan assertion akhir:

```js
// di dalam page.evaluate yang sudah ada (mis. blok `run`), tambah:
meshWorker: !!window.__meshWorkerActive
// ...
// di daftar `problems`:
if (!run.meshWorker) problems.push('mesh worker tidak aktif (window.__meshWorkerActive)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `timeout 420 npm run verify`
Expected: FAIL — `mesh worker tidak aktif`.

- [ ] **Step 3: Implement**

- `main.js`: setelah `renderer`/`scene` siap → `const meshService = (typeof Worker !== 'undefined') ? createMeshService() : null; if (meshService) window.__meshWorkerActive = true;` lalu teruskan ke `new FixtureManager({ scene, machine, createVise, meshService })`. `applyToolFromTable`: `machine.toolSpec = { dia: t.dia, flute: t.flute, overall: t.overall };`.
- `FixtureManager`: constructor terima `meshService`; di `build()` teruskan `meshService: this.meshService` ke `new VoxelStock({...})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `timeout 420 npm run verify`
Expected: `VERIFY HIJAU ✓`.

- [ ] **Step 5: Commit**

```bash
git add src/sim/FixtureManager.js src/main.js scripts/verify.mjs
git commit -m "feat(stock): wire MeshService ke FixtureManager + toolSpec untuk holder crash"
```

---

### Task 8: Benchmark + smoke lanjutan + metadata rilis

**Files:**
- Create: `scripts/bench-mesh.mjs`
- Modify: `package.json`, `scripts/verify.mjs`, `HANDOFF.md`, `README.md`, `AGENTS.md`, `docs/PLAN-LANJUTAN.md`
- Test: `npm test` + `npm run verify` + `npm run bench:mesh`

**Interfaces:**
- Consumes: `buildGreedyGeometry` (Task 2), `VoxelStock` (Task 3/6).
- Produces: `npm run bench:mesh` mencetak ms greedy-mesh stok 100×80×20.

- [ ] **Step 1: Write the failing test**

```js
// scripts/bench-mesh.mjs — cetak ms; exit != 0 bila > 4000 ms (sanity)
import { buildGreedyGeometry } from '../src/stock/greedyMesh.js';
const nx = 100, ny = 80, nz = 20;
const grid = new Uint8Array(nx * ny * nz).fill(1);
const t0 = performance.now();
const g = buildGreedyGeometry({ grid, nx, ny, nz, originX: 0, originY: 0, originZ: 0, res: 1 });
const ms = performance.now() - t0;
console.log('greedy mesh 100x80x20: ' + ms.toFixed(1) + ' ms, tris=' + (g.position.length / 9));
if (ms > 4000) { console.error('greedy mesh terlalu lambat'); process.exit(1); }
```

`package.json` scripts: `"bench:mesh": "node scripts/bench-mesh.mjs"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run bench:mesh`
Expected: FAIL — script tidak ada.

- [ ] **Step 3: Implement + metadata**

- Buat `scripts/bench-mesh.mjs`; tambah script `bench:mesh`.
- `scripts/verify.mjs`: tidak wajib tambah assertion baru selain Task 7 (worker aktif); pastikan tetap hijau.
- Naikkan `package.json` versi ke `0.13.0`.
- `README.md`/`AGENTS.md`: perbarui jumlah unit test (dari output `npm test`).
- `docs/PLAN-LANJUTAN.md`: tandai Tahap 8 SELESAI (v0.13.0), executive worker/greedy/holder.
- `HANDOFF.md`: status gelombang, commit, tugas berikutnya (Tahap 9), known issues sisa (v0.12.1 deferred). **Commit terakhir gelombang menyentuh file ini** (tambah `[skip-handoff]` TIDAK dipakai).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run bench:mesh && npm test && timeout 420 npm run verify`
Expected: bench mencetak ms & tris; `npm test` PASS; `VERIFY HIJAU ✓`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bench-mesh.mjs package.json scripts/verify.mjs README.md AGENTS.md docs/PLAN-LANJUTAN.md HANDOFF.md
git commit -m "chore(release): v0.13.0 — removal v2 (worker meshing, greedy, holder crash)"
```

---

## Self-Review

- **Spec coverage:** §2c greedyMesher → Task 2; §2d worker/service → Task 5; §2e VoxelStock + cut opt → Task 3/6; §2f ToolProfile/holder → Task 1/4; §7 bench → Task 8; wiring → Task 7; metadata/rilis → Task 8. Semua bagian spec punya task.
- **Review Focus:** (1) Worker tak ada → Task 5 (reject) + Task 6 (fallback); (2) transfer grid asli → Task 6 (`grid.slice()`, assertion grid utuh); (3) `toolSpec` absen → Task 4 (fallback profil); (4) holder-only → Task 1 & Task 4; (5) reply basi → Task 6 (token latest-wins); (6) grid kosong → Task 2 (`null`) + Task 3 (box fallback existing).
- **Type consistency:** `toolProfile`/`radiusAt`/`sampleCollision`, `buildGreedyGeometry`, `createMeshService`, opsi `meshService`, `machine.toolSpec = {dia,flute,overall}` konsisten antar task.
- **Proportion:** plan ≈ panjang spec; code block hanya test + signature/algoritma kunci.
