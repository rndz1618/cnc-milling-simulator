# CNC Milling Simulator v0.5 — Haas-style UI

Modular web-based CNC milling trainer with **voxel material removal** and a control panel layout inspired by the Haas Next Generation Control (NGC).

## Structure

```
src/
  machine/   Parser, MachineState
  sim/       Simulator (playback engine)
  stock/     VoxelStock (material removal + machined color)
  view/      Scene, tool mesh, Z-colored toolpath
  main.js    bootstrap + UI wiring
  style.css  Haas dark theme
```

## Run

```bash
cd cnc-sim-v03
# Option A – static server (importmap)
python3 -m http.server 8080
# open http://localhost:8080

# Option B – Vite
npm install
npm run dev
```

Do **not** open `index.html` via `file://` — browsers block ES modules.

## Haas UI roadmap (v0.5)

| Area | Status |
|------|--------|
| Mode bar SETUP / EDIT / OPERATION | ✅ `MODE:KEY` display (SETUP:JOG, OPERATION:MEM, EDIT) |
| Work + Tool offset tables | ✅ with ZERO / Apply |
| Handle Jog + increments + arrow keys | ✅ |
| DRO WORK / MACHINE / DTG | ✅ green Haas-style digits |
| Active Codes (G0/G1, G90, WCS, F, T, M) | ✅ live |
| Spindle RPM + direction | ✅ |
| Coolant toggle (M8/M9) | ✅ |
| Soft keys F1–F8 | ✅ OFFSET, CURNT CMDS, ALARM, GRAPH, HELP, COOLANT, SINGLE BLK, DRY RUN |
| System status bar + flags | ✅ |
| Cycle Start / Feed Hold / Reset | ✅ |
| Feed / Rapid / Sim override | ✅ |
| Voxel cut + machined surface color | ✅ |
| Z-level colored toolpath | ✅ |
| Synced G-code line highlight | ✅ |
| Bright workspace lighting (v0.5.1) | ✅ |

## Keyboard

- **Space** — Cycle Start / Feed Hold
- **Arrow keys / PgUp / PgDn** — Jog axes (SETUP mode)
- **F1–F8** — Soft keys

## Training flow

1. **SETUP** → WORK: set G54 (ZERO at part corner) → TOOL: length/dia → JOG: approach with handle
2. **EDIT** → load / edit program
3. **OPERATION** → Cycle Start, Single Block, Dry Run, overrides
