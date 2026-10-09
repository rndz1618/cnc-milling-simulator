# Planning Pengembangan Lanjutan — CNC Milling Simulator

Dokumen ini untuk Jack dan **AI harness mana pun** yang melanjutkan pengembangan.
Ditulis setelah v0.9.0 (commit `1b93079` + `0c19353`). Bahasa kerja: Bahasa Indonesia,
istilah teknis boleh English.

---

## 1. Status saat ini (baseline yang JANGAN dirusak)

| Area | Status |
|---|---|
| Koordinat | ✅ Satu sumber kebenaran: posisi internal = koordinat MESIN. `machine = work + offset WCS`. DRO WORK/MACHINE/DTG turunan. |
| Parser | ✅ G0–G3 (arc IJK/R, G17), G20/21, G28, G43 H/G49, G53, G54–G59, G81–G83 (peck, G98/99), M0/1/3/4/5/6/8/9/30, M97/O-sub, N-line, bare decimal (`Z.`), alarm utk kode tak dikenal **dan blok tidak dieksekusi**. |
| Simulator | ✅ Alarm menghentikan eksekusi (RESET untuk lanjut); soft limit halt; G00 nabrak material = RAPID CRASH (sampling radius); single block 1 blok/Cycle Start; M00/M01 hold; H offset belum diisi = alarm. |
| Tool | ✅ Data-driven: dia/flute/overall dari tool table → geometri 3D. |
| Stock/fixture | ✅ Ukuran + posisi manual (top-center/top-corner/custom), auto-fit sebagai saran, template vise visual, marker WCS per-fixture berlabel. |
| Test | ✅ `npm test` — 38 unit test (golden file O20018 dari program nyata Jack). |
| Build | ✅ Vite dev/build/preview; deploy Vercel otomatis dari `main`. |

**Invarian yang wajib dijaga:**
1. Semua posisi internal koordinat MESIN (mm, Z-up). Renderer/stock/vise hanya membaca hasil. Jangan pernah menyimpan posisi work di `machine.x/y/z`.
2. Transform work→machine terjadi SAAT EKSEKUSI (`moveTarget`) — mengubah offset setelah load harus tetap menggeser jalur.
3. Blok yang men-alarm tidak boleh dieksekusi.
4. Parser tidak tahu state mesin; Simulator tidak parsing teks. Jangan mencampur.
5. Hindari logo/nama merek (Haas/Fanuc) — pakai "Haas-style" / "Fanuc-compatible".

## 2. Peta repo

```
index.html                  — panel + softkeys + DRO (id dipakai main.js)
src/main.js                 — app: wiring UI ↔ engine, stock setup, alarm panel
src/machine/MachineState.js — model mesin: WCS, home, travel, transform
src/machine/Parser.js       — teks G-code → stream entri (lihat header file)
src/sim/Simulator.js        — playback engine + alarm/crash/soft-limit
src/stock/VoxelStock.js     — voxel grid + mesh rebuild (throttle 80ms)
src/stock/fitStock.js       — auto-fit bounds dari titik mesin
src/view/Scene.js            — Three.js: scene, tool, vise, marker, toolpath
src/train.js                 — checklist training
tests/run.mjs                — unit test (node, tanpa framework)
```

Perintah: `npm run dev` (5173) · `npm run build` · `npm run preview` (4173) · `npm test`.
Static tanpa Node: `python3 -m http.server` (three via CDN importmap).

## 3. Peta viewport (yang sering ditanya)

Tiga triad sumbu = **bukan bug**: (1) **ORIGIN MESIN** (oranye, di meja) titik nol travel/DRO MACHINE; (2) **G54** (hijau, besar, di work zero aktif) referensi koordinat program/DRO WORK; (3) **G55** (hijau, kecil, default y=−90) work zero fixture kedua — muncul karena offsetnya ≠ 0. Marker WCS ikut pindah saat offset diedit (fitur, bukan efek samping).

## 4. Tahap berikutnya

