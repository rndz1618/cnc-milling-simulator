/**
 * Bench greedy mesher (murni, tanpa three.js/DOM).
 * Cetak ms + jumlah triangle stok penuh 100x80x20; exit != 0 bila > 4000 ms (sanity).
 */
import { buildGreedyGeometry } from '../src/stock/greedyMesh.js';

const nx = 100, ny = 80, nz = 20;
const grid = new Uint8Array(nx * ny * nz).fill(1);
const t0 = performance.now();
const g = buildGreedyGeometry({ grid, nx, ny, nz, originX: 0, originY: 0, originZ: 0, res: 1 });
const ms = performance.now() - t0;
console.log('greedy mesh 100x80x20: ' + ms.toFixed(1) + ' ms, tris=' + (g.position.length / 9));
if (ms > 4000) { console.error('greedy mesh terlalu lambat'); process.exit(1); }
