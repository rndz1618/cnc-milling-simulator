/**
 * Hitung bounds stock dari titik toolpath DALAM KOORDINAT MESIN (auto-fit).
 * Dipakai sebagai SARAN ukuran/posisi stock — user tetap bisa override manual.
 */

export function boundsFromPoints(points, opts = {}) {
  const {
    padXY = 5,
    padZBot = 4,
    minSizeX = 20,
    minSizeY = 20,
    minSizeZ = 30,
    maxSizeZ = 80,
    defaultZ = 20,
    maxVoxels = 500000,
    toolRadius = 6,
    topZ = 0,          // bidang Z0 program (offset Z WCS aktif) — top stock di sini
    cutZMax = 5,
    outlierZ = 200
  } = opts;

  if (!points || !points.length) return null;

  const nearWork = [];
  const cutZs = [];

  for (const m of points) {
    if (Math.abs(m.z) > outlierZ + Math.abs(topZ)) continue;
    if (m.type === 'feed' && m.z <= topZ + cutZMax) {
      cutZs.push(m.z);
      nearWork.push(m);
    }
  }

  const xySrc = nearWork.length
    ? nearWork
    : points.filter((m) => m.type === 'feed' && Math.abs(m.z) <= outlierZ);
  const xyPoints = xySrc.length ? xySrc : points.filter((m) => Math.abs(m.z) <= outlierZ);
  if (!xyPoints.length) return null;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const m of xyPoints) {
    minX = Math.min(minX, m.x);
    maxX = Math.max(maxX, m.x);
    minY = Math.min(minY, m.y);
    maxY = Math.max(maxY, m.y);
  }

  const r = toolRadius + padXY;
  minX -= r;
  maxX += r;
  minY -= r;
  maxY += r;

  let sizeX = Math.max(minSizeX, maxX - minX);
  let sizeY = Math.max(minSizeY, maxY - minY);

  let stockTop, stockBot;
  if (cutZs.length) {
    const minCut = Math.min(...cutZs);
    stockTop = topZ;
    stockBot = Math.min(minCut, topZ) - padZBot;
  } else {
    stockTop = topZ;
    stockBot = topZ - defaultZ;
  }

  let sizeZ = stockTop - stockBot;
  if (sizeZ < minSizeZ) {
    stockBot = stockTop - minSizeZ;
    sizeZ = minSizeZ;
  }
  if (sizeZ > maxSizeZ) {
    stockBot = stockTop - maxSizeZ;
    sizeZ = maxSizeZ;
  }

  const originX = minX;
  const originY = minY;
  const originZ = stockBot;

  let res = 1.0;
  const voxels = () =>
    Math.ceil(sizeX / res) * Math.ceil(sizeY / res) * Math.ceil(sizeZ / res);
  while (voxels() > maxVoxels && res < 4) {
    res = Math.round((res + 0.25) * 100) / 100;
  }

  return {
    sizeX: Math.round(sizeX * 100) / 100,
    sizeY: Math.round(sizeY * 100) / 100,
    sizeZ: Math.round(sizeZ * 100) / 100,
    originX: Math.round(originX * 100) / 100,
    originY: Math.round(originY * 100) / 100,
    originZ: Math.round(originZ * 100) / 100,
    res,
    centerX: originX + sizeX / 2,
    centerY: originY + sizeY / 2,
    centerZ: originZ + sizeZ / 2
  };
}

export function formatStockSize(b) {
  if (!b) return '\u2014';
  return (
    Math.round(b.sizeX) + '\u00d7' + Math.round(b.sizeY) + '\u00d7' + Math.round(b.sizeZ) +
    ' r' + b.res
  );
}
