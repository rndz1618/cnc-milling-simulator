/**
 * G-code parser → motion moves.
 * Supports: G0/G1 modal, G2/G3 arcs (IJK or R, G17 XY), multi-G lines,
 * G90/G91, G54–G59 WCS, M30 stop, M97 Pnn Lkk (Haas), bare decimals (Z. → 0).
 */
export function parseGCode(text) {
  const rawLines = text.split(/\r?\n/);

  const subs = new Map();
  let currentSub = null;
  let currentBody = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    let line = raw.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
    if (!line || line === '%') continue;

    const nMatch = line.match(/^N(\d+)\b/i);
    if (nMatch) {
      if (currentSub != null) subs.set(currentSub, currentBody);
      currentSub = parseInt(nMatch[1], 10);
      currentBody = [];
      const rest = line.replace(/^N\d+\s*/i, '').trim();
      if (rest) currentBody.push({ raw, line: rest, lineNum: i + 1 });
      continue;
    }

    if (currentSub != null) {
      if (/\bM99\b/i.test(line)) {
        subs.set(currentSub, currentBody);
        currentSub = null;
        currentBody = [];
        continue;
      }
      currentBody.push({ raw, line, lineNum: i + 1 });
    }
  }
  if (currentSub != null) subs.set(currentSub, currentBody);

  const mainBlocks = [];
  let inSubDef = false;
  const alarms = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    let line = raw.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
    if (!line || line === '%') continue;

    if (/^N\d+\b/i.test(line)) {
      inSubDef = true;
      continue;
    }
    if (inSubDef) {
      if (/\bM99\b/i.test(line)) inSubDef = false;
      continue;
    }

    if (/\bM30\b/i.test(line) || /\bM2\b/i.test(line)) break;

    const m97 = line.match(/\bM97\b/i);
    if (m97) {
      const pMatch = line.match(/\bP(\d+)/i);
      const lMatch = line.match(/\bL(\d+)/i);
      const pNum = pMatch ? parseInt(pMatch[1], 10) : null;
      const loops = lMatch ? Math.max(1, parseInt(lMatch[1], 10)) : 1;
      if (pNum != null && subs.has(pNum)) {
        const body = subs.get(pNum);
        for (let rep = 0; rep < loops; rep++) {
          for (const b of body) mainBlocks.push(b);
        }
      }
      continue;
    }

    mainBlocks.push({ raw, line, lineNum: i + 1 });
  }

  return blocksToMoves(mainBlocks, alarms);
}

function parseAxisNum(numStr) {
  if (numStr === '' || numStr === '+' || numStr === '-' || numStr === '.') return 0;
  if (numStr === '+.' || numStr === '-.') return 0;
  const val = parseFloat(numStr);
  return Number.isNaN(val) ? null : val;
}

const KNOWN_G = new Set([
  0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 28, 40, 41, 42, 43, 49,
  54, 55, 56, 57, 58, 59, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  90, 91, 98, 99
]);

/** Expand G2/G3 arc (G17 XY) into linear feed segments. */
function expandArc(x0, y0, z0, x1, y1, z1, i, j, r, cw, segs = 24) {
  let cx, cy;
  if (i != null || j != null) {
    cx = x0 + (i || 0);
    cy = y0 + (j || 0);
  } else if (r != null && r !== 0) {
    const dx = x1 - x0, dy = y1 - y0;
    const chord = Math.sqrt(dx * dx + dy * dy);
    if (chord < 1e-9) return [{ x: x1, y: y1, z: z1 }];
    const rr = Math.abs(r);
    const h2 = rr * rr - (chord * 0.5) * (chord * 0.5);
    const h = Math.sqrt(Math.max(0, h2));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const nx = -dy / chord, ny = dx / chord;
    const side = (r >= 0) === cw ? -1 : 1;
    cx = mx + side * h * nx;
    cy = my + side * h * ny;
  } else {
    return [{ x: x1, y: y1, z: z1 }];
  }

  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let a1 = Math.atan2(y1 - cy, x1 - cx);
  let da = a1 - a0;
  if (cw) {
    while (da > 0) da -= Math.PI * 2;
    if (Math.abs(da) < 1e-9) da = -Math.PI * 2;
  } else {
    while (da < 0) da += Math.PI * 2;
    if (Math.abs(da) < 1e-9) da = Math.PI * 2;
  }

  const rad = Math.sqrt((x0 - cx) ** 2 + (y0 - cy) ** 2) || 1;
  const n = Math.max(8, Math.min(72, Math.ceil(Math.abs(da) / (Math.PI / segs))));
  const pts = [];
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const ang = a0 + da * t;
    pts.push({
      x: cx + rad * Math.cos(ang),
      y: cy + rad * Math.sin(ang),
      z: z0 + (z1 - z0) * t
    });
  }
  pts[pts.length - 1] = { x: x1, y: y1, z: z1 };
  return pts;
}

