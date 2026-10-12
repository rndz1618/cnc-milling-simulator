# SPEC — Tahap 9 (slice-1): Profil, Pustaka Program, Feedback Latihan — OFFLINE

> **CATATAN (2026-10-11):** Tahap 9 (fondasi SaaS) akan dikerjakan di **repo/proyek TERPISAH**,
> bukan di repo simulator ini (lompatan arsitektur besar: backend/auth/multi-tenant).
> Dokumen ini disimpan sebagai bahan desain yang dibawa ke repo baru. **Bukan scope repo ini.**

Status: rancangan disetujui (2026-10-11). Belum diimplementasikan.
Catatan: backend/auth/multi-tenant ditunda ke slice berikutnya (lihat §12).

## 1. Tujuan

Fondasi "SaaS" dikerjakan **offline dulu** (client-side, tanpa server): profil mesin per institusi, pustaka program, dan perekam latihan + feedback otomatis. Model data dirancang agar mulus saat backend ditambahkan kemudian.

Mode penilaian: **latihan mandiri + feedback** (tanpa kunci jawaban / bank soal).

## 2. Ruang lingkup & non-goals

**In scope:** profil mesin editable + impor/ekspor JSON; pustaka program; perekam sesi + feedback + ekspor laporan.
**Non-goals:** auth, multi-tenant server, cloud sync/sharing, peran guru/siswa, kunci jawaban ujian, replay penuh.

## 3. Invarian yang dijaga

Semua invarian proyek (§1 PLAN-LANJUTAN): posisi internal = koordinat MESIN; transform di eksekusi; blok alarm tak dieksekusi; Parser stateless; hindari nama merek.

## 4. Modul (batas tugas jelas, mudah di-test)

```
src/profile/MachineProfile.js  — model + validate + serialize/parse; apply ke MachineState/controller
src/profile/presets.js         — preset bawaan (di-bundle, bukan localStorage)
src/library/ProgramLibrary.js  — CRUD program + impor/ekspor
src/session/SessionLog.js      — ring buffer sampel + event diskrit
src/session/feedback.js        — rules → findings + skor (fungsi murni)
src/session/report.js          — ekspor laporan (JSON + HTML siap cetak)
```

Modul-modul ini **murni** dan menerima objek storage yang di-inject (default `localStorage`), agar dapat di-unit-test di Node tanpa DOM.

## 5. Profil mesin (`MachineProfile`)

```
{ id, nama, institusi, controller,           // controller = id profil panel (mis. 'haas-style')
  travel: { x:[min,max], y:[min,max], z:[min,max] },
  spindle: { maxRpm, rampMs? },
  atc: { maxTools },
  defaults: { wcs: { G54:[x,y,z], ... }, tools: [...] } }
```
- `validate(p)` — range & wajib isi. `serialize`/`parse` round-trip JSON. `applyTo(machineState, controller)`.
- **Storage:** `cnc-sim-profiles` (daftar) + `cnc-sim-active-profile` (id).
- **UI (sub-tab PROFIL):** pilih preset, buat/edit/hapus, impor/ekspor JSON (satu atau semua).

## 6. Pustaka program (`ProgramLibrary`)

```
{ id, nama, wcs?, text, createdAt, updatedAt, tags? }
```
- **Storage:** `cnc-sim-programs`.
- **UI (sub-tab PUSTAKA):** daftar; LOAD ke editor/program aktif (reuse alur `loadProgram` yang ada); ubah nama/hapus; impor `.nc`/`.txt`; ekspor satu/semua.

## 7. Perekam sesi (`SessionLog`)

- `start()`/`stop()`.
- `sample({t, x,y,z, spindle, tool, feedOverride})` dipanggil dari loop `animate` **hanya saat sesi aktif**, throttle ~10 Hz.
- `event({t, type, data})` untuk: `ALARM`, `RAPID_CRASH`, `SOFT_LIMIT`, `FEED_HOLD`, `RESET`, `M00_STOP`, `TOOL_CHANGE`, `PROGRAM_END` — disalurkan dari hook yang sudah ada di `Simulator`/panel alarm.
- Ring buffer dibatasi (mis. 12.000 sampel) → `stats()`: elapsed, jarak, maxRpm, jumlah event.

## 8. Feedback (`feedback.js`) — murni

`evaluate(session) → { score, findings[] }`.
- `findings`: `{ id, rule, severity: 'high'|'med'|'low', title, detail, t }`.
- Rules awal (hanya yang bisa diamati mesin): crash/RAPID_CRASH (high); soft-limit/alarm (med); feed dengan spindle mati (med); jumlah RESET; lonjakan feed override; durasi.
- Skor: mulai 100, potong high −25 / med −10 / low −3, lantai 0.
- **Non-goals:** penilaian ber-kunci; SOP yang tak bisa diamati mesin tidak dinilai.

## 9. Laporan (`report.js`)

`buildReport(session, findings, score) → { meta, score, findings[], stats }`.
- Ekspor **JSON** (unduh) + **HTML siap cetak** (PDF via Ctrl-P). Teks di-escape via `escapeHtml` (`src/util/html.js`, dari H1).

## 10. UI

- Sub-tab baru **PROFIL** dan **PUSTAKA** (konvensi sub-tab yang ada: STOCK/FIXTURE).
- Panel **LAPORAN** muncul setelah `PROGRAM_END`/RESET: skor besar + daftar temuan (severity berwarna) + tombol Ekspor JSON / Cetak.

## 11. Testing

- `feedback.js` (murni): crash → temuan + skor turun; run bersih → 100; kombinasi severity.
- `SessionLog`: cap ring buffer, urutan & penyaringan event.
- `MachineProfile`: validate menolak range salah; serialize/parse round-trip; `applyTo` set travel/rpm.
- `ProgramLibrary`: CRUD pada storage palsu; impor/ekspor round-trip.
- `report.js`: struktur + escape HTML.
- Smoke (verify): satu run kecil → panel LAPORAN punya skor; sub-tab PROFIL/PUSTAKA render.

## 12. Jalur ke slice backend (ke depan, bukan scope sekarang)

- Model sudah JSON-serializable → nanti dipetakan ke tabel/tenant di server tanpa mengubah bentuk data.
- `MachineProfile` per institusi → baris `tenant`+`machine_profile`; `ProgramLibrary` → tabel program; `report` → arsip sesi.
- Auth & sinkronisasi ditambahkan sebagai lapisan di atas modul yang sama (inject storage → ganti dengan adapter API).

## 13. Non-goals eksplisit

Auth, server, sharing, peran pengguna, bank soal ujian, kunci jawaban, grading berbasis jawaban benar, cloud sync.
