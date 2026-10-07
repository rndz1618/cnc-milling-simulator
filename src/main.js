// v0.7.0-rA1 loader
const a = await (await fetch(new URL("./main_part_a.txt", import.meta.url))).text();
const b = await (await fetch(new URL("./main_part_b.txt", import.meta.url))).text();
let code = a + b;
// Ensure three resolves from CDN when running as blob module
code = code.replace(
  /from\s+['\"]three['\"]/g,
  "from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'"
);
const blob = new Blob([code], { type: "text/javascript" });
await import(URL.createObjectURL(blob));