function blocksToMoves(blocks, alarms = []) {
  const result = [];
  let x = 0, y = 0, z = 50;
  let f = 500, spindle = 0, tool = 0;
  let absolute = true;
  let motion = 0;
  let wcs = 'G54';

  for (const blk of blocks) {
    let line = blk.line.replace(/^N\d+\s*/i, '');
    const tokens = line.match(/[A-Za-z][-+]?[0-9]*\.?[0-9]*/g) || [];
    if (!tokens.length) continue;

    const gCodes = [];
    let m = null;
    let nx = null, ny = null, nz = null, nf = null, ns = null, nt = null;
    let ni = null, nj = null, nk = null, nr = null;

    for (const t of tokens) {
      const letter = t[0].toUpperCase();
      const numStr = t.slice(1);
      const val = parseAxisNum(numStr);
      if (val === null && letter !== 'G' && letter !== 'M') continue;
      switch (letter) {
        case 'G': gCodes.push(val === null ? 0 : val); break;
        case 'M': m = val; break;
        case 'X': nx = val; break;
        case 'Y': ny = val; break;
        case 'Z': nz = val; break;
        case 'F': nf = val; break;
        case 'S': ns = val; break;
        case 'T': nt = val; break;
        case 'I': ni = val; break;
        case 'J': nj = val; break;
        case 'K': nk = val; break;
        case 'R': nr = val; break;
        default: break;
      }
    }

    for (const g of gCodes) {
      if (g === 90) absolute = true;
      else if (g === 91) absolute = false;
      else if (g === 0) motion = 0;
      else if (g === 1) motion = 1;
      else if (g === 2) motion = 2;
      else if (g === 3) motion = 3;
      else if (g >= 54 && g <= 59) wcs = 'G' + g;
      else if (!KNOWN_G.has(g) && Number.isInteger(g)) {
        alarms.push({ line: blk.lineNum, code: 'G' + g, msg: 'Unknown G-code G' + g });
      }
    }

    if (nf !== null) f = nf;
    if (ns !== null) spindle = ns;
    if (nt !== null) tool = nt;
    if (m === 5) spindle = 0;

    const hasAxis = nx !== null || ny !== null || nz !== null;
    if (!hasAxis) continue;

    const tx = nx !== null ? (absolute ? nx : x + nx) : x;
    const ty = ny !== null ? (absolute ? ny : y + ny) : y;
    const tz = nz !== null ? (absolute ? nz : z + nz) : z;

    if (tx === x && ty === y && tz === z && motion !== 2 && motion !== 3) continue;

    const meta = {
      f, line: blk.lineNum, raw: (blk.raw || '').trim(),
      spindle, tool, m, wcs
    };

    if (motion === 2 || motion === 3) {
      const pts = expandArc(x, y, z, tx, ty, tz, ni, nj, nr, motion === 2);
      for (const p of pts) {
        result.push({ x: p.x, y: p.y, z: p.z, type: 'feed', ...meta });
      }
    } else {
      const type = motion === 0 ? 'rapid' : 'feed';
      result.push({ x: tx, y: ty, z: tz, type, ...meta });
    }

    x = tx; y = ty; z = tz;
  }

  let totalTime = 0;
  let px = 0, py = 0, pz = 50;
  for (const mv of result) {
    const dist = Math.sqrt((mv.x - px) ** 2 + (mv.y - py) ** 2 + (mv.z - pz) ** 2);
    const feed = mv.type === 'rapid' ? 5000 : (mv.f || 500);
    totalTime += (dist / Math.max(1, feed)) * 60;
    px = mv.x; py = mv.y; pz = mv.z;
  }

  return { moves: result, totalTime, alarms };
}
