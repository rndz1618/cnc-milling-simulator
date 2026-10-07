import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog = new THREE.Fog(0x0a0e14, 350, 900);

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
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(50, 0, 40);
  controls.maxPolarAngle = Math.PI * 0.92;

  scene.add(new THREE.AmbientLight(0x607080, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(80, 160, 100);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  scene.add(new THREE.DirectionalLight(0x88aaff, 0.45).position.set(-90, 80, -70));
  scene.add(new THREE.HemisphereLight(0x8ab4f8, 0x3a2a10, 0.35));

  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(240, 10, 200),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.45, roughness: 0.55 })
  );
  bed.position.set(50, -25, 40);
  bed.receiveShadow = true;
  scene.add(bed);

  const grid = new THREE.GridHelper(220, 22, 0x404850, 0x1e242c);
  grid.position.set(50, -19.9, 40);
  scene.add(grid);

  const axes = new THREE.AxesHelper(25);
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

  return { scene, camera, renderer, controls, onResize };
}

export function createToolMesh() {
  const g = new THREE.Group();

  const flute = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.25 })
  );
  flute.position.y = 8;
  g.add(flute);

  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 28, 16),
    new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.85, roughness: 0.3 })
  );
  shank.position.y = 30;
  g.add(shank);

  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 16, 22, 20),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.55, roughness: 0.4 })
  );
  spindle.position.y = 55;
  g.add(spindle);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffaa00 })
  );
  tip.position.y = 0;
  g.add(tip);

  g.position.set(0, 50, 0);
  return g;
}

/** CNC work (x,y,z) → Three.js (x, z, y) */
export function setToolPosition(toolMesh, mx, my, mz) {
  toolMesh.position.set(mx, mz, my);
}

/**
 * Toolpath colored by Z-level:
 *  rapid  → red
 *  Z >= 0  → cyan (above stock)
 *  Z ~ -2  → yellow (shallow cut)
 *  Z ~ -5  → orange (deeper)
 *  Z < -5  → magenta (deep)
 */
function colorForZ(z, isRapid) {
  if (isRapid) return 0xff4444;
  if (z >= 0) return 0x44ddff;
  if (z >= -3) return 0xffdd44;
  if (z >= -6) return 0xff8844;
  return 0xff44aa;
}

export function buildToolpathLines(moves) {
  const group = new THREE.Group();
  if (!moves || moves.length < 1) return group;

  const buckets = new Map();
  let prev = { x: 0, y: 0, z: 50 };
  for (const m of moves) {
    const isRapid = m.type === 'rapid';
    const col = colorForZ(Math.min(prev.z, m.z), isRapid);
    if (!buckets.has(col)) buckets.set(col, []);
    const arr = buckets.get(col);
    arr.push(prev.x, prev.z, prev.y, m.x, m.z, m.y);
    prev = m;
  }

  for (const [col, positions] of buckets) {
    if (positions.length < 6) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 })
    ));
  }
  return group;
}
