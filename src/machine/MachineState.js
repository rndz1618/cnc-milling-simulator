/**
 * Machine / work coordinate state.
 *
 * Model (Tahap 1):
 *   work  = programmed coordinates (G-code XYZ under active WCS)
 *   machine = work + active WCS offset (G54/G55/…)
 *   tool tip is rendered at WORK so it stays aligned with stock & toolpath
 *   (stock lives in work space). DRO MACHINE = work + g54.
 */
export function createMachineState() {
  return {
    x: 0, y: 0, z: 50,
    workX: 0, workY: 0, workZ: 50,
    feed: 0,
    spindle: 0,
    spindleOn: false,
    coolant: false,
    tool: 1,
    absolute: true,
    motion: 'G0',
    plane: 'G17',
    units: 'G21',
    g54: { x: 0, y: 0, z: 0 },
    activeWcs: 'G54',
    toolLength: 0,
    toolDiameter: 12,
    dtgX: 0, dtgY: 0, dtgZ: 0
  };
}

export function updateWorkCoords(state) {
  state.workX = state.x;
  state.workY = state.y;
  state.workZ = state.z;
  return { x: state.workX, y: state.workY, z: state.workZ };
}

export function machineCoords(state) {
  const o = state.g54 || { x: 0, y: 0, z: 0 };
  return {
    x: state.x + (o.x || 0),
    y: state.y + (o.y || 0),
    z: state.z + (o.z || 0) + (state.toolLength || 0)
  };
}
