/*
 * Ce script tourne dans le contexte JavaScript de la page (nécessaire pour
 * intercepter window.open et neutraliser les scripts publicitaires).
 * Il n'a pas accès au stockage GM : sa configuration est recopiée dans le
 * localStorage du site par le script principal « iBlock » (clé __iblock).
 * Il communique avec lui via des CustomEvent (texte JSON uniquement).
 */
(function iBlockPage() {
  'use strict';

  if (window.__iBlockPage) return;
  try {
    Object.defineProperty(window, '__iBlockPage', { value: true });
  } catch (e) { /* ignore */ }

  const CFG_KEY = '__iblock';
  const EVT_OUT = 'iblock:page';   // page -> content
  const EVT_IN = 'iblock:content'; // content -> page

  let cfg = {};
  try {
    cfg = JSON.parse(window.localStorage.getItem(CFG_KEY) || '{}') || {};
  } catch (e) { cfg = {}; }
  if (cfg.off) return;

  const features = Object.assign({ popups: true, scriptlets: true }, cfg.features || {});

  // ---------------------------------------------------------------------------
  // Communication avec le script principal
  // ---------------------------------------------------------------------------
  // Les deux scripts démarrent en même temps (document-start) et les
  // événements utiles (pop-ups) n'arrivent qu'après un geste de l'utilisateur :
  // un envoi direct suffit.
  const dispatch = EventTarget.prototype.dispatchEvent;
  const CE = window.CustomEvent;

  function send(type, data) {
    const msg = JSON.stringify({ type, data: data || {} });
    try { dispatch.call(document, new CE(EVT_OUT, { detail: msg })); } catch (e) { /* ignore */ }
  }

  document.addEventListener(EVT_IN, (ev) => {
    let msg;
    try { msg = JSON.parse(ev.detail); } catch (e) { return; }
    if (!msg) return;
    if (msg.type === 'hello') {
      // Le script principal a démarré après nous : on se signale à nouveau.
      send('page-ready', { scriptlets: ran });
    } else if (msg.type === 'allow-open' && msg.data && typeof msg.data.url === 'string') {
      allowOnce.add(msg.data.url);
    }
  });

  // ---------------------------------------------------------------------------
  // Outils
  // ---------------------------------------------------------------------------
  const nativeToString = Function.prototype.toString;
  const fakeNative = new WeakMap();
  try {
    // Les fonctions remplacées se présentent comme natives (anti-détection).
    const toStringProxy = new Proxy(nativeToString, {
      apply(target, thisArg, args) {
        if (fakeNative.has(thisArg)) return fakeNative.get(thisArg);
        return Reflect.apply(target, thisArg, args);
      },
    });
    Function.prototype.toString = toStringProxy;
    fakeNative.set(toStringProxy, 'function toString() { [native code] }');
  } catch (e) { /* ignore */ }

  function disguise(fn, name) {
    fakeNative.set(fn, `function ${name}() { [native code] }`);
    return fn;
  }

  function sameSite(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol === 'javascript:') return false;
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
      return baseDomain(u.hostname) === baseDomain(location.hostname);
    } catch (e) {
      return true;
    }
  }

  function baseDomain(host) {
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    // Approximation sans liste de suffixes : gère co.uk, com.au, etc.
    const sld = parts[parts.length - 2];
    const take = (sld.length <= 3 && parts[parts.length - 1].length === 2) ? 3 : 2;
    return parts.slice(-take).join('.');
  }

  function absUrl(url) {
    try { return new URL(url, location.href).href; } catch (e) { return String(url); }
  }

  // ---------------------------------------------------------------------------
  // Anti pop-ups
  // ---------------------------------------------------------------------------
  const allowOnce = new Set();

  // Sites légitimes souvent ouverts dans une fenêtre (connexion, partage, paiement).
  const POPUP_ALLOW = [
    'accounts.google.com', 'accounts.youtube.com', 'appleid.apple.com', 'idmsa.apple.com',
    'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'reddit.com',
    'tumblr.com', 'bsky.app', 'threads.net', 'vk.com', 'login.microsoftonline.com', 'login.live.com',
    'github.com', 'discord.com', 'twitch.tv', 'spotify.com', 'steamcommunity.com',
    'paypal.com', 'stripe.com', 'pay.google.com', 'whatsapp.com', 'wa.me', 't.me', 'telegram.me',
    'mail.google.com', 'outlook.live.com', 'auth0.com', 'okta.com',
  ];
  function allowedHost(host) {
    host = host.toLowerCase();
    return POPUP_ALLOW.some((d) => host === d || host.endsWith(`.${d}`));
  }

  // Dernier geste de l'utilisateur, capturé avant les scripts du site.
  const gesture = { time: 0, target: null, opens: 0 };
  const onGesture = (ev) => {
    if (!ev.isTrusted) return;
    gesture.time = Date.now();
    gesture.target = ev.target;
    gesture.opens = 0;
  };
  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown']) {
    window.addEventListener(t, onGesture, { capture: true, passive: true });
  }

  const INTERACTIVE = 'a[href],button,input[type="button"],input[type="submit"],input[type="image"],[role="button"],[role="link"],[role="menuitem"],select,label,summary';
  // Un « vrai » bouton : les lecteurs vidéo déguisent souvent des <div> en boutons.
  const REAL_BUTTON = 'button,input[type="button"],input[type="submit"],input[type="image"]';

  function gestureElement() {
    const t = gesture.target;
    return t && t.nodeType === 1 && typeof t.closest === 'function' ? t : null;
  }

  function popupVerdict(url) {
    const full = absUrl(url || 'about:blank');
    if (allowOnce.has(full)) {
      allowOnce.delete(full);
      return { allow: true };
    }
    if (Date.now() - gesture.time > 1500) {
      // Aucun geste récent : ouverture automatique → pop-up indésirable.
      return { allow: false, reason: 'ouverture automatique' };
    }
    gesture.opens += 1;
    if (gesture.opens > 1) return { allow: false, reason: 'ouvertures multiples' };

    const el = gestureElement();
    if (!url || full === 'about:blank') {
      // Fenêtre vide puis redirection : technique classique des popunders.
      return el && el.closest(REAL_BUTTON)
        ? { allow: true }
        : { allow: false, reason: 'fenêtre vide suspecte' };
    }
    let u;
    try { u = new URL(full); } catch (e) { return { allow: true }; }
    if (/^(data|blob|javascript):$/.test(u.protocol)) return { allow: false, reason: 'adresse suspecte' };
    if (!/^https?:$/.test(u.protocol)) return { allow: true };
    if (sameSite(full)) return { allow: true };

    const link = el && el.closest('a[href]');
    if (link) {
      // Clic sur un lien : seule sa propre destination peut s'ouvrir.
      const href = absUrl(link.getAttribute('href'));
      if (href === full) return { allow: true };
      try {
        if (new URL(href).hostname === u.hostname) return { allow: true };
      } catch (e) { /* ignore */ }
      return { allow: false, reason: 'lien détourné' };
    }
    if (allowedHost(u.hostname)) return { allow: true };
    // Mode strict : un site externe ne s'ouvre pas depuis un bouton quelconque
    // (le bouton ▶ d'un lecteur vidéo par exemple).
    return { allow: false, reason: el && el.closest(INTERACTIVE) ? 'site externe' : 'clic détourné' };
  }

  // window.open(url, "nom") vers une iframe existante n'est pas un pop-up.
  function targetsFrame(win, name) {
    if (!name || /^_(self|top|parent)$/i.test(name)) return true;
    if (/^_blank$/i.test(name)) return false;
    try {
      for (let i = 0; i < win.frames.length; i += 1) {
        try { if (win.frames[i].name === name) return true; } catch (e) { /* cross-origin */ }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function isAnchor(a) {
    return !!a && a.nodeType === 1 && a.tagName === 'A';
  }

  function suspiciousAnchor(a) {
    if (!isAnchor(a)) return false;
    const t = (a.getAttribute('target') || '').toLowerCase();
    if (!t || t === '_self' || t === '_top' || t === '_parent') return false;
    const href = a.getAttribute('href');
    if (!href || sameSite(href)) return false;
    return true;
  }

  function anchorBlocked(a) {
    if (!suspiciousAnchor(a)) return false;
    // Un lien réellement touché par l'utilisateur est toujours autorisé.
    const touched = gesture.target && a.contains(gesture.target) && Date.now() - gesture.time < 1500;
    if (touched) return false;
    const verdict = popupVerdict(a.href);
    if (verdict.allow) return false;
    send('popup-blocked', { url: a.href, reason: 'lien invisible cliqué par script' });
    return true;
  }

  function formBlocked(f) {
    const t = f.getAttribute('target') || '';
    if (targetsFrame(f.ownerDocument.defaultView || window, t)) return false;
    const action = absUrl(f.getAttribute('action') || location.href);
    if (sameSite(action)) return false;
    const verdict = popupVerdict(action);
    if (verdict.allow) return false;
    send('popup-blocked', { url: action, reason: 'formulaire vers un nouvel onglet' });
    return true;
  }

  function override(obj, prop, fn) {
    try {
      Object.defineProperty(obj, prop, { value: fn, writable: true, configurable: true, enumerable: true });
    } catch (e) {
      try { obj[prop] = fn; } catch (e2) { /* ignore */ }
    }
  }

  // Protège une fenêtre : la page elle-même et les iframes vides créées par les
  // régies pour récupérer un window.open « intact ».
  const protectedWindows = new WeakSet();
  function protectWindow(w) {
    let nativeOpen;
    try {
      if (protectedWindows.has(w)) return;
      nativeOpen = w.open; // lève une exception si la fenêtre est d'une autre origine
      protectedWindows.add(w);
    } catch (e) {
      return;
    }

    override(w, 'open', disguise(function open(url, target) {
      const name = target == null ? '' : String(target);
      if (name && targetsFrame(w, name)) return Reflect.apply(nativeOpen, this, arguments);
      const verdict = popupVerdict(url == null ? '' : String(url));
      if (verdict.allow) return Reflect.apply(nativeOpen, this, arguments);
      send('popup-blocked', { url: absUrl(url || 'about:blank'), reason: verdict.reason });
      return null;
    }, 'open'));

    const nativeClick = w.HTMLElement.prototype.click;
    override(w.HTMLAnchorElement.prototype, 'click', disguise(function click() {
      if (anchorBlocked(this)) return undefined;
      return Reflect.apply(nativeClick, this, arguments);
    }, 'click'));

    const nativeDispatch = w.EventTarget.prototype.dispatchEvent;
    override(w.EventTarget.prototype, 'dispatchEvent', disguise(function dispatchEvent(ev) {
      if (ev && ev.type === 'click' && !ev.isTrusted && anchorBlocked(this)) return false;
      return Reflect.apply(nativeDispatch, this, arguments);
    }, 'dispatchEvent'));

    const formProto = w.HTMLFormElement.prototype;
    const nativeSubmit = formProto.submit;
    override(formProto, 'submit', disguise(function submit() {
      if (formBlocked(this)) return undefined;
      return Reflect.apply(nativeSubmit, this, arguments);
    }, 'submit'));
    const nativeRequestSubmit = formProto.requestSubmit;
    if (typeof nativeRequestSubmit === 'function') {
      override(formProto, 'requestSubmit', disguise(function requestSubmit() {
        if (formBlocked(this)) return undefined;
        return Reflect.apply(nativeRequestSubmit, this, arguments);
      }, 'requestSubmit'));
    }

    // Toute iframe consultée par un script est protégée à son tour.
    for (const Ctor of [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement]) {
      if (!Ctor) continue;
      for (const prop of ['contentWindow', 'contentDocument']) {
        const d = Object.getOwnPropertyDescriptor(Ctor.prototype, prop);
        if (!d || !d.get) continue;
        const getter = d.get;
        try {
          Object.defineProperty(Ctor.prototype, prop, {
            configurable: true,
            enumerable: d.enumerable,
            get: disguise(function () {
              const v = getter.call(this);
              try {
                const win = prop === 'contentWindow' ? v : v && v.defaultView;
                if (win) protectWindow(win);
              } catch (e) { /* ignore */ }
              return v;
            }, `get ${prop}`),
          });
        } catch (e) { /* ignore */ }
      }
    }
  }

  if (features.popups) protectWindow(window);

  // ---------------------------------------------------------------------------
  // Scriptlets (sous-ensemble compatible uBlock Origin)
  // ---------------------------------------------------------------------------
  function patternToRegex(pattern) {
    if (pattern == null || pattern === '') return /^/;
    const m = /^\/(.+)\/([gimsu]*)$/.exec(pattern);
    if (m) {
      try { return new RegExp(m[1], m[2]); } catch (e) { return /^\b$/; }
    }
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  function resolveConstant(raw) {
    switch (raw) {
      case 'undefined': return undefined;
      case 'null': return null;
      case 'true': return true;
      case 'false': return false;
      case '': case 'emptyStr': return '';
      case 'noopFunc': return function () {};
      case 'trueFunc': return function () { return true; };
      case 'falseFunc': return function () { return false; };
      case 'emptyArr': case '[]': return [];
      case 'emptyObj': case '{}': return {};
      case 'noopPromiseResolve': return function () { return Promise.resolve(); };
      default:
        if (/^-?\d+(\.\d+)?$/.test(raw)) {
          const n = Number(raw);
          if (Math.abs(n) <= 0x7FFF) return n;
        }
        return undefined;
    }
  }

  // Définit un piège sur un chemin de propriétés (a.b.c), même si les objets
  // intermédiaires n'existent pas encore.
  function trapChain(root, chain, onFinal) {
    const dot = chain.indexOf('.');
    if (dot === -1) {
      onFinal(root, chain);
      return;
    }
    const prop = chain.slice(0, dot);
    const rest = chain.slice(dot + 1);
    let current = root[prop];
    if (current instanceof Object || (typeof current === 'object' && current !== null)) {
      trapChain(current, rest, onFinal);
      return;
    }
    const desc = Object.getOwnPropertyDescriptor(root, prop);
    if (desc && desc.configurable === false) return;
    try {
      Object.defineProperty(root, prop, {
        configurable: true,
        get() { return current; },
        set(v) {
          current = v;
          if (v instanceof Object) trapChain(v, rest, onFinal);
        },
      });
    } catch (e) { /* ignore */ }
  }

  const scriptlets = {};

  scriptlets['set-constant'] = function (chain, rawValue) {
    if (!chain) return;
    const value = resolveConstant(rawValue);
    trapChain(window, chain, (owner, prop) => {
      try {
        Object.defineProperty(owner, prop, {
          configurable: false,
          get() { return value; },
          set() {},
        });
      } catch (e) { /* ignore */ }
    });
  };
  scriptlets.set = scriptlets['set-constant'];

  function abortError() {
    return new ReferenceError(Math.random().toString(36).slice(2));
  }

  scriptlets['abort-on-property-read'] = function (chain) {
    if (!chain) return;
    trapChain(window, chain, (owner, prop) => {
      try {
        Object.defineProperty(owner, prop, {
          configurable: false,
          get() { throw abortError(); },
          set() {},
        });
      } catch (e) { /* ignore */ }
    });
  };
  scriptlets.aopr = scriptlets['abort-on-property-read'];

  scriptlets['abort-on-property-write'] = function (prop) {
    if (!prop) return;
    trapChain(window, prop, (owner, p) => {
      try {
        Object.defineProperty(owner, p, {
          configurable: false,
          get() { return undefined; },
          set() { throw abortError(); },
        });
      } catch (e) { /* ignore */ }
    });
  };
  scriptlets.aopw = scriptlets['abort-on-property-write'];

  scriptlets['abort-current-script'] = function (chain, needle) {
    if (!chain) return;
    const re = patternToRegex(needle);
    const scriptOf = () => document.currentScript;
    trapChain(window, chain, (owner, prop) => {
      let value = owner[prop];
      const check = () => {
        const s = scriptOf();
        if (!(s instanceof HTMLScriptElement)) return;
        const text = s.src ? s.src : s.textContent;
        if (re.test(text)) throw abortError();
      };
      try {
        Object.defineProperty(owner, prop, {
          configurable: true,
          get() { check(); return value; },
          set(v) { check(); value = v; },
        });
      } catch (e) { /* ignore */ }
    });
  };
  scriptlets.acs = scriptlets['abort-current-script'];

  function makeTimerGuard(name) {
    return function (needle, delay) {
      const native = window[name];
      const re = patternToRegex(needle);
      const delayNum = delay ? parseInt(String(delay).replace(/^!/, ''), 10) : NaN;
      const negateDelay = typeof delay === 'string' && delay.startsWith('!');
      window[name] = disguise(function (fn, ms) {
        const text = typeof fn === 'function' ? nativeToString.call(fn) : String(fn);
        let match = re.test(text);
        if (!Number.isNaN(delayNum)) {
          const delayMatch = Number(ms) === delayNum;
          match = match && (negateDelay ? !delayMatch : delayMatch);
        }
        if (match) return 0;
        return Reflect.apply(native, this, arguments);
      }, name);
    };
  }
  scriptlets['no-setTimeout-if'] = makeTimerGuard('setTimeout');
  scriptlets.nostif = scriptlets['no-setTimeout-if'];
  scriptlets['prevent-setTimeout'] = scriptlets['no-setTimeout-if'];
  scriptlets['no-setInterval-if'] = makeTimerGuard('setInterval');
  scriptlets.nosiif = scriptlets['no-setInterval-if'];
  scriptlets['prevent-setInterval'] = scriptlets['no-setInterval-if'];

  scriptlets['addEventListener-defuser'] = function (type, needle) {
    const reType = patternToRegex(type);
    const reFn = patternToRegex(needle);
    const native = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = disguise(function addEventListener(t, fn) {
      if (reType.test(String(t))) {
        let text = '';
        try { text = typeof fn === 'function' ? nativeToString.call(fn) : String(fn); } catch (e) { /* ignore */ }
        if (reFn.test(text)) return undefined;
      }
      return Reflect.apply(native, this, arguments);
    }, 'addEventListener');
  };
  scriptlets.aeld = scriptlets['addEventListener-defuser'];
  scriptlets['prevent-addEventListener'] = scriptlets['addEventListener-defuser'];

  // Supprime des propriétés d'objets JSON (ex. pubs du lecteur YouTube).
  function pruneObject(obj, paths, required) {
    if (!obj || typeof obj !== 'object') return false;
    if (required.length && !required.every((p) => hasPath(obj, p))) return false;
    let pruned = false;
    for (const p of paths) {
      if (deletePath(obj, p.split('.'))) pruned = true;
    }
    return pruned;
  }
  function hasPath(obj, path) {
    let cur = obj;
    for (const k of path.split('.')) {
      if (cur == null || typeof cur !== 'object' || !(k in cur)) return false;
      cur = cur[k];
    }
    return true;
  }
  function deletePath(obj, keys) {
    if (obj == null || typeof obj !== 'object') return false;
    const [k, ...rest] = keys;
    if (k === '[]' || k === '*') {
      let any = false;
      for (const v of Object.values(obj)) {
        if (rest.length === 0) continue;
        if (deletePath(v, rest)) any = true;
      }
      return any;
    }
    if (!(k in obj)) return false;
    if (rest.length === 0) {
      delete obj[k];
      return true;
    }
    return deletePath(obj[k], rest);
  }

  const jsonPruners = [];
  let jsonHooked = false;
  function hookJson() {
    if (jsonHooked) return;
    jsonHooked = true;
    const nativeParse = JSON.parse;
    JSON.parse = disguise(function parse() {
      const result = Reflect.apply(nativeParse, this, arguments);
      for (const pr of jsonPruners) {
        if (pruneObject(result, pr.paths, pr.required)) send('scriptlet', { name: 'json-prune' });
      }
      return result;
    }, 'parse');
    const nativeJson = Response.prototype.json;
    Response.prototype.json = disguise(function json() {
      return Reflect.apply(nativeJson, this, arguments).then((result) => {
        for (const pr of jsonPruners) {
          if (pruneObject(result, pr.paths, pr.required)) send('scriptlet', { name: 'json-prune' });
        }
        return result;
      });
    }, 'json');
  }

  scriptlets['json-prune'] = function (paths, required) {
    if (!paths) return;
    jsonPruners.push({
      paths: paths.split(/\s+/).filter(Boolean),
      required: (required || '').split(/\s+/).filter(Boolean),
    });
    hookJson();
  };

  scriptlets['noeval-if'] = function (needle) {
    const re = patternToRegex(needle);
    const native = window.eval;
    window.eval = disguise(function (src) {
      if (re.test(String(src))) return undefined;
      return native(src);
    }, 'eval');
  };

  scriptlets['nowebrtc'] = function () {
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
      if (typeof window[name] !== 'function') continue;
      const Fake = disguise(function () { throw new DOMException('Bloqué par iBlock', 'NotAllowedError'); }, name);
      try { window[name] = Fake; } catch (e) { /* ignore */ }
    }
  };

  scriptlets['window.open-defuser'] = function () {
    window.open = disguise(function open() { return null; }, 'open');
  };
  scriptlets['no-window-open-if'] = function (needle) {
    const re = patternToRegex(needle);
    const native = window.open;
    window.open = disguise(function open(url) {
      if (re.test(String(url || ''))) {
        send('popup-blocked', { url: absUrl(url || ''), reason: 'filtre' });
        return null;
      }
      return Reflect.apply(native, this, arguments);
    }, 'open');
  };
  scriptlets.nowoif = scriptlets['no-window-open-if'];

  const ran = [];
  function runScriptlet(name, args) {
    let fname = String(name || '').trim().replace(/\.js$/, '');
    const fn = scriptlets[fname];
    if (!fn) {
      send('scriptlet-unknown', { name: fname });
      return;
    }
    try {
      fn.apply(null, (args || []).map(String));
      ran.push(fname);
    } catch (e) {
      send('scriptlet-error', { name: fname, error: String(e && e.message) });
    }
  }

  if (features.scriptlets && Array.isArray(cfg.scriptlets)) {
    for (const s of cfg.scriptlets) {
      if (Array.isArray(s) && s.length) runScriptlet(s[0], s.slice(1));
    }
  }

  send('page-ready', { scriptlets: ran });
})();
