# BACKLOG — pekerjaan & perbaikan tertunda

Daftar tunggal semua item yang sengaja ditunda (deferred) dari Tahap 6–8, temuan review
yang di-park, plus tahap berikutnya. Bahasa kerja: Bahasa Indonesia, istilah teknis boleh English.

> Sumber: rekap review Tahap 6/7 (HANDOFF), ledger SDD Tahap 8
> (`.superpowers/sdd/2026-10-11-tahap8-removal-v2/progress.md`), dan review pasca-merge v0.13.0.
> Status: per rilis **v0.13.1** (commit `2267beb`+fix H1/H3). Tidak ada item di sini yang memblok rilis.

## Prioritas HIGH (bug/security/dampak nyata)

| # | Sumber | Item |
|---|--------|------|
| H2 | T7 | **Edit WCS/touch-off tak rebuild mesh** — posisi stok diturunkan dari WCS saat `build`, jadi mesh vs toolpath bisa divergen. Rebuild saat WCS berubah. |
| H4 | T9 | **Tahap 9 — fondasi SaaS**: akun + multi-tenant, machine profile per institusi, pustaka program, scenario builder + penilaian otomatis, ekspor laporan. |

## Prioritas MEDIUM (korektnes/kualitas)

| # | Sumber | Item |
|---|--------|------|
| M1 | T6 | **G92** work coordinate shift (fitur, di luar scope v0.11.0 — spec Tahap 6 §4). |
| M2 | T6 | **G41/G42 miter tak di-clamp** (`Compensator`). |
| M3 | T6 | **G28 stale pos di `Compensator`.** |
| M4 | T7 | **Touch-off X/Y hanya tepat untuk `top-corner`** (default `top-center` butuh koreksi setengah ukuran). |
| M5 | T7 | **`custom` placement tanpa input offset** → stok lompat ke origin mesin. |
| M6 | T7 | **`normalizeFixtures` diam-diam buang WCS duplikat.** |
| M7 | T8 | **Test latest-wins ordering `VoxelStock`** (reply token basi tiba setelah token baru) — satu-satunya cabang async non-trivial tanpa cakupan. |
| M8 | T8 | **`_geoFrom` hanya jaga `g.position`** — reply dengan position tapi normal/color hilang → geometry rusak senyap. |
| M9 | T8 | **`package-lock.json` versi 0.9.3** tak sinkron `package.json` 0.13.1 — putuskan commit/regenerate. |
| M10 | T8 | **Ukur FPS program ≥2000 gerakan** (kriteria "selesai" Tahap 8 belum terukur; bench baru mengukur waktu mesh). |
| M11 | T8 | **verify**: probe port dijalankan setelah build (boros) + `kill -pid` no-op di Windows. |

## Prioritas LOW (kosmetik/optimalisasi/cakupan tambahan)

| # | Sumber | Item |
|---|--------|------|
| L1 | T8 | `sampleCollision`: early-return `null` saat dist<1e-6; step sampling `r*0.5` vs `res*0.5`. |
| L2 | T8 | Greedy test: `tri<=12` (bukan `===12`) + tak cek posisi vertex. |
| L3 | T8 | Komentar `VoxelStock.js` 207-208: 2.55 (jarak ke sampel disk) vs jarak garis sebenarnya 2.5. |
| L4 | T8 | Test regresi batas optimasi `cutCylinder` (voxel tepat di bawah zTip di zTip menengah). |
| L5 | T8 | `_checkRapidCrash`: subsample ganda ~2x + lokalisasi titik tabrak lebih kasar (step 3 vs 2). |
| L6 | T8 | Wording alarming `HOLDER CRASH` pakai frasa "G00 MENABRAK MATERIAL" (dinding, bukan material lepas). |
| L7 | T8 | `MeshService`: `if(e.data.error)` truthiness (string kosong lolos); `meshWorker` `if(!g)` unreachable. |
| L8 | T8 | Test transfer buffer nyata (fake tak detasemen). |
| L9 | T8 | `HANDOFF` field `commit:` = feature SHA (bukan SHA rilis). |
| L10 | T8 | `README.md` stray code fence (pre-existing). |
| L11 | T8 | Bench pakai stok solid (best-case); tambah worst-case/carved. |
| L12 | T8 | Flute hanya disampel h=0 & `fluteLen/2` → slab tipis murni di paruh atas flute bisa lolos (plane sampling). |
| L13 | T8 | **heightfield/dexel** (YAGNI — hanya bila pengukuran membuktikan worker+greedy kurang). |
| L14 | T10 | **Tahap 10 (opsional)** — PWA offline, layout tablet, i18n ID/EN. |

## Konvensi mengerjakan
- Satu item (atau beberapa yang serumpun) per gelombang kecil; commit kecil, pesan jelas.
- Perubahan parser/simulator → wajib unit test. Perubahan UI → `npm run verify` (test + build + smoke).
- Update `HANDOFF.md` di akhir gelombang (commit terakhir gelombang HARUS menyentuh file itu).
- Hapus baris dari file ini saat item selesai; push ke `main` hanya setelah konfirmasi Jack.
