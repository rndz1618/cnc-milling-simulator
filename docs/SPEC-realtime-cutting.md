# SPEC — Realtime Cutting Visual (lanjutan Tahap 8)

Status: rancangan disetujui (2026-10-11). Belum diimplementasikan.
Prasyarat: v0.13.2 (material removal v2 + fix update mesh saat cutting).

## 1. Tujuan

Material harus terlihat **terpotong secara realtime mengikuti gerakan spindle**, tanpa lag/telat. Saat ini rebuild mesh seluruh stok memakan ~200–400 ms sehingga visual selalu tertinggal.

## 2. Temuan spike (angka dasar)

Meshing penuh 100×80×20 (res=1, ~160k voxel):

| Kondisi | Waktu | Tris |
|---|---|---|
| Stok penuh (solid) | ≈335 ms | 12 |
| Setelah ribuan potongan | 174–430 ms | ~1.100 |

**Biaya ≈ volume grid, bukan jumlah triangle.** Jadi rebuild penuh tak pernah realtime (budget 1 frame = 16 ms).

Chunk (remesh hanya daerah kotor), simulasi cut bergerak:

| chunk | biaya/chunk | avg/step | max/step |
|---|---|---|---|
| 8×8 voxel | ~4,5 ms | **5,8 ms** | 9,7 ms |
| 16×16 | ~9,3 ms | 11,5 ms | 18,8 ms |
| 32×32 | ~29 ms | 31,6 ms | 57 ms |

Kesimpulan: **chunked incremental meshing** (chunk 8 voxel) muat budget frame, terutama bila meshing di-offload ke worker.

## 3. Ruang lingkup & non-goals

**In scope:** pecah `VoxelStock` jadi chunk; remesh hanya chunk kotor; swalayan di worker per-chunk; warna cut kontras per material; input offset manual fixture.
**Non-goals:** heightmap/shader/GPU, LOD, greedy melintasi batas chunk, mengubah `Parser`/`Simulator`/koordinat.

## 4. Arsitektur

```
Simulator step → cutCylinder/cutSegment → tandai chunk kotor (Set)
   → updateMesh: kirim HANYA chunk kotor (slice grid + padding 1 voxel) ke worker
   → worker buildGreedyGeometry per-chunk → balik geometry
   → main thread tukar geometry chunk itu saja
```

- **Invarian dijaga:** grid voxel + cut + collision tetap di **main thread** (alarm sinkron; unit test Node tanpa DOM tetap jalan). Hanya meshing di-offload.
- `buildGreedyGeometry` tetap dipakai (tetap murni), kini dipanggil per-chunk.
- **Chunk**: grid XY (default 8 voxel, `nz` penuh). `chunkSize` konfigurable (bukan hardcode 8).
- **Border antar chunk benar**: meshing chunk menyertakan **padding 1 voxel** dari tetangga; muka pada bidang batas dibuang.
- **Geometry chunk lokal** (origin 0); `THREE.Mesh.position` = origin chunk (hindari presisi float).

## 4b. Warna cut per material

`VoxelStock` menerima `colorCut` (opsional). Default: **warna cut = `colorRaw * 0.45`** (digelapkan) sehingga selalu kontras terhadap material — termasuk **steel** yang warna mentahnya nyaris sama dengan `COLOR_CUT` lama. `buildGreedyGeometry` sudah menerima `colorCut`; alirkan dari ctor → `buildGeometry` + spec chunk. `FixtureManager` tak berubah (material → `colorRaw`; `colorCut` diturunkan dari `colorRaw`).

## 4c. Fixture: offset manual

Untuk `placement = 'custom'`, tampilkan input **X/Y/Z** (field `offsetX/offsetY/offsetZ`) yang mengisi `fixture.offset` → stok bisa digeser bebas (menutup M5). Material sudah bisa dipilih (dropdown → `colorRaw`). Ini perubahan UI terbatas, tak menyentuh meshing.

