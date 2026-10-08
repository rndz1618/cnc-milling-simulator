# CNC Milling Simulator v0.9.0 — Training

Modular web CNC milling trainer with voxel material removal and Haas-style control panel.

## Revision history

| Rev | Version | Notes |
|-----|---------|-------|
| — | 0.9.0 | Machine-coordinate engine (WCS G54–G59, G43/G28, DTG, soft-limit halt), parser hardening (N-lines, canned cycles G81–G83, G20/G21, alarm halts, M97/O-subs), data-driven tool geometry, unit tests |
| — | 0.8.0 | Alarm panel F3, WCS/Tool localStorage, tool auto-apply, chunk loader |
| rA1 | 0.7.0 | Progressive toolpath trail, live segment, dim rapids / bright feed |
| — | 0.6.x | Soft keys F1–F8, training checklist, override buttons, WCS, work zero |

## Run

```bash
npm install
npm run dev      # dev server (Vite)
npm run build    # production build → dist/
npm run preview  # serve the production build
npm test         # parser/interpreter unit tests (golden file: O20018)
```

Tanpa Node, tetap bisa jalan sebagai static site (three.js via CDN importmap):

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Do **not** open via `file://`.

## Keyboard

- **Space** — Cycle Start / Feed Hold
- **F1–F8** — Soft keys
- **Arrow / PgUp / PgDn** — Jog (SETUP)

## Training flow

1. Press **F5** (TRAINING)
2. Follow checklist: Part Zero → Tool → Dry Run → Cycle Start
3. Steps auto-check when completed
