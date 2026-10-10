# SPEC Tahap 8 — Material removal v2 (worker meshing, greedy mesh, holder crash)

Status: disetujui secara desain (brainstorm Jack, 2026-10-11). Authority untuk plan.
Invarian di `PLAN-LANJUTAN.md` §1 tetap berlaku penuh: posisi internal = koordinat
MESIN, transform work→machine saat eksekusi, blok yang men-alarm tidak dieksekusi,
Parser stateless, Simulator tidak parsing teks.

---

## 1. Tujuan

Hilangkan stall frame saat program besar dengan memindahkan pembentukan **mesh**
stok ke Web Worker + **greedy meshing**, dan tambahkan **deteksi tabrakan
holder/shank** (bukan hanya flute) sebagai alarm baru `HOLDER CRASH`.

Keputusan brainstorm (Jack): **Voxel + Worker + greedy mesh**. Split thread:
**worker hanya membangun mesh**; grid voxel + cut + collision tetap di main thread
(lihat §3 alasan).

## 2. Selesai jika

1. Stok voxel tetap dirender; mesh dibangun dari **greedy mesher** (bukan per-face
   naif), jumlah triangle turun vs baseline untuk grid representatif.
2. Pembentukan mesh berjalan di **Web Worker**; main thread tidak lagi mengalokasi
   geometri per-face selama run.
3. Grid voxel tetap otoritatif di main thread → `pointInStock` sinkron → alarm tetap
   sinkron (G00 nabrak = halt seketika), semua unit test cut/collision lama tetap jalan.
4. G00 yang mendorong **holder/shank** (bagian di atas flute) ke material tinggi →
   alarm `HOLDER CRASH`; G00 yang flute-nya menembus material → tetap `RAPID CRASH`.
5. `npm run bench:mesh` mencetak waktu mesher greedy untuk stok 100×80×20 (bukti
   kuantitatif, bukan gate).
6. `npm run verify` hijau (worker aktif, program jalan, tanpa `pageerror`).

## 2b. Pipeline & batas modul

```
Simulator.step/tick  →  stock.cutSegment(...)        // main thread (otoritatif, sinkron)
                          └─ _dirty = true
animate()  →  stock.updateMesh(scene)                // throttle 80 ms (existing)
                ├─ meshService aktif? → postMessage(grid.slice()) → worker
                │                        worker: greedyMesh → transfer buffer
                │                        main: swap THREE.BufferGeometry
                └─ tanpa worker (Node/test) → buildGeometry() sinkron via greedyMesh
```

- **Parser**: tak berubah.
- **cut + collision**: tetap di main thread. Alasan: (a) invarian 3 — alarm harus
  sinkron, butuh `pointInStock` sinkron; grid di worker ⇒ alarm jadi async. (b)
  `npm test` menjalankan `Simulator`/`VoxelStock` di Node tanpa `Worker`; cut/collision
  harus tetap bisa diuji langsung.
- **Worker**: murni transformasi `grid → buffer` (data render saja). Tak tahu
  mesin/WCS/parser.
- **Simulator**: hanya menambah profil tool saat cek rapid; hook lain tak berubah.

## 2c. Greedy mesher (`src/stock/greedyMesh.js`, murni)

`buildGreedyGeometry({grid,nx,ny,nz,originX,originY,originZ,res,colorRaw})` →
`{position,normal,color}` (Float32Array) atau `null` bila kosong.

- Untuk tiap 6 arah, sweep slice dan gabungkan sisi solid yang **coplanar** menjadi
  quad besar; pisah hanya bila warna berubah.
- Warna: `raw` (sisi menghadap luar AABB, mis. warna material) vs `cut` (sisi
  antar-voxel, abu "machined") — sama aturan dengan `buildGeometry` sekarang.
- Urutan vertex/normal sesuai konvensi existing (`positions.push(wx, wz, wy)`).
- Berjalan identik di worker **dan** di Node → bisa di-unit-test tanpa browser.

