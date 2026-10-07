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
  controls.target.set(50, 0, 40);
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

  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(240, 10, 200),
    new THREE.MeshStandardMaterial({
      color: 0x3a4555,
      metalness: 0.35,
      roughness: 0.6,
      emissive: 0x0a1018,
      emissiveIntensity: 0.15
    })
  );
  bed.position.set(50, -25, 40);
  bed.receiveShadow = true;
  scene.add(bed);

  const grid = new THREE.GridHelper(220, 22, 0x6a7a90, 0x3a4a5c);
  grid.position.set(50, -19.9, 40);
  scene.add(grid);

  const axes = new THREE.AxesHelper(28);
  axes.position.set(0, 0.2, 0);
  scene.add(axes);

  function onResize() {
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  setTimeout(onResize, 50);

  return { scene, camera, renderer, controls, bed, grid, onResize };
}

/**
 * Realistic end-mill mesh.
 * radius = cutter radius mm (default 6 → Ø12).
 * Tip at local y=0 so setToolPosition places tip at programmed Z.
 */
export function createToolMesh(radius = 6) {
  const g = new THREE.Group();
  const r = Math.max(1.0, Math.min(radius, 20));
  const D = r * 2;

  const fluteLen = Math.min(30, Math.max(10, D * 2.5));
  const flute = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.98, r, fluteLen, 24),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.92, roughness: 0.22 })
  );
  flute.position.y = fluteLen / 2;
  g.add(flute);

  for (let i = 1; i <= 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * 1.01, 0.15, 6, 24),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.5, roughness: 0.6 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = (fluteLen * i) / 4;
    g.add(ring);
  }

  const shankR = r * 1.02;
  const shankLen = Math.min(40, Math.max(18, D * 2.2));
  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(shankR, shankR, shankLen, 20),
    new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.88, roughness: 0.2 })
  );
  shank.position.y = fluteLen + shankLen / 2;
  g.add(shank);

  const colletR = Math.max(r * 1.35, Math.min(9, 5 + r * 0.4));
  const colletLen = 10;
  const collet = new THREE.Mesh(
    new THREE.CylinderGeometry(colletR * 0.92, colletR, colletLen, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.6, roughness: 0.32 })
  );
  collet.position.y = fluteLen + shankLen + colletLen / 2;
  g.add(collet);

  const stubR = colletR * 0.55;
  const stubLen = 12;
  const stub = new THREE.Mesh(
    new THREE.CylinderGeometry(stubR, stubR * 1.1, stubLen, 16),
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

  g.userData.radius = r;
  g.userData.diameter = D;
  g.userData.fluteLen = fluteLen;
  g.position.set(0, 50, 0);
  return g;
}

/** Rebuild tool geometry for a new diameter (mm). */
export function setToolDiameter(toolMesh, diameterMm) {
  const r = Math.max(1.0, (diameterMm || 12) / 2);
  while (toolMesh.children.length) {
    const c = toolMesh.children[0];
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
    toolMesh.remove(c);
  }
  const fresh = createToolMesh(r);
  while (fresh.children.length) {
    toolMesh.add(fresh.children[0]);
  }
  toolMesh.userData.radius = r;
  toolMesh.userData.diameter = r * 2;
}

/** CNC work (x,y,z) → Three.js (x, z, y) */
export function setToolPosition(toolMesh, mx, my, mz) {
  toolMesh.position.set(mx, mz, my);
}

function colorForZ(z) {
  if (z >= 0) return 0x44ddff;
  if (z >= -5) return 0xffdd44;
  if (z >= -15) return 0xff9944;
  return 0xff4488;
}

/**
 * Build colored toolpath.
 * Rapids clipped to zRef+clearance so Z100 retracts don't dominate the view.
 */
export function buildToolpathLines(moves, opts = {}) {
  const group = new THREE.Group();
  if (!moves || moves.length < 1) return group;

  const clearance = opts.rapidClearance ?? 15;
  let zRef = 0;
  for (const m of moves) {
    if (m.type === 'feed') zRef = Math.max(zRef, m.z);
  }
  const rapidCap = zRef + clearance;

  const feedBuckets = new Map();
  const rapidPositions = [];

  let prev = { x: 0, y: 0, z: Math.min(50, rapidCap) };
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
      const col = colorForZ(Math.min(z0, z1));
      if (!feedBuckets.has(col)) feedBuckets.set(col, []);
      feedBuckets.get(col).push(prev.x, z0, prev.y, m.x, z1, m.y);
    }
    prev = m;
  }

  if (rapidPositions.length >= 6) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rapidPositions, 3));
    group.add(new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.22,
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
        opacity: 0.95
      })
    ));
  }
  return group;
}
