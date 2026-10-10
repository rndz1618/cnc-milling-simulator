# SPEC — Tahap 6: Interpreter realism

Status: disetujui secara desain (chat), menunggu review spec sebelum implementation plan.
Target versi: 0.11.0. Bahasa kerja: Bahasa Indonesia, istilah teknis English.

Dokumen ini melengkapi `docs/PLAN-LANJUTAN.md` §Tahap 6. Invarian di
`AGENTS.md` dan `docs/PLAN-LANJUTAN.md` §1 tetap berlaku penuh:
posisi internal = koordinat MESIN, transform work→machine saat eksekusi,
blok yang men-alarm tidak dieksekusi, Parser stateless, Simulator tidak parsing.

---

## 1. Tujuan

Naikkan realisme interpreter dalam satu gelombang (keputusan Jack):

1. **G41/G42 cutter compensation** — offset radius tool nyata (hapus alarm "belum didukung").
2. **Arc G18/G19** — arc di plane XZ/YZ, bukan hanya G17.
3. **G4 dwell nyata** — waktu simulasi berhenti selama P detik.
4. **G84 tapping** — siklus rigid dengan pembalikan spindle.
5. **Feed hold mid-blok** — tombol FEED HOLD; Cycle Start melanjutkan dari titik berhenti.
6. **Spindle ramp + animasi ATC sederhana** — RPM naik/turun bertahap; M6 beranimasi.

## 2. Kriteria selesai

1. Program kontur dengan G41/G42 menghasilkan jalur ter-offset radius tool,
   benar dibanding path offset manual; G40 menutup kompensasi (lead-out).
2. `expandArc` menghormati plane G17/G18/G19 (endpoint & titik tengah geometris benar).
3. G4 P<n> menahan simulasi selama n detik (diskalakan `simSpeed`), lalu lanjut.
4. G84 mengemit feed masuk + pembalikan `spindleDir` 3→4 saat keluar → kembali 3.
5. Tombol FEED HOLD menghentikan di tengah blok tanpa reset `progress`; Cycle Start melanjutkan.
6. `machine.spindle` merambat menuju target dan mencapai target; ATC memicu animasi pada M6.
7. `npm test` hijau (unit test baru di atas) dan `npm run verify` hijau (test + build + smoke).

## 3. Pipeline & batas modul

Pipeline baru (semua di koordinat WORK, sebelum eksekusi):

```
parseGCode(text)
  → applyCutterComp(moves, { getRadius })   // src/machine/Compensator.js (baru, murni)
  → sim.loadMoves(moves)
  → computeMachineMoves()                    // moveTarget → koordinat MESIN (existing)
```

- **Parser** tetap murni/stateless; hanya menambah field/entry baru.
- **Compensator** modul murni baru; tidak tahu mesin, tidak menyentuh DOM.
- **Simulator** tetap tidak parsing teks; mengonsumsi entry baru.
- Transform work→machine tetap terjadi saat eksekusi (`moveTarget`) — comp jalan di WORK,
  jadi ubah offset WCS setelah load tetap menggeser jalur.

## 4. Batas yang sengaja (YAGNI — jadi komentar `shortcut:` di kode)

- Comp hanya plane **G17**; G18/G19 saat comp aktif → pesan status, tidak dikompensasi.
- Ubah tool table saat program termuat tidak auto-regenerate path comp → perlu Load ulang.
- ATC: animasi visual saja (angkat/tukar/turun tool mesh), bukan model magazine.
- Spindle ramp: linear ke target dengan time constant tetap; tanpa akselerasi per-sumbu.
- Feed hold: memanfaatkan `pause()` yang ada; tanpa model deselerasi sumbu.

---

## 5. Komponen & file

### 5.1 `src/machine/Parser.js` (diperluas)

**Cutter comp:**
- `KNOWN_G` sudah memuat 40/41/42 → hapus cabang alarm "belum didukung".
- Lacak modal `compSide` (`null` | `'left'` | `'right'`) dan radius via `D`.
- Parsing `D` (saat ini diabaikan): `nd` = nilai D. Bila tak ada, default = tool aktif saat itu.
- Emit entry baru saat G41/G42/G40 ditemui:
  ```
  { type:'comp', side:'left'|'right'|null, d, line, raw }
  ```
