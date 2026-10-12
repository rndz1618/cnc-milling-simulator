# Realtime Cutting Visual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Material terpotong realtime mengikuti gerakan spindle (remesh per-chunk), warna cut kontras dengan raw material per material, fixture bisa digeser manual (offset X/Y/Z), dan tool magazine 20 posisi.

**Architecture:** `VoxelStock` dipecah jadi chunk XY (default 8 voxel, `nz` penuh). `cutCylinder`/`cutSegment` menandai chunk kotor; `updateMesh` me-remesh hanya chunk kotor (sinkron, atau via `meshService` per-chunk). Grid + cut + collision tetap di main thread.

**Tech Stack:** JavaScript ESM, three.js, Web Worker, Node test runner DIY (`tests/run.mjs`), Playwright headless (`scripts/verify.mjs`), Vite.

**Spec:** `docs/SPEC-realtime-cutting.md`

## Global Constraints

- Invarian: posisi internal = koordinat MESIN (mm, Z-up); three.js Y-up → `position.push(originX + cx*res, originZ + cz*res, originY + cy*res)`; chunk Y-mesin = geometri Y three.js.
- Grid voxel + `cutCylinder` + collision **wajib tetap di main thread** (alarm sinkron; unit test Node tanpa DOM).
- Unit test Node harus jalan tanpa Worker/DOM (`meshService` disuntik; stub scene `{ add, remove }`).
- ASCII saja di kode/komentar.
- Gate per task: perubahan murni/parser → `npm test` hijau; perubahan simulator/UI/worker → `timeout 420 npm run verify` hijau.
- Commit terakhir gelombang WAJIB menyentuh `HANDOFF.md` (CI menolak). Push hanya setelah konfirmasi Jack.
- `buildGreedyGeometry` tetap fungsi murni; perilaku lama (tanpa `emitBounds`) tidak boleh berubah.

## Review Focus

- **Seam antar chunk** (muka internal di bidang batas chunk) → dinding/garis terlihat di material. Test: stok 2-chunk, jumlah muka == padanan grid tunggal (tanpa muka internal).
- **Chunk kotor tak tertandai** saat cut tepat di batas chunk (muka tetangga ikut berubah) → chunk basi. Test: cut di perbatasan menandai kedua chunk.
- **Ordering balasan async** — balasan chunk basi menimpa yang baru, atau chunk A terblokir chunk B → mesh salah/lambat. Test: versi basi dibuang, chunk lain tetap diproses.
- **Posisi chunk salah** (offset/duplikat) karena origin/axis salah → material muncul di tempat lain. Test: origin chunk = `originX + baseIx*res` (x-mesin), `originY + baseIy*res` (y-mesin).
- **Chunk tepi parsial** (`nx` tak habis dibagi `chunkVoxels`) → muka hilang/keluar batas. Test: `nx=10` dengan `chunkVoxels=8` → 2 chunk, muka benar.

---

### Task 1: `emitBounds` pada greedy mesher

**Files:**
- Modify: `src/stock/greedyMesh.js:26-101`
- Test: `tests/run.mjs` (blok greedy, sekitar baris 600-612)

**Interfaces:**
- Produces: `buildGreedyGeometry({ ..., emitBounds })` — `emitBounds = { minX, minY, minZ, maxX, maxY, maxZ }` (max eksklusif, indeks voxel). Muka hanya di-emit bila voxel padat pemilik muka berada di dalam `emitBounds`. Default (tidak diisi) = seluruh grid (perilaku lama).

- [ ] **Step 1: Tulis test gagal**

