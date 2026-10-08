import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2332);
  scene.fog = new THREE.Fog(0x1a2332, 450, 1100);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    2000
  );
  camera.position.set(160, 110, 200);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, -30);
  controls.maxPolarAngle = Math.PI * 0.92;

  scene.add(new THREE.AmbientLight(0xc8d4e8, 0.85));
  const key = new THREE.DirectionalLight(0xfff5e6, 1.55);
  key.position.set(90, 180, 110);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0003;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa0c4ff, 0.65);
  fill.position.set(-100, 90, -80);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xd0e4ff, 0x4a3a20, 0.55));
  const top = new THREE.DirectionalLight(0xffffff, 0.4);
  top.position.set(50, 250, 40);
  scene.add(top);

  // Meja mesin di ruang koordinat mesin (origin mesin = sudut kerja).
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(520, 10, 520),
    new THREE.MeshStandardMaterial({
      color: 0x3a4555,
      metalness: 0.35,
      roughness: 0.6,
      emissive: 0x0a1018,
      emissiveIntensity: 0.15
    })
  );
  bed.position.set(0, -70, 0);
  bed.receiveShadow = true;
  scene.add(bed);

  const grid = new THREE.GridHelper(500, 50, 0x6a7a90, 0x3a4a5c);
  grid.position.set(0, -64.9, 0);
  scene.add(grid);

  // Marker origin mesin (kecil, abu) — beda dengan work zero G54 (hijau).
  const machineOrigin = new THREE.AxesHelper(12);
  machineOrigin.position.set(0, -64.5, 0);
  scene.add(machineOrigin);

  function onResize() {
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  setTimeout(onResize, 50);

  return { scene, camera, renderer, controls, bed, grid, machineOrigin, onResize };
}

/**
 * Geometri tool berbasis DATA (tool table), bukan proporsi prosedural.
 * spec: { diameter, flute, overall } (mm). Tip di y=0, mengarah ke bawah
 * saat diposisikan oleh setToolPosition.
 */
export const DEFAULT_TOOL_SPEC = { diameter: 12, flute: 36, overall: 100 };

export function createToolMesh(spec = DEFAULT_TOOL_SPEC) {
  const g = new THREE.Group();
  const d = Math.max(1, spec.diameter || DEFAULT_TOOL_SPEC.diameter);
  const r = d / 2;
  const overall = Math.max(d + 30, spec.overall || DEFAULT_TOOL_SPEC.overall);
  const fluteLen = Math.max(4, Math.min(spec.flute || d * 3, overall - 26));

  // Flute (heliks digambarkan ring gelap)
  const flute = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.985, r, fluteLen, 24),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.92, roughness: 0.22 })
  );
  flute.position.y = fluteLen / 2;
  g.add(flute);
  for (let i = 1; i <= 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.01, Math.max(0.12, d * 0.012), 6, 24),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.5, roughness: 0.6 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = (fluteLen * i) / 4;
    g.add(ring);
  }

  // Shank sampai dekat holder
  const colletLen = Math.max(10, d * 0.9);
  const stubLen = 14;
  const shankLen = Math.max(6, overall - fluteLen - colletLen - stubLen);
  const shankR = Math.max(r * 1.02, 6);
  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(shankR, shankR, shankLen, 20),
    new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.88, roughness: 0.2 })
  );
  shank.position.y = fluteLen + shankLen / 2;
  g.add(shank);

  // Collet (ER-style)
  const colletR = Math.max(shankR * 1.3, 11);
  const collet = new THREE.Mesh(
    new THREE.CylinderGeometry(colletR * 0.92, colletR, colletLen, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.6, roughness: 0.32 })
  );
  collet.position.y = fluteLen + shankLen + colletLen / 2;
  g.add(collet);

  // Holder stub
  const stub = new THREE.Mesh(
    new THREE.CylinderGeometry(colletR * 0.55, colletR * 0.62, stubLen, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.5, roughness: 0.4 })
  );
  stub.position.y = fluteLen + shankLen + colletLen + stubLen / 2;
  g.add(stub);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.4, r * 0.28), 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc33 })
  );
  tip.position.y = 0;
  g.add(tip);

  g.userData.spec = { diameter: d, flute: fluteLen, overall };
  return g;
}

/** Bangun ulang geometri tool dari spesifikasi baru (dipanggil saat tool change). */
export function setToolGeometry(toolMesh, spec) {
  while (toolMesh.children.length) {
    const c = toolMesh.children[0];
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
    toolMesh.remove(c);
  }
  const fresh = createToolMesh(spec || DEFAULT_TOOL_SPEC);
  while (fresh.children.length) toolMesh.add(fresh.children[0]);
  toolMesh.userData.spec = fresh.userData.spec;
}

/** CNC (x,y,z) mesin → Three.js (x, z, y) — sumbu Y Three.js = Z mesin. */
export function setToolPosition(toolMesh, mx, my, mz) {
  toolMesh.position.set(mx, mz, my);
}

