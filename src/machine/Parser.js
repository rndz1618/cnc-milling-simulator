/**
 * G-code parser → array of motion moves.
 * Handles real machine programs: multiple G on one line, modal G0/G1,
 * trailing decimals (X4.), G43 Z moves, unknown G codes ignored.
 */
export function parseGCode(text) {
  const lines = text.split(/\r?\n/);
  const result = [];

  let x = 0;
  let y = 0;
  let z = 50;
  let f = 500;
  let spindle = 0;
  let absolute = true;
  let tool = 0;
  let motion = 0; // modal: 0 = rapid, 1 = feed
  let lineNum = 0;

  for (const raw of lines) {
    lineNum++;
    let line = raw.replace(/;.*$/, '');
    line = line.replace(/\([^)]*\)/g, '');
    line = line.trim();
    if (!line || line === '%') continue;
    line = line.replace(/^N\d+\s*/i, '');

    const tokens = line.match(/[A-Za-z][-+]?[0-9]*\.?[0-9]*/g) || [];
    if (!tokens.length) continue;

    const gCodes = [];
    let m = null;
    let nx = null;
    let ny = null;
    let nz = null;
    let nf = null;
    let ns = null;
    let nt = null;

    for (const t of tokens) {
      const letter = t[0].toUpperCase();
      const numStr = t.slice(1);
      if (numStr === '' || numStr === '+' || numStr === '-') continue;
      const val = parseFloat(numStr);
      if (Number.isNaN(val)) continue;

      switch (letter) {
        case 'G': gCodes.push(val); break;
        case 'M': m = val; break;
        case 'X': nx = val; break;
        case 'Y': ny = val; break;
        case 'Z': nz = val; break;
        case 'F': nf = val; break;
        case 'S': ns = val; break;
        case 'T': nt = val; break;
        default: break;
      }
    }

    for (const g of gCodes) {
      if (g === 90) absolute = true;
      else if (g === 91) absolute = false;
      else if (g === 0) motion = 0;
      else if (g === 1) motion = 1;
      else if (g === 2 || g === 3) motion = 1;
    }

    if (nf !== null) f = nf;
    if (ns !== null) spindle = ns;
    if (nt !== null) tool = nt;
    if (m === 5) spindle = 0;

    const hasAxis = nx !== null || ny !== null || nz !== null;
    if (!hasAxis) continue;

    let type = motion === 0 ? 'rapid' : 'feed';
    for (const g of gCodes) {
      if (g === 0) type = 'rapid';
      if (g === 1 || g === 2 || g === 3) type = 'feed';
    }

    const tx = nx !== null ? (absolute ? nx : x + nx) : x;
    const ty = ny !== null ? (absolute ? ny : y + ny) : y;
    const tz = nz !== null ? (absolute ? nz : z + nz) : z;

    if (tx === x && ty === y && tz === z) continue;

    result.push({
      x: tx, y: ty, z: tz, f, type,
      line: lineNum, raw: raw.trim(), spindle, tool, m
    });

    x = tx; y = ty; z = tz;
    motion = type === 'rapid' ? 0 : 1;
  }

  let totalTime = 0;
  let px = 0, py = 0, pz = 50;
  for (const mv of result) {
    const dist = Math.sqrt((mv.x - px) ** 2 + (mv.y - py) ** 2 + (mv.z - pz) ** 2);
    const feed = mv.type === 'rapid' ? 5000 : (mv.f || 500);
    totalTime += (dist / Math.max(1, feed)) * 60;
    px = mv.x; py = mv.y; pz = mv.z;
  }

  return { moves: result, totalTime };
}
