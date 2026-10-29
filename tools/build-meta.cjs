// Génère les fichiers *.meta.js (en-têtes seuls) utilisés par l'app
// Userscripts pour détecter les mises à jour.
// Usage : node tools/build-meta.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

for (const name of ['iBlock', 'iBlock-page']) {
  const src = fs.readFileSync(path.join(ROOT, `${name}.user.js`), 'utf8');
  const m = /\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/.exec(src);
  if (!m) throw new Error(`En-tête introuvable dans ${name}.user.js`);
  fs.writeFileSync(path.join(ROOT, `${name}.meta.js`), `${m[0]}\n`);
  const version = /@version\s+(\S+)/.exec(m[0])[1];
  console.log(`${name}.meta.js → ${version}`);
}
