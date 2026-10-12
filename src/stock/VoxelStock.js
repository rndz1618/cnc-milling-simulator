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
    colorRaw = null,
    meshService = null,
    chunkVoxels = 8
  } = {}) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.res = res;
    this.originX = originX;
    this.originY = originY;
    this.originZ = originZ;
    this.colorRaw = colorRaw || COLOR_RAW;
    this.chunkVoxels = chunkVoxels;
    this.maxChunksPerUpdate = 4;

    this.nx = Math.max(1, Math.ceil(sizeX / res));
    this.ny = Math.max(1, Math.ceil(sizeY / res));
    this.nz = Math.max(1, Math.ceil(sizeZ / res));

    this._initChunks();

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
    this.meshService = meshService || null;
    this._meshToken = 0;
    this._meshPending = false;

    this.fill();
  }

  idx(ix, iy, iz) {
    return iz * this.nx * this.ny + iy * this.nx + ix;
  }

  _chunkId(gx, gy) {
    return gy * this.cw + gx;
  }

  _chunkOfVoxel(ix, iy) {
    return { gx: Math.floor(ix / this.chunkVoxels), gy: Math.floor(iy / this.chunkVoxels) };
  }

  _markChunk(gx, gy) {
    if (gx < 0 || gx >= this.cw || gy < 0 || gy >= this.chN) return;
    const id = this._chunkId(gx, gy);
    this.chunks[id].dirty = true;
    this._dirtyChunks.add(id);
  }

  _markAllChunksDirty() {
    for (const c of this.chunks) {
      c.dirty = true;
      this._dirtyChunks.add(c.id);
    }
  }

  _initChunks() {
    this.cw = Math.ceil(this.nx / this.chunkVoxels);
    this.chN = Math.ceil(this.ny / this.chunkVoxels);
    this.chunks = [];
    this._dirtyChunks = new Set();
    for (let gy = 0; gy < this.chN; gy++) {
      for (let gx = 0; gx < this.cw; gx++) {
        this.chunks.push({
          id: this._chunkId(gx, gy), gx, gy,
          version: 0, pending: false, dirty: true, empty: false, mesh: null
        });
      }
    }
    this._markAllChunksDirty();
  }

  fill() {
    this.grid.fill(1);
    this._markAllChunksDirty();
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
    this._initChunks();
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
    let minIx = Infinity, maxIx = -Infinity, minIy = Infinity, maxIy = -Infinity;
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
              if (ix < minIx) minIx = ix;
              if (ix > maxIx) maxIx = ix;
              if (iy < minIy) minIy = iy;
              if (iy > maxIy) maxIy = iy;
            }
          }
        }
      }
    }
    if (changed) {
      this._dirty = true;
      const gx0 = Math.floor((minIx - 1) / this.chunkVoxels);
      const gx1 = Math.floor((maxIx + 1) / this.chunkVoxels);
      const gy0 = Math.floor((minIy - 1) / this.chunkVoxels);
      const gy1 = Math.floor((maxIy + 1) / this.chunkVoxels);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) this._markChunk(gx, gy);
      }
    }
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

  _geoFrom(g) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normal, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.color, 3));
    geo.computeBoundingSphere();
    return geo;
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

    if (!g) {
      const box = new THREE.BoxGeometry(this.sizeX, this.sizeZ, this.sizeY);
      box.translate(
        this.originX + this.sizeX / 2,
        this.originZ + this.sizeZ / 2,
        this.originY + this.sizeY / 2
      );
      return box;
    }
    return this._geoFrom(g);
  }

  _swapGeometry(geo, scene) {
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

  updateMesh(scene, force = false) {
    if (!this._dirty && !force) return;
    const now = performance.now();
    if (!force && now - this._lastRebuild < this.rebuildIntervalMs) return;
    // Satu permintaan in-flight saja: worker greedy-mesh jauh lebih lambat dari
    // rebuildIntervalMs, jadi mengirim tiap interval akan menumpuk antrean DAN
    // membuat balasan selalu "basi" (mesh hanya ter-update saat cutting berhenti).
    // Jangan reset _dirty saat menunggu — biar cut selama in-flight tetap diproses.
    if (this.meshService && this._meshPending && !force) return;
    this._lastRebuild = now;
    this._dirty = false;

    if (this.meshService) {
      const token = ++this._meshToken;
      this._meshPending = true;
      this.meshService.request({
        grid: this.grid.slice(),
        nx: this.nx,
        ny: this.ny,
        nz: this.nz,
        originX: this.originX,
        originY: this.originY,
        originZ: this.originZ,
        res: this.res,
        colorRaw: this.colorRaw
      }).then((g) => {
        if (token !== this._meshToken) return;   // dibatalkan (dispose/resize)
        this._meshPending = false;
        if (!g || !g.position) { this._swapGeometry(this.buildGeometry(), scene); return; }
        this._swapGeometry(this._geoFrom(g), scene);
      }).catch(() => {
        if (token !== this._meshToken) return;
        this._meshPending = false;
        this._swapGeometry(this.buildGeometry(), scene);   // service gagal → fallback sinkron
      });
    } else {
      this._swapGeometry(this.buildGeometry(), scene);
    }
  }

  dispose(scene) {
    this._meshToken++;   // batalkan reply tertunda
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