## 2d. Mesh service + worker

- `src/stock/meshWorker.js` (**baru**): entry worker. Terima `{id,grid,nx,ny,nz,
  origin*,res,colorRaw}`, panggil greedyMesher, `postMessage({id,position,normal,
  color})` dengan transferable. Bungkus try/catch → `{id,error}`.
- `src/stock/MeshService.js` (**baru**): RPC tipis `createMeshService()` →
  `{ request(spec)=>Promise<buffers>, dispose() }`. Satu `Worker`, route per `id`,
  **latest-wins** (reply lama diabaikan), `dispose` menghentikan worker.
- Worker dibuat sekali di `main.js` (pola `new Worker(new URL('./stock/meshWorker.js',
  import.meta.url), {type:'module'})`) dan diteruskan ke `FixtureManager` → tiap
  `VoxelStock`. Di Node `MeshService` tak dipanggil.

## 2e. VoxelStock (perubahan)

- `buildGeometry()` memakai `greedyMesh` (sinkron) — dipakai test + fallback.
- `updateMesh(scene, force)`: throttle 80 ms tetap. Bila `meshService` terpasang:
  kirim `grid.slice()` (copy; grid asli tetap milik main thread) dan swap geometri
  saat reply. Tanpa `meshService`: build sinkron (perilaku lama; test lama utuh).
- `dispose(scene)` juga membatalkan request pending.
- Optimasi cut: `cutCylinder` mulai `iz` dari `max(0, floor((zTip-originZ)/res))`
  (lompati voxel di bawah ujung tool yang memang tak terhapus).

## 2f. Profil tool & holder crash (`src/machine/ToolProfile.js`, murni)

```
toolProfile(spec) → simpul silinder sepanjang sumbu tool (tip di 0, Z naik):
  flute  [0 .. flute]                       r = dia/2
  shank  [flute .. flute+shankLen]          r = max(dia*0.51, 6)
  holder [flute+shankLen .. overall]        r = max(shankR*1.3, 11)
collisionParts(profile, h)  → radius pada tinggi h
sampleCollision(pointInStock, p0, p1, profile)
  → null | 'RAPID CRASH' (bagian di ≤ flute) | 'HOLDER CRASH' (bagian di atas flute)
```

- Radius mengikuti `createToolMesh` (`Scene.js`): shank `max(r*1.02,6)`, collet
  `max(shankR*1.3,11)`.
- `Simulator._checkRapidCrash` memakai `sampleCollision` (ring sampling existing
  dipertahankan, tapi tiap tinggi punya radius sendiri). Bila `machine.toolSpec`
  tak ada → fallback profil dia-saja (radius = dia/2 untuk semua tinggi) sehingga
  test lama tak berubah.
- `main.js` `applyToolFromTable` juga set `machine.toolSpec = {dia,flute,overall,shankLen}`.

## 3. Batas yang sengaja (YAGNI — jadi komentar `shortcut:` di kode)

- **Cut tetap di main thread** (bukan di worker). Kalau cut terbukti jadi bottleneck,
  naikkan ke Arsitektur 2 di gelombang berikutnya.
- **Tanpa heightfield/dexel**: voxel 3D dipertahankan (undercut/T-slot tetap bisa);
  heightfield hanya bila data membuktikan worker+kaya greedy belum cukup.
- **Kolisi hanya pada G00 (rapid)**, seperti sekarang; feed yang mendorong holder
  belum dicek (Tahap lanjut).
- Profil collision = silinder bertingkat (bukan mesh tool eksak/facet).
- Tidak ada gate fps absolut di CI (GL software headless tak deterministik); bukti
  = bench script + assertion worker aktif.

## 4. Komponen & file

- `src/stock/greedyMesh.js` (**baru**, murni): `buildGreedyGeometry`.
- `src/stock/meshWorker.js` (**baru**): entry worker.
- `src/stock/MeshService.js` (**baru**): RPC worker (latest-wins).
- `src/machine/ToolProfile.js` (**baru**, murni): `toolProfile`, `collisionParts`,
  `sampleCollision`.
