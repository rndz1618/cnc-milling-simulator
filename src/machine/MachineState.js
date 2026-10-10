/**
 * Machine coordinate engine — single source of truth.
 *
 * Semua posisi internal adalah KOORDINAT MESIN (mm, Z-up) dari ujung tool:
 *   machine = work + wcsOffset(activeWcs)
 *   DRO WORK    = machine − wcsOffset
 *   DRO MACHINE = machine
 * Renderer (Three.js), stock, toolpath, dan vise hidup di ruang mesin dan
 * hanya membaca hasil transform — tidak ada perhitungan offset duplikat.
 */

export const MACHINE_PROFILE = {
  travel: { x: [-260, 260], y: [-260, 260], z: [-130, 170] },
  home: { x: 0, y: 0, z: 150 },
  rapidRate: 10000,   // mm/min
  maxRpm: 12000,
  maxRapidOvr: 1
};

export const WCS_NAMES = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];

export function createMachineState() {
  const wcs = {};
  for (const w of WCS_NAMES) wcs[w] = { x: 0, y: 0, z: 0 };
  // Template dua fixture: "ragum kanan" default 90 mm di −Y dari G54.
  // Nilai ini bisa diedit user (OFFSET → WORK) dan dipersist di localStorage.
  wcs.G55 = { x: 0, y: -90, z: 0 };
  return {
    // posisi ujung tool dalam koordinat mesin
    x: MACHINE_PROFILE.home.x,
    y: MACHINE_PROFILE.home.y,
    z: MACHINE_PROFILE.home.z,
    feed: 0,
    spindle: 0,
    spindleTarget: 0,
    spindleOn: false,
    spindleDir: 3,
    coolant: false,
    optStop: true,
    tool: 1,
    hNum: 0,
    hOffset: 0,
    toolLength: 0,
    toolDiameter: 12,
    motion: 'G0',
    plane: 'G17',
    units: 'mm',
    wcs,
    activeWcs: 'G54',
    dtg: { x: 0, y: 0, z: 0 }
  };
}

export function wcsOffset(state, name = state.activeWcs) {
  return (state.wcs && state.wcs[name]) || { x: 0, y: 0, z: 0 };
}

/** work → machine */
export function toMachine(p, off) {
  return { x: p.x + off.x, y: p.y + off.y, z: p.z + off.z };
}

/** machine → work */
export function toWork(p, off) {
  return { x: p.x - off.x, y: p.y - off.y, z: p.z - off.z };
}

/** DRO MACHINE */
export function machineCoords(state) {
  return { x: state.x, y: state.y, z: state.z };
}

/** DRO WORK (dipakai oleh WCS yang sedang aktif) */
export function workCoords(state) {
  return toWork({ x: state.x, y: state.y, z: state.z }, wcsOffset(state));
}

/**
 * Target koordinat MESIN dari sebuah entri parser.
 * Entri normal berisi koordinat work + tag WCS; entri G53 berisi koordinat
 * mesin langsung; entri G28 (type 'home') menuju home pada sumbu yang disebut.
 */
export function moveTarget(move, state) {
  if (move.type === 'home') {
    const t = { x: state.x, y: state.y, z: state.z };
    for (const a of move.axes && move.axes.length ? move.axes : ['z']) {
      t[a] = MACHINE_PROFILE.home[a];
    }
    return t;
  }
  if (move.machine) {
    // G53: sumbu yang tidak ditulis di blok tetap di posisi mesin sekarang.
    return {
      x: move.ax && move.ax.x === false ? state.x : move.x,
      y: move.ax && move.ax.y === false ? state.y : move.y,
      z: move.ax && move.ax.z === false ? state.z : move.z
    };
  }
  return toMachine(
    { x: move.x, y: move.y, z: move.z },
    wcsOffset(state, move.wcs || state.activeWcs)
  );
}

/** Daftar sumbu yang melanggar soft limit ('X','Y','Z'); kosong = aman. */
export function outOfTravel(p) {
  const t = MACHINE_PROFILE.travel;
  const bad = [];
  if (p.x < t.x[0] || p.x > t.x[1]) bad.push('X');
  if (p.y < t.y[0] || p.y > t.y[1]) bad.push('Y');
  if (p.z < t.z[0] || p.z > t.z[1]) bad.push('Z');
  return bad;
}
