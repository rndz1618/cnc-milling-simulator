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

export function createToolMesh() {
  const g = new THREE.Group();

  const flute = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.85, roughness: 0.28 })
  );
  flute.position.y = 8;
  g.add(flute);

  const shank = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 28, 16),
    new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.8, roughness: 0.28 })
  );
  shank.position.y = 30;
  g.add(shank);

  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 16, 22, 20),
    new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 0.5, roughness: 0.38 })
  );
  spindle.position.y = 55;
  g.add(spindle);

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcc33 })
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
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 1.0, linewidth: 2 })
    ));
  }
  return group;
}
