import { VoxelStock } from '../stock/VoxelStock.js';
import { stockOriginFor, materialRGB } from '../machine/Fixtures.js';
import { wcsOffset } from '../machine/MachineState.js';

export class FixtureManager {
  constructor({ scene = null, machine, createVise = null, meshService = null } = {}) {
    this.scene = scene;
    this.machine = machine;
    this.createVise = createVise;
    this.meshService = meshService;
    this.entries = [];
    this.byWcs = new Map();
  }

  build(fixtures) {
    this.dispose();
    for (const fixture of fixtures || []) {
      const origin = stockOriginFor(fixture, wcsOffset(this.machine, fixture.wcs));
      const s = fixture.stock;
      const stock = new VoxelStock({
        sizeX: s.sizeX, sizeY: s.sizeY, sizeZ: s.sizeZ,
        originX: origin.x, originY: origin.y, originZ: origin.z,
        colorRaw: materialRGB(s.material),
        meshService: this.meshService
      });
      let vise = null;
      if (this.scene) {
        stock.updateMesh(this.scene, true);
        if (this.createVise) {
          vise = this.createVise({
            jawWidth: fixture.vise.jawWidth,
            jawHeight: fixture.vise.jawHeight,
            opening: fixture.vise.opening,
            baseH: fixture.vise.baseH,
            centerX: origin.x + s.sizeX / 2,
            yMin: origin.y,
            yMax: origin.y + s.sizeY,
            topZ: origin.z
          });
          this.scene.add(vise);
        }
      }
      const entry = { fixture, stock, vise, origin };
      this.entries.push(entry);
      this.byWcs.set(fixture.wcs, entry);
    }
    return this;
  }

  stockFor(wcs) {
    const e = this.byWcs.get(wcs);
    return e ? e.stock : null;
  }

  fixtureFor(wcs) {
    const e = this.byWcs.get(wcs);
    return e ? e.fixture : null;
  }

  stocks() {
    return this.entries.map((e) => e.stock);
  }

  /**
   * Pindahkan stok & vise mengikuti offset WCS terbaru TANPA membangun ulang
   * voxel grid (material terpotong tetap). Dipanggil saat offset WCS berubah
   * (edit OFFSET/ZERO/touch-off) — menggeser jalur & marker tanpa ini membuat
   * mesh stok/toolpath divergen (H2).
   */
  reposition() {
    for (const e of this.entries) {
      const origin = stockOriginFor(e.fixture, wcsOffset(this.machine, e.fixture.wcs));
      const dx = origin.x - e.stock.originX;
      const dy = origin.y - e.stock.originY;
      const dz = origin.z - e.stock.originZ;
      if (!dx && !dy && !dz) continue;
      e.stock.originX = origin.x;
      e.stock.originY = origin.y;
      e.stock.originZ = origin.z;
      e.origin = origin;
      if (this.scene) {
        e.stock.updateMesh(this.scene, true);
        if (e.vise) {
          // Grup vise memakai sumbu scene: X=mesin X, Y=mesin Z, Z=mesin Y.
          e.vise.position.x += dx;
          e.vise.position.y += dz;
          e.vise.position.z += dy;
        }
      }
    }
  }

  reset() {
    for (const e of this.entries) {
      e.stock.reset();
      e.stock._dirty = true;
    }
  }

  setVisible(v) {
    for (const e of this.entries) {
      if (e.stock.mesh) e.stock.mesh.visible = v;
      if (e.vise) e.vise.visible = v;
    }
  }

  get remainingRatio() {
    let tv = 0, acc = 0;
    for (const e of this.entries) {
      const s = e.stock;
      const vol = s.sizeX * s.sizeY * s.sizeZ;
      tv += vol;
      acc += vol * s.remainingRatio;
    }
    if (tv > 0) return acc / tv;
    if (!this.entries.length) return 1;
    return this.entries.reduce((a, e) => a + e.stock.remainingRatio, 0) / this.entries.length;
  }

  frameBounds() {
    if (!this.entries.length) return null;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const { stock } of this.entries) {
      xMin = Math.min(xMin, stock.originX);
      xMax = Math.max(xMax, stock.originX + stock.sizeX);
      yMin = Math.min(yMin, stock.originY);
      yMax = Math.max(yMax, stock.originY + stock.sizeY);
      zMin = Math.min(zMin, stock.originZ);
      zMax = Math.max(zMax, stock.originZ + stock.sizeZ);
    }
    return {
      x: (xMin + xMax) / 2,
      y: (yMin + yMax) / 2,
      z: (zMin + zMax) / 2,
      span: Math.max(xMax - xMin, yMax - yMin, (zMax - zMin) * 2)
    };
  }

  rebuild() {
    return this.build(this.entries.map((e) => e.fixture));
  }

  dispose() {
    for (const e of this.entries) {
      if (this.scene) {
        e.stock.dispose(this.scene);
        if (e.vise) {
          this.scene.remove(e.vise);
          e.vise.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
          });
        }
      }
    }
    this.entries = [];
    this.byWcs = new Map();
  }
}
