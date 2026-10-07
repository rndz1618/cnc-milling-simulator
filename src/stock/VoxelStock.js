/**
 * VoxelStock – 3D voxel grid for CNC material removal.
 * Tool carves voxels; surface mesh rebuilt so pocket walls are near-vertical.
 */
import * as THREE from 'three';

export class VoxelStock {
  constructor({
    sizeX = 100,
    sizeY = 80,
    sizeZ = 20,
    res = 1.0,
    originX = 0,
    originY = 0,
    originZ = -20 // work Z of bottom; top of stock = originZ + sizeZ = 0
  } = {}) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.res = res;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;

    this.nx = Math.max(1, Math.ceil(sizeX / res));
    this.ny = Math.max(1, Math.ceil(sizeY / res));
    this.nz = Math.max(1, Math.ceil(sizeZ / res));

    this.grid = new Uint8Array(this.nx * this.ny * this.nz);
    this.mesh = null;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xe8b84a,
      emissive: 0x3a2808,
      emissiveIntensity: 0.25,
      metalness: 0.15,
      roughness: 0.55,
      flatShading: true,
      side: THREE.DoubleSide
    });
    this._dirty = true;
    this._lastRebuild = 0;
    this.rebuildIntervalMs = 80;

    this.fill();
  }

  idx(ix, iy, iz) {
    return iz * this.nx * this.ny + iy * this.nx + ix;
  }

  fill() {
    this.grid.fill(1);
    this._dirty = true;
  }

  reset() {
    this.fill();
  }

  worldToVoxel(x, y, z) {
    const ix = Math.floor((x - this.originX) / this.res);
    const iy = Math.floor((y - this.originY) / this.res);
    const iz = Math.floor((z - this.originZ) / this.res);
    return { ix, iy, iz };
  }

  inBounds(ix, iy, iz) {
    return ix >= 0 && ix < this.nx && iy >= 0 && iy < this.ny && iz >= 0 && iz < this.nz;
  }

  /**
   * Remove voxels whose center is inside tool cylinder (XY)
   * and at or above tool tip Z (material above tip is cut away).
   */
  cutCylinder(cx, cy, zTip, radius) {
    const r2 = radius * radius;
    const { ix: cx0, iy: cy0 } = this.worldToVoxel(cx, cy, zTip);
    const rVox = Math.ceil(radius / this.res) + 1;

    let changed = false;
    for (let iy = cy0 - rVox; iy <= cy0 + rVox; iy++) {
      for (let ix = cx0 - rVox; ix <= cx0 + rVox; ix++) {
        const wx = this.originX + (ix + 0.5) * this.res;
        const wy = this.originY + (iy + 0.5) * this.res;
        if ((wx - cx) ** 2 + (wy - cy) ** 2 > r2) continue;

        for (let iz = 0; iz < this.nz; iz++) {
          if (!this.inBounds(ix, iy, iz)) continue;
          const wz = this.originZ + (iz + 0.5) * this.res;
          if (wz >= zTip - 0.01) {
            const i = this.idx(ix, iy, iz);
            if (this.grid[i]) {
              this.grid[i] = 0;
              changed = true;
            }
          }
        }
      }
    }
    if (changed) this._dirty = true;
    return changed;
  }

  cutSegment(x0, y0, z0, x1, y1, z1, radius) {
    const stockTop = this.originZ + this.sizeZ;
    if (z0 > stockTop + 0.5 && z1 > stockTop + 0.5) return false;

    const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
    const step = Math.max(this.res * 0.45, 0.35);
    const n = Math.max(1, Math.ceil(dist / step));
    let changed = false;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      if (this.cutCylinder(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        z0 + (z1 - z0) * t,
        radius
      )) changed = true;
    }
    return changed;
  }

  /**
   * Build solid surface mesh (outer faces only) in Three.js coords:
   * work (x,y,z) → Three (x, z, y)
   */
  buildGeometry() {
    const positions = [];
    const normals = [];
    const res = this.res;
    const ox = this.originX;
    const oy = this.originY;
    const oz = this.originZ;

    const isSolid = (ix, iy, iz) =>
      this.inBounds(ix, iy, iz) && this.grid[this.idx(ix, iy, iz)] === 1;

    // face: d = neighbor offset, n = outward normal (work space)
    const faces = [
      { d: [1, 0, 0], n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
      { d: [-1, 0, 0], n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
      { d: [0, 1, 0], n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
      { d: [0, -1, 0], n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
      { d: [0, 0, 1], n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
      { d: [0, 0, -1], n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] }
    ];

    for (let iz = 0; iz < this.nz; iz++) {
      for (let iy = 0; iy < this.ny; iy++) {
        for (let ix = 0; ix < this.nx; ix++) {
          if (!isSolid(ix, iy, iz)) continue;

          for (const f of faces) {
            const nix = ix + f.d[0];
            const niy = iy + f.d[1];
            const niz = iz + f.d[2];
            if (isSolid(nix, niy, niz)) continue;

            const cx = ix + 0.5 + f.d[0] * 0.5;
            const cy = iy + 0.5 + f.d[1] * 0.5;
            const cz = iz + 0.5 + f.d[2] * 0.5;
            const u = f.u;
            const v = f.v;
            const corners = [
              [cx - u[0] * 0.5 - v[0] * 0.5, cy - u[1] * 0.5 - v[1] * 0.5, cz - u[2] * 0.5 - v[2] * 0.5],
              [cx + u[0] * 0.5 - v[0] * 0.5, cy + u[1] * 0.5 - v[1] * 0.5, cz + u[2] * 0.5 - v[2] * 0.5],
              [cx + u[0] * 0.5 + v[0] * 0.5, cy + u[1] * 0.5 + v[1] * 0.5, cz + u[2] * 0.5 + v[2] * 0.5],
              [cx - u[0] * 0.5 + v[0] * 0.5, cy - u[1] * 0.5 + v[1] * 0.5, cz - u[2] * 0.5 + v[2] * 0.5]
            ];

            const order = (f.d[0] + f.d[1] + f.d[2] > 0)
              ? [0, 1, 2, 0, 2, 3]
              : [0, 2, 1, 0, 3, 2];

            for (const oi of order) {
              const c = corners[oi];
              const wx = ox + c[0] * res;
              const wy = oy + c[1] * res;
              const wz = oz + c[2] * res;
              // Three.js: X=workX, Y=workZ (height), Z=workY
              positions.push(wx, wz, wy);
              normals.push(f.n[0], f.n[2], f.n[1]);
            }
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    if (positions.length === 0) {
      // Fallback solid box so stock is never invisible
      const box = new THREE.BoxGeometry(this.sizeX, this.sizeZ, this.sizeY);
      box.translate(
        this.originX + this.sizeX / 2,
        this.originZ + this.sizeZ / 2,
        this.originY + this.sizeY / 2
      );
      return box;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  updateMesh(scene, force = false) {
    if (!this._dirty && !force) return;
    const now = performance.now();
    if (!force && now - this._lastRebuild < this.rebuildIntervalMs) return;
    this._lastRebuild = now;
    this._dirty = false;

    const geo = this.buildGeometry();
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.mesh.name = 'stock';
      scene.add(this.mesh);
    } else {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    }
  }

  dispose(scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material.dispose();
      this.mesh = null;
    }
  }

  get remainingRatio() {
    let solid = 0;
    for (let i = 0; i < this.grid.length; i++) solid += this.grid[i];
    return solid / this.grid.length;
  }
}