### Tahap 5 — Panel data-driven (controller profile)
**Tujuan:** layout & tombol panel dari config, bukan hardcode HTML — fondasi Fanuc + SaaS kustomisasi.
- `src/controllers/haas-style.json`: daftar halaman, softkey per halaman, keypad, DRO mode (tambah **OPERATOR**), layout grid.
- Engine render panel dari JSON; mode EDIT/MEM/MDI/JOG nyata (MDI: ketik 1 blok → Cycle Start).
- CURNT CMDS (F2) jadi halaman sungguhan; alarm panel masuk sistem halaman.
**Selesai jika:** mengganti JSON mengubah panel tanpa sentuh JS; MDI bisa menjalankan `G0 X10`; DRO punya 4 mode.

### Tahap 6 — Interpreter realism
- G41/G42 cutter comp (implementasi, hapus alarm "not supported" di Parser.js).
- G84 tapping; arc di G18/G19; G4 dwell nyata (waktu simulasi); feed hold di tengah blok lalu resume; ramp spindle; animasi tool change (ATC).
**Selesai jika:** program kontur dengan kompensasi radius jalan benar vs manual offset; unit test + visual.

### Tahap 7 — Editor setup & fixture
- UI parameter vise (tinggi/lebar rahang, bukaan, posisi per WCS), multi-vise (G54 & G55 masing-masing).
- Preset material stok (warna/berbeda), prosedur touch-off semi-otomatis (edge finder).
**Selesai jika:** skenario 2 ragum O20018 menampilkan 2 vise + 2 stok terpisah yang masing-masing terpotong blok G54/G55-nya.

### Tahap 8 — Material removal v2
- Pindah cut + mesh ke **Web Worker**; evaluasi heightfield/dexel utk 3-axis (lebih ringan dari voxel); collision holder/shank (bukan hanya flute) = alarm.
**Selesai jika:** program besar (≥2000 gerakan) tetap 60fps; G00 dengan holder menabrak stok tinggi memunculkan alarm HOLDER CRASH.

### Tahap 9 — Fondasi SaaS
- Akun + multi-tenant; machine profile per institusi (travel, rpm, ATC, controller); pustaka program; **scenario builder + penilaian** (checklist otomatis, kesalahan tercatat: crash/offset salah/waktu); ekspor laporan.
**Selesai jika:** dua tenant melihat profil mesin berbeda; skenario training dinilai otomatis dengan skor.

### Tahap 10 (opsional) — PWA offline, layout tablet, i18n ID/EN.

## 5. Catatan handoff untuk AI harness lain

**Aman dilanjutkan AI lain** karena: kode modular dengan batas tugas jelas, 38 unit test sebagai jaring pengaman regresi, invarian tertulis (bagian 1), dan program uji nyata (O20018) tersedia.

**Urutan baca wajib:** `README.md` → dokumen ini → header `src/machine/Parser.js` (format entri) → `src/machine/MachineState.js` (model koordinat) → `src/sim/Simulator.js`.

**Aturan kerja:**
- Satu tahap per gelombang, commit kecil dengan pesan jelas; JANGAN rewrite engine/parser sekaligus.
- Setiap perubahan parser/simulator WAJIB diikuti unit test; `npm test` hijau sebelum commit.
- UI berubah → verifikasi headless (Playwright sudah devDep; pola: buka → klik → cek `#simStatus`/`#sbAlarm` → screenshot).
- Jangan kembalikan loader chunk `.txt` atau build statis salin-file — pipeline Vite sudah normal.

**Gotcha:**
- `G28 G91 Z0` sengaja membiarkan G91 modal (perilaku Fanuc asli) — jangan 'diperbaiki'.
- Preview toolpath meng-cap Z rapid di `zRef+15` (pilihan visual, `buildToolpathLines`).
- localStorage: `cnc-sim-wcs`, `cnc-sim-tools` — pertahankan backward compat.
- WCS default G55 = (0,−90,0) template fixture kedua; tombol Reset Default mengandalkan nilai ini.
- `machine.dtg` hanya diisi Simulator saat berjalan; jog meng-nol-kan.
- Estimasi `totalTime` parser kasar (tampilan saja); Simulator menghitung sendiri.

**Terakhir:** Jack hands-on — beri hasil yang bisa langsung dijalankan, hindari teori panjang. Push hanya setelah konfirmasi.
