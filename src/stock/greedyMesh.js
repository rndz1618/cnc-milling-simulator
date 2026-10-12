/**
 * greedyMesh – greedy mesher murni (tanpa three.js/DOM).
 * Menggabungkan sel permukaan yang seragam jadi quad besar (quad-merge).
 *
 * Konvensi vertex sama dengan VoxelStock.buildGeometry:
 *   position.push(wx, wz, wy)  (y/z ditukar)
 *   normal.push(n[0], n[2], n[1])
 *   warna = colorRaw bila sisi menghadap luar AABB, colorCut bila ke tetangga kosong.
 */

export const COLOR_RAW = [0.96, 0.78, 0.32]; // stok brass terang
export const COLOR_CUT = [0.55, 0.58, 0.62]; // abu bekas pengerjaan

// 6 arah sisi; urutan & sumbu u/v persis VoxelStock.
const FACES = [
  { d: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { d: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { d: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { d: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { d: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { d: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] }
];

const axisOf = (vec) => (vec[0] ? 0 : vec[1] ? 1 : 2);

export function buildGreedyGeometry({
  grid, nx, ny, nz,
  originX, originY, originZ, res,
  colorRaw = COLOR_RAW, colorCut = COLOR_CUT, emitBounds = null
}) {
  const dims = [nx, ny, nz];
  const idx = (ix, iy, iz) => iz * nx * ny + iy * nx + ix;
  const isSolid = (ix, iy, iz) =>
    ix >= 0 && ix < nx && iy >= 0 && iy < ny && iz >= 0 && iz < nz &&
    grid[idx(ix, iy, iz)] === 1;
  const inEmit = (ix, iy, iz) =>
    !emitBounds ||
    (ix >= emitBounds.minX && ix < emitBounds.maxX &&
     iy >= emitBounds.minY && iy < emitBounds.maxY &&
     iz >= emitBounds.minZ && iz < emitBounds.maxZ);

  const position = [];
  const normal = [];
  const color = [];

  for (const f of FACES) {
    const a = axisOf(f.d);          // sumbu normal
    const s = f.d[a];               // tanda arah
    const ua = axisOf(f.u);
    const va = axisOf(f.v);
    const nu = dims[ua];
    const nv = dims[va];

    // mask: 0 = tanpa sisi, 1 = raw (luar AABB), 2 = cut (tetangga kosong)
    const mask = new Uint8Array(nu * nv);
    const coord = [0, 0, 0];

    for (let w = 0; w < dims[a]; w++) {
      mask.fill(0);
      coord[a] = w;
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          coord[ua] = i;
          coord[va] = j;
          const ix = coord[0], iy = coord[1], iz = coord[2];
          if (!isSolid(ix, iy, iz)) continue;
          if (!inEmit(ix, iy, iz)) continue;

          coord[a] = w + s;
          const nbgInBounds =
            coord[0] >= 0 && coord[0] < nx &&
            coord[1] >= 0 && coord[1] < ny &&
            coord[2] >= 0 && coord[2] < nz;
          const nSolid = nbgInBounds && grid[idx(coord[0], coord[1], coord[2])] === 1;
          coord[a] = w;

          if (nSolid) continue;
          mask[i * nv + j] = nbgInBounds ? 2 : 1;
        }
      }

      // greedy-merge: gabung sel bernilai sama jadi persegi panjang.
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu;) {
          const val = mask[i * nv + j];
          if (!val) { i++; continue; }

          let du = 1;
          while (i + du < nu && mask[(i + du) * nv + j] === val) du++;
          let dv = 1;
          outer: while (j + dv < nv) {
            for (let k = 0; k < du; k++) {
              if (mask[(i + k) * nv + (j + dv)] !== val) break outer;
            }
            dv++;
          }

          emitQuad(f, a, ua, va, i, j, du, dv, w, val === 1 ? colorRaw : colorCut);

          for (let dj = 0; dj < dv; dj++) {
            for (let di = 0; di < du; di++) mask[(i + di) * nv + (j + dj)] = 0;
          }
          i += du;
        }
      }
    }
  }

  if (position.length === 0) return null;

  function emitQuad(f, a, ua, va, u0, v0, du, dv, w, col) {
    // u/v di FACES selalu unit positif → indeks sel = koordinat tepi bawah.
    const s = f.d[a];
    const base = [0, 0, 0];
    base[a] = w + 0.5 + s * 0.5;
    base[ua] = u0 + 0.5;
    base[va] = v0 + 0.5;

    const u = f.u, v = f.v;
    const corners = [
      [base[0] - u[0] * 0.5 - v[0] * 0.5, base[1] - u[1] * 0.5 - v[1] * 0.5, base[2] - u[2] * 0.5 - v[2] * 0.5],
      [base[0] - u[0] * 0.5 - v[0] * 0.5 + u[0] * du, base[1] - u[1] * 0.5 - v[1] * 0.5 + u[1] * du, base[2] - u[2] * 0.5 - v[2] * 0.5 + u[2] * du],
      [base[0] - u[0] * 0.5 - v[0] * 0.5 + u[0] * du + v[0] * dv, base[1] - u[1] * 0.5 - v[1] * 0.5 + u[1] * du + v[1] * dv, base[2] - u[2] * 0.5 - v[2] * 0.5 + u[2] * du + v[2] * dv],
      [base[0] - u[0] * 0.5 - v[0] * 0.5 + v[0] * dv, base[1] - u[1] * 0.5 - v[1] * 0.5 + v[1] * dv, base[2] - u[2] * 0.5 - v[2] * 0.5 + v[2] * dv]
    ];

    const order = (f.d[0] + f.d[1] + f.d[2] > 0)
      ? [0, 1, 2, 0, 2, 3]
      : [0, 2, 1, 0, 3, 2];

    for (const oi of order) {
      const c = corners[oi];
      position.push(originX + c[0] * res, originZ + c[2] * res, originY + c[1] * res);
      normal.push(f.d[0], f.d[2], f.d[1]);
      color.push(col[0], col[1], col[2]);
    }
  }

  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    color: new Float32Array(color)
  };
}