```js
// ---------- emitBounds (Task realtime cutting) ----------
{
  const grid = new Uint8Array(2 * 1 * 1).fill(1);   // 2 voxel di X
  const full = buildGreedyGeometry({ grid, nx: 2, ny: 1, nz: 1, originX: 0, originY: 0, originZ: 0, res: 1 });
  eq(full.position.length / 9, 12, 'emitBounds: grid penuh 2x1x1 → 6 muka');
  const only0 = buildGreedyGeometry({ grid, nx: 2, ny: 1, nz: 1, originX: 0, originY: 0, originZ: 0, res: 1,
    emitBounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 } });
  eq(only0.position.length / 9, 10, 'emitBounds: hanya voxel x=0 → 5 muka (muka +X internal hilang)');
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test 2>&1 | grep emitBounds`
Expected: FAIL (muka +X masih ada → 12 tri, bukan 10).

- [ ] **Step 3: Implementasi `emitBounds`**

Di `buildGreedyGeometry`, tambah param `emitBounds = null`; buat helper `inEmit(ix, iy, iz)` yang `true` bila `emitBounds` null ATAU voxel di dalam rentang. Di loop pembentukan `mask` (baris 56-74), sebelum memproses voxel, `if (!inEmit(ix, iy, iz)) continue;` (voxel di luar rentang tidak menjadi pemilik muka, tapi tetap dihitung sebagai tetangga `isSolid`). Tanpa perubahan lain.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test 2>&1 | grep -E "emitBounds|PASS:"`
Expected: PASS: (jumlah naik 2), FAIL: 0.

- [ ] **Step 5: Commit**

```bash
git add src/stock/greedyMesh.js tests/run.mjs
git commit -m "feat(stock): emitBounds pada greedy mesher (emit muka hanya di region)"
```

---

### Task 2: Scaffold chunk + dirty mapping (tanpa ubah pipeline mesh)

**Files:**
- Modify: `src/stock/VoxelStock.js:11-67, 105-135`
- Test: `tests/run.mjs` (blok baru)

**Interfaces:**
- Produces: ctor menerima `chunkVoxels = 8`. State: `this.cw`, `this.chN`, `this.chunks` (array objek `{ id, gx, gy, version:0, pending:false, dirty:true, empty:false, mesh:null }`), `this._dirtyChunks` (Set id), `this.maxChunksPerUpdate = 4`.
- `_chunkId(gx, gy) -> int` (`gy * cw + gx`); `_chunkOfVoxel(ix, iy) -> { gx, gy }` (`Math.floor(ix/chunkVoxels)`); `_markChunk(gx, gy)` (clamp ke rentang, set `chunk.dirty=true`, `this._dirtyChunks.add(id)`); `_markAllChunksDirty()`; `_initChunks()` (hitung `cw/chN`, bangun `chunks`, tandai semua kotor).
- `cutCylinder` mengumpulkan `minIx/maxIx/minIy/maxIy` voxel yang benar-benar dihapus, lalu menandai chunk untuk `gx` di `[floor((minIx-1)/chunkVoxels) .. floor((maxIx+1)/chunkVoxels)]` dan `gy` serupa (ekspansi ±1 voxel untuk muka tetangga).

- [ ] **Step 1: Tulis test gagal**

```js
// ---------- chunk dirty mapping (Task realtime cutting) ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const s = new VoxelStock({ sizeX: 20, sizeY: 20, sizeZ: 10, res: 1, originX: 0, originY: 0, originZ: -10, chunkVoxels: 8 });
  ok(s.cw === 3 && s.chN === 3, 'chunk: 20 voxel / 8 → 3x3 chunk');
  s._dirtyChunks.clear(); for (const c of s.chunks) c.dirty = false;
  s.cutSegment(7, 0, -2, 7, 0, -2, 2);   // tepi x=8 (chunk 0/1)
  const ids = [...s._dirtyChunks].sort((a, b) => a - b);
  ok(ids.includes(s._chunkId(0, 0)) && ids.includes(s._chunkId(1, 0)),
    'chunk: cut di batas menandai KEDUA chunk (0,0) & (1,0), dapat ' + ids.join(','));
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test 2>&1 | grep chunk`
Expected: FAIL (`s.cw` undefined).

- [ ] **Step 3: Implementasi**

Tambah `chunkVoxels` ke konstruktor & `this._initChunks()` sebelum `this.fill()`; ubah `fill()` → `this.grid.fill(1); this._markAllChunksDirty();`. Di `cutCylinder`, catat rentang voxel terhapus dan tandai chunk (blok `if (changed)` di baris 133). `resize` memanggil `this._initChunks()` setelah menghitung `nx/ny/nz`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test 2>&1 | grep -E "chunk|PASS:"`
Expected: PASS naik, FAIL 0. Semua test lama tetap hijau (pipeline mesh belum berubah).

