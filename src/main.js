// v0.7.0-rA3 Fix4 — load complete main from known-good commit (full source, no blob)
// Modules resolve from the same CDN commit. Parser G2/G3 is on live branch but
// this pin prioritizes a working UI; next step will restore live modules.
import 'https://cdn.jsdelivr.net/gh/rndz1618/cnc-milling-simulator@ab0be8a194fd53f2ff4396a4029c20dfc4e13101/src/main.js';
