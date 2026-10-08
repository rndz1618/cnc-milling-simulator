// v0.7.0-rA3 Fix2 — decompress pinned main, import live modules (G2/G3 + trail)
const PIN = '80f2af7358b1acb900c4a91208a8c9d17c4e8cd2';
const pinBase = `https://cdn.jsdelivr.net/gh/rndz1618/cnc-milling-simulator@${PIN}/src/`;

async function boot() {
  const a = await (await fetch(pinBase + 'main_part_a.txt')).text();
  const b = await (await fetch(pinBase + 'main_part_b.txt')).text();
  const loaderSrc = a + b;

  // Extract B64 from the compressed loader
  const m = loaderSrc.match(/const B64 = "([^"]+)"/);
  if (!m) throw new Error('B64 not found in pinned loader');
  const bin = Uint8Array.from(atob(m[1]), c => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bin]).stream().pipeThrough(ds);
  let code = await new Response(stream).text();

  // Rewrite relative imports to THIS deployment's src/ (live Parser has G2/G3)
  const liveBase = new URL('.', import.meta.url).href;
  code = code.replace(/from\s+['"](\.[^'"]+)['"]/g, (_, rel) => {
    return "from '" + new URL(rel, liveBase).href + "'";
  });
  code = code.replace(/from\s+['"]three['"]/g,
    "from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'");

  const blob = new Blob([code], { type: 'text/javascript' });
  await import(URL.createObjectURL(blob));
}
boot().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="color:#f55;padding:12px;white-space:pre-wrap">Boot: ${e}</pre>`);
});