- [ ] **Step 5: Commit**

```bash
git add src/stock/VoxelStock.js tests/run.mjs
git commit -m "feat(stock): scaffold chunk voxel + dirty mapping saat cut"
```

---

### Task 3: Meshing per-chunk SINKRON (ganti mesh penuh)

**Files:**
- Modify: `src/stock/VoxelStock.js:157-252`
- Modify: `src/sim/FixtureManager.js:64-76`
- Test: `tests/run.mjs` (blok VoxelStock Tahap 8 & async)

**Interfaces:**
- Produces: `_buildChunkSpec(chunk) -> spec` (`{ grid: Uint8Array((chunkVoxels+2)^2 * nz), nx: W, ny: W, nz, originX, originY, originZ, res, colorRaw, emitBounds }`, `W = chunkVoxels + 2`, mapping subgrid `(sx,sy) -> main (baseIx-1+sx, baseIy-1+sy)`, x-mesin di luar batas → 0; `emitBounds = { minX:1, maxX:1+chunkW, minY:1, maxY:1+chunkH, minZ:0, maxZ:nz }`).
- `_applyChunkGeometry(chunk, geo, scene)` — `geo` null → hapus `chunk.mesh` dari scene + dispose; else buat/­tukar `THREE.Mesh` (nama `'stock-chunk'`, `castShadow/receiveShadow=true`, material `this.material`, posisi 0 karena geometry sudah koordinat dunia).
- `_meshChunkSync(chunk, scene)`.
- `updateMesh(scene, force)` — `force` → `_markAllChunksDirty()`; jika `_dirtyChunks` kosong → return; throttle `rebuildIntervalMs` (kecuali `force`); proses ≤ `maxChunksPerUpdate` chunk kotor; **pada task ini hanya jalur sinkron** (`_meshChunkSync`), `meshService` diabaikan (dipulihkan Task 4).
- `setVisible(v)` — set `visible` semua `chunk.mesh`.
- Consumes: Task 1 `emitBounds`, Task 2 state chunk.

- [ ] **Step 1: Tulis test gagal (ganti blok mesh Tahap 8 async)**

Ganti blok `Tahap 8: VoxelStock async mesh` + blok regresi kontinu dengan:

```js
// ---------- chunk meshing sinkron (Task realtime cutting) ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const scene = { children: [], add(m) { this.children.push(m); }, remove(m) { this.children = this.children.filter((x) => x !== m); } };
  const s = new VoxelStock({ sizeX: 20, sizeY: 20, sizeZ: 10, res: 1, originX: 0, originY: 0, originZ: -10, chunkVoxels: 8 });
  for (let f = 0; f < 50; f++) s.updateMesh(scene, true);   // bangun semua chunk (bounded 4/frame → beberapa frame)
  const meshes = s.chunks.map((c) => c.mesh).filter(Boolean);
  ok(meshes.length === s.cw * s.chN, 'chunk sync: semua chunk punya mesh (' + meshes.length + '/' + (s.cw * s.chN) + ')');
  ok(meshes.every((m) => m.name === 'stock-chunk'), 'chunk sync: nama mesh = stock-chunk');

  // tanam muka internal: dua chunk bertetangga harus sama dgn grid tunggal
  // (jumlah muka stok penuh 20x20x10 dgn chunk 8 == jumlah muka grid tunggal penuh)
  const single = new VoxelStock({ sizeX: 20, sizeY: 20, sizeZ: 10, res: 1, originX: 0, originY: 0, originZ: -10 });
  const triChunked = meshes.reduce((a, m) => a + m.geometry.attributes.position.count / 3, 0);
  const triSingle = single.buildGeometry().attributes.position.count / 3;
  ok(triChunked === triSingle, 'chunk sync: tanpa muka internal (chunked ' + triChunked + ' == single ' + triSingle + ')');

  // cut mengubah mesh chunk yang benar
  s._dirtyChunks.clear();
  s.cutSegment(10, 10, -2, 10, 10, -2, 2);
  ok(s._dirtyChunks.size > 0, 'chunk sync: cut menandai chunk kotor');
  const before = s.chunks[s._chunkId(1, 1)].mesh.geometry.attributes.position.count;
  s.updateMesh(scene, true);
  ok(s.chunks[s._chunkId(1, 1)].mesh.geometry.attributes.position.count !== before ||
     s.chunks[s._chunkId(1, 1)].empty, 'chunk sync: chunk terpotong di-remesh');

  // setVisible
  s.setVisible(false);
  ok(s.chunks.every((c) => !c.mesh || c.mesh.visible === false), 'chunk sync: setVisible menyembunyikan semua chunk');
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test 2>&1 | grep "chunk sync"`
Expected: FAIL (`c.mesh` null / tak ada).

