/**
 * G-code parser → stream entri untuk Simulator.
 *
 * Entri yang dihasilkan:
 *   { type:'rapid'|'feed', x,y,z (work; machine:true untuk G53), wcs, f, spindle, tool, line, raw }
 *   { type:'home', axes:['z'], line, raw }                    — G28
 *   { type:'tool', tool, line, raw }                          — T.. M06
 *   { type:'toolcomp', h, line, raw }                         — G43 H / G49
 *   { type:'coolant', on, line, raw }                         — M08/M09
 *   { type:'stop', optional?, end?, line, raw }               — M00/M01/M30
 *   { type:'alarm', code, msg, line, raw }                    — kode salah: blok TIDAK dieksekusi
 *
 * Dukungan: G0–G3 (arc IJK/R, G17), G4, G17–G19, G20/G21 (konversi inch↔mm),
 * G28, G40, G41/G42 (alarm: belum didukung), G43 H/G49, G53, G54–G59,
 * G80–G83 (canned cycle drill: G98/G99), G90/G91, M0/1/3/4/5/6/8/9/30/97/99,
 * subprogram lokal O#### + M97 P L (dialek Haas), N#### = nomor baris (bukan sub).
 * Bare decimal: "Z." = 0, "Z.5" = 0.5.
 */
export function parseGCode(text) {
  const rawLines = text.split(/\r?\n/);

  // ---------- Pass 1: bersihkan baris, deteksi subprogram lokal (O####) ----------
  const cleaned = [];
  let sawMeaningful = false;
  let mainOSeen = false;
  let subStart = null;
  const subs = new Map();

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const line = raw.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
    if (!line || line === '%') continue;
    const lineNum = i + 1;

    // "O1234" sendirian: header program utama (baris pertama) ATAU awal sub lokal.
    const oMatch = line.match(/^O(\d+)$/i);
    if (oMatch) {
      if (!mainOSeen && !sawMeaningful) {
        mainOSeen = true; // header program utama — lewati
      } else if (subStart == null) {
        subStart = parseInt(oMatch[1], 10); // definisi sub lokal dimulai
      }
      sawMeaningful = true;
      continue;
    }
    sawMeaningful = true;

    if (subStart != null) {
      if (/\bM99\b/i.test(line)) {
        subs.set(subStart, subs.get(subStart) || []);
        subStart = null;
      } else {
        if (!subs.has(subStart)) subs.set(subStart, []);
        subs.get(subStart).push({ raw, line, lineNum });
      }
      continue;
    }
    cleaned.push({ raw, line, lineNum });
  }
  if (subStart != null && !subs.has(subStart)) subs.set(subStart, []);

  // ---------- Pass 2: rangkai blok utama, ekspansi M97 ----------
  const mainBlocks = [];
  for (const blk of cleaned) {
    if (/\bM30\b/i.test(blk.line) || /\bM2\b/i.test(blk.line)) {
      mainBlocks.push(blk);
      break;
    }
    const m97s = blk.line.match(/\bM97\b/i);
    if (m97s) {
      const pMatch = blk.line.match(/\bP(\d+)/i);
      const lMatch = blk.line.match(/\bL(\d+)/i);
      const pNum = pMatch ? parseInt(pMatch[1], 10) : null;
      const loops = lMatch ? Math.max(1, Math.min(999, parseInt(lMatch[1], 10))) : 1;
      if (pNum != null && subs.has(pNum)) {
        const body = subs.get(pNum);
        for (let rep = 0; rep < loops; rep++) {
          for (const b of body) mainBlocks.push(b);
        }
      } else {
        mainBlocks.push(blk); // P tidak ditemukan → biarkan memunculkan alarm
      }
      continue;
    }
    mainBlocks.push(blk);
  }

  return blocksToMoves(mainBlocks);
}

function parseAxisNum(numStr) {
  if (numStr === '' || numStr === '+' || numStr === '-' || numStr === '.') return 0;
  if (numStr === '+.' || numStr === '-.') return 0;
  const val = parseFloat(numStr);
  return Number.isNaN(val) ? null : val;
}

