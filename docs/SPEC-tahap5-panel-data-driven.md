# SPEC — Tahap 5 lanjutan: UI shell data-driven (controller profile)

Status: disetujui secara desain (chat), menunggu review spec sebelum implementation plan.
Target versi: 0.10.0. Bahasa kerja: Bahasa Indonesia, istilah teknis English.

Dokumen ini melengkapi `docs/PLAN-LANJUTAN.md` §Tahap 5. Invarian di
`AGENTS.md` dan `docs/PLAN-LANJUTAN.md` §1 tetap berlaku penuh.

---

## 1. Tujuan

Jadikan **shell UI** — tab mode, softkey, dan mode DRO — dirender dari satu
file controller JSON, sehingga mengganti profil mengubah UI tanpa menyentuh JS.
Tambahkan mode **MEM** dan **JOG** sebagai mode nyata.

CURNT CMDS dan ALARM **tetap overlay melayang** (keputusan Jack), dipicu lewat
softkey action.

## 2. Kriteria selesai

1. Tab mode ditampilkan dari JSON: `EDIT · MEM · MDI · JOG · SETUP`.
2. Softkey F1–F8 (label + action) dirender dari JSON.
3. Mode DRO dirender dari JSON: WORK · MACHINE · OPERATOR · DTG.
4. MDI dapat menjalankan `G0 X10` (sudah ada — dijaga regresinya).
5. Mengubah daftar mode/softkey/DRO di JSON mengubah UI tanpa edit JS.
6. `npm run verify` hijau; smoke headless diperluas untuk (1)–(3) dan mode baru.

## 3. Batas config vs code (eksplisit)

- **Config (JSON)** menentukan: struktur, label, urutan, `id`, `pane`, `view`,
  `action` (nama aksi), daftar DRO, subtab setup, mode default.
- **Code (JS)** menyediakan: implementasi tiap `action` (registry), logika
  show/hide pane, dan wiring ke engine simulasi. Perilaku tidak bisa berasal
  dari data murni tanpa berubah jadi bahasa program; batas ini sengaja dan
  didokumentasikan di header `src/controllers/Panel.js`.
- Action atau mode yang tak dikenal → fallback aman (no-op + pesan status),
  bukan crash.

## 4. Komponen & file

### 4.1 `src/controllers/haas-style.json` (diperluas)
Skema:
```jsonc
{
  "name": "haas-style",
  "version": 1,
  "default": "mem",
  "modes": [
    { "id": "edit",  "label": "EDIT",  "pane": "program", "view": "editor" },
    { "id": "mem",   "label": "MEM",   "pane": "program", "view": "lines" },
    { "id": "mdi",   "label": "MDI",   "pane": "program", "view": "mdi" },
    { "id": "jog",   "label": "JOG",   "pane": "jog" },
    { "id": "setup", "label": "SETUP", "pane": "setup" }
  ],
  "droModes": [
    { "id": "work", "label": "WORK" },
    { "id": "machine", "label": "MACHINE" },
    { "id": "operator", "label": "OPERATOR" },
    { "id": "dtg", "label": "DTG" }
  ],
  "setupSubs": [
    { "id": "work", "label": "WORK" },
    { "id": "tool", "label": "TOOL" },
    { "id": "stock", "label": "STOCK" }
  ],
  "softkeys": [
    { "f": 1, "label": "OFFSET", "action": "open-offset" },
    { "f": 2, "label": "CURNT CMDS", "action": "current-cmds" },
    { "f": 3, "label": "ALARM", "action": "alarm" },
    { "f": 4, "label": "GRAPH", "action": "graph" },
    { "f": 5, "label": "TRAINING", "action": "training" },
    { "f": 6, "label": "COOLANT", "action": "coolant" },
    { "f": 7, "label": "SINGLE BLK", "action": "single-block" },
    { "f": 8, "label": "DRY RUN", "action": "dry-run" }
  ]
}
```

### 4.2 `src/controllers/Panel.js` (BARU)
- `normalizeProfile(raw)` → `{ name, default, modes, droModes, softkeys, setupSubs }`
  tervalidasi: buang entri tanpa `id`, dedupe `id`, clamp `f` ke 1–8,
  pastikan minimal satu mode (fallback default bawaan), `default` harus
  menunjuk mode yang ada. **Fungsi murni, tanpa DOM.**
- `renderModeTabs(el, modes, activeId)`, `renderSoftkeys(el, softkeys)`,
  `renderDroTabs(el, droModes, activeId)`, `renderSetupSubs(el, subs)`:
  membangun DOM dan mempertahankan atribut `data-mode` / `data-sk` / `data-dro`
  yang dipakai wiring + test.
- `loadController(url)` → `normalizeProfile(await fetch())`; melempar error ke
  pemanggil agar main.js bisa memakai fallback.

