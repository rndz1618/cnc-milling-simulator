/**
 * Kompensasi radius tool G41/G42 — pass murni, koordinat WORK (plane G17).
 * Menggeser target X/Y tiap gerakan sejauh radius tool, ke kiri/kanan arah travel.
 * Vertex sambungan memakai miter (perpotongan dua garis offset) — lead-in/out
 * otomatis dari posisi nyata ke titik offset pertama.
 */
export function applyCutterComp(moves, { getRadius }) {
  const out = [];
  let side = null;
  let radius = 0;
  let pos = { x: 0, y: 0 };
  let startPos = { x: 0, y: 0 };
  let buf = [];

  const isMotion = (m) => m.type === 'rapid' || m.type === 'feed';

  const normalFor = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { d: { x: 1, y: 0 }, o: { x: 0, y: 0 } };
    const d = { x: dx / len, y: dy / len };
    const o = side === 'left'
      ? { x: -d.y * radius, y: d.x * radius }
      : { x: d.y * radius, y: -d.x * radius };
    return { d, o };
  };

  // Perpotongan dua garis offset (miter) di vertex Pj — sudut dalam jadi rapi.
  const miterPoint = (Pj, inc, outSeg) => {
    const a1 = { x: Pj.x + inc.o.x, y: Pj.y + inc.o.y };
    const a2 = { x: Pj.x + outSeg.o.x, y: Pj.y + outSeg.o.y };
    const den = inc.d.x * outSeg.d.y - inc.d.y * outSeg.d.x;
    if (Math.abs(den) < 1e-9) return { x: a2.x, y: a2.y };
    const t = ((a2.x - a1.x) * outSeg.d.y - (a2.y - a1.y) * outSeg.d.x) / den;
    return { x: a1.x + t * inc.d.x, y: a1.y + t * inc.d.y };
  };

  const flush = () => {
    if (!buf.length) return;
    const n = buf.length;
    const P = [{ x: startPos.x, y: startPos.y }];
    for (const m of buf) P.push({ x: m.x, y: m.y });
    // seg[i] = offset/normal segmen P[i]→P[i+1]; null bila tak ada gerak XY.
    const seg = [];
    for (let i = 0; i < n; i++) {
      const zeroXy = Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y) < 1e-9;
      seg.push(zeroXy ? null : normalFor(P[i].x, P[i].y, P[i + 1].x, P[i + 1].y));
    }
    // Offsetting hanya vertex yang tersentuh segmen XY nyata (miter sisi dalam).
    const vOff = new Array(n + 1).fill(null);
    for (let j = 0; j <= n; j++) {
      const inc = j - 1 >= 0 ? seg[j - 1] : null;
      const outSeg = j < n ? seg[j] : null;
      if (inc && outSeg) vOff[j] = miterPoint(P[j], inc, outSeg);
      else if (outSeg) vOff[j] = { x: P[j].x + outSeg.o.x, y: P[j].y + outSeg.o.y };
      else if (inc) vOff[j] = { x: P[j].x + inc.o.x, y: P[j].y + inc.o.y };
    }
    let carry = null;
    for (let i = 0; i < n; i++) {
      // Gerak tanpa perpindahan XY (plunge/retract) → pertahankan offset saat ini,
      // jangan tarik tool ke titik terprogram (gouge sudut).
      const target = seg[i] ? vOff[i + 1] : vOff[i];
      const p = target || carry || { x: P[i].x, y: P[i].y };
      carry = p;
      out.push({ ...buf[i], x: p.x, y: p.y });
    }
    buf = [];
  };

  for (const m of moves) {
    if (m.type === 'comp') {
      flush();
      side = m.side;
      radius = side ? getRadius(m.d) : 0;
      out.push(m);
      continue;
    }
    const compMotion = isMotion(m) && !m.machine && side !== null;
    if (!compMotion) {
      flush();
      if (isMotion(m)) pos = { x: m.x, y: m.y };
      out.push(m);
      continue;
    }
    if (!buf.length) startPos = { x: pos.x, y: pos.y };
    buf.push(m);
    pos = { x: m.x, y: m.y };
  }
  flush();

  return out;
}
