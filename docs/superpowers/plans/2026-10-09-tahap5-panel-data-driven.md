# Tahap 5 lanjutan: UI Shell data-driven — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab mode, softkey, dan mode DRO dirender dari satu controller JSON; tambah mode MEM dan JOG nyata.

**Architecture:** Satu file profil JSON (`src/controllers/haas-style.json`) jadi sumber config. Modul baru `src/controllers/Panel.js` memvalidasi profil (fungsi murni `normalizeProfile`) dan merender DOM (kembalikan `data-*` yang dipakai wiring + test). `src/main.js` memakai *event delegation* pada container agar render-ulang aman, plus `applyMode()` generik yang men-toggle `[data-pane]`/`[data-view]`. Parser/Simulator/koordinat mesin tidak disentuh.

**Tech Stack:** Vanilla JS ES module, Vite, Three.js, playwright headless (dev).

**Spec:** `docs/SPEC-tahap5-panel-data-driven.md`

## Global Constraints

- Bahasa kerja komentar/dokumen: **Bahasa Indonesia**; istilah teknis boleh English.
- Hindari nama/logo merek (pakai "Haas-style").
- Invarian: posisi internal = koordinat mesin; Parser tidak parsing state; Simulator tidak parsing teks. **Jangan sentuh** `Parser.js`/`Simulator.js`/`MachineState.js` di gelombang ini.
- Pertahankan id/class yang dipakai test & smoke: `#cmdsPanel`, `#cmdsPanelBody`, `#btnPlay`, `.gline`, `.sk[data-sk]`, `.ovr-btn[data-sim]`, `#simStatus`, `#stockLeft`, `#modeTabs`, `#droTabs`, `#softkeys`, `#gcodeLines`.
- Versi rilis gelombang: **0.10.0**.
- Gerbang tiap task: `npm run verify` hijau sebelum commit (test + build + smoke).
- Commit kecil; commit terakhir gelombang WAJIB menyentuh `HANDOFF.md`.

## Review Focus

1. JSON gagal dimuat (404/rusak/offline) → app tetap jalan memakai markup default `index.html`, bukan layar kosong.
2. `action` tak dikenal di JSON → no-op + pesan status, bukan crash saat klik softkey.
3. Render-ulang tab (mode/DRO) tidak boleh memutus handler klik → dipakai event delegation.
4. Entri `softkeys` dengan `f` di luar 1–8 atau duplikat → di-clamp/dedupe aman.
5. Default mode `mem` → `#gcodeLines` terlihat, editor tersembunyi, tanpa perlu klik.

---

### Task 1: Profil JSON + `normalizeProfile` (murni) + unit test

**Files:**
- Modify: `src/controllers/haas-style.json`
- Create: `src/controllers/Panel.js`
- Modify: `tests/run.mjs`

**Interfaces:**
- `src/controllers/Panel.js` mengekspor:
  - `DEFAULT_PROFILE` — objek konstan `{ name, default, modes, droModes, softkeys, setupSubs }`.
  - `normalizeProfile(raw)` → objek bentuk sama, selalu tervalidasi (tanpa DOM).
- Bentuk entri: `modes:[{id,label,pane,view?}]`, `droModes:[{id,label}]`, `softkeys:[{f,label,action}]`, `setupSubs:[{id,label}]`.

- [ ] **Step 1: Perluas `src/controllers/haas-style.json`** persis seperti Spec §4.1 (kunci `version`, `default:"mem"`, `modes` 5 entri, `droModes` 4, `setupSubs` 3 tanpa JOG, `softkeys` 8 dengan `action`).

