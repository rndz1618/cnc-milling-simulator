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

  const flush = () => {
    if (!buf.length) return;
    const P = [{ x: startPos.x, y: startPos.y }];
    for (const m of buf) P.push({ x: m.x, y: m.y });
    const seg = [];
    for (let i = 0; i < buf.length; i++) {
      seg.push(normalFor(P[i].x, P[i].y, P[i + 1].x, P[i + 1].y));
    }
    for (let i = 0; i < buf.length; i++) {
      const m = { ...buf[i] };
      if (i < buf.length - 1) {
        const a1 = { x: P[i + 1].x + seg[i].o.x, y: P[i + 1].y + seg[i].o.y };
        const a2 = { x: P[i + 1].x + seg[i + 1].o.x, y: P[i + 1].y + seg[i + 1].o.y };
        const d0 = seg[i].d, d1 = seg[i + 1].d;
        const den = d0.x * d1.y - d0.y * d1.x;
        if (Math.abs(den) < 1e-9) {
          m.x = a1.x; m.y = a1.y;
        } else {
          const t = ((a2.x - a1.x) * d1.y - (a2.y - a1.y) * d1.x) / den;
          m.x = a1.x + t * d0.x;
          m.y = a1.y + t * d0.y;
        }
      } else {
        m.x = P[i + 1].x + seg[i].o.x;
        m.y = P[i + 1].y + seg[i].o.y;
      }
      out.push(m);
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
