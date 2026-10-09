# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
commit: (diisi saat commit gelombang)
status: v0.9.3 — fix CURNT CMDS live; Tahap 5: DRO 4 mode, tab MDI, CURNT CMDS (F2), controller profile JSON
verify: test 41/41 · build OK · smoke browser OK (cek CURNT CMDS terbuka + live update saat run)
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 5 lanjutan / Tahap 6**: render seluruh panel (keypad/mode EDIT-MEM-MDI-JOG) dari JSON controller; lalu lanjut Tahap 6 (interpreter realism: G41/G42, G84, dwell nyata, feed hold di tengah blok).
2. Setelah itu: Tahap 7 (fixture editor) → 8 (removal v2) → 9 (SaaS).
## Catatan gelombang terakhir (2026-10-09)
- v0.9.3: bug ditemukan Jack — CURNT CMDS statis. Kode gerak (`g`: 0/1/2/3) kini ditandai di Parser, diteruskan Simulator `_applyMeta`, dan panel di-render ulang tiap tick di `refreshUI`. Smoke mengecek sebelum≠sesudah run.
- v0.9.2: halaman CURNT CMDS (F2); smoke mengecek panel terbuka & berisi.
- v0.9.1: DRO 4 mode (OPERATOR & DTG), tab MDI (jalankan 1 blok), softkey label dari JSON.
- Meta: AGENTS.md + scripts/verify.mjs ter-commit; .github/workflows/ di-gitignore (token tanpa scope workflow).
- Baseline hijau. Invarian koordinat mesin terjaga.
