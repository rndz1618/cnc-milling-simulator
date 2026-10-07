/**
 * Compute stock bounds from toolpath moves for auto-fit.
 * XY from all moves; Z from feed moves (cutting depth).
 * Stock top defaults near Z=0 (WCS part zero convention).
 */
export function boundsFromMoves(moves, opts = {}) {
  const {
    padXY = 5,
    padZTop = 0.5,
    padZBot = 2,
    minSizeX = 20,
    minSizeY = 20,
    minSizeZ = 10,
    defaultZ = 20,
    maxVoxels = 600000,
    toolRadius = 3
  } = opts;

  if (!moves || !moves.length) return null;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let minFeedZ = Infinity, maxFeedZ = -Infinity;
  let hasFeed = false;

  for (const m of moves) {
    minX = Math.min(minX, m.x);
    maxX = Math.max(maxX, m.x);
    minY = Math.min(minY, m.y);
    maxY = Math.max(maxY, m.y);
    minZ = Math.min(minZ, m.z);
    maxZ = Math.max(maxZ, m.z);
    if (m.type === 'feed') {
      hasFeed = true;
      minFeedZ = Math.min(minFeedZ, m.z);
      maxFeedZ = Math.max(maxFeedZ, m.z);
    }
  }

  // Expand XY by tool radius + pad so cutter stays inside stock edges
  const r = toolRadius + padXY;
  minX -= r;
  maxX += r;
  minY -= r;
  maxY += r;

  let sizeX = Math.max(minSizeX, maxX - minX);
  let sizeY = Math.max(minSizeY, maxY - minY);

  // Z: stock top near highest cutting surface or Z0
  let stockTop, stockBot;
  if (hasFeed) {
    stockTop = Math.max(0, maxFeedZ) + padZTop;
    stockBot = Math.min(minFeedZ, 0) - padZBot;
  } else {
    stockTop = padZTop;
    stockBot = -defaultZ;
  }
  if (stockTop - stockBot < minSizeZ) {
    stockBot = stockTop - minSizeZ;
  }

  let sizeZ = stockTop - stockBot;
  const originX = minX;
  const originY = minY;
  const originZ = stockBot;

  // Auto resolution to stay under maxVoxels
  let res = 1.0;
  const voxels = () =>
    Math.ceil(sizeX / res) * Math.ceil(sizeY / res) * Math.ceil(sizeZ / res);
  while (voxels() > maxVoxels && res < 5) {
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
