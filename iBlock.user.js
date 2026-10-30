// ==UserScript==
// @name         iBlock
// @namespace    https://github.com/mithrax0/iBlock
// @version      0.2.0
// @description  Bloqueur façon uBlock Origin pour Safari sur iPadOS : pop-ups, pubs, bannières cookies, nuisances. À installer avec « iBlock (page) ».
// @author       mithrax0
// @match        *://*/*
// @run-at       document-start
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addStyle
// @grant        GM.openInTab
// @updateURL    https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock.meta.js
// @downloadURL  https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock.user.js
// ==/UserScript==

(async function iBlock() {
  'use strict';

  if (window.__iBlockContent) return;
  window.__iBlockContent = true;
  if (!/^https?:$/.test(location.protocol)) return;

  const VERSION = '0.2.0';
  const REPO_URL = 'https://github.com/mithrax0/iBlock';
  const IS_TOP = window.top === window;
  const CFG_KEY = '__iblock';
  const EVT_TO_PAGE = 'iblock:content';
  const EVT_FROM_PAGE = 'iblock:page';

  const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
  const HOST = location.hostname.toLowerCase();
  // Site « principal » (onglet) : sert pour l'interrupteur par site, y compris
  // dans les iframes.
  const SITE = (() => {
    if (IS_TOP) return normHost(HOST);
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return normHost(new URL(ao[ao.length - 1]).hostname);
    } catch (e) { /* ignore */ }
    return normHost(HOST);
  })();

  const FEATURES = [
    ['popups', 'Anti pop-ups', 'Bloque les fenêtres et onglets ouverts sans votre accord.'],
    ['overlays', 'Calques pièges', 'Retire les liens invisibles qui couvrent la page.'],
    ['cookies', 'Bannières cookies', 'Refuse automatiquement quand c’est possible, sinon masque.'],
    ['cosmetic', 'Publicités', 'Masque les emplacements publicitaires connus.'],
    ['annoyances', 'Nuisances', 'Newsletters, notifications, « Se connecter avec Google »…'],
    ['scriptlets', 'Scriptlets', 'Neutralise les scripts indiqués par vos filtres +js(…).'],
  ];
  const DEFAULT_FEATURES = Object.fromEntries(FEATURES.map(([k]) => [k, true]));

  // ===========================================================================
  // Listes intégrées (syntaxe uBlock Origin)
  // ===========================================================================
  const LIST_ADS = `
! Google / réseaux publicitaires
##ins.adsbygoogle
##.adsbygoogle
##[id^="div-gpt-ad"]
##[id^="google_ads_iframe"]
##div[id^="google_ads_"]
##.GoogleActiveViewElement
##[data-google-query-id]
##iframe[src*="googlesyndication.com"]
##iframe[src*="doubleclick.net"]
##iframe[src*="amazon-adsystem.com"]
##iframe[src*="adnxs.com"]
##iframe[src*="criteo."]
##amp-ad
##amp-embed[type="taboola"]
##amp-embed[type="outbrain"]
! Contenus sponsorisés (Taboola, Outbrain, Ligatus…)
##[id^="taboola-"]
##.trc_related_container
##.trc-content-sponsored
##.OUTBRAIN
##.ob-widget
##[id^="outbrain_widget"]
##.ligatus
##[id^="ligatus"]
##.teads-inread
! Emplacements génériques
##.ad-slot
##.ad-container
##.ad-banner
##.ad-wrapper
##.ads-container
##.advertisement
##.adunit
##.ad-unit
##.dfp-ad
##.gpt-ad
##.adthrive-ad
##.mv-ad-box
##.ezoic-ad
##[id^="ezoic-pub-ad"]
##div[aria-label="Advertisement"]
##div[aria-label="Publicité"]
`;

  const LIST_ANNOYANCES = `
! Messages « désactivez votre bloqueur » de Google
##.fc-ab-root
! Newsletters et pop-ups marketing
##.pum-overlay
##.mc-modal
##.mc-modal-bg
##.mc-banner
##[id^="om-"][id$="-holder"]
###wisepops-root
##.privy-popup-container
! Demandes de notifications
###onesignal-slidedown-container
###onesignal-popover-container
###onesignal-bell-container
! « Se connecter avec Google » (One Tap)
###credential_picker_container
##iframe[src*="accounts.google.com/gsi/iframe"]
`;

  const LIST_COOKIES = `
###onetrust-banner-sdk
###onetrust-consent-sdk
##.onetrust-pc-dark-filter
###didomi-host
###CybotCookiebotDialog
###CybotCookiebotDialogBodyUnderlay
###truste-consent-track
##.truste_box_overlay
##.truste_overlay
###usercentrics-root
###axeptio_overlay
###tarteaucitronRoot
##[id^="sp_message_container_"]
###cookie-law-info-bar
##.cli-modal-backdrop
##.cky-consent-container
##.cky-overlay
###cmplz-cookiebanner-container
###iubenda-cs-banner
##.osano-cm-window
##.klaro
###BorlabsCookieBox
##.fc-consent-root
###qc-cmp2-container
##.qc-cmp2-container
###cookiescript_injected
##.cc-window.cc-banner
###moove_gdpr_cookie_info_bar
###cookie-notice
###cookies-eu-banner
###sd-cmp
###appconsent
###hs-eu-cookie-confirmation
###termly-code-snippet-support
`;

  // Conteneurs de bannières cookies dans lesquels chercher un bouton « refuser ».
  const COOKIE_CONTAINERS = LIST_COOKIES.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('##'))
    .map((l) => l.slice(2))
    .concat(['ytd-consent-bump-v2-lightbox']);

  // Boutons « refuser » connus (cliqués en priorité).
  const COOKIE_REJECT = [
    '#onetrust-reject-all-handler',
    '#didomi-notice-disagree-button',
    '.didomi-continue-without-agreeing',
    '#CybotCookiebotDialogBodyButtonDecline',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '#axeptio_btn_dismiss',
    '#tarteaucitronAllDenied2',
    '.cky-btn-reject',
    '.cmplz-btn.cmplz-deny',
    '.iubenda-cs-reject-btn',
    '.osano-cm-denyAll',
    '#cn-refuse-cookie',
    '#hs-eu-decline-button',
    '.sp_choice_type_REJECT_ALL',
    '.klaro .cn-decline',
    '.klaro .cm-btn-decline',
  ];

  const REJECT_TEXT = /^\s*(tout refuser|refuser tout|tout rejeter|rejeter tout|refuser et fermer|refuser les cookies|refuser|je refuse|continuer sans accepter|reject all|reject|decline all|decline|deny all|deny|refuse all|only necessary|necessary only|use necessary cookies only|nécessaires uniquement|uniquement les cookies nécessaires|alle ablehnen|ablehnen|rechazar todo|rechazar|rifiuta tutto|rifiuta)\b/i;

  // ===========================================================================
  // Journal et statistiques
  // ===========================================================================
  const stats = { hidden: 0, popups: 0, cookies: 0, traps: 0, scriptlets: 0 };
  const frameStatus = new Map(); // hôte -> protection « page » active
  const logs = [];
  function log(kind, text) {
    logs.push({ time: new Date(), kind, text: String(text).slice(0, 300) });
    if (logs.length > 200) logs.shift();
    ui.refresh();
  }

  // Les iframes remontent leurs événements à l'onglet principal.
  function report(type, data) {
    if (IS_TOP) {
      handleReport(type, data || {});
    } else {
      try { window.top.postMessage({ __iblock: 1, type, data: data || {} }, '*'); } catch (e) { /* ignore */ }
    }
  }

  function handleReport(type, data) {
    switch (type) {
      case 'popup-blocked': {
        stats.popups += 1;
        log('popup', `Pop-up bloquée (${data.reason || 'suspecte'}) : ${data.url || ''}`);
        ui.popupToast(String(data.url || ''));
        break;
      }
      case 'trap': {
        stats.traps += 1;
        stats.popups += 1;
        log('trap', `Calque piège retiré : ${data.url || ''}`);
        ui.toast('Calque piège retiré. Touchez à nouveau.', null);
        break;
      }
      case 'cookie': {
        stats.cookies += 1;
        log('cookie', data.text || 'Bannière cookies traitée');
        break;
      }
      case 'scriptlet': {
        stats.scriptlets += 1;
        log('scriptlet', `Scriptlet actif : ${data.name}`);
        break;
      }
      case 'frame-status': {
        if (typeof data.host === 'string') {
          const known = frameStatus.get(data.host);
          frameStatus.set(data.host, !!data.active || !!known);
          if (!data.active && !known) log('error', `Anti pop-ups inactif dans le cadre ${data.host}`);
        }
        break;
      }
      case 'scriptlet-unknown':
        log('error', `Scriptlet inconnu : ${data.name}`);
        break;
      case 'scriptlet-error':
        log('error', `Erreur scriptlet ${data.name} : ${data.error}`);
        break;
      default:
        break;
    }
    ui.refresh();
  }

  if (IS_TOP) {
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.__iblock !== 1 || typeof d.type !== 'string') return;
      handleReport(d.type, d.data && typeof d.data === 'object' ? d.data : {});
    });
  }

  // Événements du script « page » de la même frame.
  document.addEventListener(EVT_FROM_PAGE, (ev) => {
    let msg;
    try { msg = JSON.parse(ev.detail); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'page-ready') {
      pageScriptSeen = true;
      for (const name of (msg.data && msg.data.scriptlets) || []) report('scriptlet', { name });
      return;
    }
    report(msg.type, msg.data || {});
  });
  let pageScriptSeen = false;

  function sendToPage(type, data) {
    try {
      document.dispatchEvent(new CustomEvent(EVT_TO_PAGE, { detail: JSON.stringify({ type, data }) }));
    } catch (e) { /* ignore */ }
  }

  // ===========================================================================
  // Protection « page » embarquée (anti pop-ups, scriptlets)
  // ===========================================================================
  // Injectée dans le contexte JavaScript du site, y compris dans les iframes
  // (lecteurs vidéo). Sur les sites à CSP stricte, l'injection échoue : le
  // script séparé « iBlock (page) » prend alors le relais.
  // @@PAGE_CODE_START (généré par tools/build.cjs à partir de src/page.js : ne pas modifier)
  const PAGE_CODE = "/*\n * Ce script tourne dans le contexte JavaScript de la page (nécessaire pour\n * intercepter window.open et neutraliser les scripts publicitaires).\n * Il n'a pas accès au stockage GM : sa configuration est recopiée dans le\n * localStorage du site par le script principal « iBlock » (clé __iblock).\n * Il communique avec lui via des CustomEvent (texte JSON uniquement).\n */\n(function iBlockPage() {\n  'use strict';\n\n  if (window.__iBlockPage) return;\n  try {\n    Object.defineProperty(window, '__iBlockPage', { value: true });\n  } catch (e) { /* ignore */ }\n\n  const CFG_KEY = '__iblock';\n  const EVT_OUT = 'iblock:page';   // page -> content\n  const EVT_IN = 'iblock:content'; // content -> page\n\n  let cfg = {};\n  try {\n    cfg = JSON.parse(window.localStorage.getItem(CFG_KEY) || '{}') || {};\n  } catch (e) { cfg = {}; }\n  if (cfg.off) return;\n\n  const features = Object.assign({ popups: true, scriptlets: true }, cfg.features || {});\n\n  // ---------------------------------------------------------------------------\n  // Communication avec le script principal\n  // ---------------------------------------------------------------------------\n  // Les deux scripts démarrent en même temps (document-start) et les\n  // événements utiles (pop-ups) n'arrivent qu'après un geste de l'utilisateur :\n  // un envoi direct suffit.\n  const dispatch = EventTarget.prototype.dispatchEvent;\n  const CE = window.CustomEvent;\n\n  function send(type, data) {\n    const msg = JSON.stringify({ type, data: data || {} });\n    try { dispatch.call(document, new CE(EVT_OUT, { detail: msg })); } catch (e) { /* ignore */ }\n  }\n\n  document.addEventListener(EVT_IN, (ev) => {\n    let msg;\n    try { msg = JSON.parse(ev.detail); } catch (e) { return; }\n    if (!msg) return;\n    if (msg.type === 'hello') {\n      // Le script principal a démarré après nous : on se signale à nouveau.\n      send('page-ready', { scriptlets: ran });\n    } else if (msg.type === 'allow-open' && msg.data && typeof msg.data.url === 'string') {\n      allowOnce.add(msg.data.url);\n    }\n  });\n\n  // ---------------------------------------------------------------------------\n  // Outils\n  // ---------------------------------------------------------------------------\n  const nativeToString = Function.prototype.toString;\n  const fakeNative = new WeakMap();\n  try {\n    // Les fonctions remplacées se présentent comme natives (anti-détection).\n    const toStringProxy = new Proxy(nativeToString, {\n      apply(target, thisArg, args) {\n        if (fakeNative.has(thisArg)) return fakeNative.get(thisArg);\n        return Reflect.apply(target, thisArg, args);\n      },\n    });\n    Function.prototype.toString = toStringProxy;\n    fakeNative.set(toStringProxy, 'function toString() { [native code] }');\n  } catch (e) { /* ignore */ }\n\n  function disguise(fn, name) {\n    fakeNative.set(fn, `function ${name}() { [native code] }`);\n    return fn;\n  }\n\n  function sameSite(url) {\n    try {\n      const u = new URL(url, location.href);\n      if (u.protocol === 'javascript:') return false;\n      if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;\n      return baseDomain(u.hostname) === baseDomain(location.hostname);\n    } catch (e) {\n      return true;\n    }\n  }\n\n  function baseDomain(host) {\n    const parts = host.split('.');\n    if (parts.length <= 2) return host;\n    // Approximation sans liste de suffixes : gère co.uk, com.au, etc.\n    const sld = parts[parts.length - 2];\n    const take = (sld.length <= 3 && parts[parts.length - 1].length === 2) ? 3 : 2;\n    return parts.slice(-take).join('.');\n  }\n\n  function absUrl(url) {\n    try { return new URL(url, location.href).href; } catch (e) { return String(url); }\n  }\n\n  // ---------------------------------------------------------------------------\n  // Anti pop-ups\n  // ---------------------------------------------------------------------------\n  const allowOnce = new Set();\n\n  // Sites légitimes souvent ouverts dans une fenêtre (connexion, partage, paiement).\n  const POPUP_ALLOW = [\n    'accounts.google.com', 'accounts.youtube.com', 'appleid.apple.com', 'idmsa.apple.com',\n    'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'reddit.com',\n    'tumblr.com', 'bsky.app', 'threads.net', 'vk.com', 'login.microsoftonline.com', 'login.live.com',\n    'github.com', 'discord.com', 'twitch.tv', 'spotify.com', 'steamcommunity.com',\n    'paypal.com', 'stripe.com', 'pay.google.com', 'whatsapp.com', 'wa.me', 't.me', 'telegram.me',\n    'mail.google.com', 'outlook.live.com', 'auth0.com', 'okta.com',\n  ];\n  function allowedHost(host) {\n    host = host.toLowerCase();\n    return POPUP_ALLOW.some((d) => host === d || host.endsWith(`.${d}`));\n  }\n\n  // Dernier geste de l'utilisateur, capturé avant les scripts du site.\n  const gesture = { time: 0, target: null, opens: 0 };\n  const onGesture = (ev) => {\n    if (!ev.isTrusted) return;\n    gesture.time = Date.now();\n    gesture.target = ev.target;\n    gesture.opens = 0;\n  };\n  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown']) {\n    window.addEventListener(t, onGesture, { capture: true, passive: true });\n  }\n\n  const INTERACTIVE = 'a[href],button,input[type=\"button\"],input[type=\"submit\"],input[type=\"image\"],[role=\"button\"],[role=\"link\"],[role=\"menuitem\"],select,label,summary';\n  // Un « vrai » bouton : les lecteurs vidéo déguisent souvent des <div> en boutons.\n  const REAL_BUTTON = 'button,input[type=\"button\"],input[type=\"submit\"],input[type=\"image\"]';\n\n  function gestureElement() {\n    const t = gesture.target;\n    return t && t.nodeType === 1 && typeof t.closest === 'function' ? t : null;\n  }\n\n  function popupVerdict(url) {\n    const full = absUrl(url || 'about:blank');\n    if (allowOnce.has(full)) {\n      allowOnce.delete(full);\n      return { allow: true };\n    }\n    if (Date.now() - gesture.time > 1500) {\n      // Aucun geste récent : ouverture automatique → pop-up indésirable.\n      return { allow: false, reason: 'ouverture automatique' };\n    }\n    gesture.opens += 1;\n    if (gesture.opens > 1) return { allow: false, reason: 'ouvertures multiples' };\n\n    const el = gestureElement();\n    if (!url || full === 'about:blank') {\n      // Fenêtre vide puis redirection : technique classique des popunders.\n      return el && el.closest(REAL_BUTTON)\n        ? { allow: true }\n        : { allow: false, reason: 'fenêtre vide suspecte' };\n    }\n    let u;\n    try { u = new URL(full); } catch (e) { return { allow: true }; }\n    if (/^(data|blob|javascript):$/.test(u.protocol)) return { allow: false, reason: 'adresse suspecte' };\n    if (!/^https?:$/.test(u.protocol)) return { allow: true };\n    if (sameSite(full)) return { allow: true };\n\n    const link = el && el.closest('a[href]');\n    if (link) {\n      // Clic sur un lien : seule sa propre destination peut s'ouvrir.\n      const href = absUrl(link.getAttribute('href'));\n      if (href === full) return { allow: true };\n      try {\n        if (new URL(href).hostname === u.hostname) return { allow: true };\n      } catch (e) { /* ignore */ }\n      return { allow: false, reason: 'lien détourné' };\n    }\n    if (allowedHost(u.hostname)) return { allow: true };\n    // Mode strict : un site externe ne s'ouvre pas depuis un bouton quelconque\n    // (le bouton ▶ d'un lecteur vidéo par exemple).\n    return { allow: false, reason: el && el.closest(INTERACTIVE) ? 'site externe' : 'clic détourné' };\n  }\n\n  // window.open(url, \"nom\") vers une iframe existante n'est pas un pop-up.\n  function targetsFrame(win, name) {\n    if (!name || /^_(self|top|parent)$/i.test(name)) return true;\n    if (/^_blank$/i.test(name)) return false;\n    try {\n      for (let i = 0; i < win.frames.length; i += 1) {\n        try { if (win.frames[i].name === name) return true; } catch (e) { /* cross-origin */ }\n      }\n    } catch (e) { /* ignore */ }\n    return false;\n  }\n\n  function isAnchor(a) {\n    return !!a && a.nodeType === 1 && a.tagName === 'A';\n  }\n\n  function suspiciousAnchor(a) {\n    if (!isAnchor(a)) return false;\n    const t = (a.getAttribute('target') || '').toLowerCase();\n    if (!t || t === '_self' || t === '_top' || t === '_parent') return false;\n    const href = a.getAttribute('href');\n    if (!href || sameSite(href)) return false;\n    return true;\n  }\n\n  function anchorBlocked(a) {\n    if (!suspiciousAnchor(a)) return false;\n    // Un lien réellement touché par l'utilisateur est toujours autorisé.\n    const touched = gesture.target && a.contains(gesture.target) && Date.now() - gesture.time < 1500;\n    if (touched) return false;\n    const verdict = popupVerdict(a.href);\n    if (verdict.allow) return false;\n    send('popup-blocked', { url: a.href, reason: 'lien invisible cliqué par script' });\n    return true;\n  }\n\n  function formBlocked(f) {\n    const t = f.getAttribute('target') || '';\n    if (targetsFrame(f.ownerDocument.defaultView || window, t)) return false;\n    const action = absUrl(f.getAttribute('action') || location.href);\n    if (sameSite(action)) return false;\n    const verdict = popupVerdict(action);\n    if (verdict.allow) return false;\n    send('popup-blocked', { url: action, reason: 'formulaire vers un nouvel onglet' });\n    return true;\n  }\n\n  function override(obj, prop, fn) {\n    try {\n      Object.defineProperty(obj, prop, { value: fn, writable: true, configurable: true, enumerable: true });\n    } catch (e) {\n      try { obj[prop] = fn; } catch (e2) { /* ignore */ }\n    }\n  }\n\n  // Protège une fenêtre : la page elle-même et les iframes vides créées par les\n  // régies pour récupérer un window.open « intact ».\n  const protectedWindows = new WeakSet();\n  function protectWindow(w) {\n    let nativeOpen;\n    try {\n      if (protectedWindows.has(w)) return;\n      nativeOpen = w.open; // lève une exception si la fenêtre est d'une autre origine\n      protectedWindows.add(w);\n    } catch (e) {\n      return;\n    }\n\n    override(w, 'open', disguise(function open(url, target) {\n      const name = target == null ? '' : String(target);\n      if (name && targetsFrame(w, name)) return Reflect.apply(nativeOpen, this, arguments);\n      const verdict = popupVerdict(url == null ? '' : String(url));\n      if (verdict.allow) return Reflect.apply(nativeOpen, this, arguments);\n      send('popup-blocked', { url: absUrl(url || 'about:blank'), reason: verdict.reason });\n      return null;\n    }, 'open'));\n\n    const nativeClick = w.HTMLElement.prototype.click;\n    override(w.HTMLAnchorElement.prototype, 'click', disguise(function click() {\n      if (anchorBlocked(this)) return undefined;\n      return Reflect.apply(nativeClick, this, arguments);\n    }, 'click'));\n\n    const nativeDispatch = w.EventTarget.prototype.dispatchEvent;\n    override(w.EventTarget.prototype, 'dispatchEvent', disguise(function dispatchEvent(ev) {\n      if (ev && ev.type === 'click' && !ev.isTrusted && anchorBlocked(this)) return false;\n      return Reflect.apply(nativeDispatch, this, arguments);\n    }, 'dispatchEvent'));\n\n    const formProto = w.HTMLFormElement.prototype;\n    const nativeSubmit = formProto.submit;\n    override(formProto, 'submit', disguise(function submit() {\n      if (formBlocked(this)) return undefined;\n      return Reflect.apply(nativeSubmit, this, arguments);\n    }, 'submit'));\n    const nativeRequestSubmit = formProto.requestSubmit;\n    if (typeof nativeRequestSubmit === 'function') {\n      override(formProto, 'requestSubmit', disguise(function requestSubmit() {\n        if (formBlocked(this)) return undefined;\n        return Reflect.apply(nativeRequestSubmit, this, arguments);\n      }, 'requestSubmit'));\n    }\n\n    // Toute iframe consultée par un script est protégée à son tour.\n    for (const Ctor of [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement]) {\n      if (!Ctor) continue;\n      for (const prop of ['contentWindow', 'contentDocument']) {\n        const d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);\n        if (!d || !d.get) continue;\n        const getter = d.get;\n        try {\n          Object.defineProperty(Ctor.prototype, prop, {\n            configurable: true,\n            enumerable: d.enumerable,\n            get: disguise(function () {\n              const v = getter.call(this);\n              try {\n                const win = prop === 'contentWindow' ? v : v && v.defaultView;\n                if (win) protectWindow(win);\n              } catch (e) { /* ignore */ }\n              return v;\n            }, `get ${prop}`),\n          });\n        } catch (e) { /* ignore */ }\n      }\n    }\n  }\n\n  if (features.popups) protectWindow(window);\n\n  // ---------------------------------------------------------------------------\n  // Scriptlets (sous-ensemble compatible uBlock Origin)\n  // ---------------------------------------------------------------------------\n  function patternToRegex(pattern) {\n    if (pattern == null || pattern === '') return /^/;\n    const m = /^\\/(.+)\\/([gimsu]*)$/.exec(pattern);\n    if (m) {\n      try { return new RegExp(m[1], m[2]); } catch (e) { return /^\\b$/; }\n    }\n    return new RegExp(pattern.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'));\n  }\n\n  function resolveConstant(raw) {\n    switch (raw) {\n      case 'undefined': return undefined;\n      case 'null': return null;\n      case 'true': return true;\n      case 'false': return false;\n      case '': case 'emptyStr': return '';\n      case 'noopFunc': return function () {};\n      case 'trueFunc': return function () { return true; };\n      case 'falseFunc': return function () { return false; };\n      case 'emptyArr': case '[]': return [];\n      case 'emptyObj': case '{}': return {};\n      case 'noopPromiseResolve': return function () { return Promise.resolve(); };\n      default:\n        if (/^-?\\d+(\\.\\d+)?$/.test(raw)) {\n          const n = Number(raw);\n          if (Math.abs(n) <= 0x7FFF) return n;\n        }\n        return undefined;\n    }\n  }\n\n  // Définit un piège sur un chemin de propriétés (a.b.c), même si les objets\n  // intermédiaires n'existent pas encore.\n  function trapChain(root, chain, onFinal) {\n    const dot = chain.indexOf('.');\n    if (dot === -1) {\n      onFinal(root, chain);\n      return;\n    }\n    const prop = chain.slice(0, dot);\n    const rest = chain.slice(dot + 1);\n    let current = root[prop];\n    if (current instanceof Object || (typeof current === 'object' && current !== null)) {\n      trapChain(current, rest, onFinal);\n      return;\n    }\n    const desc = Object.getOwnPropertyDescriptor(root, prop);\n    if (desc && desc.configurable === false) return;\n    try {\n      Object.defineProperty(root, prop, {\n        configurable: true,\n        get() { return current; },\n        set(v) {\n          current = v;\n          if (v instanceof Object) trapChain(v, rest, onFinal);\n        },\n      });\n    } catch (e) { /* ignore */ }\n  }\n\n  const scriptlets = {};\n\n  scriptlets['set-constant'] = function (chain, rawValue) {\n    if (!chain) return;\n    const value = resolveConstant(rawValue);\n    trapChain(window, chain, (owner, prop) => {\n      try {\n        Object.defineProperty(owner, prop, {\n          configurable: false,\n          get() { return value; },\n          set() {},\n        });\n      } catch (e) { /* ignore */ }\n    });\n  };\n  scriptlets.set = scriptlets['set-constant'];\n\n  function abortError() {\n    return new ReferenceError(Math.random().toString(36).slice(2));\n  }\n\n  scriptlets['abort-on-property-read'] = function (chain) {\n    if (!chain) return;\n    trapChain(window, chain, (owner, prop) => {\n      try {\n        Object.defineProperty(owner, prop, {\n          configurable: false,\n          get() { throw abortError(); },\n          set() {},\n        });\n      } catch (e) { /* ignore */ }\n    });\n  };\n  scriptlets.aopr = scriptlets['abort-on-property-read'];\n\n  scriptlets['abort-on-property-write'] = function (prop) {\n    if (!prop) return;\n    trapChain(window, prop, (owner, p) => {\n      try {\n        Object.defineProperty(owner, p, {\n          configurable: false,\n          get() { return undefined; },\n          set() { throw abortError(); },\n        });\n      } catch (e) { /* ignore */ }\n    });\n  };\n  scriptlets.aopw = scriptlets['abort-on-property-write'];\n\n  scriptlets['abort-current-script'] = function (chain, needle) {\n    if (!chain) return;\n    const re = patternToRegex(needle);\n    const scriptOf = () => document.currentScript;\n    trapChain(window, chain, (owner, prop) => {\n      let value = owner[prop];\n      const check = () => {\n        const s = scriptOf();\n        if (!(s instanceof HTMLScriptElement)) return;\n        const text = s.src ? s.src : s.textContent;\n        if (re.test(text)) throw abortError();\n      };\n      try {\n        Object.defineProperty(owner, prop, {\n          configurable: true,\n          get() { check(); return value; },\n          set(v) { check(); value = v; },\n        });\n      } catch (e) { /* ignore */ }\n    });\n  };\n  scriptlets.acs = scriptlets['abort-current-script'];\n\n  function makeTimerGuard(name) {\n    return function (needle, delay) {\n      const native = window[name];\n      const re = patternToRegex(needle);\n      const delayNum = delay ? parseInt(String(delay).replace(/^!/, ''), 10) : NaN;\n      const negateDelay = typeof delay === 'string' && delay.startsWith('!');\n      window[name] = disguise(function (fn, ms) {\n        const text = typeof fn === 'function' ? nativeToString.call(fn) : String(fn);\n        let match = re.test(text);\n        if (!Number.isNaN(delayNum)) {\n          const delayMatch = Number(ms) === delayNum;\n          match = match && (negateDelay ? !delayMatch : delayMatch);\n        }\n        if (match) return 0;\n        return Reflect.apply(native, this, arguments);\n      }, name);\n    };\n  }\n  scriptlets['no-setTimeout-if'] = makeTimerGuard('setTimeout');\n  scriptlets.nostif = scriptlets['no-setTimeout-if'];\n  scriptlets['prevent-setTimeout'] = scriptlets['no-setTimeout-if'];\n  scriptlets['no-setInterval-if'] = makeTimerGuard('setInterval');\n  scriptlets.nosiif = scriptlets['no-setInterval-if'];\n  scriptlets['prevent-setInterval'] = scriptlets['no-setInterval-if'];\n\n  scriptlets['addEventListener-defuser'] = function (type, needle) {\n    const reType = patternToRegex(type);\n    const reFn = patternToRegex(needle);\n    const native = EventTarget.prototype.addEventListener;\n    EventTarget.prototype.addEventListener = disguise(function addEventListener(t, fn) {\n      if (reType.test(String(t))) {\n        let text = '';\n        try { text = typeof fn === 'function' ? nativeToString.call(fn) : String(fn); } catch (e) { /* ignore */ }\n        if (reFn.test(text)) return undefined;\n      }\n      return Reflect.apply(native, this, arguments);\n    }, 'addEventListener');\n  };\n  scriptlets.aeld = scriptlets['addEventListener-defuser'];\n  scriptlets['prevent-addEventListener'] = scriptlets['addEventListener-defuser'];\n\n  // Supprime des propriétés d'objets JSON (ex. pubs du lecteur YouTube).\n  function pruneObject(obj, paths, required) {\n    if (!obj || typeof obj !== 'object') return false;\n    if (required.length && !required.every((p) => hasPath(obj, p))) return false;\n    let pruned = false;\n    for (const p of paths) {\n      if (deletePath(obj, p.split('.'))) pruned = true;\n    }\n    return pruned;\n  }\n  function hasPath(obj, path) {\n    let cur = obj;\n    for (const k of path.split('.')) {\n      if (cur == null || typeof cur !== 'object' || !(k in cur)) return false;\n      cur = cur[k];\n    }\n    return true;\n  }\n  function deletePath(obj, keys) {\n    if (obj == null || typeof obj !== 'object') return false;\n    const [k, ...rest] = keys;\n    if (k === '[]' || k === '*') {\n      let any = false;\n      for (const v of Object.values(obj)) {\n        if (rest.length === 0) continue;\n        if (deletePath(v, rest)) any = true;\n      }\n      return any;\n    }\n    if (!(k in obj)) return false;\n    if (rest.length === 0) {\n      delete obj[k];\n      return true;\n    }\n    return deletePath(obj[k], rest);\n  }\n\n  const jsonPruners = [];\n  let jsonHooked = false;\n  function hookJson() {\n    if (jsonHooked) return;\n    jsonHooked = true;\n    const nativeParse = JSON.parse;\n    JSON.parse = disguise(function parse() {\n      const result = Reflect.apply(nativeParse, this, arguments);\n      for (const pr of jsonPruners) {\n        if (pruneObject(result, pr.paths, pr.required)) send('scriptlet', { name: 'json-prune' });\n      }\n      return result;\n    }, 'parse');\n    const nativeJson = Response.prototype.json;\n    Response.prototype.json = disguise(function json() {\n      return Reflect.apply(nativeJson, this, arguments).then((result) => {\n        for (const pr of jsonPruners) {\n          if (pruneObject(result, pr.paths, pr.required)) send('scriptlet', { name: 'json-prune' });\n        }\n        return result;\n      });\n    }, 'json');\n  }\n\n  scriptlets['json-prune'] = function (paths, required) {\n    if (!paths) return;\n    jsonPruners.push({\n      paths: paths.split(/\\s+/).filter(Boolean),\n      required: (required || '').split(/\\s+/).filter(Boolean),\n    });\n    hookJson();\n  };\n\n  scriptlets['noeval-if'] = function (needle) {\n    const re = patternToRegex(needle);\n    const native = window.eval;\n    window.eval = disguise(function (src) {\n      if (re.test(String(src))) return undefined;\n      return native(src);\n    }, 'eval');\n  };\n\n  scriptlets['nowebrtc'] = function () {\n    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {\n      if (typeof window[name] !== 'function') continue;\n      const Fake = disguise(function () { throw new DOMException('Bloqué par iBlock', 'NotAllowedError'); }, name);\n      try { window[name] = Fake; } catch (e) { /* ignore */ }\n    }\n  };\n\n  scriptlets['window.open-defuser'] = function () {\n    window.open = disguise(function open() { return null; }, 'open');\n  };\n  scriptlets['no-window-open-if'] = function (needle) {\n    const re = patternToRegex(needle);\n    const native = window.open;\n    window.open = disguise(function open(url) {\n      if (re.test(String(url || ''))) {\n        send('popup-blocked', { url: absUrl(url || ''), reason: 'filtre' });\n        return null;\n      }\n      return Reflect.apply(native, this, arguments);\n    }, 'open');\n  };\n  scriptlets.nowoif = scriptlets['no-window-open-if'];\n\n  const ran = [];\n  function runScriptlet(name, args) {\n    let fname = String(name || '').trim().replace(/\\.js$/, '');\n    const fn = scriptlets[fname];\n    if (!fn) {\n      send('scriptlet-unknown', { name: fname });\n      return;\n    }\n    try {\n      fn.apply(null, (args || []).map(String));\n      ran.push(fname);\n    } catch (e) {\n      send('scriptlet-error', { name: fname, error: String(e && e.message) });\n    }\n  }\n\n  if (features.scriptlets && Array.isArray(cfg.scriptlets)) {\n    for (const s of cfg.scriptlets) {\n      if (Array.isArray(s) && s.length) runScriptlet(s[0], s.slice(1));\n    }\n  }\n\n  send('page-ready', { scriptlets: ran });\n})();";
  // @@PAGE_CODE_END

  function injectPageCode() {
    try {
      const s = document.createElement('script');
      s.textContent = PAGE_CODE;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) { /* CSP ou Trusted Types */ }
  }
  whenRoot(injectPageCode);

  // Chaque cadre signale à l'onglet principal si la protection « page » y tourne.
  setTimeout(() => report('frame-status', { host: HOST, active: pageScriptSeen }), 2500);

  // ===========================================================================
  // Réglages (stockage GM) + miroir localStorage pour le script « page »
  // ===========================================================================
  function normalizeSettings(s) {
    const base = {
      v: 1,
      disabled: {},
      userFilters: '',
      features: Object.assign({}, DEFAULT_FEATURES),
      ui: { side: 'right', top: null, mini: false },
    };
    if (!s || typeof s !== 'object') return base;
    return {
      v: 1,
      disabled: s.disabled && typeof s.disabled === 'object' ? s.disabled : {},
      userFilters: typeof s.userFilters === 'string' ? s.userFilters : '',
      features: Object.assign({}, DEFAULT_FEATURES, s.features || {}),
      ui: Object.assign(base.ui, s.ui || {}),
    };
  }

  const hasGM = typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function';

  async function loadSettings() {
    if (!hasGM) return normalizeSettings(null);
    try {
      const raw = await GM.getValue('settings', null);
      return normalizeSettings(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch (e) {
      return normalizeSettings(null);
    }
  }

  async function saveSettings() {
    if (!hasGM) return;
    try {
      await GM.setValue('settings', JSON.stringify(settings));
    } catch (e) {
      log('error', 'Impossible d’enregistrer les réglages.');
    }
  }

  function readMirror() {
    try { return JSON.parse(window.localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; }
  }

  function writeMirror() {
    const pageFeatures = { popups: !!settings.features.popups, scriptlets: !!settings.features.scriptlets };
    const cfg = { off: siteOff || undefined, features: pageFeatures, scriptlets: rules.scriptlets.length ? rules.scriptlets : undefined };
    const isDefault = !cfg.off && pageFeatures.popups && pageFeatures.scriptlets && !cfg.scriptlets;
    try {
      if (isDefault) {
        if (window.localStorage.getItem(CFG_KEY) !== null) window.localStorage.removeItem(CFG_KEY);
      } else {
        const s = JSON.stringify(cfg);
        if (window.localStorage.getItem(CFG_KEY) !== s) window.localStorage.setItem(CFG_KEY, s);
      }
    } catch (e) { /* stockage indisponible */ }
  }

  // ===========================================================================
  // Analyse des filtres
  // ===========================================================================
  const PROC_OPS = new Set([
    'has-text', 'contains', '-abp-contains', 'upward', 'remove', 'style', 'matches-css',
    'matches-css-before', 'matches-css-after', 'min-text-length', 'matches-path',
    'remove-attr', 'remove-class', 'xpath', 'watch-attr', 'if', 'if-not', '-abp-has',
    'matches-attr', 'matches-prop', 'others',
  ]);
  const ACTION_OPS = new Set(['remove', 'style', 'remove-attr', 'remove-class']);

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function textPattern(arg) {
    const m = /^\/(.+)\/([gimsu]*)$/.exec(arg);
    if (m) {
      try { return new RegExp(m[1], m[2].replace('g', '')); } catch (e) { return null; }
    }
    return new RegExp(escapeRegex(arg));
  }

  function domainMatch(entry, host) {
    if (entry.endsWith('.*')) {
      const re = new RegExp(`(^|\\.)${escapeRegex(entry.slice(0, -2))}\\.[^.]+(\\.[^.]+)?$`);
      return re.test(host);
    }
    return host === entry || host.endsWith(`.${entry}`);
  }

  function appliesTo(domains, host) {
    if (!domains.pos.length && !domains.neg.length) return true;
    if (domains.neg.some((d) => domainMatch(d, host))) return false;
    return domains.pos.length === 0 || domains.pos.some((d) => domainMatch(d, host));
  }

  function parseDomains(str) {
    const out = { pos: [], neg: [] };
    for (let d of str.split(',')) {
      d = d.trim().toLowerCase();
      if (!d) continue;
      if (d.startsWith('~')) out.neg.push(d.slice(1));
      else out.pos.push(d);
    }
    return out;
  }

  function splitArgs(str) {
    const out = [];
    let cur = '';
    for (let i = 0; i < str.length; i += 1) {
      const c = str[i];
      if (c === '\\' && str[i + 1] === ',') { cur += ','; i += 1; continue; }
      if (c === ',') { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((a) => {
      a = a.trim();
      if ((a.startsWith('"') && a.endsWith('"')) || (a.startsWith('\'') && a.endsWith('\''))) a = a.slice(1, -1);
      return a;
    });
  }

  // Découpe un sélecteur en segments CSS et opérateurs procéduraux.
  function splitProcedural(sel) {
    const parts = [];
    let css = '';
    let i = 0;
    let depth = 0;
    let bracket = 0;
    let quote = '';
    while (i < sel.length) {
      const c = sel[i];
      if (quote) {
        css += c;
        if (c === '\\') { css += sel[i + 1] || ''; i += 2; continue; }
        if (c === quote) quote = '';
        i += 1;
        continue;
      }
      if (c === '"' || c === '\'') { quote = c; css += c; i += 1; continue; }
      if (c === '[') bracket += 1;
      if (c === ']') bracket -= 1;
      if (c === '(') depth += 1;
      if (c === ')') depth -= 1;
      if (c === ':' && depth === 0 && bracket === 0) {
        const m = /^:(-?[a-z][a-z-]*)\(/i.exec(sel.slice(i));
        if (m) {
          const name = m[1].toLowerCase();
          const argStart = i + m[0].length;
          const end = matchParen(sel, argStart - 1);
          if (end === -1) return null;
          const arg = sel.slice(argStart, end);
          let opName = null;
          if (PROC_OPS.has(name)) opName = name;
          else if ((name === 'has' || name === 'not') && isProcedural(arg)) opName = name === 'has' ? 'if' : 'if-not';
          if (opName) {
            if (css.trim()) parts.push({ css: css.trim() });
            css = '';
            parts.push({ op: opName, arg });
            i = end + 1;
            continue;
          }
        }
      }
      css += c;
      i += 1;
    }
    if (css.trim()) parts.push({ css: css.trim() });
    return parts;
  }

  function matchParen(str, openIdx) {
    let depth = 0;
    let quote = '';
    for (let i = openIdx; i < str.length; i += 1) {
      const c = str[i];
      if (quote) {
        if (c === '\\') { i += 1; continue; }
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === '\'') { quote = c; continue; }
      if (c === '\\') { i += 1; continue; }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function isProcedural(sel) {
    return /:(-?[a-z][a-z-]*)\(/gi.test(sel) && [...sel.matchAll(/:(-?[a-z][a-z-]*)\(/gi)]
      .some((m) => PROC_OPS.has(m[1].toLowerCase()));
  }

  const validityFrag = document.createDocumentFragment();
  function validSelector(sel) {
    if (!sel || /[{}]/.test(sel)) return false;
    try {
      validityFrag.querySelector(sel);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Parse une ligne de filtre. Retourne null pour un commentaire.
  function parseFilter(line) {
    line = line.trim();
    if (!line || line.startsWith('!') || line.startsWith('[') || /^#\s/.test(line)) return null;
    const m = /^([^#]*?)#(@?)([?$]{0,2})#(.*)$/.exec(line);
    // Une règle réseau peut contenir « # » dans son URL.
    if (!m || /[|/^$=]/.test(m[1])) return { kind: 'network' };
    const domains = parseDomains(m[1]);
    const exception = m[2] === '@';
    const flags = m[3];
    let body = m[4].trim();
    if (!body) return { kind: 'invalid' };

    if (body.startsWith('+js(') && body.endsWith(')')) {
      const args = splitArgs(body.slice(4, -1));
      if (args.length === 1 && args[0] === '') return { kind: 'scriptlet', domains, exception, args: [] };
      return { kind: 'scriptlet', domains, exception, args };
    }
    if (body.startsWith('^')) return { kind: 'unsupported' };

    if (flags.includes('$')) {
      // Injection CSS façon AdGuard : sel { prop: valeur }
      const cm = /^(.+?)\s*\{([^{}]*)\}\s*$/.exec(body);
      if (!cm) return { kind: 'invalid' };
      return { kind: 'style', domains, exception, selector: cm[1].trim(), css: cm[2].trim(), raw: body };
    }

    if (isProcedural(body) || flags.includes('?')) {
      const parts = splitProcedural(body);
      if (!parts || !parts.length) return { kind: 'invalid' };
      // :style() sur un sélecteur CSS simple → règle CSS classique.
      if (parts.length === 2 && parts[0].css && parts[1].op === 'style' && validSelector(parts[0].css)) {
        return { kind: 'style', domains, exception, selector: parts[0].css, css: parts[1].arg, raw: body };
      }
      if (parts.some((p) => p.op === 'others' || p.op === 'matches-prop')) return { kind: 'unsupported' };
      return { kind: 'proc', domains, exception, parts, raw: body };
    }
    if (!validSelector(body)) return { kind: 'invalid' };
    return { kind: 'hide', domains, exception, selector: body, raw: body };
  }

  function compileRules(texts, host) {
    const out = {
      hide: [], styles: [], procs: [], scriptlets: [],
      counts: { cosmetic: 0, scriptlet: 0, network: 0, unsupported: 0, invalid: 0 },
    };
    const parsed = [];
    for (const text of texts) {
      for (const line of String(text || '').split(/\r?\n/)) {
        const f = parseFilter(line);
        if (!f) continue;
        if (f.kind === 'network') { out.counts.network += 1; continue; }
        if (f.kind === 'unsupported') { out.counts.unsupported += 1; continue; }
        if (f.kind === 'invalid') { out.counts.invalid += 1; continue; }
        if (f.kind === 'scriptlet') out.counts.scriptlet += 1;
        else out.counts.cosmetic += 1;
        parsed.push(f);
      }
    }
    const excepted = new Set();
    let noScriptlets = false;
    for (const f of parsed) {
      if (!f.exception) continue;
      // Une exception sans domaine s'applique partout.
      if (f.domains.pos.length && !appliesTo(f.domains, host)) continue;
      if (f.kind === 'scriptlet') {
        if (!f.args.length) noScriptlets = true;
        else excepted.add(`+js:${f.args[0]}`);
      } else {
        excepted.add(f.raw);
      }
    }
    const seenScriptlets = new Set();
    for (const f of parsed) {
      if (f.exception) continue;
      if (!appliesTo(f.domains, host)) continue;
      if (f.kind === 'scriptlet') {
        // Les scriptlets génériques (sans domaine) sont ignorés, comme dans uBO.
        if (!f.domains.pos.length || noScriptlets || !f.args.length) continue;
        if (excepted.has(`+js:${f.args[0]}`)) continue;
        const key = JSON.stringify(f.args);
        if (seenScriptlets.has(key)) continue;
        seenScriptlets.add(key);
        out.scriptlets.push(f.args);
        continue;
      }
      if (excepted.has(f.raw)) continue;
      if (f.kind === 'hide') out.hide.push(f.selector);
      else if (f.kind === 'style') out.styles.push({ selector: f.selector, css: f.css });
      else if (f.kind === 'proc') out.procs.push(f);
    }
    out.hide = [...new Set(out.hide)];
    return out;
  }

  // ===========================================================================
  // Feuille de style (résiste aux CSP strictes et aux suppressions)
  // ===========================================================================
  // Au tout début du chargement, <html> peut ne pas encore exister.
  function whenRoot(cb) {
    if (document.documentElement) { cb(); return; }
    const mo = new MutationObserver(() => {
      if (!document.documentElement) return;
      mo.disconnect();
      cb();
    });
    mo.observe(document, { childList: true });
  }

  class Sheet {
    constructor(name) {
      this.name = name;
      this.rules = [];
      this.el = null;
      this.gmFallback = false;
      this.adopted = null;
      this.waiting = false;
    }

    set(rules) {
      this.rules = rules;
      this.render();
    }

    ensure() {
      if (!this.rules.length) return;
      if (this.adopted) {
        if (!document.adoptedStyleSheets.includes(this.adopted)) this.adopt();
      } else if (!this.el || !this.el.isConnected) {
        this.render();
      }
    }

    remove() {
      this.rules = [];
      if (this.el) this.el.remove();
      this.el = null;
      if (this.adopted) {
        try { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== this.adopted); } catch (e) { /* ignore */ }
      }
      this.adopted = null;
    }

    // Feuille « construite » : non soumise à la CSP du site (Safari 16.4+).
    adopt() {
      try {
        if (!('adoptedStyleSheets' in document)) return false;
        const cs = this.adopted || new CSSStyleSheet();
        cs.replaceSync(this.rules.join('\n'));
        if (!document.adoptedStyleSheets.includes(cs)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, cs];
        this.adopted = cs;
        return true;
      } catch (e) {
        return false;
      }
    }

    render() {
      if (this.el) this.el.remove();
      this.el = null;
      if (!this.rules.length) return;
      if (this.adopted) { this.adopt(); return; }
      if (!document.documentElement) {
        if (!this.waiting) {
          this.waiting = true;
          whenRoot(() => { this.waiting = false; this.render(); });
        }
        return;
      }
      const el = document.createElement('style');
      el.setAttribute('data-iblock', this.name);
      el.textContent = this.rules.join('\n');
      (document.head || document.documentElement).appendChild(el);
      this.el = el;
      let ok = el.sheet && el.sheet.cssRules.length > 0;
      if (!ok && el.sheet) {
        // CSP « style-src » sans unsafe-inline : on passe par le CSSOM.
        el.textContent = '';
        for (const r of this.rules) {
          try { el.sheet.insertRule(r, el.sheet.cssRules.length); } catch (e) { /* règle invalide */ }
        }
        ok = el.sheet.cssRules.length > 0;
      }
      if (!ok) {
        el.remove();
        this.el = null;
        ok = this.adopt();
      }
      if (!ok && !this.gmFallback && hasGM && typeof GM.addStyle === 'function') {
        this.gmFallback = true;
        try { GM.addStyle(this.rules.join('\n')); } catch (e) { /* ignore */ }
      }
    }
  }

  // ===========================================================================
  // Moteur cosmétique (CSS + filtres procéduraux)
  // ===========================================================================
  const sheet = new Sheet('cosmetic');
  const procHidden = new Map(); // élément -> ancienne valeur display
  let procStyleId = 0;
  let watchedAttrs = new Set();

  function relQuery(root, css) {
    if (root === document) return [...document.querySelectorAll(css)];
    try { return [...root.querySelectorAll(`:scope ${css}`)]; } catch (e) { return []; }
  }

  function runParts(roots, parts) {
    let set = roots;
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      if (p.css) {
        const next = new Set();
        for (const r of set) {
          try { for (const el of relQuery(r, p.css)) next.add(el); } catch (e) { return []; }
        }
        set = [...next];
      } else if (!ACTION_OPS.has(p.op)) {
        set = applyOp(set, p);
      }
      if (!set.length) return [];
    }
    return set.filter((el) => el !== document);
  }

  function applyOp(set, p) {
    const arg = p.arg;
    switch (p.op) {
      case 'has-text':
      case 'contains':
      case '-abp-contains': {
        const re = textPattern(arg);
        if (!re) return [];
        return set.filter((el) => el !== document && re.test(el.textContent));
      }
      case 'min-text-length': {
        const n = parseInt(arg, 10) || 0;
        return set.filter((el) => el !== document && el.textContent.length >= n);
      }
      case 'upward': {
        const out = new Set();
        const n = /^\d+$/.test(arg.trim()) ? parseInt(arg, 10) : null;
        for (const el of set) {
          if (el === document) continue;
          let cur = el;
          if (n !== null) {
            for (let k = 0; k < n && cur; k += 1) cur = cur.parentElement;
          } else {
            try { cur = el.parentElement && el.parentElement.closest(arg); } catch (e) { cur = null; }
          }
          if (cur && cur !== document.documentElement && cur !== document.body) out.add(cur);
        }
        return [...out];
      }
      case 'if':
      case '-abp-has':
      case 'if-not': {
        const inner = splitProcedural(arg);
        if (!inner) return [];
        const want = p.op !== 'if-not';
        return set.filter((el) => el !== document && (runParts([el], inner).length > 0) === want);
      }
      case 'matches-css':
      case 'matches-css-before':
      case 'matches-css-after': {
        const pseudo = p.op === 'matches-css' ? null : `::${p.op.split('-').pop()}`;
        const idx = arg.indexOf(':');
        if (idx === -1) return [];
        const prop = arg.slice(0, idx).trim();
        const val = arg.slice(idx + 1).trim();
        const re = /^\/.+\/[a-z]*$/.test(val) ? textPattern(val) : new RegExp(`^${escapeRegex(val)}$`);
        if (!re) return [];
        return set.filter((el) => el !== document && re.test(getComputedStyle(el, pseudo).getPropertyValue(prop)));
      }
      case 'matches-attr': {
        const am = /^\s*"?(.+?)"?\s*(?:=\s*"?(.*?)"?)?\s*$/.exec(arg);
        if (!am) return [];
        const nameRe = textPattern(am[1]);
        const valRe = am[2] !== undefined ? textPattern(am[2]) : null;
        if (!nameRe) return [];
        return set.filter((el) => el !== document && [...el.attributes].some((a) => {
          const nameOk = am[1].startsWith('/') ? nameRe.test(a.name) : a.name === am[1];
          if (!nameOk) return false;
          if (!valRe) return true;
          return am[2].startsWith('/') ? valRe.test(a.value) : a.value === am[2];
        }));
      }
      case 'matches-path': {
        const re = textPattern(arg);
        return re && re.test(location.pathname + location.search) ? set : [];
      }
      case 'xpath': {
        const out = new Set();
        for (const ctx of set) {
          try {
            const r = document.evaluate(arg, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let k = 0; k < r.snapshotLength; k += 1) {
              const n = r.snapshotItem(k);
              if (n && n.nodeType === 1) out.add(n);
            }
          } catch (e) { return []; }
        }
        return [...out];
      }
      case 'watch-attr':
        for (const a of arg.split(',')) if (a.trim()) watchedAttrs.add(a.trim());
        return set;
      default:
        return [];
    }
  }

  function runProcedurals() {
    for (const f of rules.procs) {
      let targets;
      try {
        targets = runParts([document], f.parts);
      } catch (e) {
        continue;
      }
      if (!targets.length) continue;
      const last = f.parts[f.parts.length - 1];
      const action = last.op && ACTION_OPS.has(last.op) ? last : null;
      for (const el of targets) {
        if (uiHost && (el === uiHost || el.contains(uiHost))) continue;
        if (!action) {
          if (!procHidden.has(el)) {
            procHidden.set(el, el.style.getPropertyValue('display'));
            stats.hidden += 1;
          }
          el.style.setProperty('display', 'none', 'important');
        } else if (action.op === 'remove') {
          el.remove();
          stats.hidden += 1;
        } else if (action.op === 'style') {
          if (!el.hasAttribute('data-iblock-s')) {
            procStyleId += 1;
            el.setAttribute('data-iblock-s', String(procStyleId));
            for (const decl of action.arg.split(';')) {
              const di = decl.indexOf(':');
              if (di === -1) continue;
              const prop = decl.slice(0, di).trim();
              const val = decl.slice(di + 1).replace(/!important/i, '').trim();
              if (prop) el.style.setProperty(prop, val, 'important');
            }
          }
        } else if (action.op === 'remove-attr') {
          const re = textPattern(action.arg);
          for (const a of [...el.attributes]) {
            const match = action.arg.startsWith('/') ? re && re.test(a.name) : a.name === action.arg;
            if (match) el.removeAttribute(a.name);
          }
        } else if (action.op === 'remove-class') {
          for (const c of action.arg.split('|')) el.classList.remove(c.trim());
        }
      }
    }
  }

  function restoreProcedurals() {
    for (const [el, prev] of procHidden) {
      if (prev) el.style.setProperty('display', prev);
      else el.style.removeProperty('display');
    }
    procHidden.clear();
  }

  function buildCss() {
    const out = [];
    for (const sel of rules.hide) out.push(`${sel}{display:none!important}`);
    for (const s of rules.styles) {
      if (/[{}]/.test(s.css) || !validSelector(s.selector)) continue;
      out.push(`${s.selector}{${s.css}}`);
    }
    return out;
  }

  // Compte les éléments masqués par le CSS (approximatif, par lots).
  let cssHiddenCount = 0;
  function countCssHidden() {
    if (!rules.hide.length) { cssHiddenCount = 0; return; }
    const found = new Set();
    for (let i = 0; i < rules.hide.length; i += 200) {
      const chunk = rules.hide.slice(i, i + 200).join(',');
      try { for (const el of document.querySelectorAll(chunk)) found.add(el); } catch (e) { /* ignore */ }
    }
    cssHiddenCount = found.size;
  }

  // ===========================================================================
  // Bannières cookies
  // ===========================================================================
  const clickedRejects = new WeakSet();
  const seenContainers = new WeakSet();

  function isButtonLike(el) {
    return el.matches('button, a, [role="button"], input[type="button"], input[type="submit"]');
  }

  function buttonText(el) {
    return (el.tagName === 'INPUT' ? el.value : (el.innerText || el.textContent || '')).trim();
  }

  function findRejectIn(root) {
    const candidates = root.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
    for (const b of candidates) {
      const t = buttonText(b) || b.getAttribute('aria-label') || '';
      if (t.length <= 45 && REJECT_TEXT.test(t)) return b;
    }
    return null;
  }

  function clickReject(btn, label) {
    if (clickedRejects.has(btn)) return false;
    clickedRejects.add(btn);
    try {
      btn.click();
      report('cookie', { text: `Cookies refusés automatiquement (${label})` });
      scheduleUnlock();
      return true;
    } catch (e) {
      return false;
    }
  }

  function handleCookies() {
    let acted = false;
    for (const sel of COOKIE_REJECT) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) {
        if (isButtonLike(el) || el.tagName === 'DIV' || el.tagName === 'SPAN') {
          if (clickReject(el, sel)) acted = true;
        }
      }
    }
    // Pages de consentement Google / YouTube.
    if (/^consent\.(google|youtube)\./.test(HOST)) {
      const b = findRejectIn(document);
      if (b && clickReject(b, 'Google')) acted = true;
    }
    // Usercentrics (Shadow DOM).
    const uc = document.querySelector('#usercentrics-root');
    if (uc && uc.shadowRoot) {
      const b = uc.shadowRoot.querySelector('[data-testid="uc-deny-all-button"]') || findRejectIn(uc.shadowRoot);
      if (b && clickReject(b, 'Usercentrics')) acted = true;
    }
    for (const sel of COOKIE_CONTAINERS) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const c of els) {
        const b = findRejectIn(c);
        if (b && clickReject(b, sel)) {
          acted = true;
          seenContainers.add(c);
          continue;
        }
        if (!seenContainers.has(c)) {
          seenContainers.add(c);
          if (!acted) report('cookie', { text: `Bannière cookies masquée (${sel})` });
          scheduleUnlock();
        }
      }
    }
    return acted;
  }

  // ===========================================================================
  // Défilement bloqué
  // ===========================================================================
  let unlockTimers = [];
  function scheduleUnlock() {
    if (unlockTimers.length) return;
    unlockTimers = [400, 1500, 4000].map((ms) => setTimeout(() => {
      unlockScroll(false);
      if (ms === 4000) unlockTimers = [];
    }, ms));
  }

  function unlockScroll(manual) {
    let changed = false;
    // Sites de type « application » (défilement dans un conteneur interne) :
    // on ne touche à rien automatiquement.
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 50;
    if (!manual && !scrollable) return false;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowY === 'hidden' || cs.overflow === 'hidden' || cs.overflowY === 'clip') {
        el.style.setProperty('overflow', 'auto', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
        changed = true;
      }
      if (el === document.body && cs.position === 'fixed') {
        const top = parseInt(cs.top, 10) || 0;
        el.style.setProperty('position', 'static', 'important');
        if (top < 0) window.scrollTo(0, -top);
        changed = true;
      }
      if (manual) {
        el.style.setProperty('touch-action', 'auto', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
      }
    }
    if (changed) log('info', 'Défilement de la page débloqué');
    return changed;
  }

  // ===========================================================================
  // Calques pièges (liens invisibles qui recouvrent la page)
  // ===========================================================================
  function crossSite(href) {
    try {
      const u = new URL(href, location.href);
      if (!/^https?:$/.test(u.protocol)) return false;
      const a = u.hostname.split('.').slice(-2).join('.');
      const b = location.hostname.split('.').slice(-2).join('.');
      return a !== b;
    } catch (e) {
      return false;
    }
  }

  function isTrap(el) {
    if (!(el instanceof HTMLAnchorElement)) return false;
    const href = el.getAttribute('href');
    if (!href || href.startsWith('#') || !crossSite(href)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    const r = el.getBoundingClientRect();
    const vp = window.innerWidth * window.innerHeight;
    // Couvre une bonne partie de l'écran, ou au moins un lecteur vidéo.
    if (r.width * r.height < Math.min(vp * 0.35, 60000)) return false;
    const transparentBg = cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
    const noContent = !el.textContent.trim() && !el.querySelector('img, video, canvas, picture, svg, iframe');
    return parseFloat(cs.opacity) < 0.2 || (transparentBg && noContent && cs.backgroundImage === 'none');
  }

  let swallowClickUntil = 0;
  function onPointerDown(ev) {
    if (!ev.isTrusted || siteOff || !settings.features.overlays) return;
    if (uiHost && ev.composedPath().includes(uiHost)) return;
    let n = ev.target instanceof Element ? ev.target : null;
    for (let depth = 0; n && depth < 6; depth += 1, n = n.parentElement) {
      if (isTrap(n)) {
        n.style.setProperty('display', 'none', 'important');
        n.style.setProperty('pointer-events', 'none', 'important');
        swallowClickUntil = Date.now() + 1000;
        report('trap', { url: n.href });
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
    }
  }
  function onClickSwallow(ev) {
    if (Date.now() < swallowClickUntil) {
      swallowClickUntil = 0;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('click', onClickSwallow, true);

  // ===========================================================================
  // Boucle principale
  // ===========================================================================
  let settings = normalizeSettings(null);
  let siteOff = false;
  let rules = compileRules([], HOST);
  let observer = null;
  let tickTimer = null;
  let lastTick = 0;
  let countTimer = null;

  // Démarrage rapide avec le miroir local (avant le chargement des réglages GM).
  const mirror = readMirror();
  if (mirror) {
    siteOff = !!mirror.off;
    if (mirror.features) Object.assign(settings.features, mirror.features);
  }

  function currentLists() {
    const lists = [];
    if (settings.features.cosmetic) lists.push(LIST_ADS);
    if (settings.features.annoyances) lists.push(LIST_ANNOYANCES);
    if (settings.features.cookies) lists.push(LIST_COOKIES);
    lists.push(settings.userFilters);
    return lists;
  }

  function applyAll() {
    if (siteOff) {
      stop();
      return;
    }
    rules = compileRules(currentLists(), HOST);
    watchedAttrs = new Set();
    sheet.set(buildCss());
    restoreProcedurals();
    stopObserver();
    tick();
    start();
  }

  function tick() {
    tickTimer = null;
    lastTick = Date.now();
    if (siteOff) return;
    sheet.ensure();
    try { runProcedurals(); } catch (e) { /* ignore */ }
    if (settings.features.cookies && document.body) {
      try { handleCookies(); } catch (e) { /* ignore */ }
    }
    if (IS_TOP && !countTimer) {
      countTimer = setTimeout(() => {
        countTimer = null;
        countCssHidden();
        ui.refresh();
      }, 1200);
    }
  }

  function scheduleTick() {
    if (tickTimer) return;
    const wait = Math.max(50, 250 - (Date.now() - lastTick));
    tickTimer = setTimeout(tick, wait);
  }

  function start() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' || m.addedNodes.length) { scheduleTick(); return; }
        if (sheet.el && !sheet.el.isConnected) { scheduleTick(); return; }
      }
    });
    const opts = { childList: true, subtree: true };
    // Attributs observés seulement si un filtre :watch-attr() le demande.
    if (watchedAttrs.size) Object.assign(opts, { attributes: true, attributeFilter: [...watchedAttrs] });
    observer.observe(document, opts);
  }

  function stopObserver() {
    if (observer) observer.disconnect();
    observer = null;
  }

  function stop() {
    stopObserver();
    sheet.remove();
    restoreProcedurals();
  }

  // ===========================================================================
  // Interface (onglet principal uniquement)
  // ===========================================================================
  let uiHost = null;

  const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.root {
  --bg: #ffffff; --bg2: #f2f2f7; --fg: #1c1c1e; --fg2: #6e6e73; --line: rgba(60,60,67,.18);
  --accent: #0a84ff; --ok: #30a46c; --off: #e5484d; --shadow: 0 10px 40px rgba(0,0,0,.22);
  font: 15px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  color: var(--fg); -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root { --bg: #1c1c1e; --bg2: #2c2c2e; --fg: #f5f5f7; --fg2: #98989f; --line: rgba(255,255,255,.14);
    --accent: #0a84ff; --shadow: 0 10px 40px rgba(0,0,0,.6); }
}
button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; margin: 0; }
.fab {
  position: fixed; z-index: 2147483647; width: 46px; height: 46px; border-radius: 23px;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.25);
  opacity: .9; touch-action: none; user-select: none; -webkit-user-select: none;
  transition: transform .15s ease, opacity .2s ease;
}
.fab:active { transform: scale(.92); }
.fab.off { background: #8e8e93; }
.fab.mini { width: 30px; height: 30px; border-radius: 15px; opacity: .45; }
.fab.mini svg { width: 16px; height: 16px; }
.fab svg { width: 24px; height: 24px; }
.badge {
  position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 10px; background: var(--off); color: #fff; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; border: 2px solid var(--bg);
}
.fab.mini .badge { display: none; }
.panel {
  position: fixed; z-index: 2147483647; width: 360px; max-width: calc(100vw - 24px);
  max-height: min(78vh, 640px); overflow: auto; -webkit-overflow-scrolling: touch;
  background: var(--bg); border-radius: 18px; box-shadow: var(--shadow); border: 1px solid var(--line);
  padding: 14px 14px 12px; overscroll-behavior: contain;
}
.head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.logo { width: 34px; height: 34px; border-radius: 10px; background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center; flex: none; }
.logo svg { width: 20px; height: 20px; }
.title { flex: 1; min-width: 0; }
.title b { display: block; font-size: 17px; }
.title span { display: block; color: var(--fg2); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iconbtn { width: 36px; height: 36px; border-radius: 18px; background: var(--bg2); display: flex;
  align-items: center; justify-content: center; flex: none; }
.iconbtn svg { width: 18px; height: 18px; }
.card { background: var(--bg2); border-radius: 14px; padding: 12px; margin-bottom: 10px; }
.row { display: flex; align-items: center; gap: 12px; min-height: 44px; }
.row .label { flex: 1; min-width: 0; }
.row .label small { display: block; color: var(--fg2); font-size: 12px; margin-top: 2px; }
.switch { position: relative; width: 51px; height: 31px; border-radius: 16px; background: #c7c7cc; flex: none;
  transition: background .2s; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%;
  background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.25); transition: transform .2s; }
.switch.on { background: var(--ok); }
.switch.on::after { transform: translateX(20px); }
.big { font-size: 16px; font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
.stat { background: var(--bg2); border-radius: 14px; padding: 10px 6px; text-align: center; }
.stat b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.stat span { display: block; font-size: 11px; color: var(--fg2); margin-top: 2px; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.action { background: var(--bg2); border-radius: 14px; min-height: 52px; padding: 8px 10px; display: flex;
  align-items: center; gap: 8px; text-align: left; font-size: 14px; font-weight: 500; }
.action svg { width: 20px; height: 20px; color: var(--accent); flex: none; }
.notice { background: rgba(10,132,255,.12); color: var(--fg); border-radius: 12px; padding: 10px 12px;
  margin-bottom: 10px; font-size: 14px; display: flex; align-items: center; gap: 10px; }
.notice button { margin-left: auto; background: var(--accent); color: #fff; border-radius: 10px; padding: 8px 12px; font-weight: 600; }
.foot { color: var(--fg2); font-size: 12px; text-align: center; padding-top: 4px; }
.sub { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sub b { font-size: 17px; flex: 1; }
.log { list-style: none; margin: 0; padding: 0; }
.log li { padding: 8px 2px; border-bottom: 1px solid var(--line); font-size: 13px; word-break: break-all; }
.log li time { color: var(--fg2); font-size: 11px; display: block; }
.log .k-popup, .log .k-trap { color: var(--off); }
.log .k-cookie { color: var(--ok); }
.empty { color: var(--fg2); text-align: center; padding: 18px 0; font-size: 14px; }
textarea { width: 100%; min-height: 220px; font: 13px/1.4 ui-monospace, Menlo, monospace; color: var(--fg);
  background: var(--bg2); border: 1px solid var(--line); border-radius: 12px; padding: 10px; resize: vertical; }
.btn { background: var(--accent); color: #fff; border-radius: 12px; min-height: 44px; padding: 0 16px; font-weight: 600; }
.btn.secondary { background: var(--bg2); color: var(--fg); }
.btn.danger { background: var(--bg2); color: var(--off); }
.btns { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
.help { color: var(--fg2); font-size: 12px; line-height: 1.5; }
.help code { font: 12px ui-monospace, Menlo, monospace; background: var(--bg2); padding: 1px 4px; border-radius: 4px; }
.toasts { position: fixed; z-index: 2147483647; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 8px; align-items: center; width: max-content; max-width: calc(100vw - 24px); }
.toast { background: rgba(28,28,30,.94); color: #fff; border-radius: 14px; padding: 10px 12px 10px 14px;
  display: flex; align-items: center; gap: 12px; font-size: 14px; box-shadow: 0 6px 24px rgba(0,0,0,.3);
  max-width: 100%; animation: tin .2s ease; }
.toast .t { min-width: 0; }
.toast .t small { display: block; color: #aeaeb2; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60vw; }
.toast button { color: #64d2ff; font-weight: 600; padding: 6px 4px; min-height: 36px; white-space: nowrap; }
@keyframes tin { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.zapbox { position: fixed; z-index: 2147483646; pointer-events: none; border: 2px solid var(--off);
  background: rgba(229,72,77,.18); border-radius: 4px; transition: all .08s ease; }
.zapbar { position: fixed; z-index: 2147483647; left: 12px; right: 12px; bottom: 16px; background: var(--bg);
  border-radius: 16px; box-shadow: var(--shadow); border: 1px solid var(--line); padding: 10px; }
.zapbar .sel { font: 12px ui-monospace, Menlo, monospace; color: var(--fg2); margin: 0 4px 8px; word-break: break-all; }
.zapbar .btns { margin: 0; }
.zapbar .btn { flex: 1; min-width: 120px; }
`;

  const ICONS = {
    shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 14-4-4 1.4-1.4L11 13.2l5.6-5.6L18 9l-7 7Z',
    close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z',
    back: 'M15.4 5 8.4 12l7 7 1.4-1.4-5.6-5.6 5.6-5.6L15.4 5Z',
    zap: 'M11 2h2v3.07A7 7 0 0 1 18.93 11H22v2h-3.07A7 7 0 0 1 13 18.93V22h-2v-3.07A7 7 0 0 1 5.07 13H2v-2h3.07A7 7 0 0 1 11 5.07V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
    scroll: 'M12 3 7 8h4v8H7l5 5 5-5h-4V8h4l-5-5Z',
    list: 'M4 6h2v2H4V6Zm4 0h12v2H8V6Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Zm-4 5h2v2H4v-2Zm4 0h12v2H8v-2Z',
    filter: 'M3 5h18l-7 8v5l-4 2v-7L3 5Z',
    gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.3-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5-2.1-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  };

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  // Petit utilitaire de création d'éléments (sans innerHTML : compatible Trusted Types).
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function mountCss(shadow) {
    const style = document.createElement('style');
    style.textContent = UI_CSS;
    shadow.appendChild(style);
    if (style.sheet && style.sheet.cssRules.length) return;
    // CSP stricte : feuille construite, sinon insertion règle par règle.
    style.remove();
    try {
      const cs = new CSSStyleSheet();
      cs.replaceSync(UI_CSS);
      shadow.adoptedStyleSheets = [cs];
      return;
    } catch (e) { /* ignore */ }
    shadow.appendChild(style);
    style.textContent = '';
    if (!style.sheet) return;
    for (const rule of splitCssRules(UI_CSS)) {
      try { style.sheet.insertRule(rule, style.sheet.cssRules.length); } catch (e) { /* ignore */ }
    }
  }

  function splitCssRules(css) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const c of css) {
      cur += c;
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) { out.push(cur.trim()); cur = ''; }
      }
    }
    return out.filter(Boolean);
  }

  const ui = {
    shadow: null,
    root: null,
    fab: null,
    badge: null,
    panel: null,
    toasts: null,
    view: 'main',
    needsReload: false,
    lastPopupToast: null,

    mount() {
      if (!IS_TOP || uiHost) return;
      uiHost = document.createElement('iblock-ui');
      uiHost.style.setProperty('all', 'initial', 'important');
      uiHost.style.setProperty('position', 'fixed', 'important');
      uiHost.style.setProperty('top', '0', 'important');
      uiHost.style.setProperty('left', '0', 'important');
      uiHost.style.setProperty('width', '0', 'important');
      uiHost.style.setProperty('height', '0', 'important');
      uiHost.style.setProperty('z-index', '2147483647', 'important');
      uiHost.style.setProperty('display', 'block', 'important');
      this.shadow = uiHost.attachShadow({ mode: 'closed' });
      mountCss(this.shadow);
      this.root = h('div', { class: 'root' });
      this.shadow.appendChild(this.root);
      this.toasts = h('div', { class: 'toasts' });
      this.root.appendChild(this.toasts);
      this.buildFab();
      document.documentElement.appendChild(uiHost);
      // Le site ne doit pas pouvoir retirer l'interface.
      new MutationObserver(() => {
        if (!uiHost.isConnected) document.documentElement.appendChild(uiHost);
      }).observe(document.documentElement, { childList: true });
      window.addEventListener('resize', () => this.placeFab());
    },

    buildFab() {
      this.fab = h('button', { class: 'fab', 'aria-label': 'iBlock' }, icon('shield'));
      this.badge = h('span', { class: 'badge', text: '0' });
      this.badge.style.display = 'none';
      this.fab.appendChild(this.badge);
      this.root.appendChild(this.fab);
      this.placeFab();
      let startX = 0;
      let startY = 0;
      let origTop = 0;
      let dragging = false;
      let pressed = false;
      this.fab.addEventListener('pointerdown', (ev) => {
        pressed = true;
        dragging = false;
        startX = ev.clientX;
        startY = ev.clientY;
        origTop = this.fab.getBoundingClientRect().top;
        try { this.fab.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        ev.preventDefault();
      });
      this.fab.addEventListener('pointermove', (ev) => {
        if (!pressed) return;
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) dragging = true;
        if (dragging) {
          const size = this.fab.offsetHeight;
          const top = Math.min(window.innerHeight - size - 8, Math.max(8, origTop + ev.clientY - startY));
          this.fab.style.top = `${top}px`;
          this.fab.style.left = `${Math.min(window.innerWidth - size - 4, Math.max(4, ev.clientX - size / 2))}px`;
          this.fab.style.right = 'auto';
        }
      });
      const end = (ev) => {
        if (!pressed) return;
        pressed = false;
        if (dragging) {
          settings.ui.side = ev.clientX < window.innerWidth / 2 ? 'left' : 'right';
          settings.ui.top = Math.round((this.fab.getBoundingClientRect().top / window.innerHeight) * 1000) / 1000;
          this.placeFab();
          saveSettings();
        } else if (ev.type === 'pointerup') {
          this.togglePanel();
        }
      };
      this.fab.addEventListener('pointerup', end);
      this.fab.addEventListener('pointercancel', end);
      this.fab.addEventListener('click', (ev) => ev.preventDefault());
    },

    placeFab() {
      if (!this.fab) return;
      const size = settings.ui.mini ? 30 : 46;
      this.fab.classList.toggle('mini', !!settings.ui.mini);
      this.fab.classList.toggle('off', siteOff);
      const topRatio = typeof settings.ui.top === 'number' ? settings.ui.top : null;
      const top = topRatio === null
        ? window.innerHeight - size - 90
        : Math.min(window.innerHeight - size - 8, Math.max(8, topRatio * window.innerHeight));
      this.fab.style.top = `${top}px`;
      this.fab.style.left = settings.ui.side === 'left' ? '10px' : 'auto';
      this.fab.style.right = settings.ui.side === 'left' ? 'auto' : '10px';
    },

    togglePanel(force) {
      const open = force !== undefined ? force : !this.panel;
      if (!open) {
        if (this.panel) this.panel.remove();
        this.panel = null;
        this.view = 'main';
        this.fab.style.visibility = '';
        return;
      }
      this.fab.style.visibility = 'hidden';
      if (!this.panel) {
        this.panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'iBlock' });
        this.root.appendChild(this.panel);
        this.panel.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      }
      this.positionPanel();
      this.render();
    },

    positionPanel() {
      if (!this.panel) return;
      const narrow = window.innerWidth < 520;
      const p = this.panel.style;
      if (narrow) {
        p.left = '12px';
        p.right = '12px';
        p.width = 'auto';
        p.bottom = '12px';
        p.top = 'auto';
      } else {
        // Le panneau s'ouvre à l'emplacement du bouton flottant.
        const r = this.fab.getBoundingClientRect();
        p.width = '360px';
        if (r.top > window.innerHeight / 2) {
          p.top = 'auto';
          p.bottom = `${Math.max(12, window.innerHeight - r.bottom)}px`;
        } else {
          p.bottom = 'auto';
          p.top = `${Math.max(12, r.top)}px`;
        }
        if (settings.ui.side === 'left') { p.left = '12px'; p.right = 'auto'; } else { p.right = '12px'; p.left = 'auto'; }
      }
    },

    refresh() {
      if (!this.fab) return;
      const total = cssHiddenCount + stats.hidden + stats.popups + stats.cookies;
      this.badge.textContent = total > 99 ? '99+' : String(total);
      this.badge.style.display = total > 0 && !siteOff ? 'flex' : 'none';
      this.fab.classList.toggle('off', siteOff);
      if (this.panel && (this.view === 'main' || this.view === 'log')) this.render();
    },

    render() {
      if (!this.panel) return;
      const scroll = this.panel.scrollTop;
      this.panel.textContent = '';
      const views = { main: this.viewMain, log: this.viewLog, filters: this.viewFilters, settings: this.viewSettings };
      this.panel.appendChild((views[this.view] || this.viewMain).call(this));
      this.panel.scrollTop = scroll;
    },

    go(view) {
      this.view = view;
      this.panel.scrollTop = 0;
      this.render();
    },

    header(title, back) {
      if (back) {
        return h('div', { class: 'sub' },
          h('button', { class: 'iconbtn', 'aria-label': 'Retour', onclick: () => this.go('main') }, icon('back')),
          h('b', { text: title }),
          h('button', { class: 'iconbtn', 'aria-label': 'Fermer', onclick: () => this.togglePanel(false) }, icon('close')));
      }
      return h('div', { class: 'head' },
        h('div', { class: 'logo' }, icon('shield')),
        h('div', { class: 'title' }, h('b', { text: 'iBlock' }), h('span', { text: SITE })),
        h('button', { class: 'iconbtn', 'aria-label': 'Réglages', onclick: () => this.go('settings') }, icon('gear')),
        h('button', { class: 'iconbtn', 'aria-label': 'Fermer', onclick: () => this.togglePanel(false) }, icon('close')));
    },

    viewMain() {
      const frag = h('div');
      frag.appendChild(this.header());
      const on = !siteOff;
      frag.appendChild(h('div', { class: 'card' },
        h('div', { class: 'row', role: 'switch', 'aria-checked': String(on), onclick: () => toggleSite() },
          h('div', { class: 'label big' },
            on ? 'Protection activée' : 'Protection désactivée',
            h('small', { text: on ? 'Touchez pour désactiver sur ce site' : 'Touchez pour réactiver sur ce site' })),
          h('div', { class: `switch${on ? ' on' : ''}` }))));
      if (this.needsReload) {
        frag.appendChild(h('div', { class: 'notice' },
          h('span', { text: 'Rechargez la page pour appliquer.' }),
          h('button', { text: 'Recharger', onclick: () => location.reload() })));
      }
      frag.appendChild(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: String(cssHiddenCount + stats.hidden) }), h('span', { text: 'Éléments masqués' })),
        h('div', { class: 'stat' }, h('b', { text: String(stats.popups) }), h('span', { text: 'Pop-ups bloquées' })),
        h('div', { class: 'stat' }, h('b', { text: String(stats.cookies) }), h('span', { text: 'Cookies' }))));
      frag.appendChild(h('div', { class: 'actions' },
        h('button', { class: 'action', onclick: () => { this.togglePanel(false); zapper.start(); } }, icon('zap'), 'Zapper un élément'),
        h('button', { class: 'action', onclick: () => {
          const changed = unlockScroll(true);
          this.toast(changed ? 'Défilement débloqué' : 'Le défilement n’était pas bloqué', null);
        } }, icon('scroll'), 'Débloquer le défilement'),
        h('button', { class: 'action', onclick: () => this.go('log') }, icon('list'), 'Journal'),
        h('button', { class: 'action', onclick: () => this.go('filters') }, icon('filter'), 'Mes filtres')));
      const inactive = [...frameStatus].filter(([, active]) => !active).map(([host]) => host);
      if (inactive.length && settings.features.popups && !siteOff) {
        frag.appendChild(h('div', { class: 'help', text: `Anti pop-ups limité ici : ${inactive.join(', ')}. Installez aussi le script « iBlock (page) » dans l’app Userscripts.` }));
      }
      frag.appendChild(h('div', { class: 'foot', text: `iBlock ${VERSION}` }));
      return frag;
    },

    viewLog() {
      const frag = h('div');
      frag.appendChild(this.header('Journal', true));
      if (!logs.length) {
        frag.appendChild(h('div', { class: 'empty', text: 'Rien à signaler pour l’instant sur cette page.' }));
      } else {
        const ul = h('ul', { class: 'log' });
        for (const e of logs.slice().reverse()) {
          ul.appendChild(h('li', { class: `k-${e.kind}` },
            h('time', { text: e.time.toLocaleTimeString() }), e.text));
        }
        frag.appendChild(ul);
      }
      frag.appendChild(h('div', { class: 'help', text: `Masquage CSS : ${cssHiddenCount} élément(s) touchés par ${rules.hide.length} règle(s) actives sur ce site.` }));
      if (frameStatus.size) {
        const parts = [...frameStatus].map(([host, active]) => `${host} ${active ? '✓' : '✗'}`);
        frag.appendChild(h('div', { class: 'help', text: `Anti pop-ups par cadre : ${parts.join(' · ')}` }));
      }
      return frag;
    },

    viewFilters() {
      const frag = h('div');
      frag.appendChild(this.header('Mes filtres', true));
      const ta = h('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off',
        placeholder: '! Un filtre par ligne\nexemple.com##.banniere-pub\n##.popup-newsletter' });
      ta.value = settings.userFilters;
      frag.appendChild(ta);
      const info = h('div', { class: 'help' });
      const describe = (text) => {
        const r = compileRules([text], HOST).counts;
        const parts = [`${r.cosmetic} règle(s) cosmétique(s)`, `${r.scriptlet} scriptlet(s)`];
        if (r.network) parts.push(`${r.network} règle(s) réseau ignorée(s) (gérées par le DNS)`);
        if (r.invalid) parts.push(`${r.invalid} invalide(s)`);
        if (r.unsupported) parts.push(`${r.unsupported} non prise(s) en charge`);
        info.textContent = parts.join(' · ');
      };
      describe(ta.value);
      frag.appendChild(h('div', { class: 'btns' },
        h('button', { class: 'btn', text: 'Enregistrer', onclick: async () => {
          const hadScriptlets = rules.scriptlets.length;
          settings.userFilters = ta.value;
          await saveSettings();
          applyAll();
          writeMirror();
          describe(ta.value);
          if (rules.scriptlets.length || hadScriptlets) this.needsReload = true;
          this.toast('Filtres enregistrés', null);
        } }),
        h('button', { class: 'btn secondary', text: 'Annuler', onclick: () => this.go('main') })));
      frag.appendChild(info);
      frag.appendChild(h('div', { class: 'help' },
        h('p', null, 'Syntaxe uBlock Origin : ',
          h('code', { text: '##.pub' }), ' masque partout, ',
          h('code', { text: 'site.fr##.pub' }), ' sur un site, ',
          h('code', { text: 'site.fr#@#.pub' }), ' exception, ',
          h('code', { text: 'site.fr##div:has-text(Sponsorisé)' }), ' procédural, ',
          h('code', { text: 'site.fr##+js(set-constant, a.b, false)' }), ' scriptlet (rechargement requis).'),
        h('p', { text: 'Les règles réseau (||domaine^) sont ignorées : le blocage réseau est assuré par le DNS.' })));
      return frag;
    },

    viewSettings() {
      const frag = h('div');
      frag.appendChild(this.header('Réglages', true));
      const card = h('div', { class: 'card' });
      for (const [key, label, desc] of FEATURES) {
        const on = !!settings.features[key];
        card.appendChild(h('div', { class: 'row', role: 'switch', 'aria-checked': String(on), onclick: async () => {
          settings.features[key] = !settings.features[key];
          await saveSettings();
          applyAll();
          writeMirror();
          if (key === 'popups' || key === 'scriptlets') this.needsReload = true;
          this.render();
        } },
        h('div', { class: 'label' }, label, h('small', { text: desc })),
        h('div', { class: `switch${on ? ' on' : ''}` })));
      }
      frag.appendChild(card);
      const mini = !!settings.ui.mini;
      frag.appendChild(h('div', { class: 'card' },
        h('div', { class: 'row', role: 'switch', 'aria-checked': String(mini), onclick: async () => {
          settings.ui.mini = !settings.ui.mini;
          await saveSettings();
          this.placeFab();
          this.render();
        } },
        h('div', { class: 'label' }, 'Bouton discret', h('small', { text: 'Plus petit et transparent. Déplaçable en le faisant glisser.' })),
        h('div', { class: `switch${mini ? ' on' : ''}` }))));
      const disabledSites = Object.keys(settings.disabled).filter((k) => settings.disabled[k]);
      if (disabledSites.length) {
        const list = h('div', { class: 'card' }, h('div', { class: 'label', text: 'Sites désactivés' }));
        for (const site of disabledSites.sort()) {
          list.appendChild(h('div', { class: 'row' },
            h('div', { class: 'label', text: site }),
            h('button', { class: 'btn secondary', text: 'Réactiver', onclick: async () => {
              delete settings.disabled[site];
              await saveSettings();
              if (site === SITE) { siteOff = false; applyAll(); writeMirror(); this.needsReload = true; }
              this.render();
            } })));
        }
        frag.appendChild(list);
      }
      frag.appendChild(h('div', { class: 'btns' },
        h('button', { class: 'btn secondary', text: 'Page du projet', onclick: () => openTab(REPO_URL) }),
        h('button', { class: 'btn danger', text: 'Réinitialiser', onclick: async () => {
          // eslint-disable-next-line no-alert
          if (!window.confirm('Réinitialiser tous les réglages et filtres d’iBlock ?')) return;
          settings = normalizeSettings(null);
          siteOff = false;
          await saveSettings();
          applyAll();
          writeMirror();
          this.needsReload = true;
          this.placeFab();
          this.go('main');
        } })));
      frag.appendChild(h('div', { class: 'foot', text: `iBlock ${VERSION}` }));
      return frag;
    },

    toast(text, sub, actionLabel, onAction, duration) {
      if (!this.toasts) return null;
      const t = h('div', { class: 'toast', role: 'status' },
        h('div', { class: 't' }, text, sub ? h('small', { text: sub }) : null));
      if (actionLabel) {
        t.appendChild(h('button', { text: actionLabel, onclick: () => { t.remove(); onAction(); } }));
      }
      this.toasts.appendChild(t);
      while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
      const timer = setTimeout(() => t.remove(), duration || 4000);
      t.addEventListener('pointerdown', () => clearTimeout(timer));
      return t;
    },

    popupToast(url) {
      const now = Date.now();
      let host = url;
      try { host = new URL(url).hostname || url; } catch (e) { /* ignore */ }
      const prev = this.lastPopupToast;
      if (prev && now - prev.time < 3000 && prev.el.isConnected) {
        prev.count += 1;
        prev.el.querySelector('.t').firstChild.textContent = `${prev.count} pop-ups bloquées`;
        prev.time = now;
        return;
      }
      const canOpen = /^https?:/i.test(url);
      const el = this.toast('Pop-up bloquée', host, canOpen ? 'Ouvrir' : null, () => openTab(url), 5000);
      this.lastPopupToast = el ? { el, time: now, count: 1 } : null;
    },
  };

  function openTab(url) {
    const w = window.open(url, '_blank');
    if (w) {
      try { w.opener = null; } catch (e) { /* ignore */ }
    } else if (hasGM && typeof GM.openInTab === 'function') {
      try { GM.openInTab(url, false); } catch (e) { /* ignore */ }
    }
  }

  async function toggleSite() {
    siteOff = !siteOff;
    if (siteOff) settings.disabled[SITE] = true;
    else delete settings.disabled[SITE];
    await saveSettings();
    applyAll();
    writeMirror();
    ui.needsReload = true;
    ui.refresh();
    ui.render();
  }

  // ===========================================================================
  // Zapper : supprimer un élément du doigt
  // ===========================================================================
  function goodClass(c) {
    return /^[a-zA-Z_][\w-]{1,40}$/.test(c) && !/\d{3,}/.test(c)
      && !/^(css|sc|jsx|emotion|svelte|styled)-/.test(c) && !/__[a-zA-Z0-9]{5,}$/.test(c)
      && !/[a-z][A-Z0-9][a-zA-Z0-9]{4,}$/.test(c);
  }
  function goodId(id) {
    return !!id && /^[a-zA-Z][\w-]{0,60}$/.test(id) && !/\d{4,}/.test(id);
  }

  function selectorFor(el) {
    if (goodId(el.id)) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement && n !== document.body && parts.length < 6) {
      if (n !== el && goodId(n.id)) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
      let part = n.localName;
      const cls = [...n.classList].filter(goodClass).slice(0, 2);
      part += cls.map((c) => `.${CSS.escape(c)}`).join('');
      const parent = n.parentElement;
      if (parent) {
        const same = [...parent.children].filter((s) => s.localName === n.localName);
        const sameCls = same.filter((s) => cls.every((c) => s.classList.contains(c)));
        if (sameCls.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) { /* ignore */ }
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  const zapper = {
    active: false,
    target: null,
    box: null,
    bar: null,
    selText: null,

    start() {
      if (this.active || !ui.root) return;
      this.active = true;
      this.target = null;
      this.box = h('div', { class: 'zapbox' });
      this.box.style.display = 'none';
      this.selText = h('div', { class: 'sel', text: 'Touchez l’élément à supprimer.' });
      this.bar = h('div', { class: 'zapbar' },
        this.selText,
        h('div', { class: 'btns' },
          h('button', { class: 'btn secondary', text: 'Plus large', onclick: () => this.widen() }),
          h('button', { class: 'btn', text: 'Supprimer', onclick: () => this.zap(false) }),
          h('button', { class: 'btn', text: 'Toujours masquer', onclick: () => this.zap(true) }),
          h('button', { class: 'btn secondary', text: 'Terminer', onclick: () => this.stop() })));
      ui.root.appendChild(this.box);
      ui.root.appendChild(this.bar);
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
        window.addEventListener(t, this.onEvent, { capture: true, passive: false });
      }
      window.addEventListener('scroll', this.onScroll, true);
    },

    stop() {
      this.active = false;
      for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
        window.removeEventListener(t, this.onEvent, { capture: true });
      }
      window.removeEventListener('scroll', this.onScroll, true);
      if (this.box) this.box.remove();
      if (this.bar) this.bar.remove();
      this.box = null;
      this.bar = null;
      this.target = null;
    },

    onEvent(ev) {
      if (!zapper.active) return;
      if (ev.composedPath().includes(uiHost)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.type !== 'pointerdown') return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (el && el !== document.documentElement && el !== document.body && el !== uiHost) zapper.select(el);
    },

    onScroll() {
      if (zapper.target) zapper.highlight();
    },

    select(el) {
      this.target = el;
      this.highlight();
    },

    widen() {
      if (!this.target) return;
      const p = this.target.parentElement;
      if (p && p !== document.body && p !== document.documentElement) this.select(p);
    },

    highlight() {
      if (!this.target || !this.box) return;
      const r = this.target.getBoundingClientRect();
      Object.assign(this.box.style, {
        display: 'block', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
      this.selText.textContent = selectorFor(this.target);
    },

    async zap(permanent) {
      if (!this.target) {
        ui.toast('Touchez d’abord un élément de la page.', null);
        return;
      }
      const sel = selectorFor(this.target);
      this.target.style.setProperty('display', 'none', 'important');
      stats.hidden += 1;
      if (permanent) {
        const line = `${normHost(HOST)}##${sel}`;
        settings.userFilters = `${settings.userFilters.replace(/\s*$/, '')}\n${line}`.replace(/^\n/, '');
        await saveSettings();
        applyAll();
        log('info', `Filtre ajouté : ${line}`);
        ui.toast('Élément masqué définitivement', line);
      } else {
        log('info', `Élément supprimé : ${sel}`);
      }
      this.target = null;
      this.box.style.display = 'none';
      this.selText.textContent = 'Touchez un autre élément, ou « Terminer ».';
      ui.refresh();
    },
  };
  zapper.onEvent = zapper.onEvent.bind(zapper);
  zapper.onScroll = zapper.onScroll.bind(zapper);

  // ===========================================================================
  // Démarrage
  // ===========================================================================
  sendToPage('hello', {});
  if (!siteOff) applyAll();

  settings = await loadSettings();
  siteOff = !!settings.disabled[SITE];
  applyAll();
  writeMirror();

  function onReady() {
    tick();
    if (IS_TOP) {
      ui.mount();
      ui.refresh();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
  window.addEventListener('load', () => scheduleTick(), { once: true });
})();
