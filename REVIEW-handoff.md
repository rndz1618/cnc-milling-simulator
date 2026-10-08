# Review Kode — cnc-milling-simulator v0.8.0 (main, 8 Okt 2026)

Review terhadap `main` setelah clone, diverifikasi dengan pembacaan seluruh `src/` + smoke test Node (Parser dijalankan langsung dengan program O20018 dari handoff).

## TL;DR

Enam temuan handoff: **5 terkonfirmasi** (3 dengan root cause berbeda dari dugaan), **1 sebagian sudah diperbaiki**. Ditemukan **2 bug baru yang lebih serius** dari daftar handoff: (1) baris bernomor `N…` menelan sisa program secara diam-diam, (2) canned cycle `G81` dieksekusi sebagai rapid biasa yang menabrak material. Repo sendiri punya masalah maintainability: aplikasi asli tersimpan sebagai 7 file chunk `.txt` yang di-fetch dan digabung saat runtime.

Catatan penting: dokumen handoff menganalisis screenshot **v0.6.1**, tapi `main` sekarang **v0.8.0** — beberapa keluhan sudah setengah dibereskan (alarm panel, G2/G3, tool auto-apply, badge T3, localStorage WCS/Tool).

---

## 1. Kondisi repo (tidak lazim, perlu dirapikan dulu)

**Aplikasi hidup = 7 file `.txt` yang digabung saat runtime.**
`index.html` → `src/main.js` (chunk loader) → fetch `main_body_a1.txt`, `main_body_a2.txt`, `main_bb0..bb4.txt`, di-concatenate, import di-rewrite ke CDN Three.js, lalu disuntikkan sebagai `<script type="module>` (src/main.js:8-40). Ini tampaknya artefak batasan ukuran file agent sebelumnya (lihat pesan commit "main_bb1", "main_bb2", …).

Konsekuensi:
- Satu syntax error di satu chunk = seluruh app mati, dan nomor baris di stack trace tidak bermakna (7 file di-join).
- `npm run build` (scripts/build-static.mjs) hanya menyalin file — Vite yang terpasang tidak dipakai untuk bundling.
- Sulit di-test, sulit di-diff per modul.

**File mati yang tidak di-load siapa pun:** `src/v06.js`, `src/main_body_a.txt`, `src/main_part_a.txt`, `src/main_part_b.txt`, `src/chunks/s0.txt` (diverifikasi: tidak ada referensi dari rantai hidup).

**Rekomendasi tahap 0:** gabungkan 7 chunk kembali menjadi modul `.js` normal (atau jalankan lewat Vite seperti semula), hapus file mati, samakan README (masih v0.7.0) dan `package.json` version. Tanpa ini, semua perbaikan berikutnya menyusah.

---

## 2. Verifikasi 6 temuan handoff terhadap kode

### Temuan 1 — Posisi tool 3D vs DRO → **TERKONFIRMASI (root cause: tidak ada koordinat mesin sama sekali)**

Dugaan handoff (G54/G43 tidak konsisten antara interpreter dan renderer) keliru arah. Yang sebenarnya: **tidak ada ruang koordinat mesin** — `machine.x/y/z` LANGSUNG berisi koordinat WORK (src/machine/MachineState.js:4-9, komentar resminya sendiri begitu). Akibatnya:

- Tool dirender di work coords (Scene.js:163-165) — konsisten dengan DRO WORK, tapi TIDAK pernah digeser G54/G55.
- Offset G54 hanya dipakai untuk menampilkan DRO mode MACHINE: `machine = work + g54 + toolLength` (MachineState.js:38-45). Ganti nilai offset di tabel → DRO MACHINE berubah, tapi 3D, stock, dan toolpath diam total.
- `G43 H03` tidak berlaku: parser tidak punya case `H`/`D` sama sekali (Parser.js:161-180) — kata H03/D03 dibuang diam-diam. `toolLength` hanya menambah Z di DRO MACHINE, tidak ke renderer.
- `updateWorkCoords` diimpor tapi tidak pernah dipanggil; `dtgX/Y/Z` diinisialisasi dan tidak pernah dihitung.

Ini kebalikan dari arsitektur target handoff ("satu sumber kebenaran: semua dalam koordinat mesin"). Perbaikan Tahap 1 = membangun ulang model ini, bukan menambal renderer.

### Temuan 2 — Stock tidak terikat ke work zero → **TERKONFIRMASI**

