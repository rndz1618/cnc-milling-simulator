import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e14);
  scene.fog = new THREE.Fog(0x0a0e14, 300, 800);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    2000
  );
  camera.position.set(140, 120, 180);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(50, 5, 40);

  // Lights
  scene.add(new THREE.AmbientLight(0x404060, 0.55));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(100, 180, 120);
  dir.castShadow = true;
  scene.add(dir);
  scene.add(new THREE.DirectionalLight(0x88aaff, 0.3).position.set(-80, 60, -100));

  // Bed
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(240, 8, 200),
    new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.4, roughness: 0.55 })
  );
  bed.position.set(50, -4, 40);
  bed.receiveShadow = true;
  scene.add(bed);

  // Grid
  const grid = new THREE.GridHelper(220, 22, 0x30363d, 0x1a1f26);
  grid.position.set(50, 0.05, 40);
  scene.add(grid);

  // Axes
  scene.add(new THREE.AxesHelper(30).position.set(0, 0.3, 0));

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return { scene, camera, renderer, controls, onResize };
}

export function createToolMesh() {
  const g = new THREE.Group();

  // Cutting flute – tip at local Y=0
  const flute = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.2 })
  );
  flute.position.y = 8;
  g.add(flute);

  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 28, 16),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.85, roughness: 0.3 })
  );
  shank.position.y = 30;
  g.add(shank);

  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 16, 22, 20),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.55, roughness: 0.4 })
  );
  spindle.position.y = 55;
  g.add(spindle);

  // Tip marker
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 12, 12),
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
  if (moves.length < 2) return group;

  const rapid = [];
  const feed = [];
  let prev = { x: 0, y: 0, z: 50 };
  for (const m of moves) {
    const arr = m.type === 'rapid' ? rapid : feed;
    arr.push(prev.x, prev.z, prev.y, m.x, m.z, m.y);
    prev = m;
  }

  function add(positions, color) {
    if (positions.length < 6) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color })));
  }
  add(rapid, 0xff4444);
  add(feed, 0x4499ff);
  return group;
}
