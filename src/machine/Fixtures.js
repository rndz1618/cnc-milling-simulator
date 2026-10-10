const WCS_NAMES = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];

export const MATERIALS = {
  alum: { label: 'Aluminium', color: '#c9ccd1' },
  steel: { label: 'Baja', color: '#8a8f96' },
  plastic: { label: 'Plastik', color: '#d9c27a' }
};

let _seq = 0;

export function defaultVise() {
  return { jawWidth: 150, jawHeight: 40, opening: 90, baseH: 40 };
}

export function makeFixture(partial = {}) {
  const id = partial.id || 'fx' + (++_seq);
  return {
    id,
    wcs: partial.wcs || 'G54',
    name: partial.name || 'Ragum ' + id,
    vise: { ...defaultVise(), ...(partial.vise || {}) },
    stock: { sizeX: 100, sizeY: 80, sizeZ: 20, material: 'alum', ...(partial.stock || {}) },
    placement: partial.placement || 'top-center',
    offset: { x: 0, y: 0, z: 0, ...(partial.offset || {}) }
  };
}

export function stockOriginFor(fixture, wcsOffset) {
  const s = fixture.stock;
  const o = wcsOffset || { x: 0, y: 0, z: 0 };
  if (fixture.placement === 'top-center') {
    return { x: o.x - s.sizeX / 2, y: o.y - s.sizeY / 2, z: o.z - s.sizeZ };
  }
  if (fixture.placement === 'top-corner') {
    return { x: o.x, y: o.y, z: o.z - s.sizeZ };
  }
  const f = fixture.offset;
  return { x: f.x, y: f.y, z: f.z };
}

export function normalizeFixtures(raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || !WCS_NAMES.includes(item.wcs) || seen.has(item.wcs)) continue;
    seen.add(item.wcs);
    out.push(makeFixture(item));
  }
  return out;
}

export function migrateLegacyStock(old) {
  if (!old || typeof old !== 'object') {
    return [makeFixture({ wcs: 'G54' })];
  }
  return [makeFixture({
    wcs: 'G54',
    stock: { sizeX: old.sizeX, sizeY: old.sizeY, sizeZ: old.sizeZ },
    placement: old.placement,
    offset: { x: old.originX, y: old.originY, z: old.originZ }
  })];
}

export function materialColor(material) {
  return (MATERIALS[material] && MATERIALS[material].color) || MATERIALS.alum.color;
}

export function materialRGB(material) {
  const n = parseInt(materialColor(material).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