- [ ] **Step 3: Implementasi**

Ganti `_swapGeometry`/isi `updateMesh` dengan `_buildChunkSpec` + `_meshChunkSync` + `_applyChunkGeometry` + loop terbatas di `updateMesh`. `dispose` menghapus semua `chunk.mesh`, `chunk.version++`, lalu `this.material.dispose()`. `FixtureManager`: baris 73 → `e.stock.setVisible(v)`; `reset()` hapus baris `e.stock._dirty = true` (`reset()` sudah menandai semua chunk).

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test 2>&1 | grep -E "chunk sync|PASS:"`
Expected: PASS, FAIL 0. Lalu `timeout 420 npm run verify` → VERIFY HIJAU.

- [ ] **Step 5: Commit**

```bash
git add src/stock/VoxelStock.js src/sim/FixtureManager.js tests/run.mjs
git commit -m "feat(stock): meshing per-chunk sinkron (remesh hanya chunk kotor)"
```

---

### Task 4: Meshing per-chunk ASYNC via meshService (versi + fallback)

**Files:**
- Modify: `src/stock/VoxelStock.js` (`updateMesh`)
- Test: `tests/run.mjs` (blok async diubah + blok kontinu)

**Interfaces:**
- Consumes: `meshService.request(spec) -> Promise<geo|null>` (Map per `id`; sudah ada di `MeshService.js`, **tidak diubah**), `_buildChunkSpec`, `_applyChunkGeometry`.
- `updateMesh` async path per-chunk: bila `chunk.pending` → lewati (tunggu). Else `chunk.version++`, `chunk.pending=true`, kirim; `.then` → `if (token !== chunk.version) return; chunk.pending=false; apply(geo); if (chunk.dirty) this._dirtyChunks.add(chunk.id);`; `.catch` → `if (token !== chunk.version) return; chunk.pending=false; _meshChunkSync(chunk, scene)`.

- [ ] **Step 1: Tulis test gagal**

```js
// ---------- chunk async (Task realtime cutting) ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const { buildGreedyGeometry } = await import('../src/stock/greedyMesh.js');
  const scene = { children: [], add(m) { this.children.push(m); }, remove(m) { this.children = this.children.filter((x) => x !== m); } };
  // service yang mengembalikan geometry chunk dari spec (neck: build greedy dari spec)
  const svc = { request(spec) { return Promise.resolve(buildGreedyGeometry(spec)); }, dispose() {} };
  const s = new VoxelStock({ sizeX: 20, sizeY: 20, sizeZ: 10, res: 1, originX: 0, originY: 0, originZ: -10, chunkVoxels: 8, meshService: svc });
  for (let f = 0; f < 20; f++) { s.updateMesh(scene, true); await new Promise((r) => setTimeout(r, 0)); }
  ok(s.chunks.filter((c) => c.mesh).length === s.cw * s.chN, 'chunk async: semua chunk ter-mesh dari reply');

  // fallback: service reject → chunk di-mesh sinkron
  const bad = { request() { return Promise.reject(new Error('x')); }, dispose() {} };
  const s2 = new VoxelStock({ sizeX: 20, sizeY: 20, sizeZ: 10, res: 1, originX: 0, originY: 0, originZ: -10, chunkVoxels: 8, meshService: bad });
  s2.updateMesh(scene, true); await new Promise((r) => setTimeout(r, 0));
  ok(s2.chunks.some((c) => c.mesh), 'chunk async: service gagal → fallback sinkron');

  // balasan yang datang SETELAH dispose() harus dibuang (versi chunk di-bump)
  const pending = [];
  const ctl = { request(spec) { return new Promise((res) => pending.push(() => res(buildGreedyGeometry(spec)))); }, dispose() {} };
  const s3 = new VoxelStock({ sizeX: 10, sizeY: 10, sizeZ: 10, res: 1, originX: 0, originY: 0, originZ: -10, chunkVoxels: 8, meshService: ctl });
  s3.updateMesh(scene, true);
  s3.dispose(scene);
  for (const f of pending) f();          // balasan telat
  await new Promise((r) => setTimeout(r, 0));
  ok(s3.chunks.every((c) => c.mesh === null), 'chunk async: balasan setelah dispose dibuang (mesh tetap null)');
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test 2>&1 | grep "chunk async"`
Expected: FAIL (masih jalur sinkron, `meshService` diabaikan).

- [ ] **Step 3: Implementasi**

Di `updateMesh`, jalur `this.meshService`: untuk chunk kotor non-pending → kirim `_buildChunkSpec(chunk)`; hapus dari `_dirtyChunks`; simpan `const token = ++chunk.version`. Pada resolve terapkan bila `token === chunk.version`, dan bila `chunk.dirty` re-tambahkan id. Pada reject → `_meshChunkSync`. Bila `!this.meshService` → `_meshChunkSync`. Batasi `maxChunksPerUpdate`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test 2>&1 | grep -E "chunk async|PASS:"`
Expected: PASS, FAIL 0. Lalu `timeout 420 npm run verify` → VERIFY HIJAU.

