# CNC Milling Simulator v0.3 (Voxel)

Modular web-based CNC milling trainer with **voxel material removal**.

## Structure

```
src/
  machine/   Parser, MachineState
  sim/       Simulator (playback engine)
  stock/     VoxelStock (material removal)
  view/      Scene, tool mesh, toolpath
  ui/        (reserved)
  main.js    bootstrap
  style.css
```

## Run (required: local server — ES modules)

```bash
# Option A – Python
cd cnc-sim-v03
python3 -m http.server 8080
# open http://localhost:8080

# Option B – Vite (if npm works)
npm install
npm run dev
```

## Deploy

Static hosting (Vercel/Netlify) works out of the box via CDN importmap for Three.js.
