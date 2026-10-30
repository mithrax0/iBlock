// Construit les scripts à partir des sources :
//  - src/page.js  → iBlock-page.user.js (script séparé, utile sur les sites à CSP stricte)
//                 → embarqué dans iBlock.user.js (injecté dans la page par le script principal)
//  - VERSION      → @version des deux scripts + constante VERSION
//  - *.meta.js    → en-têtes pour les mises à jour automatiques de l'app Userscripts
// Usage : node tools/build.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const version = read('VERSION').trim();
const pageCode = read('src/page.js').trim();

const pageHeader = `// ==UserScript==
// @name         iBlock (page)
// @namespace    https://github.com/mithrax0/iBlock
// @version      ${version}
// @description  iBlock, partie « page » : anti pop-ups et scriptlets sur les sites à sécurité renforcée. Complète le script « iBlock ».
// @author       mithrax0
// @match        *://*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock-page.meta.js
// @downloadURL  https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock-page.user.js
// ==/UserScript==
`;
write('iBlock-page.user.js', `${pageHeader}\n// Fichier généré par tools/build.cjs à partir de src/page.js : ne pas modifier.\n\n${pageCode}\n`);

let main = read('iBlock.user.js');
main = main.replace(/(\/\/ @version\s+)\S+/, `$1${version}`);
main = main.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
const START = '  // @@PAGE_CODE_START';
const END = '  // @@PAGE_CODE_END';
const a = main.indexOf(START);
const b = main.indexOf(END);
if (a === -1 || b === -1) throw new Error('Marqueurs PAGE_CODE introuvables dans iBlock.user.js');
const block = `${START} (généré par tools/build.cjs à partir de src/page.js : ne pas modifier)\n  const PAGE_CODE = ${JSON.stringify(pageCode)};\n`;
main = main.slice(0, a) + block + main.slice(b);
write('iBlock.user.js', main);

for (const name of ['iBlock', 'iBlock-page']) {
  const src = read(`${name}.user.js`);
  const m = /\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/.exec(src);
  write(`${name}.meta.js`, `${m[0]}\n`);
}
console.log(`iBlock ${version} construit.`);
