# CNC Milling Simulator v0.6 — Training

Modular web CNC milling trainer with voxel material removal and Haas-style control panel.

## v0.6 features

- **Soft keys F1–F8** (Haas style bottom bar)
  - F1 OFFSET · F2 CURNT CMDS · F3 ALARM · F4 GRAPH
  - F5 TRAINING · F6 COOLANT · F7 SINGLE BLK · F8 DRY RUN
- **Training Scenario** checklist (F5):
  1. Part Zero (G54)
  2. Tool Length / Diameter
  3. Dry Run
  4. Cycle Start (produksi)
- Bright workshop lighting (v0.5.1)
- Voxel cut + machined grey surfaces
- SETUP / EDIT / OPERATION modes

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
