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
 * Tool mesh. radius = cutter radius mm (default 6 → Ø12).
 * Tip at local y=0 so setToolPosition places tip at programmed Z.
 */
export function createToolMesh(radius = 6) {
  const g = new THREE.Group();
  const r = Math.max(1.5, radius);

  const fluteLen = Math.max(12, r * 3);
  const flute = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.95, fluteLen, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.25 })
  );
  flute.position.y = fluteLen / 2;
  g.add(flute);

  const shankR = r * 1.15;
  const shankLen = 20;
  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(shankR, shankR, shankLen, 16),
    new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.85, roughness: 0.25 })
  );
  shank.position.y = fluteLen + shankLen / 2;
  g.add(shank);

  const holdR = Math.max(8, r * 1.8);
  const holdLen = 14;
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(holdR * 0.9, holdR, holdLen, 20),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.55, roughness: 0.35 })
  );
  holder.position.y = fluteLen + shankLen + holdLen / 2;
  g.add(holder);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.35, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffcc33 })
  );
  tip.position.y = 0;
  g.add(tip);

  g.userData.radius = r;
  g.position.set(0, 50, 0);
  return g;
}

/** Rebuild tool geometry for a new diameter (mm). */
export function setToolDiameter(toolMesh, diameterMm) {
  const r = Math.max(1.5, (diameterMm || 12) / 2);
  while (toolMesh.children.length) {
    const c = toolMesh.children[0];
    if (c.geometry) c.geometry.dispose();
    toolMesh.remove(c);
  }
  const fresh = createToolMesh(r);
  while (fresh.children.length) {
    toolMesh.add(fresh.children[0]);
  }
  toolMesh.userData.radius = r;
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
