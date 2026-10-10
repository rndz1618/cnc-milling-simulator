# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
commit: 76de9d0
status: v0.10.0 — UI shell data-driven: mode EDIT/MEM/MDI/JOG/SETUP, softkey & DRO dari profil JSON, action registry (config vs code)
verify: test 50/50 · build OK · smoke browser OK (shell dirender dari JSON; mode JOG/MDI/MEM; regresi MDI)
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 6** (interpreter realism): G41/G42 (cutter comp), G84 tapping, dwell nyata (G4), feed hold di tengah blok, G92.
2. Setelah itu: Tahap 7 (fixture editor) → 8 (removal v2) → 9 (SaaS).
## Catatan gelombang terakhir (2026-10-10)
- v0.10.0: `src/controllers/Panel.js` — `normalizeProfile` (murni, unit test) + renderer (`renderModeTabs`/`renderSoftkeys`/`renderDroTabs`/`renderSetupSubs`) + `loadController`. `main.js` boot async, `applyMode`/`applySetupSub`, delegasi klik (`#modeTabs`/`#softkeys`/`#setupSubs`/`#droTabs`), `ACTIONS` registry. Pane `#panelProgram`/`#panelSetup`/`#panelJog` via `data-pane`; editor/lines/mdi via `data-view`.
- Keputusan: **CONFIG = struktur/label/urutan/id/nama action; CODE = implementasi action**. Softkey tanpa action valid → no-op (aman). CURNT CMDS & ALARM **tetap overlay** (dipicu action), bukan pane.
- Profil JSON dipindah ke `public/controllers/haas-style.json` supaya ikut ter-`fetch` di build produksi (sebelumnya `./src/...` hanya ada saat dev). Fallback aman ke `DEFAULT_PROFILE` bila fetch gagal.
- Smoke mengecek: 5 mode, 4 DRO, 8 softkey dari JSON, transisi pane JOG/MDI/MEM, CURNT CMDS live, regresi MDI (1 blok). Cek dipindah ke `page.evaluate` (GL software di mesin ini membuat `page.click` lambat/timeout).
- Meta: commit kecil per task; push ke `main` hanya setelah konfirmasi Jack.
