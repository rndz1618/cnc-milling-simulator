# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
commit: d5ec437
status: v0.12.0 — fixture editor: multi-fixture per WCS (maks 6), vise ber-parameter, preset material, skenario bernama (localStorage), wizard touch-off edge-finder → WCS
verify: test 121/121 · build OK · smoke browser OK (shell JSON + FEED HOLD + RPM + FIXTURE/scenario + wizard touch-off)
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 8** (material removal v2): pindah cut + mesh ke Web Worker; heightfield/dexel utk 3-axis; collision holder/shank → alarm HOLDER CRASH.
2. Setelah itu: Tahap 9 (fondasi SaaS: multi-tenant, scenario builder + penilaian) → 10 (PWA/i18n).
- Ditunda dari Tahap 6: **G92** (work coordinate shift) — di luar scope v0.11.0 (spec §4).
- Kandidat v0.12.1 (minor Tahap 6): `G4 X` di G20 pakai X ter-konversi unit; spasi-pause tak set `holdReason`; akuntansi `elapsed` ATC; miter tak di-clamp; G28 stale pos di Compensator.
## Catatan gelombang terakhir (2026-10-11)
- Engine multi-stok: `src/machine/Fixtures.js` (model fixture + `MATERIALS` + `stockOriginFor` + `normalizeFixtures` + `serializeScenario`/`parseScenario`) & `src/sim/FixtureManager.js` (`Map<wcs,VoxelStock>` + vise ber-parameter + `frameBounds`/`remainingRatio`). `Simulator` punya `resolveStock(wcs)`/`onResetStocks` → tiap WCS memotong stok sendiri (bukan voxel gabungan).
- UI: sub-tab STOCK → **FIXTURE** (`index.html` `#setupFixture`, `#fixtureList` baris per fixture). Skenario disimpan di `localStorage` `cnc-sim-scenarios` (layout + program + WCS + tool). `main.js`: `fixtureState` (array fixture) + `rebuildFixtures` + `applyFixtureLayout`; `applyStockSetup` kini memperbarui fixture G54 (jalur auto-fit/legacy).
- Wizard touch-off: `src/machine/TouchOff.js` (`EDGES`, `edgePlane`, `contactOffset`, `checkContact`, `surfaceCoord`) dipakai overlay `#touchoffOverlay` (PROBE ke kontak → SET WCS menulis `machine.wcs[wcs][axis]`).
- Golden test 2-ragum O20018 (dua fixture G54/G55, dua stok terpotong independen) + smoke browser FIXTURE/scenario & wizard.
- Gate: `npm test` (121/121) + `npm run verify`. Commit kecil per task; push ke `main` hanya setelah konfirmasi Jack.