## 5. Data model
`VoxelStock` menyimpan:
- `chunks`: array `{ id, ix, iy, originChunk, mesh (THREE.Mesh|null), version, pending (bool), dirty (bool), empty (bool) }`.
- `cw, ch`: jumlah chunk X/Y.
- Indeks grid tetap `iz*nx*ny + iy*nx + ix` (tak berubah).

## 6. Protokol worker (per-chunk)

```
req  { chunkId, version, W, nz, originChunk, res, colorRaw, colorCut, grid: Uint8Array(padded W×W×nz) }
res  { chunkId, version, position/normal/color (transferable) }   |   { chunkId, version, empty: true }
```
`empty:true` → chunk tanpa muka → mesh chunk dihapus (tanpa draw call).

## 7. Ordering & koalesensi

- Setiap chunk punya **`version` sendiri** + **maksimal satu request in-flight per chunk**.
- Balasan diterapkan hanya bila `version` cocok; jika tidak, dibuang.
- Chunk ditandai kotor lagi saat in-flight → diproses ulang saat balasan tiba (latest). Chunk A tak menunggu chunk B; antrean tak menumpuk.

## 8. Dirty mapping (korektnes)

Menghapus voxel mengubah muka **tetangganya**. Saat cut, tandai chunk yang bersinggungan dengan **bbox cut ± 1 voxel** (bukan hanya bbox cut). `cutCylinder` mengembalikan AABB voxel; `cutSegment` mengakumulasi sepanjang sub-segmen.

## 9. Tepi kasus

- Chunk tanpa muka → mesh dihapus.
- **Resize/rebuild**: dispose semua mesh chunk, hitung ulang grid chunk, mesh ulang (boleh bertahap per-frame agar tak ada jeda besar).
- **dispose()**: bump semua `version` (batalkan balasan in-flight).
- **Ganti material/`colorRaw`**: butuh remesh chunk yang terlihat (langka; catat sebagai keterbatasan).
- **Banyak chunk kotor dalam satu step** (resize, cut besar/rapid jauh): proses dibatasi per-update (mis. N chunk/frame), sisanya menyusul frame berikut — hindari hitch. G00 di atas material tidak memotong.
- **Worker gagal**: `worker.onerror`/reject → remesh chunk kotor sinkron di main thread (fallback), tandai service `failed`.

## 10. Perf & bench

- `npm run bench:mesh` ditambah mode **carved + chunked** (menutup celah lama: bench hanya stok solid best-case).
- Gate baru: waktu melayani chunk kotor rata-rata ≤ ~8 ms pada stok 100×80×20 (sanity, bukan CI keras di sandbox lambat — pakai ambang longgar + laporan angka).

## 11. Testing

**Unit (Node, tanpa worker/DOM):**
- Cut di batas chunk menandai **kedua** chunk.
- Ordering: balasan `version` basi dibuang; balasan chunk A tetap dipakai walau chunk B pending.
- Chunk kosong → mesh dihapus; chunk berisi → mesh ada.
- Fallback sinkron saat service reject.
- Border: dua chunk bertetangga tidak menghasilkan muka internal di bidang batas (assert tidak ada muka koinsiden / cek soliditas lintas batas).

**Smoke (verify browser):**
- Jalankan program kecil → beberapa mesh chunk ada dan berubah **saat berjalan**.
- `pageerror` nol.

## 12. File tersentuh

- `src/stock/VoxelStock.js` — chunking, dirty mapping, swap per-chunk, fallback.
- `src/stock/MeshService.js` — request per-chunk (version per chunk).
- `src/stock/meshWorker.js` — mesh satu chunk.
- `src/stock/greedyMesh.js` — kemungkinan tambah opsi "buang muka di batas padding" (atau wrapper tipis).
- `scripts/bench-mesh.mjs` — mode carved/chunked.
- `scripts/verify.mjs`, `tests/run.mjs` — test di atas.

`Parser`, `Simulator`, `MachineState`, koordinat, dan UI panel **tidak berubah**.