Stock bukan entitas setup, melainkan fungsi dari toolpath: `boundsFromMoves` (src/stock/fitStock.js:5-101) menghitung bounding box dari titik-titik potong lalu menaruh stock di sana — **top selalu dipaku di Z=0** (fitStock.js:60-62), XY = min/max potong ± (toolRadius + 5). Marker work zero fix di titik dunia (0,0,0) (Scene.js:167-186).

Jadi hubungan work-zero ↔ stock arbitrer dan berubah tiap program di-load. Tidak ada UI untuk mengatur ukuran/posisi stock manual (kewajiban kustomisasi stock di handoff bagian 8.4 belum ada; hanya checkbox Auto-fit + Fit Now). Klem/vise belum ada sama sekali.

### Temuan 3 — Tool tidak sesuai program → **SEBAGIAN SUDAH DIPERBAIKI di v0.8**

Yang sudah baik:
- `toolTable[3].dia = 12` — cocok dengan komentar `(VHM D12MM)`.
- `loadProgram` otomatis meng-applied tool pertama dari program (badge T3 benar sekarang; ini fix v0.8.0 "index badge T3 fix").
- `setToolDiameter` membangun ulang mesh — ganti Ø6 → Ø12 mengubah model secara proporsional (kriteria Tahap 2 terpenuhi secara ukuran).

Yang masih salah: geometri tool **prosedural, bukan data** (Scene.js:79-141). Flute length di-cap `min(30, …)` (Scene.js:84) dan shank `min(40, …)` (Scene.js:103) — end mill D12 jadi flute 30/shank 26 mm, tidak ada hubungan dengan tool asli (VHM D12 flute ±38 mm, overall jauh lebih panjang). Kolom `length` di tool table tidak pernah memengaruhi geometri 3D. Belum ada holder profile/flute length/overall length di data (handoff Tahap 2 belum jalan).

### Temuan 4 — Multi-fixture G54/G55 → **TERKONFIRMASI (lebih parah dari dugaan "motong udara")**

Parser mencatat WCS hanya sebagai label meta per move (Parser.js:190), Simulator hanya menyalin label ke `machine.activeWcs` (Simulator.js:100) — **koordinat tidak pernah ditransformasi**. Bukti runtime (smoke test O20018): blok G54 dan G55 sama-sama menghasilkan `X-87` di ruang koordinat yang sama (y=13.2 dan y=−22), dan auto-fit lalu menggabungkan extent kedua fixture menjadi **satu stock**. Jadi operasi G55 menimpa area G54 — bukan sekadar memotong udara. Fix mensyaratkan model machine-coords dari Temuan 1.

### Temuan 5 — Parser (bare decimal, G119) → **SEBAGIAN SUDAH DIPERBAIKI, eksekusi tidak berhenti**

Hasil smoke test dengan O20018 persis dari handoff (23 moves, alarm G119 line 31):
- ✅ `Z.` → 0: `parseAxisNum` menangani `.`, `+.`, `-.` (Parser.js:81-86). Move ke Z0 dihasilkan benar.
- ✅ G119 memunculkan alarm dengan nomor baris (Parser.js:191-193, `KNOWN_G` whitelist).
- ❌ Tapi blok yang men-alarm **tetap dieksekusi**: `G00 G90 G119 X0 Y0` tetap menghasilkan move rapid ke X0 Y0. Di mesin asli, alarm = eksekusi berhenti sampai reset. Alarm di sini hanya pesan status; Cycle Start terus jalan.
- ❌ `G43 Z. H03 D03 M08`: Z benar, tapi G43/H/D diabaikan tanpa warning.
- ❌ `G28 G91 Z0`: G28 tidak menggerakkan apa pun (tidak ada home), dan G91 **bocor menjadi modal** ke baris berikut — baris tanpa G90 setelahnya akan salah dibaca incremental. (Kebocoran G91 realistis di Fanuc, tapi karena G28-nya sendiri palsu, kombinasi ini menyesatkan.)

### Temuan 6 — UI → **TERKONFIRMASI**

- Layout terpotong: grid utama kolom fix `300px 1fr 280px` + `overflow: hidden` di panel dan body (style.css:88, 96, 27) — teks seperti "PROGRAM"/"MACHINE" terpotong pada resolusi tertentu, tidak ada min-width/clamp responsif.
- DRO hanya WORK/MACHINE (index.html:185-187). Haas asli: OPERATOR / WORK / MACHINE / DIST-TO-GO. Field DTG sudah disiapkan di state tapi tidak pernah dihitung/ditampilkan.
- F2 "CURNT CMDS" hanya mengganti pesan status bar — belum ada halaman perintah aktif sungguhan.
- F6 COOLANT hanya toggle label; `machine.coolant` tidak pernah di-set.

