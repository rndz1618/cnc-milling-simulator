export function createMachineState() {
  return {
    x: 0, y: 0, z: 50,       // machine coords
    workX: 0, workY: 0, workZ: 50,
    feed: 0,
    spindle: 0,
    spindleOn: false,
    coolant: false,
    tool: 1,
    absolute: true,
    g54: { x: 0, y: 0, z: 0 },
    toolLength: 0,
    toolDiameter: 6
  };
}

export function updateWorkCoords(state) {
  state.workX = state.x - state.g54.x;
  state.workY = state.y - state.g54.y;
  state.workZ = state.z - state.g54.z - state.toolLength;
}
