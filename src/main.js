// v0.7.0-rA3 Fix3b — 12-chunk loader (script type=module, absolute imports)
const base = new URL('.', import.meta.url).href;
const N = 12;
async function boot() {
  const parts = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      fetch(new URL('./chunks/s' + i + '.txt', import.meta.url)).then(r => {
        if (!r.ok) throw new Error('chunk s' + i + ' HTTP ' + r.status);
        return r.text();
      })
    )
  );
  let code = parts.join('');
  code = code.replace(/from\s+['"](\.[^'"]+)['"]/g, (_, rel) => {
    return "from '" + new URL(rel, base).href + "'";
  });
  code = code.replace(/from\s+['"]three['"]/g,
    "from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'");
  const s = document.createElement('script');
  s.type = 'module';
  s.textContent = code;
  document.head.appendChild(s);
}
boot().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend',
    '<pre style="color:#f55;padding:12px;white-space:pre-wrap">Boot: ' + e + '</pre>');
});