- `src/stock/VoxelStock.js`: `buildGeometry`→greedy; `updateMesh` async via service;
  optimasi `cutCylinder`.
- `src/sim/FixtureManager.js`: teruskan `meshService` ke tiap `VoxelStock`.
- `src/sim/Simulator.js`: `_checkRapidCrash` pakai `sampleCollision` + alarm
  `HOLDER CRASH`.
- `src/main.js`: buat `MeshService`; set `machine.toolSpec` di `applyToolFromTable`.
- `scripts/bench-mesh.mjs` (**baru**) + `package.json` script `bench:mesh`.
- `tests/run.mjs`, `scripts/verify.mjs`: test + smoke baru.
- `HANDOFF.md`, `README.md`/`AGENTS.md` (hitungan test), `docs/PLAN-LANJUTAN.md`
  (tandai Tahap 8 selesai).

## 5. Data flow

```
cut (main) → grid._dirty → animate() → updateMesh (throttle 80 ms)
  → grid.slice() → MeshService.request → worker greedyMesh → transfer buffer
  → swap geometry (BufferGeometry) → render
rapid → Simulator._checkRapidCrash → sampleCollision(machine.toolSpec)
  → flute kena = RAPID CRASH | holder/shank kena = HOLDER CRASH → halt (sinkron)
```

## 6. Error handling

- Worker gagal / error → fallback build sinkron di main (tetap tampil), status info.
- `meshService` null (Node, atau worker tak didukung) → path sinkron; test lama utuh.
- Reply basi (id bukan terbaru) → diabaikan (latest-wins).
- `machine.toolSpec` tak ada → profil dia-saja (kompatibel mundur).
- Grid kosong / stok habis → greedyMesh kembalikan `null` → tampilkan box fallback
  seperti `buildGeometry` sekarang.

## 7. Testing

`tests/run.mjs` (gaya existing, tanpa framework):
1. Greedy mesher: grid solid penuh → jumlah triangle ≤ mesher per-face naif; sisi
   luar berwarna `raw`, dinding galian berwarna `cut`; hasil tetap tertutup (tiap
   edge dipakai tepat 2 kali atau cek jumlah face invarian).
2. `toolProfile`/`collisionParts`: radius flute/shank/holder pada tinggi benar.
3. `sampleCollision`: stok tinggi + holder panjang → `'HOLDER CRASH'`; flute menembus
   → `'RAPID CRASH'`; di udara → `null`.
4. `Simulator` rapid ke stok tinggi → `state='alarm'`, pesan `HOLDER CRASH`.
5. Regresi: 121 test lama tetap hijau (VoxelStock sinkron tanpa worker, cut, multi-stok).

`scripts/verify.mjs`: smoke di `page.evaluate` — worker aktif (mesh ter-update
setelah program jalan), stok tetap render, tanpa `pageerror`. `scripts/bench-mesh.mjs`
mencetak ms greedy-mesh (bukan gate).

## 8. File tersentuh

`src/stock/greedyMesh.js` (baru) · `src/stock/meshWorker.js` (baru) ·
`src/stock/MeshService.js` (baru) · `src/machine/ToolProfile.js` (baru) ·
`src/stock/VoxelStock.js` · `src/sim/FixtureManager.js` · `src/sim/Simulator.js` ·
`src/main.js` · `scripts/bench-mesh.mjs` (baru) + `package.json` ·
`tests/run.mjs`, `scripts/verify.mjs` · `HANDOFF.md`, `README.md`/`AGENTS.md`,
`docs/PLAN-LANJUTAN.md`.

## 9. Rilis

- Versi `0.13.0`. Commit terakhir gelombang menyentuh `HANDOFF.md`.
- Gate: `npm test` hijau untuk perubahan murni; `npm run verify` hijau untuk
  perubahan Simulator/UI/worker. Push ke `main` hanya setelah konfirmasi Jack.
