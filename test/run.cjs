// Tests automatisés d'iBlock dans Chromium (Playwright).
// Usage : node test/run.cjs
// Les deux scripts sont injectés dans le contexte de la page avec une
// imitation de l'API GM de l'app Userscripts.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'iBlock.user.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'iBlock-page.user.js'), 'utf8');
const PAGES = path.join(__dirname, 'pages');

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const file = path.join(PAGES, path.basename(url.pathname) || 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end('404');
        return;
      }
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      if (url.pathname.includes('csp')) {
        headers['content-security-policy'] = "default-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'";
      }
      res.writeHead(200, headers);
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const GM_SHIM = `
  window.__opened = [];
  window.open = function (url) { window.__opened.push(String(url)); return {}; };
  window.GM = {
    getValue: async (k, d) => { const v = await window.__gmGet(k); return v === undefined || v === null ? d : v; },
    setValue: (k, v) => window.__gmSet(k, v),
    addStyle: async () => {},
    openInTab: async () => {},
  };
`;

let failures = 0;
function check(name, ok, extra) {
  console.log(`${ok ? '✔' : '✘'} ${name}${extra !== undefined ? `  (${extra})` : ''}`);
  if (!ok) failures += 1;
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const store = new Map();

  async function newPage(settings, viewport) {
    store.clear();
    if (settings) store.set('settings', JSON.stringify(settings));
    const ctx = await browser.newContext({ viewport: viewport || { width: 1024, height: 768 }, hasTouch: false });
    await ctx.exposeFunction('__gmGet', (k) => store.get(k));
    await ctx.exposeFunction('__gmSet', (k, v) => { store.set(k, v); });
    await ctx.addInitScript(GM_SHIM);
    await ctx.addInitScript(PAGE);
    await ctx.addInitScript(CONTENT);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.errors = errors;
    return page;
  }

  // --- 1. Publicités + bannière cookies -----------------------------------
  {
    const page = await newPage();
    await page.goto(`${base}/ads.html`);
    await page.waitForTimeout(1800);
    const vis = (sel) => page.$eval(sel, (el) => getComputedStyle(el).display !== 'none').catch(() => 'absent');
    check('pub adsbygoogle masquée', (await vis('ins.adsbygoogle')) === false);
    check('pub GPT masquée', (await vis('#div-gpt-ad-1234-0')) === false);
    check('contenu normal visible', (await vis('#article')) === true);
    check('OneTrust : bouton « Tout refuser » cliqué', await page.evaluate(() => window.__rejected === true));
    check('bannière OneTrust masquée', (await vis('#onetrust-banner-sdk')) !== true);
    check('défilement débloqué', await page.evaluate(() => getComputedStyle(document.body).overflowY !== 'hidden'));
    check('interface montée', await page.evaluate(() => !!document.querySelector('iblock-ui')));
    check('aucune erreur JS', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  // --- 2. Pop-ups ------------------------------------------------------------
  {
    const page = await newPage();
    await page.goto(`${base}/popups.html`);
    await page.waitForTimeout(500);
    // Clic sur une zone de texte : le script du site tente un popunder.
    await page.click('#text');
    check('popunder au clic bloqué', await page.evaluate(() => !window.__opened.includes('https://evil.example/pop')));
    // Bouton légitime (connexion).
    await page.click('#login');
    check('bouton de connexion autorisé', await page.evaluate(() => window.__opened.includes('https://accounts.google.com/login')));
    // Ouverture automatique sans geste.
    await page.evaluate(() => window.__autoOpen());
    await page.waitForTimeout(1700);
    await page.evaluate(() => window.__autoOpenLater());
    check('ouverture automatique bloquée', await page.evaluate(() => !window.__opened.includes('https://evil.example/auto')));
    // Lien détourné : clic sur un lien interne qui ouvre une pub.
    await page.click('#hijacked');
    check('lien détourné bloqué', await page.evaluate(() => !window.__opened.includes('https://evil.example/hijack')));
    // Lien externe ouvert par le site via window.open(href) : autorisé.
    await page.click('#external');
    check('lien externe légitime autorisé', await page.evaluate(() => window.__opened.includes('https://wikipedia.org/')));
    // Lien invisible cliqué par script.
    await page.click('#text2');
    check('lien _blank invisible bloqué', await page.evaluate(() => window.__anchorNav !== true));
    const toast = await page.evaluate(() => document.querySelector('iblock-ui') !== null);
    check('interface présente', toast);
    check('aucune erreur JS', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  // --- 3. Calque piège --------------------------------------------------------
  {
    const page = await newPage();
    await page.goto(`${base}/trap.html`);
    await page.waitForTimeout(500);
    await page.mouse.click(300, 300);
    check('calque piège retiré', await page.$eval('#trap', (el) => getComputedStyle(el).display === 'none'));
    check('navigation du piège empêchée', await page.evaluate(() => location.pathname.endsWith('trap.html')));
    await page.mouse.click(300, 300);
    check('le clic suivant atteint la page', await page.evaluate(() => window.__contentClicked === true));
    await page.context().close();
  }

  // --- 4. Filtres utilisateur (procéduraux + scriptlet) -----------------------
  {
    const userFilters = [
      '127.0.0.1##.card:has-text(Sponsorisé)',
      '127.0.0.1##.label-promo:upward(.box)',
      '127.0.0.1##.styled:style(color: rgb(255, 0, 0) !important)',
      '127.0.0.1##.removeme:remove()',
      '127.0.0.1#@#.ad-banner',
      'autre-site.com##.normal',
      '||ads.example.com^',
      '127.0.0.1##+js(set-constant, adConfig.enabled, false)',
      '127.0.0.1##+js(json-prune, playerAds adPlacements)',
    ].join('\n');
    const page = await newPage({ userFilters });
    // Premier chargement : enregistre le miroir pour le script « page ».
    await page.goto(`${base}/filters.html`);
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForTimeout(1200);
    const vis = (sel) => page.$eval(sel, (el) => getComputedStyle(el).display !== 'none').catch(() => 'absent');
    check(':has-text masque la carte sponsorisée', (await vis('#sponso')) === false);
    check('carte normale visible', (await vis('#normal')) === true);
    check(':upward masque le parent', (await vis('#box')) === false);
    check(':style appliqué', await page.$eval('.styled', (el) => getComputedStyle(el).color === 'rgb(255, 0, 0)'));
    check(':remove() supprime', (await vis('.removeme')) === 'absent');
    check('exception #@# respectée', (await vis('.ad-banner')) === true);
    check('filtre d’un autre site ignoré', (await vis('.normal')) === true);
    check('élément ajouté plus tard masqué', (await vis('#late')) === false);
    check('scriptlet set-constant', await page.evaluate(() => window.__adEnabled === false), await page.evaluate(() => String(window.__adEnabled)));
    check('scriptlet json-prune', await page.evaluate(() => window.__pruned === true));
    check('aucune erreur JS', page.errors.length === 0, page.errors.join(' | '));
    await page.context().close();
  }

  // --- 5. Site désactivé ------------------------------------------------------
  {
    const page = await newPage({ disabled: { '127.0.0.1': true } });
    await page.goto(`${base}/ads.html`);
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForTimeout(800);
    check('site désactivé : pubs visibles', await page.$eval('ins.adsbygoogle', (el) => getComputedStyle(el).display !== 'none'));
    check('site désactivé : pop-ups non filtrées', await page.evaluate(() => { window.open('https://x.example/'); return window.__opened.includes('https://x.example/'); }));
    await page.context().close();
  }

  // --- 6. CSP stricte -----------------------------------------------------------
  {
    const page = await newPage();
    await page.goto(`${base}/csp-ads.html`);
    await page.waitForTimeout(1200);
    check('CSP stricte : pub masquée', await page.$eval('ins.adsbygoogle', (el) => getComputedStyle(el).display === 'none'));
    await page.mouse.click(1024 - 33, 768 - 90 - 23);
    await page.waitForTimeout(300);
    check('CSP stricte : interface stylée (panneau ouvert)', await page.evaluate(() => window.__iblockPanelProbe !== false));
    await page.screenshot({ path: path.join(__dirname, 'out-csp.png') });
    await page.context().close();
  }

  // --- 7. Interface : panneau, réglages, zapper (capture d'écran) ----------------
  for (const [name, viewport, scheme] of [['ipad', { width: 1024, height: 768 }, 'light'], ['ipad-dark', { width: 820, height: 1180 }, 'dark'], ['phone', { width: 390, height: 844 }, 'light']]) {
    const page = await newPage(null, viewport);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${base}/ads.html`);
    await page.waitForTimeout(1500);
    const fab = await page.evaluate(() => {
      const host = document.querySelector('iblock-ui');
      const r = host ? host.getBoundingClientRect() : null;
      return r ? 1 : 0;
    });
    check(`[${name}] bouton flottant`, fab === 1);
    // Clic sur le bouton flottant (coin bas droit).
    await page.mouse.click(viewport.width - 33, viewport.height - 90 - 23);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, `out-${name}-panel.png`) });
    await page.context().close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent.');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