- [ ] **Step 2: Tulis unit test yang GAGAL** — tambahkan di `tests/run.mjs` sebelum blok laporan:
```js
import { normalizeProfile, DEFAULT_PROFILE } from '../src/controllers/Panel.js';
eq(normalizeProfile(null).modes.length, 5, 'normalize: null → 5 mode default');
eq(normalizeProfile(null).default, 'mem', 'normalize: null → default mem');
eq(normalizeProfile({ modes: [] }).modes.length, 5, 'normalize: modes kosong → 5 default');
const sk = normalizeProfile({ softkeys: [
  { f: 12, label: 'X' }, { f: 1, label: 'A' }, { f: 1, label: 'B' }
]}).softkeys;
eq(sk.find((s) => s.f === 8)?.label, 'X', 'normalize: f=12 di-clamp ke 8');
eq(sk.filter((s) => s.f === 1).length, 1, 'normalize: f duplikat di-dedupe');
eq(sk.find((s) => s.f === 1)?.label, 'A', 'normalize: dedupe → entri pertama menang');
eq(normalizeProfile({ modes: [{ id: 'foo' }], default: 'bar' }).default, 'foo', 'normalize: default tak valid → mode pertama');
ok(normalizeProfile({ softkeys: [{ f: 2, label: 'Z', action: 'nope' }] }).softkeys[0].action === 'nope', 'normalize: action tak dikenal aman');
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — `npm test` → error/`normalizeProfile is not a function`.

- [ ] **Step 4: Buat `src/controllers/Panel.js`** dengan `DEFAULT_PROFILE` + `normalizeProfile(raw)`:
  - `raw` null/invalid → `structuredClone(DEFAULT_PROFILE)`.
  - `modes`: buang objek tanpa `id` string; dedupe `id`; `label` default `id.toUpperCase()`; `pane` default `'program'`; jika hasil kosong → mode default.
  - `default`: jika bukan salah satu mode → `modes[0].id`.
  - `droModes`/`setupSubs`: buang tanpa `id`; jika kosong → default.
  - `softkeys`: ambil dengan `f` integer, **clamp 1–8**, dedupe `f` (pertama menang), `label` default `'F'+f`, `action` default `null`.
  Header file mencatat batas config (JSON) vs code (action registry).

- [ ] **Step 4: Jalankan test, pastikan LULUS** — `npm test` → `PASS: <n> FAIL: 0` (termasuk 41 test lama).

- [ ] **Step 5: Commit.** `git add src/controllers/haas-style.json src/controllers/Panel.js tests/run.mjs && git commit -m "feat(panel): profil controller JSON + normalizeProfile (murni, unit test)"`

---

### Task 2: Render shell dari JSON + mode MEM/JOG + delegation

**Files:**
- Modify: `src/controllers/Panel.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/style.css`
- Modify: `scripts/verify.mjs`

**Interfaces:**
- `Panel.js` tambah: `renderModeTabs(el, modes, activeId)`, `renderSoftkeys(el, softkeys)`, `renderDroTabs(el, droModes, activeId)`, `renderSetupSubs(el, subs, activeId)`, `loadController(url = './src/controllers/haas-style.json')` (throw bila fetch gagal).
- `main.js`: `applyMode(def)` + `applyModeById(id)` + registry `ACTIONS` + `runAction(sk)`.

- [ ] **Step 1: Tambah assertion smoke GAGAL** di `scripts/verify.mjs` setelah `waitForTimeout(1500)`, sebelum klik softkey:
```js
await page.waitForFunction(() => document.querySelector('#modeTabs .mode-tab'), null, { timeout: 8000 });
const modeCount = await page.locator('#modeTabs .mode-tab').count();
const droCount  = await page.locator('#droTabs .dro-tab').count();
const skCount   = await page.locator('#softkeys .sk').count();
const linesVisible = await page.locator('#gcodeLines').isVisible();
await page.click('#modeTabs .mode-tab[data-mode="jog"]');
await page.waitForTimeout(150);
const jogVisible = await page.locator('#panelJog').isVisible();
const progHidden = !(await page.locator('#panelProgram').isVisible());
await page.click('#modeTabs .mode-tab[data-mode="mdi"]');
await page.waitForTimeout(150);
const mdiVisible = await page.locator('#mdiWrap').isVisible();
await page.click('#modeTabs .mode-tab[data-mode="mem"]');
await page.waitForTimeout(150);
```
Tambahkan ke `problems`:
```js
if (modeCount !== 5) problems.push('mode tabs=' + modeCount + ' (harus 5 dari JSON)');
if (droCount !== 4) problems.push('dro tabs=' + droCount + ' (harus 4 dari JSON)');
if (skCount !== 8) problems.push('softkeys=' + skCount + ' (harus 8 dari JSON)');
if (!linesVisible) problems.push('default mem: #gcodeLines tidak terlihat');
if (!jogVisible || !progHidden) problems.push('mode JOG tidak menampilkan #panelJog / menyembunyikan #panelProgram');
if (!mdiVisible) problems.push('mode MDI tidak menampilkan #mdiWrap');
```

- [ ] **Step 2: Jalankan smoke, pastikan GAGAL** — `npm run verify` → gagal `mode tabs=...` (belum ada `#modeTabs`).

- [ ] **Step 3: Tambah CSS** di `src/style.css`:
```css
.pane-hidden { display: none !important; }
.view-hidden { display: none !important; }
```

- [ ] **Step 4: Restrukturisasi `index.html`.**
  - Header: bungkus tab mode jadi `<div class="mode-tabs" id="modeTabs">` berisi default `EDIT/MEM/MDI/JOG/SETUP` (`data-mode` = `edit/mem/mdi/jog/setup`, MEM `.active`).
  - Tambah `id="droTabs"` pada `.dro-tabs`.
  - Tambah `id="setupSubs"` pada `.subtabs`; hapus tombol JOG (sisakan WORK/TOOL/STOCK).
  - `#panelProgram` beri `data-pane="program"`; bungkus textarea jadi `<div data-view="editor">`, `#gcodeLines` jadi `<div data-view="lines" id="gcodeLines">`, `#mdiWrap` jadi `<div data-view="mdi" id="mdiWrap">`. Hapus inline `style="display:none"` pada elemen yang dikelola `data-view`. `.left-actions` & `.stock-fit-row` tetap selalu tampil.
  - `#panelSetup` beri `data-pane="setup"`; ganti inline `display:none` dengan class `pane-hidden`.
  - Buat `#panelJog` `data-pane="jog"` `class="pane-hidden"`; pindahkan markup jog dari `#setupJog` ke sini.