### 4.3 `index.html`
- Container mempertahankan **markup default sebagai fallback**; renderer
  mengganti `innerHTML`-nya saat profil berhasil dimuat. Container: `#modeTabs`
  (header), `.dro-tabs` → `#droTabs`, `#softkeys`, subtab setup.
- Pane baru `#panelJog` (markup jog dipindah dari `#setupJog`).
- Panel program dibagi: `[data-view="editor"]` (textarea), `[data-view="lines"]`
  (`#gcodeLines`), `[data-view="mdi"]` (`#mdiWrap`).
- Setiap pane diberi `data-pane="program|setup|jog"`.

### 4.4 `src/main.js`
- Action registry: `{ 'open-offset', 'current-cmds', 'alarm', 'graph',
  'training', 'coolant', 'single-block', 'dry-run' }`.
- `applyMode(def)`: set `currentMode`, update `#hdrMode`/`#simMode`, toggle
  `[data-pane]` lalu (jika `pane==='program'`) toggle `[data-view]`.
- **Delegated listeners** pada `#modeTabs`, `#softkeys`, `#droTabs`, subtab —
  agar render ulang tidak memutus event.
- Boot async: muat profil → render shell → `applyMode(default)` → `loadProgram()`.
  Gagal muat profil → pakai markup default index.html + pesan status.
- `showLinesView` hanya mengisi konten `#gcodeLines`; visibilitas diatur
  `applyMode`.
- Handler `train-goto` diarahkan ke id mode baru (`setup`, `mem`).
- Jog-key aktif hanya saat `currentMode === 'jog'`.

### 4.5 `src/train.js`
Tidak berubah.

### 4.6 `tests/run.mjs`
Test unit `normalizeProfile` + semua test lama (41) tetap lulus.

### 4.7 `scripts/verify.mjs`
Smoke diperluas (lihat §7).

### 4.8 Docs & versi
`HANDOFF.md` (status, commit, berikutnya), `README.md` (rev history + keyboard),
`package.json` → `0.10.0`.

## 5. Data flow

```
fetch haas-style.json
  → normalizeProfile()
  → renderModeTabs / renderSoftkeys / renderDroTabs / renderSetupSubs

klik mode    → applyMode(def)  : toggle [data-pane] / [data-view], hdr + status
klik softkey → actions[def.action]?.()
klik DRO     → droMode = def.id → refreshUI()
```

Renderer **tidak menyentuh** `machine`/`sim`. Posisi internal tetap koordinat
mesin (invarian §1 PLAN).

## 6. Error handling

| Kondisi | Perilaku |
|---|---|
| JSON 404 / rusak | Fallback markup default index.html; status "controller profile gagal dimuat"; app tetap jalan |
| `action` tak dikenal | No-op + status "action <id> belum diimplementasi" |
| Mode tanpa `pane` valid | Fallback ke pane pertama yang ada |
| `default` tak valid | Pakai mode pertama |
| `f` di luar 1–8 | Di-clamp; entri ganda `f` → yang pertama menang |

## 7. Testing

**Unit (`tests/run.mjs`):**
- `normalizeProfile`: default modes saat input kosong; clamp `f`; dedupe `id`;
  `default` tak valid → mode pertama; `action` tak dikenal tidak melempar.
- Regresi: seluruh test parser/state lama tetap lulus.

**Smoke headless (`scripts/verify.mjs`):**
- Jumlah tab mode (hasil render JSON) = 5; tab DRO = 4; softkey = 8.
- Klik MEM → `#gcodeLines` terlihat, editor tersembunyi.
- Klik JOG → `#panelJog` terlihat.
- Klik F2 → overlay `#cmdsPanel` terbuka.
- Regresi: jalankan program → status RUN/DONE; `#stockLeft` ada; CURNT CMDS live
  (sebelum ≠ sesudah); tanpa `pageerror`.

**Gerbang:** `npm run verify` hijau sebelum commit.

## 8. Di luar scope (sengaja)

- Render seluruh 3 kolom dari JSON (layout penuh) — bukan gelombang ini.
- CURNT CMDS/ALARM sebagai halaman non-overlay — tetap overlay (keputusan Jack).
- Perubahan Parser/Simulator/koordinat mesin.
- Editor widget generic (form/table) dari JSON — YAGNI untuk sekarang.

## 9. Risiko & mitigasi

- **Regresi wiring**: event diganti ke delegation; ditutup oleh smoke.
- **`data-*` test lama**: id/class lama (`#cmdsPanel`, `#btnPlay`, `.gline`,
  `.sk[data-sk]`, `.ovr-btn`) dipertahankan.
- **Boot async**: render shell sebelum `loadProgram` agar UI konsisten; fallback
  markup menjaga kondisi offline.