/** Marker work zero — diposisikan app pada wcsOffset WCS aktif (ruang mesin). */
export function createWorkZeroMarker(size = 20) {
  const g = new THREE.Group();
  g.name = 'workZero';
  const axes = new THREE.AxesHelper(size);
  g.add(axes);
  const plate = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 3, 24),
    new THREE.MeshBasicMaterial({ color: 0x3fb950, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.05;
  g.add(plate);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x3fb950 })
  );
  g.add(dot);
  return g;
}

/**
 * Template vise (ragum) — visual, parameter bisa diganti.
 * { spanX: panjang rahang, yMin/yMax: sisi stock yang dijepit, topZ: dasar stock }
 */
export function createVise({ spanX = 140, yMin = -40, yMax = 40, topZ = -20, jawHeight = 28 } = {}) {
  const g = new THREE.Group();
  g.name = 'vise';
  const steel = new THREE.MeshStandardMaterial({ color: 0x707880, metalness: 0.65, roughness: 0.4 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.6, roughness: 0.45 });

  const depth = (yMax - yMin) + 34;
  const baseH = 16;
  const base = new THREE.Mesh(new THREE.BoxGeometry(spanX + 26, baseH, depth), steelDark);
  base.position.set(0, topZ - baseH / 2, (yMin + yMax) / 2);
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  const jawT = 10;
  for (const side of [-1, 1]) {
    const y = side === -1 ? yMin - jawT / 2 : yMax + jawT / 2;
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(spanX + 16, jawHeight, jawT), steel);
    jaw.position.set(0, topZ + jawHeight / 2 - 6, y);
    jaw.castShadow = true;
    g.add(jaw);
  }
  return g;
}

function colorForZ(z, trail) {
  if (trail) {
    if (z >= 0) return 0x44ffee;
    if (z >= -5) return 0x66ff88;
    if (z >= -15) return 0xffee44;
    return 0xff8844;
  }
  if (z >= 0) return 0x44ddff;
  if (z >= -5) return 0xffdd44;
  if (z >= -15) return 0xff9944;
  return 0xff4488;
}

/**
 * Bangun toolpath LineSegments dari titik KOORDINAT MESIN.
 * points: [{x,y,z,type:'rapid'|'feed'|...}] — entri non-gerak dilewati.
 * opts.mode = 'trail' → jalur yang sudah ditempuh; 'preview' → GRAPH penuh.
 */
export function buildToolpathLines(points, opts = {}) {
  const group = new THREE.Group();
  const moves = (points || []).filter((p) => p.type === 'rapid' || p.type === 'feed');
  if (moves.length < 1) return group;

  const isTrail = opts.mode === 'trail';
  const clearance = opts.rapidClearance ?? 15;
  let zRef = 0;
  for (const m of moves) {
    if (m.type === 'feed') zRef = Math.max(zRef, m.z);
  }
  const rapidCap = zRef + clearance;

  const feedBuckets = new Map();
  const rapidPositions = [];

  const prevStart = opts.start || { x: moves[0].x, y: moves[0].y, z: Math.min(moves[0].z, rapidCap) };
  let prev = prevStart;
  for (const m of moves) {
    const isRapid = m.type === 'rapid';
    let z0 = prev.z;
    let z1 = m.z;
    if (isRapid) {
      z0 = Math.min(z0, rapidCap);
      z1 = Math.min(z1, rapidCap);
    }
    if (prev.x === m.x && prev.y === m.y && Math.abs(z0 - z1) < 0.001 && isRapid) {
      prev = m;
      continue;
    }

    if (isRapid) {
      rapidPositions.push(prev.x, z0, prev.y, m.x, z1, m.y);
    } else {
      const col = colorForZ(Math.min(z0, z1), isTrail);
      if (!feedBuckets.has(col)) feedBuckets.set(col, []);
      feedBuckets.get(col).push(prev.x, z0, prev.y, m.x, z1, m.y);
    }
    prev = m;
  }

  if (opts.liveEnd) {
    const le = opts.liveEnd;
    const isRapid = le.type === 'rapid';
    let z0 = prev.z;
    let z1 = le.z;
    if (isRapid) {
      z0 = Math.min(z0, rapidCap);
      z1 = Math.min(z1, rapidCap);
    }
    if (Math.abs(prev.x - le.x) > 0.01 || Math.abs(prev.y - le.y) > 0.01 || Math.abs(z0 - z1) > 0.01) {
      if (isRapid) {
        rapidPositions.push(prev.x, z0, prev.y, le.x, z1, le.y);
      } else {
        const col = colorForZ(Math.min(z0, z1), isTrail);
        if (!feedBuckets.has(col)) feedBuckets.set(col, []);
        feedBuckets.get(col).push(prev.x, z0, prev.y, le.x, z1, le.y);
      }
    }
  }

  if (rapidPositions.length >= 6) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rapidPositions, 3));
    group.add(new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: isTrail ? 0xff6666 : 0xff4444,
        transparent: true,
        opacity: isTrail ? 0.45 : 0.22,
        depthWrite: false
      })
    ));
  }

  for (const [col, positions] of feedBuckets) {
    if (positions.length < 6) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        opacity: isTrail ? 1.0 : 0.9,
        depthWrite: false
      })
    ));
  }
  return group;
}
