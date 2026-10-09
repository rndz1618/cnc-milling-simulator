# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
commit: b90f07c
status: v0.9.2 — Tahap 5: DRO 4 mode, tab MDI, CURNT CMDS (F2) sebagai halaman, controller profile JSON
verify: test 38/38 · build OK · smoke browser OK (termasuk cek halaman CURNT CMDS)
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 5 lanjutan / Tahap 6**: render seluruh panel (keypad/mode EDIT-MEM-MDI-JOG) dari JSON controller; lalu lanjut Tahap 6 (interpreter realism: G41/G42, G84, dwell nyata, feed hold di tengah blok).
2. Setelah itu: Tahap 7 (fixture editor) → 8 (removal v2) → 9 (SaaS).
## Catatan gelombang terakhir (2026-10-09)
- v0.9.2: halaman CURNT CMDS (F2) menampilkan kode G/M aktif (motion, plane, units, WCS, tool, spindle, coolant, feed); smoke browser mengeceknya.
- v0.9.1: DRO 4 mode (OPERATOR & DTG), tab MDI (jalankan 1 blok), softkey label dari JSON.
- Meta: AGENTS.md + scripts/verify.mjs + .github/workflows/ci.yml ikut ter-commit (gerbang verify + aturan handoff).
- Baseline hijau (38/38). Invarian koordinat mesin terjaga.