const KNOWN_G = new Set([
  0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 28, 40, 41, 42, 43, 49, 53,
  54, 55, 56, 57, 58, 59, 80, 81, 82, 83, 84, 90, 91, 98, 99
]);
const KNOWN_M = new Set([0, 1, 3, 4, 5, 6, 8, 9, 30, 97, 99]);

/** Ekspansi arc G2/G3 plane-aware (G17 XY, G18 ZX, G19 YZ) menjadi segmen linear. */
function expandArc(x0, y0, z0, x1, y1, z1, i, j, k, r, cw, plane = 17, segs = 24) {
  // Sumbu in-plane (u,v) dengan u×v = normal positif bidang (sesuai arah G2/G3).
  let u0, v0, u1, v1, iu, jv;
  if (plane === 18) { u0 = z0; v0 = x0; u1 = z1; v1 = x1; iu = k; jv = i; }
  else if (plane === 19) { u0 = y0; v0 = z0; u1 = y1; v1 = z1; iu = j; jv = k; }
  else { u0 = x0; v0 = y0; u1 = x1; v1 = y1; iu = i; jv = j; }

  const emit = (pu, pv, t) => {
    if (plane === 18) return { x: pv, y: y0, z: pu };
    if (plane === 19) return { x: x0, y: pu, z: pv };
    return { x: pu, y: pv, z: z0 + (z1 - z0) * t };
  };

  let cu, cv;
  if (iu != null || jv != null) {
    cu = u0 + (iu || 0);
    cv = v0 + (jv || 0);
  } else if (r != null && r !== 0) {
    const du = u1 - u0, dv = v1 - v0;
    const chord = Math.sqrt(du * du + dv * dv);
    if (chord < 1e-9) return [emit(u1, v1, 1)];
    const rr = Math.abs(r);
    const h = Math.sqrt(Math.max(0, rr * rr - (chord * 0.5) * (chord * 0.5)));
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    const nu = -dv / chord, nv = du / chord;
    const side = (r >= 0) === cw ? -1 : 1;
    cu = mu + side * h * nu;
    cv = mv + side * h * nv;
  } else {
    return [emit(u1, v1, 1)];
  }

  const a0 = Math.atan2(v0 - cv, u0 - cu);
  const a1 = Math.atan2(v1 - cv, u1 - cu);
  let da = a1 - a0;
  if (cw) {
    while (da > 0) da -= Math.PI * 2;
    if (Math.abs(da) < 1e-9) da = -Math.PI * 2;
  } else {
    while (da < 0) da += Math.PI * 2;
    if (Math.abs(da) < 1e-9) da = Math.PI * 2;
  }

  const rad = Math.sqrt((u0 - cu) ** 2 + (v0 - cv) ** 2) || 1;
  const n = Math.max(8, Math.min(72, Math.ceil(Math.abs(da) / (Math.PI / segs))));
  const pts = [];
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const ang = a0 + da * t;
    pts.push(emit(cu + rad * Math.cos(ang), cv + rad * Math.sin(ang), t));
  }
  pts[pts.length - 1] = emit(u1, v1, 1);
  return pts;
}

