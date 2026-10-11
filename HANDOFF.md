# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
> Daftar tunggal semua item tertunda (Tahap 6–8 + review): lihat `docs/BACKLOG.md`.
commit: 4c76a00
status: v0.13.0 — material removal v2: greedy mesher (`buildGreedyGeometry`) + Web Worker meshing (`MeshService`/`meshWorker`, latest-wins + fallback sinkron), `cutCylinder` optimasi; alarm HOLDER CRASH utk tabrakan holder/shank saat G00 (profil dari `machine.toolSpec`)
verify: test 160/160 · build OK · smoke browser OK (shell JSON + FEED HOLD + RPM + FIXTURE/scenario + wizard touch-off + mesh worker aktif) · bench:mesh OK
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 9** (fondasi SaaS): akun + multi-tenant, machine profile per institusi, pustaka program, scenario builder + penilaian otomatis (checklist, kesalahan tercatat: crash/offset salah/waktu), ekspor laporan.
2. Setelah itu: Tahap 10 (opsional) — PWA offline, layout tablet, i18n ID/EN.
- Ditunda (kandidat v0.12.1, dari Tahap 6): `G4 X` di G20 pakai X ter-konversi unit; spasi-pause tak set `holdReason`; akuntansi `elapsed` ATC; miter tak di-clamp; G28 stale pos di Compensator. Plus **G92** (work coordinate shift) di luar scope v0.11.0 (spec Tahap 6 §4).
- Ditunda (kandidat v0.12.1, dari Tahap 7): posisi stok diturunkan dari WCS saat build → edit WCS/touch-off tak rebuild mesh (mesh vs toolpath bisa divergen); touch-off X/Y hanya tepat untuk `top-corner` (default `top-center` butuh koreksi setengah ukuran); `custom` placement tanpa input offset (stok lompat ke origin mesin); `normalizeFixtures` diam-diam buang WCS duplikat; nama fixture di-innerHTML tanpa escape.
- Ditunda (Tahap 8, YAGNI): **heightfield/dexel** utk 3-axis — hanya jika pengukuran membuktikan worker+greedy kurang. **FPS program ≥2000 gerakan tetap 60fps BELUM terukur** (bench Task 8 mengukur waktu greedy mesh, bukan FPS); pengukuran FPS penuh = tindak lanjut bila perlu.
## Catatan gelombang terakhir (2026-10-11) — Tahap 8 material removal v2
- **Greedy mesher** `src/stock/greedyMesh.js` (`buildGreedyGeometry` + `COLOR_RAW`/`COLOR_CUT`): quad-merge sisi permukaan seragam (stok penuh 100×80×20 → 12 tris). `VoxelStock` memakainya; fallback box bila grid kosong.
- **Worker meshing — Approach 1**: worker (`src/stock/meshWorker.js` + `src/stock/MeshService.js`) HANYA membangun geometry; grid voxel + `cutCylinder` + collision tetap di main thread (alarm sinkron; unit test Node tetap jalan tanpa worker/DOM). `VoxelStock.updateMesh` async lewat `meshService` (token latest-wins; fallback sinkron). Worker ter-bundle Vite (`dist/assets/meshWorker-*.js`), probe round-trip `window.__meshWorkerActive=true`.
- **Holder crash**: `src/machine/ToolProfile.js` (`toolProfile`/`radiusAt`/`sampleCollision`) + `Simulator._checkRapidCrash` → alarm `HOLDER CRASH` saat G00 nabrak holder/shank; profil dari `machine.toolSpec = {dia,flute,overall}`, fallback profil bawaan bila absen.
- **Pasca-review (commit 4c76a00)**: (1) flute diprobe di **tip** (h=0) + mid-flute & disc shank/holder di **muka bawah** — sebelumnya disc di mid-flute membuat RAPID CRASH baru menyala ~18 mm tertanam & embed dangkal lolos (regresi vs `_checkRapidCrash` lama); (2) `scripts/verify.mjs` fail-closed bila port 4199 sudah melayani (cegah smoke hijau ke build basi) + kill process-group preview; `waitForFunction(fn, null, {timeout:90000})` (opsi di arg ke-3; env sandbox lambat).
- **Ditunda (Tahap 8, dari review)**: flute hanya disampel di h=0 & fluteLen/2 → slate tipis murni di paruh atas flute bisa lolos (plane sampling, non-blok); bench pakai stok solid (best case); tak ada test latest-wins ordering.
- **Bench** `npm run bench:mesh` (`scripts/bench-mesh.mjs`) mencetak ms greedy mesh 100×80×20 + tris (sanity gate >4000 ms → exit 1). Hasil rilis: ~399 ms, tris=12 (stok solid).
- Wiring `main.js`/`FixtureManager` meneruskan `meshService`; `scripts/verify.mjs` menunggu `window.__meshWorkerActive` terdefinisi (gerbang jujur) + smoke Tahap 6/7 tetap.
- Gate: `npm test` (160/160) · `npm run verify` hijau · `npm run bench:mesh` OK. Commit kecil per task; push ke `main` hanya setelah konfirmasi Jack.
