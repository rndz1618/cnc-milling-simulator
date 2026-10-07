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
  // Look at stock center (work X50 Y40, top Z0 → Three 50,0,40)
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

  // Brighter lighting so brass stock is clearly visible
  scene.add(new THREE.AmbientLight(0x607080, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(80, 160, 100);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  scene.add(new THREE.DirectionalLight(0x88aaff, 0.45).position.set(-90, 80, -70));
  scene.add(new THREE.HemisphereLight(0x8ab4f8, 0x3a2a10, 0.35));

  // Machine bed UNDER the stock (stock bottom at Y=-20)
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(240, 10, 200),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.45, roughness: 0.55 })
  );
  bed.position.set(50, -25, 40); // top face ≈ Y=-20
  bed.receiveShadow = true;
  scene.add(bed);

  // Grid on top of bed (under stock)
  const grid = new THREE.GridHelper(220, 22, 0x404850, 0x1e242c);
  grid.position.set(50, -19.9, 40);
  scene.add(grid);

  // Origin axes at work (0,0,0) = stock top corner
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
  // Ensure size after layout
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

export function buildToolpathLines(moves) {
  const group = new THREE.Group();
  if (!moves || moves.length < 1) return group;

  const rapid = [];
  const feed = [];
  let prev = { x: 0, y: 0, z: 50 };
  for (const m of moves) {
    const arr = m.type === 'rapid' ? rapid : feed;
    // LineSegments pairs: start, end — Three (x,z,y)
    arr.push(prev.x, prev.z, prev.y, m.x, m.z, m.y);
    prev = m;
  }

  function add(positions, color, opacity) {
    if (positions.length < 6) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: true
    });
    group.add(new THREE.LineSegments(geo, mat));
  }
  add(rapid, 0xff5555, 0.85);
  add(feed, 0x44aaff, 0.95);
  return group;
}