function blocksToMoves(blocks) {
  const moves = [];
  const alarms = [];
  // Posisi awal dalam koordinat WORK (untuk G91 tanpa referensi mesin).
  let x = 0, y = 0, z = 0;
  let f = 500, spindle = 0, spindleDir = 3, tool = 0;
  let absolute = true;
  let motion = 0;
  let plane = 17;
  let units = 'mm';
  let wcs = 'G54';
  let retract = 'G99';
  let cycle = null; // { g, z, r, q }
  let compSide = null; // 'left' | 'right' | null — modal cutter comp aktif

  const scale = () => (units === 'in' ? 25.4 : 1);

  for (const blk of blocks) {
    // Buang nomor baris N#### — hanya label, bukan subprogram.
    let line = blk.line.replace(/^N\d+\s*/i, '');
    const tokens = line.match(/[A-Za-z][-+]?[0-9]*\.?[0-9]*/g) || [];
    if (!tokens.length) continue;

    const gCodes = [];
    const mCodes = [];
    let nx = null, ny = null, nz = null, nf = null, ns = null, nt = null;
    let ni = null, nj = null, nk = null, nr = null, nq = null, np = null, nh = null, nl = null, nd = null;
    let sawG28 = false, sawG53 = false, sawCycleWord = false, group1 = false;

    for (const t of tokens) {
      const letter = t[0].toUpperCase();
      const numStr = t.slice(1);
      const val = parseAxisNum(numStr);
      if (val === null && letter !== 'G' && letter !== 'M') continue;
      switch (letter) {
        case 'G': gCodes.push(val === null ? 0 : val); break;
        case 'M': mCodes.push(val === null ? 0 : val); break;
        case 'X': nx = val === null ? 0 : val * scale(); break;
        case 'Y': ny = val === null ? 0 : val * scale(); break;
        case 'Z': nz = val === null ? 0 : val * scale(); break;
        case 'F': nf = val === null ? 0 : val * scale(); break;
        case 'S': ns = val; break;
        case 'T': nt = val; break;
        case 'I': ni = val === null ? 0 : val * scale(); break;
        case 'J': nj = val === null ? 0 : val * scale(); break;
        case 'K': nk = val === null ? 0 : val * scale(); break;
        case 'R': nr = val === null ? 0 : val * scale(); break;
        case 'Q': nq = val === null ? 0 : val * scale(); break;
        case 'P': np = val; break;
        case 'H': nh = val; break;
        case 'L': nl = val; break;
        case 'D': nd = val; break;
        default: break; // O, dsb. — diterima parser, tidak berpengaruh gerak
      }
    }

    // Blok yang men-alarm TIDAK dieksekusi geraknya (perilaku mesin asli).
    let blockAlarm = null;

    for (const g of gCodes) {
      if (!KNOWN_G.has(g) && Number.isInteger(g)) {
        blockAlarm = { code: 'G' + g, msg: 'UNKNOWN G-CODE G' + g, line: blk.lineNum };
        break;
      }
      if (g === 0 || g === 1 || g === 2 || g === 3) {
        motion = g; group1 = true; cycle = null;
      } else if (g === 4) {
        const p = np != null ? np : (nx != null ? nx : 0);
        moves.push({ type: 'dwell', p, line: blk.lineNum, raw: blk.raw.trim() });
      } else if (g === 17 || g === 18 || g === 19) {
        if (g !== 17 && compSide !== null) {
          blockAlarm = { code: 'G' + g, msg: 'CUTTER COMP HANYA G17', line: blk.lineNum };
        } else {
          plane = g;
        }
      } else if (g === 20) units = 'in';
      else if (g === 21) units = 'mm';
      else if (g === 28) sawG28 = true;
      else if (g === 40) {
        compSide = null;
        moves.push({ type: 'comp', side: null, d: nd != null ? nd : (tool || null), line: blk.lineNum, raw: blk.raw.trim() });
      } else if (g === 41 || g === 42) {
        if (plane !== 17) {
          blockAlarm = { code: 'G' + g, msg: 'CUTTER COMP HANYA G17', line: blk.lineNum };
        } else {
          compSide = g === 41 ? 'left' : 'right';
          moves.push({ type: 'comp', side: compSide, d: nd != null ? nd : (tool || null), line: blk.lineNum, raw: blk.raw.trim() });
        }
      } else if (g === 43) {
        if (nh == null) {
          blockAlarm = { code: 'G43', msg: 'G43 TANPA H — TOOL LENGTH OFFSET HILANG', line: blk.lineNum };
        }
      } else if (g === 49) {
        moves.push({ type: 'toolcomp', h: 0, line: blk.lineNum, raw: blk.raw.trim() });
      } else if (g === 53) sawG53 = true;
      else if (g >= 54 && g <= 59) wcs = 'G' + g;
      else if (g === 80) cycle = null;
      else if (g === 81 || g === 82 || g === 83 || g === 84) {
        if (g === 84 && nq != null) {
          blockAlarm = { code: 'G84', msg: 'G84 TANPA PECK', line: blk.lineNum };
          break;
        }
        sawCycleWord = true;
        cycle = { g, z: nz, r: nr, q: nq, f: nf != null ? nf : f };
      } else if (g === 90) absolute = true;
      else if (g === 91) absolute = false;
      else if (g === 98) retract = 'G98';
      else if (g === 99) retract = 'G99';
    }
    if (blockAlarm) {
      alarms.push(blockAlarm);
      moves.push({ type: 'alarm', ...blockAlarm, raw: blk.raw.trim() });
      continue; // blok tidak dieksekusi
    }

    if (nf !== null) f = nf;
    if (ns !== null) spindle = ns;
    if (nt !== null) tool = nt;

    const meta = () => ({
      f, spindle, spindleDir, tool, wcs, line: blk.lineNum, raw: (blk.raw || '').trim()
    });

    for (const m of mCodes) {
      if (!KNOWN_M.has(m) && Number.isInteger(m)) {
        const a = { code: 'M' + m, msg: 'UNKNOWN M-CODE M' + m, line: blk.lineNum };
        alarms.push(a);
        moves.push({ type: 'alarm', ...a, raw: blk.raw.trim() });
        continue;
      }
      if (m === 3 || m === 4) spindleDir = m;
      else if (m === 5) spindle = 0;
      else if (m === 6) {
        if (nt != null) moves.push({ type: 'tool', tool: nt, ...meta() });
        else {
          const a = { code: 'M6', msg: 'M06 TANPA T — NOMOR TOOL HILANG', line: blk.lineNum };
          alarms.push(a);
          moves.push({ type: 'alarm', ...a, raw: blk.raw.trim() });
        }
      } else if (m === 8) moves.push({ type: 'coolant', on: true, line: blk.lineNum, raw: blk.raw.trim() });
      else if (m === 9) moves.push({ type: 'coolant', on: false, line: blk.lineNum, raw: blk.raw.trim() });
      else if (m === 0) moves.push({ type: 'stop', line: blk.lineNum, raw: blk.raw.trim() });
      else if (m === 1) moves.push({ type: 'stop', optional: true, line: blk.lineNum, raw: blk.raw.trim() });
      else if (m === 30 || m === 2) moves.push({ type: 'stop', end: true, line: blk.lineNum, raw: blk.raw.trim() });
    }

    // G43 H —— aktifkan tool length compensation (validasi H di tabel dilakukan runtime).
    if (gCodes.includes(43)) {
      moves.push({ type: 'toolcomp', h: nh, ...meta() });
    }

    if (sawG28) {
      const axes = [];
      if (nx !== null) axes.push('x');
      if (ny !== null) axes.push('y');
      if (nz !== null) axes.push('z');
      moves.push({ type: 'home', axes: axes.length ? axes : ['z'], ...meta() });
      // Kata sumbu pada blok G28 = titik antara, bukan gerak modal — tidak diemit.
      continue;
    }

    const hasAxis = nx !== null || ny !== null || nz !== null;

    // Canned cycle: blok definisi (G81–G83 … Z R) maupun lanjutan modal (hanya X/Y).
    if (cycle && !group1 && hasAxis) {
      if (cycle.z == null || cycle.r == null) {
        const a = { code: 'G' + cycle.g, msg: 'CYCLE G' + cycle.g + ' TANPA Z/R — PARAMETER KURANG', line: blk.lineNum };
        alarms.push(a);
        moves.push({ type: 'alarm', ...a, raw: blk.raw.trim() });
        cycle = null;
        continue;
      }
      const hx = nx !== null ? (absolute ? nx : x + nx) : x;
      const hy = ny !== null ? (absolute ? ny : y + ny) : y;
      expandCycleHole(moves, cycle, retract, x, y, z, hx, hy, meta);
      x = hx; y = hy; z = retract === 'G98' ? z : cycle.r;
      continue;
    }

    if (!hasAxis) continue;
    if (sawG53) {
      // G53 non-modal: koordinat mesin langsung untuk blok ini saja.
      // Sumbu yang tidak ditulis tidak bergerak (ditandai ax, dipatch di runtime).
      const tx = nx !== null ? nx : x;
      const ty = ny !== null ? ny : y;
      const tz = nz !== null ? nz : z;
      const ax = { x: nx !== null, y: ny !== null, z: nz !== null };
      if (!(tx === x && ty === y && tz === z)) {
        moves.push({
          type: motion === 0 ? 'rapid' : 'feed',
          x: tx, y: ty, z: tz, machine: true, ax, ...meta()
        });
      }
      x = tx; y = ty; z = tz;
      continue;
    }

    const tx = nx !== null ? (absolute ? nx : x + nx) : x;
    const ty = ny !== null ? (absolute ? ny : y + ny) : y;
    const tz = nz !== null ? (absolute ? nz : z + nz) : z;

    if (tx === x && ty === y && tz === z && motion !== 2 && motion !== 3) continue;

    if (motion === 2 || motion === 3) {
      const pts = expandArc(x, y, z, tx, ty, tz, ni, nj, nk, nr, motion === 2, plane);
      for (const p of pts) {
        moves.push({ x: p.x, y: p.y, z: p.z, type: 'feed', g: motion, ...meta() });
      }
    } else {
      const type = motion === 0 ? 'rapid' : 'feed';
      moves.push({ x: tx, y: ty, z: tz, type, g: motion, ...meta() });
    }
    x = tx; y = ty; z = tz;
  }

  // Estimasi waktu tampilan (Simulator memakai profil mesin saat berjalan).
  let totalTime = 0;
  let px = 0, py = 0, pz = 0;
  for (const mv of moves) {
    if (mv.type !== 'rapid' && mv.type !== 'feed') continue;
    const dist = Math.sqrt((mv.x - px) ** 2 + (mv.y - py) ** 2 + (mv.z - pz) ** 2);
    const feed = mv.type === 'rapid' ? 8000 : (mv.f || 500);
    totalTime += (dist / Math.max(1, feed)) * 60;
    px = mv.x; py = mv.y; pz = mv.z;
  }

  return { moves, totalTime, alarms };
}