---

## 3. Temuan baru (tidak ada di handoff, dua di antaranya kritis)

1. **[KRITIS] Baris `N…` menelan program.** Parser menganggap SEMUA baris berawalan `N` sebagai awal definisi local subprogram dan membuang baris-baris berikutnya sampai ketemu M99 (Parser.js:18-26 dan 49-56). Tes: program `N10 G0 X10` + `G1 X20 F100` + `M30` → **0 move, tanpa alarm**. Program Fanuc/Haas produksi sering memakai N-numbering → seluruh program hilang diam-diam.
2. **[KRITIS] G81–G89 diterima tapi tidak dieksekusi sebagai canned cycle.** Tes: `G81 X10 Y10 Z-5 R2 F100` menghasilkan satu move **rapid** ke Z−5 — pada mesin asli itu serangkaian gerakan rapid-R, feed-in, rapid-out. Di simulator ini justru menabrak material dengan rapid tanpa alarm.
3. **G20 (inch) tidak dikonversi** — program inch dibaca sebagai mm (angka 10 tetap 10). Minimal harus ada alarm "inch mode not supported".
4. **Rapid (G00) tidak pernah memotong dan tidak ada collision check** (Simulator.js:144-146 hanya `type === 'feed'` yang cut) — G00 menembus stock tidak menghasilkan alarm crash, padahal ini persyaratan "work experience" (kesalahan harus terlihat).
5. **Soft limit tidak menghentikan apa pun** — `checkSoftLimits` hanya menulis alarm ke panel; simulasi terus berjalan keluar travel.
6. **Single Block mematikan playback sepenuhnya** (Simulator.js:104 `if (singleBlock) return`) — Cycle Start tidak bereaksi; hanya tombol Step yang jalan. Perilaku benar: eksekusi satu blok lalu Feed Hold otomatis.
7. **M00/M01 (program stop / optional stop) diabaikan** — di O20018, `M01` antara dua fixture seharusnya memberi kesempatan ganti setup; di sini kedua fixture jalan menyambung.
8. WCS G57–G59 diterima parser tapi tidak ada di tabel UI (hanya G54–G56).

---

## 4. Yang sudah lebih maju dari asumsi handoff

Supaya tidak dikerjakan dua kali — README/screenshot handoff berbasis v0.6.1, `main` sudah v0.8.0:

- G02/G03 (IJK dan R, G17) sudah diimplementasikan dan di-expand jadi segmen linear (Parser.js:95-141) — item "bertahap tambah G02/G03" sudah sebagian jalan.
- Progressive trail + live segment + GRAPH preview (F4) sudah ada.
- Alarm panel (F3) dengan riwayat, tombol clear, sudah ada.
- WCS + tool table persist ke localStorage.
- Tool auto-apply dari program + badge T3 sudah fix.
- M97 local subprogram (dialek Haas) sudah didukung (dengan gotcha N-line di atas).

---

## 5. Rekomendasi urutan kerja (menyesuaikan urutan handoff)

0. **Rapikan repo** (gabung chunk `.txt` → modul `.js`, hapus file mati) — prasyarat semua diff berikutnya bisa direview.
1. **Tahap 1 — sistem koordinat**: pindahkan sumber kebenaran ke machine coords (machine = work + offset; DRO/render/stock/toolpath derive dari satu state). Sekaligus menyelesaikan temuan 1, 2, dan 4 (G55 tinggal membaca offset dari tabel yang sama). Implementasikan G43 H dan G28 yang sebenarnya.
2. **Tahap 2 — tool data-driven**: flute/overall/holder di tool table → geometri renderer; hapus cap procedural.
3. **Tahap 3 — parser hardening + unit test** (golden file O20018): fix N-line, alarm menghentikan eksekusi (state HALT sampai RESET), ekspansi/penolakan G81+ dengan alarm, konversi/penolakan G20, G28+G91 tanpa efek samping palsu. Ini tempat dua bug kritis diperbaiki.
4. **Tahap 4 — fixture & vise template + stock custom** (setelah model koordinat ada).
5. **Tahap 5 — panel data-driven** + DRO 4 mode (OPERATOR/WORK/MACHINE/DTG) + layout responsif.

Kriteria selesai per tahap di handoff bagian 6 tetap berlaku dan sudah spesifik cukup untuk dipakai sebagai test.
