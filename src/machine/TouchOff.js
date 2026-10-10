export const EDGES = ['x-', 'x+', 'y-', 'y+', 'z-top'];

function axisOf(edge) {
  return edge[0];
}

export function edgePlane(edge, origin, size) {
  const axis = axisOf(edge);
  if (edge === 'x-') return { axis, value: origin.x };
  if (edge === 'x+') return { axis, value: origin.x + size.x };
  if (edge === 'y-') return { axis, value: origin.y };
  if (edge === 'y+') return { axis, value: origin.y + size.y };
  return { axis, value: origin.z + size.z };
}

function surfaceCoord(edge, toolRadius, machinePos) {
  if (edge === 'x-') return machinePos.x + toolRadius;
  if (edge === 'x+') return machinePos.x - toolRadius;
  if (edge === 'y-') return machinePos.y + toolRadius;
  if (edge === 'y+') return machinePos.y - toolRadius;
  return machinePos.z;
}

export function contactOffset(edge, toolRadius, machinePos) {
  return { axis: axisOf(edge), value: surfaceCoord(edge, toolRadius, machinePos) };
}

export function checkContact(edge, toolRadius, machinePos, plane, eps = 0.05) {
  return Math.abs(surfaceCoord(edge, toolRadius, machinePos) - plane.value) <= eps;
}
