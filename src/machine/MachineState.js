/** Machine state used by Simulator & UI */

export function createMachineState() {
  return {
    x: 0,
    y: 0,
    z: 50,
    g54: { x: 0, y: 0, z: 0 },
    toolLength: 0,
    toolDiameter: 6,
    tool: 1,
    feed: 0,
    spindle: 0,
    spindleOn: false
  };
}

export function updateWorkCoords(state) {
  // Work = machine - G54 - tool length (Z)
  return {
    x: state.x - state.g54.x,
    y: state.y - state.g54.y,
    z: state.z - state.g54.z - state.toolLength
  };
}
