# AGENTS.md — aturan kerja untuk AI harness (dibaca otomatis saat session start)

Proyek: web app simulator CNC milling edukasi (target SaaS). Pemilik: Jack (solo builder, hands-on).
Bahasa kerja: **Bahasa Indonesia**, istilah teknis boleh English. Hindari nama/logo merek (pakai "Haas-style", "Fanuc-compatible").

## Mulai di sini (urutan wajib)

1. Baca `HANDOFF.md` — status gelombang terakhir + tugas berikutnya.
2. Baca `docs/PLAN-LANJUTAN.md` — invarian arsitektur, peta repo, tahap 5–10, gotcha.
3. `npm install` lalu `npm run verify` — harus hijau SEBELUM mulai mengubah apa pun.

## Perintah

- `npm run dev` — dev server (5173)
- `npm test` — unit test (38 kasus, golden file O20018)
- `npm run verify` — test + build + smoke browser headless (gerbang satu perintah)
- `npm run build` / `npm run preview` — build produksi / serve dist

## Invarian (JANGAN dilanggar)

1. Satu sumber kebenaran koordinat: posisi internal = **koordinat MESIN** (mm, Z-up). `machine = work + offset WCS`. Renderer/stock hanya membaca.
2. Transform work→machine terjadi saat eksekusi (`moveTarget`) — ubah offset setelah load harus menggeser jalur.
3. Blok yang men-alarm TIDAK dieksekusi.
4. Parser tidak tahu state mesin; Simulator tidak parsing teks.
5. `G28 G91 Z0` sengaja membiarkan G91 modal (perilaku Fanuc asli) — jangan "diperbaiki".

## Alur kerja per gelombang

1. Satu tahap (atau sub-fitur kecil) per gelombang; commit kecil, pesan jelas.
2. Setiap perubahan parser/simulator WAJIB diikuti unit test; UI berubah → verifikasi browser headless (Playwright sudah devDep).
3. `npm run verify` hijau sebelum commit.
4. **Sebelum mengakhiri gelombang: update `HANDOFF.md`** (status, commit, tugas berikutnya) — commit terakhir gelombang HARUS menyentuh file itu; CI menolak push ke `main` yang tidak (kecuali pesan commit memuat `[skip-handoff]`).
5. Push hanya setelah konfirmasi Jack (kecuali Jack sudah memberi standing approval).

## Berhenti & eskalasi

Kalau `npm run verify` merah di awal session → jangan lanjut mengubah kode; laporkan ke Jack (baseline rusak, bukan tugasmu menambalnya diam-diam).