- [ ] **Step 5: Commit**

```bash
git add src/stock/VoxelStock.js tests/run.mjs
git commit -m "feat(stock): meshing per-chunk via worker (versi per-chunk + fallback sinkron)"
```

---

### Task 5: Bench carved/chunked, probe smoke, versi & dokumen

**Files:**
- Modify: `scripts/bench-mesh.mjs`, `scripts/verify.mjs`, `src/main.js` (probe), `README.md`, `AGENTS.md`, `docs/PLAN-LANJUTAN.md`, `docs/BACKLOG.md`, `HANDOFF.md`
- Test: `tests/run.mjs` (tidak berubah) + `scripts/verify.mjs` (smoke)

**Interfaces:**
- Produces: `window.__meshStats` (dijaga `main.js` di loop `animate`): `{ chunks: <jumlah chunk mesh>, dirty: <jumlah chunk kotor> }`. Dipakai smoke.
- `npm run bench:mesh` mencetak juga mode carved + chunked (ms + tris).

- [ ] **Step 1: Tambah smoke assertion**

Di `scripts/verify.mjs`, setelah program dijalankan, `page.evaluate(() => window.__meshStats)` → assert `stats && stats.chunks >= 1`; pastikan tidak ada `pageerror`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `timeout 420 npm run verify`
Expected: FAIL (`window.__meshStats` undefined).

- [ ] **Step 3: Implementasi probe + bench**

