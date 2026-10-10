/**
 * meshWorker – entry Web Worker: jalan buildGreedyGeometry di luar main thread.
 */
import { buildGreedyGeometry } from './greedyMesh.js';

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    const g = buildGreedyGeometry(e.data);
    if (!g) { self.postMessage({ id, position: null }); return; }
    self.postMessage({ id, ...g }, [g.position.buffer, g.normal.buffer, g.color.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
