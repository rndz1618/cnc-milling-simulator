# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
> Daftar tunggal semua item tertunda (Tahap 6–8 + review): lihat `docs/BACKLOG.md`.
commit: 488ee7d
status: v0.13.2 — bugfix: (1) material kini ter-update **saat** cutting berjalan (bukan hanya di akhir) — `VoxelStock.updateMesh` dibatasi satu permintaan meshing in-flight; (2) H1 escape nama fixture (`escapeHtml`); (3) H3 `G4 X` = detik. Di atas v0.13.0 (material removal v2).
verify: test 167/167 · build OK · smoke browser OK (shell JSON + FEED HOLD + RPM + FIXTURE/scenario + smoke XSS nama fixture + wizard touch-off + mesh worker aktif) · bench:mesh OK
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 9** (fondasi SaaS): akun + multi-tenant, machine profile per institusi, pustaka program, scenario builder + penilaian otomatis (checklist, kesalahan tercatat: crash/offset salah/waktu), ekspor laporan.
2. Setelah itu: Tahap 10 (opsional) — PWA offline, layout tablet, i18n ID/EN.
- Ditunda (kandidat, dari Tahap 6): spasi-pause tak set `holdReason`; akuntansi `elapsed` ATC; miter tak di-clamp; G28 stale pos di Compensator. Plus **G92** (work coordinate shift) di luar scope v0.11.0 (spec Tahap 6 §4).
- Ditunda (kandidat, dari Tahap 7): posisi stok diturunkan dari WCS saat build → edit WCS/touch-off tak rebuild mesh (mesh vs toolpath bisa divergen); touch-off X/Y hanya tepat untuk `top-corner` (default `top-center` butuh koreksi setengah ukuran); `custom` placement tanpa input offset (stok lompat ke origin mesin); `normalizeFixtures` diam-diam buang WCS duplikat.
- Ditunda (Tahap 8, YAGNI): **heightfield/dexel** utk 3-axis — hanya jika pengukuran membuktikan worker+greedy kurang. **FPS program ≥2000 gerakan tetap 60fps BELUM terukur** (bench Task 8 mengukur waktu greedy mesh, bukan FPS); pengukuran FPS penuh = tindak lanjut bila perlu.
## Catatan gelombang terakhir (2026-10-11) — bugfix v0.13.1 (H1 + H3)
- **H1 — XSS nama fixture**: helper baru `src/util/html.js` (`escapeHtml`: escape `& < > " '`). Dipakai di `main.js` pada render daftar fixture (`fixtureRowHtml`) dan opsi selector WCS. Unit test (`tests/run.mjs`) + assertion smoke end-to-end (`verify.mjs`: skenario jahat `<img src=x onerror=...>` di-load → `window.__xss` tak ter-set + `textContent` utuh). Diverifikasi RED dulu (tanpa escape) lalu GREEN.
- **H3 — `G4 X` di G20**: `Parser.js` menyimpan `nxRaw` (nilai X sebelum `scale()`); dwell pakai `nxRaw`, bukan `nx` ter-konversi. `G4 P` memang sudah tak ter-skala. Unit test: `G20\nG4 X0.5` → `p=0.5` (bukan 12.7).
- Gate: `npm test` 165/165 · `npm run verify` hijau (build + smoke, termasuk smoke XSS). Item H1/H3 dihapus dari `docs/BACKLOG.md`.

## Catatan gelombang (2026-10-11) — v0.13.2 bugfix mesh saat cutting
- **Gejala Jack (deployed)**: material "terpotong tapi sangat lambat/akhir". **Akar**: `VoxelStock.updateMesh` token latest-wins membuang balasan worker bila ada permintaan lebih baru yang **dikirim**. Worker greedy-mesh (~335 ms) >> `rebuildIntervalMs` (80 ms) → saat cutting kontinu SEMUA balasan basi → mesh hanya ter-update ketika cutting berhenti; permintaan menumpuk tiap 80 ms (page lambat).
- **Fix**: batasi **satu permintaan meshing in-flight**; balasan hanya dibuang bila dibatalkan (`dispose`/resize menaikkan `_meshToken`). Cut selama in-flight tidak me-reset `_dirty` (agar cut terakhir tetap diproses).
- **Bukti**: probe 25 cut kontinu/12 ms + service 40 ms → sebelum: 21 permintaan, **0** swap mesh; sesudah: 6 swap. Test regresi di `tests/run.mjs` (RED→GREEN). Gate: `npm test` 167/167 · `npm run verify` hijau.
- **Cakupan sisa**: smoke real-time sandbox terlalu lambat untuk meng-assert material terpotong → item baru L15 di `docs/BACKLOG.md`.

## Catatan gelombang (2026-10-11) — Tahap 8 material removal v2
- **Greedy mesher** `src/stock/greedyMesh.js` (`buildGreedyGeometry` + `COLOR_RAW`/`COLOR_CUT`): quad-merge sisi permukaan seragam (stok penuh 100×80×20 → 12 tris). `VoxelStock` memakainya; fallback box bila grid kosong.
- **Worker meshing — Approach 1**: worker (`src/stock/meshWorker.js` + `src/stock/MeshService.js`) HANYA membangun geometry; grid voxel + `cutCylinder` + collision tetap di main thread (alarm sinkron; unit test Node tetap jalan tanpa worker/DOM). `VoxelStock.updateMesh` async lewat `meshService` (token latest-wins; fallback sinkron). Worker ter-bundle Vite (`dist/assets/meshWorker-*.js`), probe round-trip `window.__meshWorkerActive=true`.
- **Holder crash**: `src/machine/ToolProfile.js` (`toolProfile`/`radiusAt`/`sampleCollision`) + `Simulator._checkRapidCrash` → alarm `HOLDER CRASH` saat G00 nabrak holder/shank; profil dari `machine.toolSpec = {dia,flute,overall}`, fallback profil bawaan bila absen.
- **Pasca-review (commit 4c76a00)**: (1) flute diprobe di **tip** (h=0) + mid-flute & disc shank/holder di **muka bawah** — sebelumnya disc di mid-flute membuat RAPID CRASH baru menyala ~18 mm tertanam & embed dangkal lolos (regresi vs `_checkRapidCrash` lama); (2) `scripts/verify.mjs` fail-closed bila port 4199 sudah melayani (cegah smoke hijau ke build basi) + kill process-group preview; `waitForFunction(fn, null, {timeout:90000})` (opsi di arg ke-3; env sandbox lambat).
- **Ditunda (Tahap 8, dari review)**: flute hanya disampel di h=0 & fluteLen/2 → slate tipis murni di paruh atas flute bisa lolos (plane sampling, non-blok); bench pakai stok solid (best case); tak ada test latest-wins ordering.
- **Bench** `npm run bench:mesh` (`scripts/bench-mesh.mjs`) mencetak ms greedy mesh 100×80×20 + tris (sanity gate >4000 ms → exit 1). Hasil rilis: ~399 ms, tris=12 (stok solid).
- Wiring `main.js`/`FixtureManager` meneruskan `meshService`; `scripts/verify.mjs` menunggu `window.__meshWorkerActive` terdefinisi (gerbang jujur) + smoke Tahap 6/7 tetap.
- Gate: `npm test` (160/160) · `npm run verify` hijau · `npm run bench:mesh` OK. Commit kecil per task; push ke `main` hanya setelah konfirmasi Jack.