`main.js` loop `animate`: hitung `window.__meshStats = { chunks: <jumlah mesh stock-chunk>, pending: <jumlah chunk.pending||dirty> }`. `bench-mesh.mjs`: tambah blok yang membangun stok, mencukur (ratusan `cutSegment`), lalu mengukur `buildGreedyGeometry` penuh (carved) **dan** jumlah chunk kotor/estimasi per-step chunk (~8 ms) — cetak angka, gate longgar (exit 1 hanya bila > 2000 ms).

- [ ] **Step 4: Jalankan, pastikan lulus + bump versi**

Run: `timeout 420 npm run verify 2>&1 | tail -3` → VERIFY HIJAU; `npm run bench:mesh`.
Bump `package.json` → `0.14.0`; update `README` (judul/versi/baris riwayat + jumlah test), `AGENTS.md` (jumlah test), `docs/PLAN-LANJUTAN.md` (status Tahap 8 + jumlah test), `docs/BACKLOG.md` (M7/L11/L15 selesai/diperbarui), `HANDOFF.md` (commit, status, catatan gelombang).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(v0.14.0): realtime cutting (chunked meshing) + smoke/bench + docs/handoff"
```

### Task 6: Warna cut kontras per material

**Files:**
- Modify: `src/stock/VoxelStock.js` (ctor, `buildGeometry`, `_buildChunkSpec`)
- Test: `tests/run.mjs` (blok warna cut)

**Interfaces:**
- Produces: ctor menerima `colorCut = null`. Warna cut efektif = `colorCut || colorRaw.map((c) => c * 0.45)`. `buildGeometry` dan `_buildChunkSpec` mengoper `colorCut: <cut efektif>` ke `buildGreedyGeometry`.

- [ ] **Step 1: Tulis test gagal**

```js
// ---------- warna cut kontras per material (Task realtime cutting) ----------
{
  const { VoxelStock } = await import('../src/stock/VoxelStock.js');
  const dark = [0.54, 0.56, 0.59];   // steel raw ~ abu, dulu nyaris sama dgn cut default
  const s = new VoxelStock({ sizeX: 10, sizeY: 10, sizeZ: 10, res: 5, originX: 0, originY: 0, originZ: 0, colorRaw: dark });
  s.cutSegment(0, 0, 0, 10, 0, 0, 3);
  const col = s.buildGeometry().attributes.color.array;
  const cutExpected = dark[0] * 0.45;
  ok(Array.from(col).some((c, i) => i % 3 === 0 && Math.abs(c - cutExpected) < 1e-4),
    'warna cut: muka cut = colorRaw*0.45 (kontras vs steel raw), cari ' + cutExpected);
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test 2>&1 | grep "warna cut"`
Expected: FAIL (masih pakai `COLOR_CUT` default `0.55`, bukan `0.243`).

- [ ] **Step 3: Implementasi**

Tambah `colorCut = null` ke ctor; simpan `this.colorCut = colorCut || this.colorRaw.map((c) => c * 0.45)`. Oper `colorCut: this.colorCut` di `buildGeometry` dan `_buildChunkSpec`. Biarkan default `COLOR_CUT` di `greedyMesh` sebagai fallback (tak dipakai jalur ini).

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `npm test 2>&1 | grep -E "warna cut|PASS:"`
Expected: PASS, FAIL: 0.

- [ ] **Step 5: Commit**

```bash
git add src/stock/VoxelStock.js tests/run.mjs
git commit -m "feat(stock): warna cut kontras per material (digelapkan dari material)"
```

---

### Task 7: Fixture offset manual (placement custom)

**Files:**
- Modify: `src/main.js` (`fixtureRowHtml` ~L454, `applyFixtureField` ~L486)
- Test: `scripts/verify.mjs`

**Interfaces:**
- Produces: bila `f.placement === 'custom'`, `fixtureRowHtml` menambah tiga input X/Y/Z `data-field="offsetX|offsetY|offsetZ"` bernilai `f.offset.x/y/z`. `applyFixtureField` menangani ketiganya → set `f.offset` lalu rebuild.

- [ ] **Step 1: Tambah smoke assertion**

Di `scripts/verify.mjs` (bagian FIXTURE): set `placement='custom'`, isi `offsetX=20`, `offsetY=10` via `page.evaluate` + dispatch `change`, lalu baca `originX/originY` stok G54 → assert `originX === 20 && originY === 10`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `timeout 420 npm run verify`
Expected: FAIL (input `offsetX` tak ada → stok tetap di origin).

- [ ] **Step 3: Implementasi**

`fixtureRowHtml`: bila `custom`, tambah label X/Y/Z dgn `data-field` offset*. `applyFixtureField`: cabang `offsetX/offsetY/offsetZ` → set `f.offset[axis] = num`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `timeout 420 npm run verify 2>&1 | tail -3`
Expected: VERIFY HIJAU.

- [ ] **Step 5: Commit**

```bash
git add src/main.js scripts/verify.mjs
git commit -m "feat(fixture): input offset X/Y/Z untuk placement manual"
```

### Task 8: Tool magazine 20 (setup)

**Files:**
- Modify: `index.html:141-166` (kosongkan `<tbody>` tabel tool)
- Modify: `src/main.js` (`toolTable` L112, handler tool L1044-1056, panggil render saat init)
- Test: `scripts/verify.mjs` (smoke)

**Interfaces:**
- Produces: `const TOOL_COUNT = 20;`. `toolTable` dibangun dari loop: tool 1-3 mempertahankan default sekarang; 4-20 default `{ length:0, dia:6, flute:18, overall:80, type:'End Mill' }`. `renderToolTable()` mengisi `#toolOffsetTable tbody` dari `toolTable`, baris `activeTool` diberi `active-row`. Listener click/change **didelegasikan** ke `tbody` (bukan per-baris).

- [ ] **Step 1: Tambah smoke assertion**

Di `scripts/verify.mjs`: assert `document.querySelectorAll('#toolOffsetTable tbody tr').length === 20`, lalu klik baris `data-tool="20"` via `page.evaluate` → assert `machine.tool === 20`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `timeout 420 npm run verify`
Expected: FAIL (baris = 3).

- [ ] **Step 3: Implementasi**

`index.html`: sisakan `<tbody></tbody>` kosong. `main.js`: bangun `toolTable` 1-20 via loop; tulis `renderToolTable()`; ganti listener per-baris L1044-1056 menjadi dua listener delegasi di `#toolOffsetTable tbody` (`click` → `applyToolFromTable(+tr.dataset.tool)` bila target bukan INPUT; `change` → set `toolTable[+tr.dataset.tool][inp.dataset.field]`). Panggil `renderToolTable()` saat init (sebelum `syncOffsetInputsFromTables`).

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `timeout 420 npm run verify 2>&1 | tail -3`
Expected: VERIFY HIJAU.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.js scripts/verify.mjs
git commit -m "feat(tool): tool magazine 20 posisi (bukan 3)"
```

---

## Self-Review

- **Spec coverage:** §4 arsitektur (Task 2-3), §4b warna cut (Task 6), §4c offset manual (Task 7), §5 data model (Task 2), §6 protokol per-chunk (Task 3-4), §7 ordering (Task 4), §8 dirty mapping (Task 2), §9 tepi kasus (Task 3 `empty`, dispose/resize; Task 4 fallback; loop terbatas `maxChunksPerUpdate`), §10 bench (Task 5), §11 testing (semua task), §3 non-goals dihormati (tak ada heightmap/LOD). Task 8 (magazine 20) adalah setup UI, di luar spec meshing.
- **Keputusan tertunda yang disadari:** `colorRaw` berubah (ganti material) belum me-remesh otomatis — langka, dicatat sebagai keterbatasan (spec §9); tidak ada task.
- **Orientasi chunk:** Task 3 memakai origin dunia (bukan `mesh.position`) agar konsisten dengan `buildGreedyGeometry`; uji Review-Focus posisi ada di Task 3 (implisit lewat kecocokan tri single vs chunked; jika reviewer ingin eksplisit, tambah cek bounding box chunk).