- [ ] **Step 5: Implementasi renderer di `Panel.js`** — bangun `innerHTML`, set `.active`, pakai atribut `data-mode`/`data-sk`/`data-dro`/`data-sub` dan `id="skN"`. Tidak menyentuh state mesin.

- [ ] **Step 6: Unit test `loadController` gagal-aman** (Review Focus #1) — tambahkan di `tests/run.mjs`:
```js
import { loadController } from '../src/controllers/Panel.js';
let loadThrew = false;
try { await loadController('http://127.0.0.1:1/nope.json'); } catch { loadThrew = true; }
ok(loadThrew, 'loadController: throw saat profil gagal dimuat (dipakai fallback main.js)');
```
Lalu `npm test` → lulus (yang menangkap error adalah `main.js`).

- [ ] **Step 7: Rombak `src/main.js`.**
  - Import dari `Panel.js`.
  - Ganti wiring lama `.mode-tab`/`.sk`/`.dro-tab`/`.subtab` dengan **delegation** pada `#modeTabs`, `#softkeys`, `#droTabs`, `#setupSubs`.
  - `applyMode(def)`: set `currentMode`; toggle `[data-pane]` via class `pane-hidden`; jika `def.pane==='program'` toggle `[data-view]` via `view-hidden`; `updateStatusBar()`.
  - `applyModeById(id)`: ambil dari `state.profile.modes`; `applyMode`; `renderModeTabs($('modeTabs'), …, id)`; update `#hdrMode`/`#simMode`.
  - Registry `ACTIONS` memetakan action lama F1–F8 (`open-offset`, `current-cmds`, `alarm`, `graph`, `training`, `coolant`, `single-block`, `dry-run`). `runAction(def)` (def = entri softkey) fallback → status `'action <id> belum diimplementasikan'`.
  - `showLinesView` hanya mengisi `#gcodeLines`; `showEditView()` → `applyModeById('edit')`.
  - Jog keyboard guard → `if (currentMode !== 'jog') return;`.
  - `train-goto`: `partzero`/`toollength` → `applyModeById('setup')` + subtab; `dryrun`/`cyclestart` → `applyModeById('mem')`.
  - Boot: `loadController().then(render semua + applyModeById(p.default)).catch(fallback default + pesan status)`.

- [ ] **Step 8: Tambah regresi MDI (Spec §2 kriteria 4)** di `scripts/verify.mjs`, setelah blok run dan **sebelum `await browser.close()`**:
```js
await page.click('#modeTabs .mode-tab[data-mode="mdi"]');
await page.fill('#mdiInput', 'G0 X10');
await page.click('#btnMdiRun');
await page.waitForTimeout(500);
```
`errors` (pageerror) sudah diperiksa di akhir — kegagalan MDI akan muncul di sana.

- [ ] **Step 9: Jalankan `npm run verify`, pastikan LULUS** → `smoke OK …` + `VERIFY HIJAU ✓`.

- [ ] **Step 10: Commit.** `git add index.html src/main.js src/controllers/Panel.js src/style.css scripts/verify.mjs tests/run.mjs && git commit -m "feat(v0.10.0): render shell panel dari JSON; mode MEM/JOG + delegation"`

---

### Task 3: Rilis 0.10.0 + HANDOFF

**Files:**
- Modify: `package.json`, `README.md`, `HANDOFF.md`

- [ ] **Step 1:** `package.json` `version` → `0.10.0`.
- [ ] **Step 2:** `README.md` tambah baris rev `0.10.0` (UI shell data-driven: tab mode/softkey/DRO dari JSON; mode MEM & JOG).
- [ ] **Step 3:** `HANDOFF.md` perbarui status/verify/berikutnya (Tahap 6) + catatan keputusan (config vs code, overlay tetap).
- [ ] **Step 4:** `npm run verify` → hijau.
- [ ] **Step 5: Commit** (menyentuh HANDOFF): `git add package.json README.md HANDOFF.md && git commit -m "chore(v0.10.0): rilis UI shell data-driven + HANDOFF"`

---

## Catatan eksekusi

- Push ke `main` **hanya setelah konfirmasi Jack**.
- Bila smoke merah karena timing fetch profil, tunggu eksplisit lewat `waitForFunction` (sudah ditambahkan di Step 1), bukan `waitForTimeout` besar.
- `package-lock.json` mungkin termodifikasi oleh `npm install` — periksa diff; jangan commit bila tak diminta.
