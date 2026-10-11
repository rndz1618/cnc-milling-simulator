/**
 * Profil tool bertingkat (flute/shank/holder) — murni, tanpa DOM/three.js.
 * Derivasi harus sama dengan createToolMesh di src/view/Scene.js.
 */

const DEFAULT_TOOL_SPEC = { dia: 12, flute: 36, overall: 100 };

export function toolProfile(spec = DEFAULT_TOOL_SPEC) {
  const d = Math.max(1, spec.dia || DEFAULT_TOOL_SPEC.dia);
  const r = d / 2;
  const overall = Math.max(d + 30, spec.overall || DEFAULT_TOOL_SPEC.overall);
  const fluteLen = Math.max(4, Math.min(spec.flute || d * 3, overall - 26));
  const colletLen = Math.max(10, d * 0.9);
  const stubLen = 14;
  const shankLen = Math.max(6, overall - fluteLen - colletLen - stubLen);
  const shankR = Math.max(r * 1.02, 6);
  const colletR = Math.max(shankR * 1.3, 11);
  return { r, fluteLen, shankR, shankLen, colletR, colletLen, stubLen, overall };
}

// Radius pada tinggi h di atas ujung tool; null bila h melewati overall.
export function radiusAt(profile, h) {
  if (h < 0 || h > profile.overall) return null;
  if (h <= profile.fluteLen) return profile.r;
  if (h <= profile.fluteLen + profile.shankLen) return profile.shankR;
  return profile.colletR;
}

/** Uji titik pusat + ring 6 titik pada 0.85*radius (pola _checkRapidCrash). */
function discHits(pointInStock, cx, cy, cz, radius) {
  if (pointInStock(cx, cy, cz)) return true;
  const ringR = radius * 0.85;
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI * 2 * k) / 6;
    if (pointInStock(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, cz)) return true;
  }
  return false;
}

/**
 * Uji kolisi tool sepanjang segmen gerak p0→p1 (titik ujung tool).
 * Flute diperiksa di ujung (h≈0) & tengah flute supaya tiap bagian flute
 * yang menyentuh material terdeteksi; shank/holder diperiksa di muka
 * bawahnya (muka terendah tiap bagian). Flute lebih dulu; bila flute tidak
 * kena tapi shank/holder kena → HOLDER CRASH.
 */
export function sampleCollision(pointInStock, p0, p1, profile) {
  const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  if (dist < 1e-6) return null;
  const step = Math.max(profile.r * 0.5, 0.5);
  const n = Math.max(1, Math.ceil(dist / step));
  // Tinggi probe relatif ujung tool. radiusAt di batas mengembalikan bagian
  // bawah, jadi geser sedikit agar muka bawah shank/holder memakai radius
  // bagiannya sendiri (muka bawah holder = colletR).
  const fluteH = [0, profile.fluteLen / 2];
  const bodyH = [profile.fluteLen, profile.fluteLen + profile.shankLen];
  const radiusOf = (h) => radiusAt(profile, h + 1e-6);
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + (p1.y - p0.y) * t;
    const z = p0.z + (p1.z - p0.z) * t;
    for (const h of fluteH) {
      if (discHits(pointInStock, x, y, z + h, radiusOf(h))) return 'RAPID CRASH';
    }
    for (const h of bodyH) {
      if (discHits(pointInStock, x, y, z + h, radiusOf(h))) return 'HOLDER CRASH';
    }
  }
  return null;
}
