/**
 * VoxelStock – 3D voxel grid for CNC material removal.
 * Cut faces use a darker “machined” color so material removal is obvious.
 */
import * as THREE from 'three';
import { buildGreedyGeometry } from './greedyMesh.js';

const COLOR_RAW = [0.96, 0.78, 0.32];       // brighter brass stock

export class VoxelStock {
  constructor({
    sizeX = 100,
    sizeY = 80,
    sizeZ = 20,
    res = 1.0,
    originX = 0,
    originY = 0,
    originZ = -20,
    colorRaw = null
  } = {}) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.res = res;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
    this.colorRaw = colorRaw || COLOR_RAW;

    this.nx = Math.max(1, Math.ceil(sizeX / res));
    this.ny = Math.max(1, Math.ceil(sizeY / res));
    this.nz = Math.max(1, Math.ceil(sizeZ / res));

    this.grid = new Uint8Array(this.nx * this.ny * this.nz);
    this.mesh = null;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.18,
      roughness: 0.42,
      flatShading: true,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x1a1208),
      emissiveIntensity: 0.12
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

  /**
   * Rebuild voxel grid with new dimensions (auto-fit stock to toolpath).
   */
  resize({ sizeX, sizeY, sizeZ, originX, originY, originZ, res }, scene) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.res = res ?? this.res;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
    this.nx = Math.max(1, Math.ceil(this.sizeX / this.res));
    this.ny = Math.max(1, Math.ceil(this.sizeY / this.res));
    this.nz = Math.max(1, Math.ceil(this.sizeZ / this.res));
    this.grid = new Uint8Array(this.nx * this.ny * this.nz);
    this.fill();
    if (scene) this.updateMesh(scene, true);
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

  /** true jika titik (koordinat mesin) berada di dalam material yang belum terpotong. */
  pointInStock(x, y, z) {
    const { ix, iy, iz } = this.worldToVoxel(x, y, z);
    return this.inBounds(ix, iy, iz) && this.grid[this.idx(ix, iy, iz)] === 1;
  }

  cutCylinder(cx, cy, zTip, radius) {
    const r2 = radius * radius;
    const { ix: cx0, iy: cy0 } = this.worldToVoxel(cx, cy, zTip);
    const rVox = Math.ceil(radius / this.res) + 1;
    // Mulai dari voxel yang memuat ujung tool: voxel di bawahnya tak akan pernah
    // lolos cek wz >= zTip - 0.01, jadi aman dilewati (regresi cut tetap sama).
    const izStart = Math.max(0, Math.floor((zTip - this.originZ) / this.res));

    let changed = false;
    for (let iy = cy0 - rVox; iy <= cy0 + rVox; iy++) {
      for (let ix = cx0 - rVox; ix <= cx0 + rVox; ix++) {
        const wx = this.originX + (ix + 0.5) * this.res;
        const wy = this.originY + (iy + 0.5) * this.res;
        if ((wx - cx) ** 2 + (wy - cy) ** 2 > r2) continue;

        for (let iz = izStart; iz < this.nz; iz++) {
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

  buildGeometry() {
    const g = buildGreedyGeometry({
      grid: this.grid,
      nx: this.nx,
      ny: this.ny,
      nz: this.nz,
      originX: this.originX,
      originY: this.originY,
      originZ: this.originZ,
      res: this.res,
      colorRaw: this.colorRaw
    });

    const geo = new THREE.BufferGeometry();
    if (!g) {
      const box = new THREE.BoxGeometry(this.sizeX, this.sizeZ, this.sizeY);
      box.translate(
        this.originX + this.sizeX / 2,
        this.originZ + this.sizeZ / 2,
        this.originY + this.sizeY / 2
      );
      return box;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.color, 3));
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
