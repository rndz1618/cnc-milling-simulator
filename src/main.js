// v0.7.0-rA3 local main (body_a + body_b chunks, script module)
const base = new URL('.', import.meta.url).href;
async function boot() {
  const urls = ['./main_body_a.txt', './main_bb0.txt', './main_bb1.txt', './main_bb2.txt', './main_bb3.txt', './main_bb4.txt'];
  const parts = await Promise.all(urls.map(u =>
    fetch(new URL(u, import.meta.url)).then(r => {
      if (!r.ok) throw new Error(u + ' HTTP ' + r.status);
      return r.text();
    })
  ));
  let code = parts.join('');
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