- Motion entries **tidak** diubah oleh comp di parser (comp diterapkan pass terpisah).

**Arc G18/G19:**
- Generalisasi `expandArc(x0,y0,z0,x1,y1,z1, i,j,k, r, cw, plane, segs)`.
- G17: pusat dari (I,J), Z interpolasi linear.
- G18: pusat dari (I,K), Y konstan; winding CW/CCW dari sudut pandang **+Y** (aturan tangan kanan = Fanuc; `u×v = +Y`).
- G19: pusat dari (J,K), X konstan; winding dari sudut pandang +X.
- R-form tetap didukung per-plane.

**G4 dwell:**
- Emit `{ type:'dwell', p:<detik>, line, raw }` (P dalam **detik**, fallback X detik).

**G84 tapping:**
- Tambah `84` ke `KNOWN_G`.
- Siklus tapping (masuk feed, balik spindle, keluar feed) lewat `spindleDir` per-move:
  - turun ke Z dengan `spindleDir` saat ini,
  - move keluar membawa `spindleDir` lawan (M3→4, M4→3),
  - move setelahnya kembali ke arah semula (modal `spindleDir` tak berubah).
- Alarm bila ada `Q` (G84 tidak boleh peck).

### 5.2 `src/machine/Compensator.js` (BARU, murni)

- `applyCutterComp(moves, { getRadius })` → array moves baru.
- Radius = `getRadius(d)` (pemanggil: `(d) => (toolTable[d]?.dia ?? 6) / 2`).
- Mengubah **hanya** entry `rapid`/`feed` ber-koordinat WORK
  (`home`, dan entry `machine:true`/G53 **tidak** dikompensasi).
- Offset **X/Y saja** (plane G17). Z diteruskan.
- Algoritma:
  1. Telusuri stream sambil melacak `compSide` aktif dari entry `comp`.
  2. Saat comp aktif, bangun polyline titik terprogram; offset tiap segmen
     sebesar ±radius pada normal (kiri/kanan sesuai side).
  3. Miter-join: di vertex dalam, interseksikan dua garis offset agar sudut rapi.
  4. **Engage** (transisi null→side): move pertama langsung ke titik ter-offset
     (lead-in alami dari posisi sebelumnya). **Cancel** (→null): move menuju titik
     terprogram (lead-out).
  5. Entry non-gerak (`tool`,`coolant`,`toolcomp`,`dwell`,`stop`,`alarm`,`comp`)
     diteruskan apa adanya, urutan dipertahankan.
- Bila `compSide` aktif tapi plane ≠ G17 → emit `{type:'alarm', ... 'CUTTER COMP HANYA G17'}`.

### 5.3 `src/machine/MachineState.js`
- Tambah `spindleTarget: 0` pada `createMachineState()`.

### 5.4 `src/sim/Simulator.js` (diperluas)

- **Timer tunggal** `this.timer` (detik) + `this.timerKind` (`'dwell'`|`'atc'`).
  - `_advanceEntries`: `dwell` → `timer=e.p, kind='dwell'`, index++, `return true`;
    `tool` → `onTool(e.tool)`, `timer=ATC_TIME, kind='atc'`, index++, `return true`.
  - Top `tick(dt)`: bila `timer>0` → `timer -= dt*simSpeed`, `elapsed += dt*simSpeed`,
    `onUpdate()`, `return` saat masih >0; lanjut ke move berikut saat habis.
  - `step()`: konsumsi timer instan (tambah ke `elapsed`) — single-block tak menggantung.
- **Spindle ramp:** `_applyMeta` set `machine.spindleTarget = m.spindle`, `spindleOn = target>0`
  (bukan set `spindle` langsung). Method `updateSpindle(dt)`: `machine.spindle` bergerak
  linear ke `spindleTarget` (time constant tetap ~1.5 s penuh); `spindleDir` tetap instan.
