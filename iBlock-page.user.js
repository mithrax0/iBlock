// ==UserScript==
// @name         iBlock (page)
// @namespace    https://github.com/mithrax0/iBlock
// @version      0.1.0
// @description  iBlock, partie « page » : protection anti pop-ups et scriptlets. À installer avec le script « iBlock ».
// @author       mithrax0
// @match        *://*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @updateURL    https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock-page.meta.js
// @downloadURL  https://raw.githubusercontent.com/mithrax0/iBlock/main/iBlock-page.user.js
// ==/UserScript==

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

  function popupVerdict(url) {
    const full = absUrl(url || 'about:blank');
    if (allowOnce.has(full)) {
      allowOnce.delete(full);
      return { allow: true };
    }
    const recent = Date.now() - gesture.time < 1500;
    if (!recent) {
      // Aucun geste récent : ouverture automatique → pop-up indésirable.
      return { allow: false, reason: 'ouverture automatique' };
    }
    gesture.opens += 1;
    if (gesture.opens > 1) return { allow: false, reason: 'ouvertures multiples' };

    const el = gesture.target && gesture.target.closest ? gesture.target : null;
    const interactive = el ? el.closest(INTERACTIVE) : null;

    if (!url || full === 'about:blank') {
      // Fenêtre vide puis redirection : technique classique des popunders,
      // mais aussi utilisée par certains boutons de partage/connexion.
      return interactive && !interactive.matches('a[href]')
        ? { allow: true }
        : { allow: false, reason: 'fenêtre vide suspecte' };
    }
    if (sameSite(full)) return { allow: true };

    if (!interactive) {
      // Clic sur une zone non interactive (texte, fond, lecteur vidéo…).
      return { allow: false, reason: 'clic détourné' };
    }
    if (interactive.matches('a[href]')) {
      // Clic sur un lien qui ouvre AUTRE CHOSE que sa propre destination.
      const href = absUrl(interactive.getAttribute('href'));
      if (href === full) return { allow: true };
      try {
        if (new URL(href).hostname === new URL(full).hostname) return { allow: true };
      } catch (e) { /* ignore */ }
      return { allow: false, reason: 'lien détourné' };
    }
    // Bouton (connexion Google/Apple, partage…) : autorisé.
    return { allow: true };
  }

  if (features.popups) {
    const nativeOpen = window.open;
    const guardedOpen = disguise(function open(url, target, feats) {
      const target_ = target == null ? '' : String(target);
      // Ouverture dans la fenêtre courante : ce n'est pas un pop-up.
      if (/^_(self|top|parent)$/i.test(target_)) {
        return Reflect.apply(nativeOpen, this, arguments);
      }
      const verdict = popupVerdict(url == null ? '' : String(url));
      if (verdict.allow) return Reflect.apply(nativeOpen, this, arguments);
      send('popup-blocked', { url: absUrl(url || 'about:blank'), reason: verdict.reason });
      return null;
    }, 'open');
    try {
      Object.defineProperty(window, 'open', {
        value: guardedOpen, writable: true, configurable: true, enumerable: true,
      });
    } catch (e) {
      window.open = guardedOpen;
    }

    // Liens _blank cliqués par script (a.click() / dispatchEvent) sur des
    // éléments invisibles ou détachés : technique de popunder.
    const anchorProto = HTMLAnchorElement.prototype;
    const nativeClick = HTMLElement.prototype.click;
    function suspiciousAnchor(a) {
      if (!(a instanceof HTMLAnchorElement)) return false;
      const t = (a.getAttribute('target') || '').toLowerCase();
      if (!t || t === '_self' || t === '_top' || t === '_parent') return false;
      const href = a.getAttribute('href');
      if (!href || sameSite(href)) return false;
      return true;
    }
    const guardedClick = disguise(function click() {
      if (this instanceof HTMLAnchorElement && suspiciousAnchor(this)) {
        const verdict = popupVerdict(this.href);
        // Un lien réellement touché par l'utilisateur est toujours autorisé.
        const touched = gesture.target && this.contains(gesture.target);
        if (!verdict.allow && !touched) {
          send('popup-blocked', { url: this.href, reason: 'lien invisible cliqué par script' });
          return undefined;
        }
      }
      return Reflect.apply(nativeClick, this, arguments);
    }, 'click');
    try {
      Object.defineProperty(anchorProto, 'click', {
        value: guardedClick, writable: true, configurable: true,
      });
    } catch (e) { /* ignore */ }

    const nativeDispatch = EventTarget.prototype.dispatchEvent;
    const guardedDispatch = disguise(function dispatchEvent(ev) {
      if (ev && ev.type === 'click' && !ev.isTrusted && suspiciousAnchor(this)) {
        const touched = gesture.target && this.contains && this.contains(gesture.target);
        const verdict = popupVerdict(this.href);
        if (!verdict.allow && !touched) {
          send('popup-blocked', { url: this.href, reason: 'lien invisible cliqué par script' });
          return false;
        }
      }
      return Reflect.apply(nativeDispatch, this, arguments);
    }, 'dispatchEvent');
    try {
      Object.defineProperty(EventTarget.prototype, 'dispatchEvent', {
        value: guardedDispatch, writable: true, configurable: true,
      });
    } catch (e) { /* ignore */ }
  }

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
