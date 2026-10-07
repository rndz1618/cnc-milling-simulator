# CNC Milling Simulator v0.7.0-rA1 — Training

Modular web CNC milling trainer with voxel material removal and Haas-style control panel.

## Revision history

| Rev | Version | Notes |
|-----|---------|-------|
| rA1 | 0.7.0 | Progressive toolpath trail, live segment, dim rapids / bright feed |
| — | 0.6.x | Soft keys F1–F8, training checklist, override buttons, WCS, work zero |

## v0.7 features (Tahap 2)

- **Progressive toolpath trail** — during Cycle Start only the path already travelled is drawn
- **Live segment** — current move from last completed point to tool tip
- **GRAPH (F4)** — full path preview when idle; hidden while running
- **DRY RUN (F8)** — stock mesh hidden
- Dim rapid lines + depth-coloured feed lines

## Run

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