- **Feed hold:** `feedHold()` = `pause()` + `this.holdReason='feed'`; `play()` clear `holdReason`.
  `progress` tidak direset → resume mid-blok lewat `tick()` existing.
- Konstanta `ATC_TIME` (mis. 1.0 s).

### 5.5 `src/main.js`
- `loadProgram`: `parsed.moves` → `applyCutterComp(parsed.moves, {getRadius})` → `sim.loadMoves`.
- `animate()`: panggil `sim.updateSpindle(dt)` tiap frame (spin-up tetap terlihat saat idle).
- Wire `#btnFeedHold` → `sim.feedHold()`.
- `onTool`: picu `animateToolChange(toolMesh)` (animasi ATC visual).
- `updateStatusBar()`: tambah flag `FEED HOLD` saat `state==='hold' && holdReason==='feed'`.
- `updateActiveCodes()`/`#hdrSpindle`: tampilkan RPM aktual (`machine.spindle` ter-ramp).

### 5.6 `src/view/Scene.js`
- Helper `animateToolChange(toolMesh)`: angkat tool mesh ~15 mm (offset visual saja,
  koordinat mesin tak berubah), lalu turun lagi; sekali jalan.

### 5.7 `index.html` + `src/style.css`
- Tombol `FEED HOLD` pada baris transport simulasi.
- (Opsional) indikator RPM ramping di `#hdrSpindle` (sudah ada; cukup baca nilai ter-ramp).

---

## 6. Data flow

```
teks G-code
  → parseGCode        → moves (work coords) + entry comp/dwell/tool/spindleDir
  → applyCutterComp    → moves ter-offset (work coords)
  → sim.loadMoves
  → per frame: tick()      → konsumsi move (timer/dwell/ATC/spindleDir), transform WCS
  → per frame: updateSpindle(dt) → machine.spindle menuju target
  → Scene: tool mesh, stok terpotong, DRO turunan
```

## 7. Error handling

- Kode G tak dikenal → perilaku existing (alarm, blok tak dieksekusi).
- G84 dengan `Q` → alarm `G84 TANPA PECK`.
- Comp aktif di plane non-G17 → alarm/warning `CUTTER COMP HANYA G17`.
- `D` menunjuk tool tanpa data → pakai diameter default (6 mm), tak crash.
- Arc G18/G19 dengan parameter kurang → alarm parameter (pola existing).
- Timer/dwell dengan `P<=0` → dilewati (tidak menggantung).

## 8. Testing

`tests/run.mjs` (gaya existing, tanpa framework), tambahan:
1. Comp kotak `G41 D..`: bandingkan titik offset vs path offset manual (toleransi kecil).
2. Comp non-aktif → path identik dengan input.
3. G40 lead-out → titik akhir kembali ke titik terprogram.
4. Arc G18/G19: endpoint + satu titik tengah sesuai geometri.
5. G4 → entry `dwell` dengan `p` benar.
6. G84 → urutan `spindleDir` 3→4→3 pada move yang dihasilkan.
7. Simulator: dwell menahan lalu lanjut; feed hold mid-blok lalu resume menyelesaikan move;
   spindle ramp mencapai target.

`scripts/verify.mjs`: smoke headless existing tetap hijau; komponen UI baru (FEED HOLD)
dicek via `page.evaluate` (pola Tahap 5, karena actionability Playwright lambat di env ini).

## 9. File tersentuh

- `src/machine/Parser.js`
- `src/machine/Compensator.js` (baru)
- `src/machine/MachineState.js`
- `src/sim/Simulator.js`
- `src/main.js`
- `src/view/Scene.js`
- `index.html`, `src/style.css`
- `tests/run.mjs`, `scripts/verify.mjs` (bila perlu)
- `HANDOFF.md` (commit terakhir gelombang), `README.md`/`AGENTS.md` (bila hitungan test berubah)

## 10. Catatan versi & handoff

- Target versi **0.11.0**; commit terakhir gelombang WAJIB menyentuh `HANDOFF.md`.
- Gate per task: `npm run verify` hijau sebelum commit.
