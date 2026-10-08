// v0.7.0-rA3 loader
const a = await (await fetch(new URL("./main_part_a.txt", import.meta.url))).text();
const b = await (await fetch(new URL("./main_part_b.txt", import.meta.url))).text();
const blob = new Blob([a + b], { type: "text/javascript" });
await import(URL.createObjectURL(blob));
