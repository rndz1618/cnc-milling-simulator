/**
 * MeshService – RPC tipis ke Web Worker greedy mesher.
 * Routing per `id`: setiap request punya Promise sendiri; worker membalas
 * dengan id yang sama untuk resolve/reject. Latest-wins dikerjakan pemanggil.
 */

export function createMeshService({ WorkerCtor } = {}) {
  // WorkerCtor bisa disuntik agar bisa diuji di Node (tanpa browser).
  const Ctor = WorkerCtor !== undefined
    ? WorkerCtor
    : (typeof Worker !== 'undefined' ? Worker : null);

  let worker = null;
  if (Ctor) {
    worker = new Ctor(new URL('./meshWorker.js', import.meta.url), { type: 'module' });
  }

  const pending = new Map();
  let nextId = 0;
  let failed = false;

  if (worker) {
    worker.onmessage = (e) => {
      const { id } = e.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (e.data.error) entry.reject(new Error(e.data.error));
      else if (e.data.position == null) entry.resolve(null);
      else entry.resolve({ position: e.data.position, normal: e.data.normal, color: e.data.color });
    };

    // Worker gagal load (module/CSP/network) atau crash di luar try/catch:
    // tak akan ada balasan, jadi tolak semua pending agar pemanggil fallback sinkron.
    worker.onerror = (ev) => {
      failed = true;
      const msg = (ev && (ev.message || ev.error?.message)) || 'mesh worker error';
      for (const { reject } of pending.values()) reject(new Error(msg));
      pending.clear();
    };
  }

  function request(spec) {
    if (!worker || failed) return Promise.reject(new Error('mesh worker tidak tersedia'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // grid = salinan milik pemanggil → aman ditransfer; jangan transfer grid asli.
      worker.postMessage({ id, ...spec }, [spec.grid.buffer]);
    });
  }

  function dispose() {
    if (worker) { worker.terminate(); worker = null; }
    for (const { reject } of pending.values()) reject(new Error('mesh service di-dispose'));
    pending.clear();
  }

  return { request, dispose };
}
