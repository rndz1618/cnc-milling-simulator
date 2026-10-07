/**
 * Basic G-code parser → array of motion moves.
 */
export function parseGCode(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let x = 0, y = 0, z = 50, f = 500, spindle = 0;
  let absolute = true;
  let tool = 0;
  let lineNum = 0;

  for (const raw of lines) {
    lineNum++;
    let line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    line = line.replace(/^N\d+\s*/i, '');

    const tokens = line.match(/[A-Z][-+]?[0-9]*\.?[0-9]*/gi) || [];
    if (!tokens.length) continue;

    let g = null, m = null;
    let nx = null, ny = null, nz = null, nf = null, ns = null, nt = null;

    for (const t of tokens) {
      const letter = t[0].toUpperCase();
      const val = parseFloat(t.slice(1));
      if (isNaN(val) && letter !== 'G' && letter !== 'M') continue;
      switch (letter) {
        case 'G': g = val; break;
        case 'M': m = val; break;
        case 'X': nx = val; break;
        case 'Y': ny = val; break;
        case 'Z': nz = val; break;
        case 'F': nf = val; break;
        case 'S': ns = val; break;
        case 'T': nt = val; break;
      }
    }

    if (g === 90) absolute = true;
    if (g === 91) absolute = false;
    if (nf !== null) f = nf;
    if (ns !== null) spindle = ns;
    if (nt !== null) tool = nt;

    if (g === 0 || g === 1 || (g === null && (nx !== null || ny !== null || nz !== null))) {
      const type = g === 0 ? 'rapid' : 'feed';
      const tx = nx !== null ? (absolute ? nx : x + nx) : x;
      const ty = ny !== null ? (absolute ? ny : y + ny) : y;
      const tz = nz !== null ? (absolute ? nz : z + nz) : z;

      result.push({
        x: tx, y: ty, z: tz, f, type,
        line: lineNum, raw, spindle, tool,
        m: m
      });
      x = tx; y = ty; z = tz;
    }
  }

  // Estimate time (seconds)
  let totalTime = 0;
  let px = 0, py = 0, pz = 50;
  for (const mv of result) {
    const dist = Math.sqrt((mv.x - px) ** 2 + (mv.y - py) ** 2 + (mv.z - pz) ** 2);
    const feed = mv.type === 'rapid' ? 5000 : (mv.f || 500);
    totalTime += (dist / feed) * 60;
    px = mv.x; py = mv.y; pz = mv.z;
  }

  return { moves: result, totalTime };
}
