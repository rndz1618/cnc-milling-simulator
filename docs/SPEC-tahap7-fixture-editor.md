# SPEC Tahap 7 — Fixture editor (vise, multi-fixture, material, touch-off)

Status: disetujui secara desain (brainstorm Jack, 2026-10-10). Authority untuk plan.
Invarian di `PLAN-LANJUTAN.md` §1 tetap berlaku penuh: posisi internal = koordinat
MESIN, transform work→machine saat eksekusi, blok yang men-alarm tidak dieksekusi,
Parser stateless, Simulator tidak parsing teks.

---

## 1. Tujuan

Ubah satu-stok hardcoded jadi **editor fixture** nyata untuk training: beberapa
ragum (vise) + stok, masing-masing terkait work offset (WCS), dengan preset
material, skenario tersimpan, dan prosedur touch-off semi-otomatis (edge finder).

Hasil yang diminta Jack (brainstorm): **full fixture suite** — jumlah fixture
configurable, mapping per WCS, material visual, wizard touch-off kontak, skenario
bernama yang menyimpan layout + program + WCS + tool table.

## 2. Selesai jika

1. Skenario **2 ragum O20018** menampilkan 2 vise + 2 stok terpisah; blok G54
   hanya memotong stok fixture G54, blok G55 hanya stok G55 — `remaining %`
   masing-masing mandiri.
- Program G54+G55 dalam satu run memotong dua stok independen.
- Menambah/menghapus fixture (≤ jumlah WCS, maks 6) mengubah scene tanpa reload.
- Ragum dirender dari parameter (`jawWidth`, `jawHeight`, `opening`), bukan diturunkan dari ukuran stok.
- Material stok (alum/steel/plastic) mengubah warna + label; tidak ada fisika.
- Skenario bernama bisa Save/Load/Delete (fixtures + program + WCS + tools) dan
  mereproduksi setup persis; migrasi config stok lama (satu stok) tetap jalan.
- Wizard touch-off: pilih tepi (X−/X+/Y−/Y+/Z-atas) → jog sampai kontak → offset
  tertulis ke WCS aktif (posisi kontak ± radius tool; Z-top = posisi ujung tool).
- Regresi satu-fixture lama tetap benar; `npm run verify` hijau.

## 2. Pipeline & batas modul

```
parseGCode(text)
  → applyCutterComp(moves)              // existing (Tahap 6)
  → sim.loadMoves(moves)                 // moves bawa m.wcs (existing)
  → Simulator: per gerak feed → resolveStock(m.wcs || activeWcs).cutSegment(...)
FixtureManager (baru): Map<wcs, VoxelStock> + vise mesh per fixture
```

- **Parser**: tak berubah (sudah emit `m.wcs`).
- **Fixtures.js (baru, murni):** model + helper murni, tak sentuh DOM/DOM/Three.
- **FixtureManager** (di `src/sim/`): pemilik stok & vise per fixture; satu-satunya
  yang tahu mesin/render. Simulator hanya lewat hook `resolveStock(wcs)`.
- **Simulator**: tambah opsi `resolveStock`; tetap kompatibel tanpa opsi itu
  (fallback ke `this.stock` lama) → semua test lama tak berubah.
- **main.js**: `stock` tunggal → `fixtures` manager; status `%`, dry-run, framing,
  reset jadi agregat/iteratif.

## 2b. Model data (pure, `src/machine/Fixtures.js`)

```
Fixture = {
  id: string,
  wcs: 'G54'..'G59',
  name: string,
  vise:  { jawWidth, jawHeight, opening, baseH },   // mm; default 150/40/90/40
  stock: { sizeX, sizeY, sizeZ, material: 'alum'|'steel'|'plastic'|'custom', color? },
  placement: 'top-center'|'top-corner'|'custom',
  offset: { x, y, z }        // origin stok di koordinat MESIN bila custom; else derived
}
```

- `MATERIALS`: alum `#c9ccd1`, steel `#8a8f96`, plastic `#d9c27a` (+const, label) — visual saja.
- `stockOriginFor(fixture, wcsOffset)`: aturan SAMA dengan `applyStockSetup` sekarang
  (top-center / top-corner / custom) — jadi perilaku satu-stok identik.
- `normalizeFixtures(raw)` + `migrateLegacyStock(oldStockSetup)`: konfigurasi lama
  → satu fixture G54 (backward compat).

## 2c. Skenario (persisted)

`scenario = { name, fixtures:[Fixture], program:string, wcs:{G54..G59}, tools:[Tool] }`.
Disimpan di localStorage `cnc-sim-scenarios` (map name→scenario). UI: bilah
skenario (nama + Save/Load/Delete). Muat skenario = set fixtures, program, WCS,
tool table sekaligus. Kunci lama `cnc-sim-wcs`/`cnc-sim-tools` tetap dipertahankan.

## 2d. Touch-off wizard (guided contact)

Overlay bergaya panel yang ada (pola CURNT CMDS/ALARM). Alur:
1. Pilih fixture + edge: X− / X+ / Y− / Y+ / Z-top.
2. Jog manual (increment 0.1/1/10) dengan indikator jarak ke edge (mm).
3. Kontak terdeteksi saat radius luar tool menyentuh bidang edge stok; pada Z-top,
   saat ujung tool menyentuh permukaan atas.
