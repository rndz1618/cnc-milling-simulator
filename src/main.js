// v0.7.0-rA3 Fix — load known-good main from pinned commit (trail + F4/F8)
// Parser G2/G3 is already on branch main (1e42ef77)
const PIN = '80f2af7358b1acb900c4a91208a8c9d17c4e8cd2';
const base = `https://cdn.jsdelivr.net/gh/rndz1618/cnc-milling-simulator@${PIN}/src/`;

async function boot() {
  // Fetch the split loader parts from the pinned good commit
  const a = await (await fetch(base + 'main_part_a.txt')).text();
  const b = await (await fetch(base + 'main_part_b.txt')).text();
  let code = a + b;
  // Rewrite relative imports to absolute (same base as loader)
  // The decompressed main uses ./stock/ etc — rewrite after inflate
  // Actually the pinned loader already does relative→absolute + three CDN.
  // Just eval the loader itself by rewriting its own relative fetches:
  // The loader fetches ./main_part_*.txt — we already inlined them.
  // So execute the combined loader code, but skip its fetch of parts.
  // Simpler: the combined a+b IS the compressed boot. Run it.
  // But boot() inside looks for import.meta.url relative to itself.
  // Force import.meta via blob URL under our origin so relative rewrite works for modules.
  const blob = new Blob([code], { type: 'text/javascript' });
  await import(URL.createObjectURL(blob));
}
boot().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="color:#f55;padding:12px;white-space:pre-wrap">Boot: ${e}</pre>`);
});
