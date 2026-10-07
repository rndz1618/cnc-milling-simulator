/** Machine state: work offsets, tool length, spindle, feed */

export function createMachineState() {
  return {
    g54: { x: 0, y: 0, z: 0 },
    toolLength: 0,
    toolDia: 6,
    spindleRpm: 0,
    spindleOn: false,
    feedRate: 0,
    workX: 0,
    workY: 0,
    workZ: 50,
    machineX: 0,
    machineY: 0,
    machineZ: 50
  };
}

export function updateWorkCoords(state, mx, my, mz) {
  state.machineX = mx;
  state.machineY = my;
  state.machineZ = mz;
  state.workX = mx - state.g54.x;
  state.workY = my - state.g54.y;
  state.workZ = mz - state.g54.z - state.toolLength;
}
