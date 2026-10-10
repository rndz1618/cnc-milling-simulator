# HANDOFF.md — state gelombang terakhir
> File ini sengaja SINGKAT dan di-update di akhir setiap gelombang development
> (aturan di AGENTS.md §Alur kerja). Pengetahuan yang tahan lama ada di
> docs/PLAN-LANJUTAN.md dan komentar kode — jangan duplikasi di sini.
commit: 3c277aa
status: v0.11.0 — interpreter realism: cutter comp G41/G42, arc G18/G19, G4 dwell nyata, G84 tapping, feed hold mid-blok, ramp spindle + animasi ATC (+ perbaikan review)
verify: test 92/92 · build OK · smoke browser OK (shell JSON + FEED HOLD flag + RPM aktual)
## Sedang berjalan
- (tidak ada)
## Berikutnya
1. **Tahap 7** (fixture editor): UI parameter vise (tinggi/lebar rahang, bukaan, posisi per WCS), multi-vise G54 & G55, preset material + touch-off semi-otomatis.
2. Setelah itu: Tahap 8 (removal v2) → 9 (SaaS).
- Ditunda dari Tahap 6: **G92** (work coordinate shift) — di luar scope v0.11.0 (spec §4).
- Known issues comp (minor, kandidat v0.11.1): `G4 X` di G20 pakai X ter-konversi unit; spasi-pause tak set `holdReason`; akuntansi `elapsed` ATC; miter tak di-clamp; G28 stale pos di Compensator.
## Catatan gelombang terakhir (2026-10-10)
- v0.11.0: kompensasi radius via pass murni `src/machine/Compensator.js` (`applyCutterComp(moves, {getRadius})`) dipanggil di `main.js` `loadProgram`; offset X/Y saja (G17), sambungan miter + lead-in/out dari posisi tool nyata. Entry `comp` (+parsing `D`) & `dwell` baru dari Parser; arc kini plane-aware (`expandArc` G17/G18/G19; winding = `u×v` = aturan tangan kanan, G18 dari +Y = Fanuc); G84 rigid (feed masuk + `spindleDir` 3→4 saat keluar, alarm bila `Q`).
- Simulator: timer tunggal (`this.timer`/`timerKind` dwell|atc, `ATC_TIME=1.0`) menahan dwell & ganti tool; `feedHold()` = `pause()` + `holdReason='feed'` (resume via `play()`); `_applyMeta` set `spindleTarget` (bukan `spindle`), `updateSpindle(dt)` ramp linear ~1.5 s ke target — `machine.spindle` tetap koordinat mesin, ramp hanya tampilan.
- UI: `#btnPause` → `sim.feedHold()`, flag **FEED HOLD** di `updateStatusBar`, `animate()` memanggil `sim.updateSpindle(dt)`, `onTool` → `Scene.animateToolChange(toolMesh)` (angkat-turun ~15 mm, murni visual via `userData.liftZ`).
- **Pasca-review (commit `ecf21d8`, `3c277aa`)**: `_advanceEntries` mengonsumsi entry `comp`; timer habis lanjut lewat `_advanceEntries` (cegah NaN saat `G41`/`G4`/`M6` dan M00 tak terlewat); Compensator pertahankan offset pada gerak tanpa perpindahan XY (plunge/retract tak gouge ke kontur mentah); Parser alarm bila ganti plane ke non-G17 saat comp aktif. Spec §5.1 diperbaiki (−Y → +Y).
- Gate: `npm test` (92/92) + `npm run verify`. Commit kecil per task; push ke `main` hanya setelah konfirmasi Jack.