4. Offset yang ditulis ke WCS aktif: `posisi_mesin_kontak ± radius_tool`
   (tanda per edge); Z-top: `z = posisi_kontak`.
Helper murni `contactOffset(fixture, edge, toolRadius, machinePos)` +
`edgePlane(fixture, edge)`. Wizard memakai mesin jog + tombol ZERO/WCS yang ada.

## 3. Batas yang sengaja (YAGNI — jadi komentar `shortcut:` di kode)

- Material = **visual saja** (warna+label); tanpa fisika pemotongan.
- Maksimum fixture = jumlah WCS (6); tak ada fixture ganda di satu WCS.
- Tanpa penilaian/skor/expected-result (itu Tahap 9 scenario builder).
- Tabrakan: pakai rapid-crash yang ada; tak ada model tabrakan vise/holder baru.
- Touch-off: deteksi bidang analitik dari bounds stok (bukan raycast mesh voxel).
- Non-G17 (G18/G19) di luar scope comp (sudah ditangani Tahap 6 untuk plane arc).

## 4. Komponen & file

- `src/machine/Fixtures.js` (**baru**, murni): model + `MATERIALS` + `stockOriginFor`
  + `normalizeFixtures` + `migrateLegacyStock`.
- `src/machine/TouchOff.js` (**baru**, murni): `edgePlane`, `contactOffset`, `checkContact`.
- `src/sim/FixtureManager.js` (**baru**): `stockFor(wcs)`, `stocks()`, `reset()`,
  `remainingRatio()`, `setVisible()`, `frameBounds()`, `rebuild(scene)` (buat mesh stok + vise per fixture).
- `src/sim/Simulator.js`: opsi `resolveStock`; cut via stok WCS blok; `stop()` reset via manager.
- `src/view/Scene.js`: `createVise(params)` parameterized (jawWidth/jawHeight/opening),
  bukan turunan stok; warna stok per material.
- `src/main.js`: ganti `stock` tunggal → `fixtures`; SETUP sub-tab STOCK → **FIXTURE**;
  bilah skenario; wiring wizard touch-off; status/framing/dry-run agregat.
- `index.html`, `src/style.css`: sub-tab FIXTURE, daftar fixture, kontrol vise/stok/material,
  bilah skenario, overlay touch-off.
- `tests/run.mjs`, `scripts/verify.mjs`: test baru + smoke.
- `HANDOFF.md`, `README.md`/`AGENTS.md` (hitungan test), `docs/PLAN-LANJUTAN.md` (tandai Tahap 7 selesai).

## 5. Data flow

```
skenario dimuat → fixtures[], program, wcs, tools
  → FixtureManager.build(fixtures, machine.wcs, scene)   // 1 stok+vise per fixture
  → applyCutterComp → sim.loadMoves
  → tick/step: cutSegment ke stockFor(m.wcs||activeWcs)
  → updateStatusBar: % per fixture + agregat
edit WCS / fixture → recompute stockOriginFor → rebuild mesh (tanpa reload program)
touch-off → contactOffset → machine.wcs[activeWcs] → marker WCS pindah (fitur existing)
```

## 6. Error handling

- Fixture dengan WCS di luar G54–G59 / dobel → diabaikan + status.
- Skenario korup → fallback default aman (satu fixture G54), tak crash.
- `resolveStock` mengembalikan null (program pakai WCS tanpa fixture) → gerak jalan,
  tak memotong apa pun (status info), tak crash.
- Touch-off tepi tanpa stok/fixture → tombol nonaktif.
- Material tak dikenal → warna default + label material apa adanya.

## 7. Testing

`tests/run.mjs` (gaya existing, tanpa framework):
1. `stockOriginFor`: top-center/top-corner/custom sama dengan `applyStockSetup` lama.
2. `migrateLegacyStock` → satu fixture G54 dengan ukuran/placement setara.
3. `normalizeFixtures`: buang WCS invalid/dobel, isi default.
4. Skenario serialize→parse round-trip (fixtures+program+wcs+tools).
5. `contactOffset`/`edgePlane`: tiap edge menghasilkan offset benar (radius ± tanda).
6. Simulator multi-stok: program G54+G55 memotong dua stok, `remainingRatio` masing-masing turun independen; regresi satu-stok lama tetap identik.

`scripts/verify.mjs`: smoke di `page.evaluate` — sub-tab FIXTURE render daftar,
tambah fixture → jumlah mesh vise/stok naik, Save/Load skenario, wizard touch-off
buka + satu kontak mengubah WCS. Skenario golden 2-ragum O20018 → 2 stok % independen.

## 8. File tersentuh

`src/machine/Fixtures.js` (baru) · `src/machine/TouchOff.js` (baru) ·
`src/sim/FixtureManager.js` (baru) · `src/sim/Simulator.js` · `src/view/Scene.js` ·
`src/main.js` · `index.html` + `src/style.css` · `tests/run.mjs`, `scripts/verify.mjs`
· `HANDOFF.md`, `README.md`/`AGENTS.md`, `docs/PLAN-LANJUTAN.md`.

## 9. Rilis

- Versi `0.12.0`. Commit terakhir gelombang menyentuh `HANDOFF.md`.
- Gate: `npm test` hijau untuk perubahan murni; `npm run verify` hijau untuk perubahan
  Simulator/UI. Push ke `main` hanya setelah konfirmasi Jack.