/** Satu lubang canned cycle (G81/G82/G83) → serangkaian gerakan. */
function expandCycleHole(moves, cycle, retract, x0, y0, z0, hx, hy, meta) {
  const f = cycle.f || 500;
  // 1. rapid XY ke lubang (di level Z saat ini)
  if (hx !== x0 || hy !== y0) moves.push({ x: hx, y: hy, z: z0, type: 'rapid', ...meta() });
  // 2. rapid ke R — dilewati jika sudah berada di R (G99 traverse antar lubang)
  if (Math.abs(z0 - cycle.r) > 1e-9) {
    moves.push({ x: hx, y: hy, z: cycle.r, type: 'rapid', ...meta() });
  }
  // 3. masuk
  if (cycle.g === 83 && cycle.q > 0) {
    let zc = cycle.r;
    while (zc > cycle.z + 1e-9) {
      const zn = Math.max(cycle.z, zc - cycle.q);
      moves.push({ x: hx, y: hy, z: zn, type: 'feed', ...meta(), f });
      zc = zn;
      if (zc > cycle.z + 1e-9) {
        moves.push({ x: hx, y: hy, z: cycle.r, type: 'rapid', ...meta() });   // retract penuh
        moves.push({ x: hx, y: hy, z: zc + 0.25, type: 'rapid', ...meta() }); // turun cepat lagi
      }
    }
  } else {
    moves.push({ x: hx, y: hy, z: cycle.z, type: 'feed', ...meta(), f });
  }
  // 4. keluar ke level retract
  const out = retract === 'G98' ? z0 : cycle.r;
  if (Math.abs(out - cycle.z) > 1e-9) {
    if (cycle.g === 84) {
      const rev = meta();
      rev.spindleDir = rev.spindleDir === 3 ? 4 : 3;
      moves.push({ x: hx, y: hy, z: out, type: 'feed', ...rev, f });
    } else {
      moves.push({ x: hx, y: hy, z: out, type: 'rapid', ...meta() });
    }
  }
}
