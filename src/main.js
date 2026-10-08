// v0.7.0-rA3 local full main (2-part, script module, no blob CDN pin)
const base = new URL('.', import.meta.url).href;
async function boot() {
  const [a, b] = await Promise.all([
    fetch(new URL('./main_body_a.txt', import.meta.url)).then(r => { if (!r.ok) throw new Error('body_a ' + r.status); return r.text(); }),
    fetch(new URL('./main_body_b.txt', import.meta.url)).then(r => { if (!r.ok) throw new Error('body_b ' + r.status); return r.text(); })
  ]);
  let code = a + b;
  code = code.replace(/from\s+['"](\.[^'"]+)['"]/g, (_, rel) => "from '" + new URL(rel, base).href + "'");
  code = code.replace(/from\s+['"]three['"]/g, "from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'");
  const s = document.createElement('script');
  s.type = 'module';
  s.textContent = code;
  document.head.appendChild(s);
}
boot().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', '<pre style="color:#f55;padding:12px;white-space:pre-wrap">Boot: ' + e + '</pre>');
});
