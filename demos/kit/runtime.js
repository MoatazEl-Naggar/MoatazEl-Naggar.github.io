/* Portfolio demo runtime: runs a real app frontend with an in-page backend.
 *
 * Loaded before the app bundle. Expects window.DEMO = {
 *   app, title, recordedAt (ms), apiPrefixes: ['/api/'], staticPrefixes: ['/uploads/'],
 *   roles: [{ id, label, start, storage: {key: value} }], back: '../../index.html#clinic'
 * }, then fixtures.js (DEMO.fixtures = { role: { 'GET /api/x?y': { s, b } } }) and an
 * optional handlers.js that registers app logic with DEMO.on(method, regex, fn).
 *
 * - XHR and fetch calls to the API are answered here; nothing reaches a network.
 * - Recorded GET responses are replayed; writes change an in-memory overlay that every
 *   later response reflects (updated fields, deleted rows, created rows). Refresh resets it.
 * - The clock is pinned to the recording date so "today" always has data.
 */
(function () {
  const D = window.DEMO = Object.assign({ apiPrefixes: ['/api/'], staticPrefixes: [], roles: [], fixtures: {} }, window.DEMO || {});
  D.handlers = [];
  const kitSrc = (document.currentScript && document.currentScript.src) || ([...document.scripts].find((s) => /kit\/runtime\.js/.test(s.src)) || {}).src;
  if (D.back && kitSrc && !/^https?:/.test(D.back)) D.back = new URL(D.back, kitSrc).href;
  D.on = (method, pattern, fn) => D.handlers.push({ method: method.toUpperCase(), pattern, fn });

  // ── Clock pinned to the recording date (time of day keeps moving) ──
  if (D.recordedAt) {
    const RealDate = Date;
    const real = new RealDate();
    const rec = new RealDate(D.recordedAt);
    rec.setHours(real.getHours(), real.getMinutes(), real.getSeconds(), real.getMilliseconds());
    // Keep the recorded calendar day, but if that time already passed on the recorded day it's fine
    const offset = rec.getTime() - real.getTime();
    class DemoDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
      static now() { return RealDate.now() + offset; }
    }
    DemoDate.UTC = RealDate.UTC; DemoDate.parse = RealDate.parse;
    window.Date = DemoDate;
  }

  // ── Session (demo role) ──
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  D.role = ss.get(`demo-role-${D.app}`) || 'guest';
  D.setRole = (r) => { D.role = r; ss.set(`demo-role-${D.app}`, r); };

  // ── Overlay state ──
  const S = D.state = { patches: new Map(), deleted: new Set(), created: [], seq: 1 };
  const idOf = (o) => (o && typeof o === 'object' ? (o._id ?? o.id ?? null) : null);
  D.newId = () => {
    const hex = (Date.now().toString(16) + (S.seq++).toString(16).padStart(6, '0') + 'demo00000000').slice(0, 24);
    return hex.replace(/[^0-9a-f]/g, 'a');
  };
  D.patch = (id, fields) => { if (id == null) return; const k = String(id); S.patches.set(k, Object.assign(S.patches.get(k) || {}, fields)); };
  D.remove = (id) => S.deleted.add(String(id));
  // created rows join any later list whose rows look like them (same kind of record)
  const signature = (o) => Object.keys(o).filter((k) => k !== '__v').sort();
  const similar = (a, b) => { const A = new Set(a); const B = new Set(b); let n = 0; A.forEach((k) => { if (B.has(k)) n++; }); return n / Math.max(A.size, B.size, 1); };
  D.create = (obj, opts = {}) => { S.created.unshift({ obj, sig: signature(obj), match: opts.match || null }); return obj; };

  // ── Keep the visit's changes for this browser tab (survive a role switch / reload; reset when the tab closes) ──
  const SKEY = `demo-state-${D.app}`;
  let restored = null;
  try { restored = JSON.parse(ss.get(SKEY) || 'null'); } catch { restored = null; }
  const kept = {};
  if (restored) {
    (restored.patches || []).forEach(([k, v]) => S.patches.set(k, v));
    (restored.deleted || []).forEach((k) => S.deleted.add(k));
    (restored.created || []).forEach((obj) => S.created.push({ obj, sig: Object.keys(obj).filter((k) => k !== '__v').sort(), match: null }));
    S.seq = restored.seq || 1;
  }
  // Handlers keep their own state here: D.keep('orders', []) returns the saved value or the initial one
  D.keep = (name, initial) => { kept[name] = restored && restored.kept && name in restored.kept ? restored.kept[name] : initial; return kept[name]; };
  D.save = () => {
    try {
      ss.set(SKEY, JSON.stringify({ patches: [...S.patches], deleted: [...S.deleted], created: S.created.map((c) => c.obj), seq: S.seq, kept }));
    } catch { /* storage full or unavailable: the demo still works for this page */ }
  };
  D.reset = () => { try { sessionStorage.removeItem(SKEY); } catch { /* unavailable */ } location.reload(); };
  window.addEventListener('pagehide', D.save);

  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const fixStatic = (s) => (typeof s === 'string' && D.staticPrefixes.some((p) => s.startsWith(p)) ? `.${s}` : s);

  // Apply the overlay to a response body
  D.applyOverlay = function apply(v, ctx) {
    if (Array.isArray(v)) {
      let arr = v.filter((x) => !(idOf(x) != null && S.deleted.has(String(idOf(x)))));
      if (arr.length && typeof arr[0] === 'object' && arr[0] && idOf(arr[0]) != null && ctx) {
        const sig = signature(arr[0]);
        const have = new Set(arr.map((x) => String(idOf(x))));
        const extra = S.created.filter((c) => !have.has(String(idOf(c.obj))) && similar(c.sig, sig) > 0.6 && (!c.match || c.match(ctx)));
        if (extra.length) arr = [...extra.map((c) => clone(c.obj)), ...arr];
      }
      return arr.map((x) => apply(x, ctx));
    }
    if (v && typeof v === 'object') {
      const id = idOf(v);
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = apply(x, ctx);
      if (id != null && S.patches.has(String(id))) Object.assign(out, clone(S.patches.get(String(id))));
      return out;
    }
    return fixStatic(v);
  };

  // ── Fixture lookup ──
  const norm = (p) => p.replace(/\/[0-9a-f]{24}(?=\/|$|\?)/gi, '/:id').replace(/\/[0-9a-f-]{36}(?=\/|$|\?)/gi, '/:id').replace(/\/\d+(?=\/|$|\?)/g, '/:id');
  const roleOrder = () => [D.role, 'any', ...Object.keys(D.fixtures).filter((r) => r !== D.role && r !== 'any')];
  D.findFixture = (method, pathQ) => {
    const [path] = pathQ.split('?');
    for (const r of roleOrder()) { const f = D.fixtures[r]; if (f && f[`${method} ${pathQ}`]) return f[`${method} ${pathQ}`]; }
    for (const r of roleOrder()) {
      const f = D.fixtures[r]; if (!f) continue;
      const hit = Object.keys(f).find((k) => k.startsWith(`${method} ${path}?`) || k === `${method} ${path}`);
      if (hit) return f[hit];
    }
    const n = norm(path);
    for (const r of roleOrder()) {
      const f = D.fixtures[r]; if (!f) continue;
      const hit = Object.keys(f).find((k) => { const [m, p] = k.split(' '); return m === method && norm(p.split('?')[0]) === n; });
      if (hit) return { ...f[hit], template: hit.split(' ')[1].split('?')[0] };
    }
    return null;
  };
  // Find a record by id inside any recorded GET response (for computing what an action changed)
  D.findRecord = (id) => {
    const want = String(id);
    let found = null;
    const walk = (v) => {
      if (found) return;
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') { if (String(idOf(v)) === want) { found = v; return; } Object.values(v).forEach(walk); }
    };
    for (const r of Object.keys(D.fixtures)) for (const [k, f] of Object.entries(D.fixtures[r])) { if (k.startsWith('GET ')) walk(f.b); if (found) return clone(found); }
    return null;
  };
  // Every recorded list item of one kind (for handlers that rebuild lists)
  D.allRecords = (test) => {
    const seen = new Map();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') { const id = idOf(v); if (id != null && test(v) && !seen.has(String(id))) seen.set(String(id), clone(v)); Object.values(v).forEach(walk); }
    };
    for (const r of Object.keys(D.fixtures)) for (const [k, f] of Object.entries(D.fixtures[r])) if (k.startsWith('GET ')) walk(f.b);
    return [...seen.values()];
  };

  // Generic write: replay a recorded answer for the same kind of action, moving its changes onto this record
  const genericWrite = (req) => {
    const fx = D.findFixture(req.method, req.pathQ);
    const ids = (req.path.match(/[0-9a-f]{24}|[0-9a-f-]{36}|(?<=\/)\d+(?=\/|$)/gi) || []);
    const targetId = ids[0];
    if (req.method === 'DELETE' && targetId) { D.remove(targetId); return { s: 200, b: fx ? fx.b : { success: true, message: 'Deleted' } }; }
    if (!fx) {
      if (req.method === 'POST') {
        const obj = { _id: D.newId(), ...(req.body || {}), createdAt: new Date().toISOString() };
        D.create(obj);
        return { s: 201, b: { success: true, data: obj, ...obj } };
      }
      if (targetId) D.patch(targetId, req.body || {});
      return { s: 200, b: { success: true, message: 'Saved' } };
    }
    let body = clone(fx.b);
    const tplIds = fx.template ? (fx.template.match(/[0-9a-f]{24}|[0-9a-f-]{36}|(?<=\/)\d+(?=\/|$)/gi) || []) : [targetId];
    const tplId = tplIds[0];
    // the changed record inside the recorded answer
    let changed = null;
    const walk = (v) => { if (changed || !v || typeof v !== 'object') return; if (Array.isArray(v)) return v.forEach(walk); if (tplId && String(idOf(v)) === String(tplId)) { changed = v; return; } Object.values(v).forEach(walk); };
    walk(body);
    if (changed && targetId) {
      const before = D.findRecord(tplId) || {};
      const delta = {};
      for (const [k, v] of Object.entries(changed)) if (JSON.stringify(before[k]) !== JSON.stringify(v) && k !== '_id' && k !== 'id') delta[k] = v;
      Object.assign(delta, req.body && typeof req.body === 'object' ? req.body : {});
      const current = D.findRecord(targetId) || {};
      D.patch(targetId, delta);
      const merged = { ...current, ...(S.patches.get(String(targetId)) || {}) };
      const swap = (v) => { if (Array.isArray(v)) return v.map(swap); if (v && typeof v === 'object') { if (String(idOf(v)) === String(tplId)) return merged; const o = {}; for (const [k, x] of Object.entries(v)) o[k] = swap(x); return o; } return v; };
      body = swap(body);
    } else if (req.method === 'POST' && changed == null) {
      // creation: the recorded new record, with the sent fields and a fresh id
      const replaceNew = (v) => {
        if (Array.isArray(v) || !v || typeof v !== 'object') return v;
        for (const [k, x] of Object.entries(v)) {
          if (x && typeof x === 'object' && !Array.isArray(x) && idOf(x) != null) {
            const obj = { ...x, ...(req.body || {}), [x._id != null ? '_id' : 'id']: D.newId(), createdAt: new Date().toISOString() };
            D.create(obj); v[k] = obj; return v;
          }
        }
        return v;
      };
      body = replaceNew(body);
    }
    return { s: fx.s || 200, b: body };
  };

  // ── Request handling ──
  const toReq = (method, url, rawBody, headers) => {
    const u = new URL(url, location.href);
    let body = rawBody;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* not JSON */ } }
    if (body instanceof FormData) { const o = {}; body.forEach((v, k) => { o[k] = typeof v === 'string' ? v : { name: v.name, type: v.type, size: v.size }; }); body = o; }
    const prefix = D.apiPrefixes.find((p) => u.pathname.includes(p));
    const path = prefix ? u.pathname.slice(u.pathname.indexOf(prefix)) : u.pathname;
    return { method: method.toUpperCase(), url: u, path, pathQ: path + u.search, query: Object.fromEntries(u.searchParams), body, headers: headers || {} };
  };
  D.isApi = (url) => { try { const u = new URL(url, location.href); return u.origin === location.origin && D.apiPrefixes.some((p) => u.pathname.includes(p)); } catch { return false; } };
  D.handle = async (req) => {
    for (const h of D.handlers) {
      if (h.method !== '*' && h.method !== req.method) continue;
      const m = req.path.match(h.pattern);
      if (!m) continue;
      const r = await h.fn(req, m);
      if (r !== undefined) { if (req.method !== 'GET') D.save(); return { s: r.s || 200, b: D.applyOverlay(r.b, req), headers: r.headers }; }
    }
    if (req.method === 'GET') {
      const fx = D.findFixture('GET', req.pathQ);
      if (fx) return { s: fx.s === 304 ? 200 : (fx.s || 200), b: D.applyOverlay(clone(fx.b), req) };
      return { s: 404, b: { message: 'Not available in the demo' } };
    }
    const r = genericWrite(req);
    D.save();
    return { s: r.s, b: D.applyOverlay(r.b, req) };
  };
  const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

  // fetch
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!D.isApi(url)) return realFetch(input, init);
    const method = init.method || (typeof input !== 'string' && input.method) || 'GET';
    const req = toReq(method, url, init.body, init.headers);
    await delay();
    const r = await D.handle(req);
    return new Response(JSON.stringify(r.b), { status: r.s, headers: { 'Content-Type': 'application/json', ...(r.headers || {}) } });
  };

  // XMLHttpRequest (axios)
  const RealXHR = window.XMLHttpRequest;
  function DemoXHR() {
    const real = new RealXHR();
    let intercepted = false; let method = 'GET'; let url = ''; const headers = {};
    const self = this;
    const fwd = ['onreadystatechange', 'onload', 'onloadend', 'onerror', 'onabort', 'ontimeout', 'onprogress', 'onloadstart'];
    this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.response = null; this.responseURL = '';
    this.responseType = ''; this.timeout = 0; this.withCredentials = false; this.upload = real.upload;
    const listeners = {};
    this.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); if (!intercepted) real.addEventListener(t, (e) => fn.call(self, e)); };
    this.removeEventListener = (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); };
    const fire = (t) => { const e = new Event(t); if (typeof self[`on${t}`] === 'function') self[`on${t}`](e); (listeners[t] || []).forEach((fn) => fn.call(self, e)); };
    this.open = (m, u, ...rest) => {
      method = m; url = u; intercepted = D.isApi(u);
      if (!intercepted) {
        real.open(m, u, ...rest);
        fwd.forEach((k) => { real[k] = (e) => { ['readyState', 'status', 'statusText', 'responseText', 'response', 'responseURL'].forEach((p) => { try { self[p] = real[p]; } catch { /* not readable */ } }); if (typeof self[k] === 'function') self[k](e); }; });
      } else { self.readyState = 1; }
    };
    this.setRequestHeader = (k, v) => { if (intercepted) headers[k] = v; else real.setRequestHeader(k, v); };
    this.getAllResponseHeaders = () => (intercepted ? 'content-type: application/json\r\n' : real.getAllResponseHeaders());
    this.getResponseHeader = (k) => (intercepted ? (/content-type/i.test(k) ? 'application/json' : null) : real.getResponseHeader(k));
    this.overrideMimeType = (m) => { if (!intercepted) real.overrideMimeType(m); };
    this.abort = () => { if (!intercepted) real.abort(); else fire('abort'); };
    this.send = (body) => {
      if (!intercepted) { real.responseType = self.responseType; real.timeout = self.timeout; real.withCredentials = self.withCredentials; return real.send(body); }
      (async () => {
        await delay();
        let r;
        try { r = await D.handle(toReq(method, url, body, headers)); } catch (e) { console.error('[demo]', e); r = { s: 500, b: { message: 'Demo error' } }; }
        const text = JSON.stringify(r.b);
        self.status = r.s; self.statusText = r.s < 400 ? 'OK' : 'Error'; self.responseURL = new URL(url, location.href).href;
        self.responseText = text; self.response = self.responseType === 'json' ? r.b : text;
        self.readyState = 4;
        fire('readystatechange'); fire('load'); fire('loadend');
      })();
    };
  }
  DemoXHR.UNSENT = 0; DemoXHR.OPENED = 1; DemoXHR.HEADERS_RECEIVED = 2; DemoXHR.LOADING = 3; DemoXHR.DONE = 4;
  window.XMLHttpRequest = DemoXHR;

  // EventSource / WebSocket to the API are quietly idle in the demo
  const RealWS = window.WebSocket;
  window.WebSocket = function (u, p) {
    if (D.isApi(u.replace(/^ws/, 'http'))) { const fake = { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} }; return fake; }
    return new RealWS(u, p);
  };

  // Absolute static paths (logos, uploads) → this demo's folder
  // Map tiles bundled with the demo (other sites' images don't load inside the portfolio)
  const TILE_RE = /^https?:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/;
  const fixTile = (s) => { const m = D.tiles && s && s.match(TILE_RE); return m ? `./tiles/${m[1]}/${m[2]}/${m[3]}.png` : s; };
  const fixEl = (el) => {
    if (el.tagName === 'IMG' || el.tagName === 'SOURCE') { const s = el.getAttribute('src'); const f = fixTile(fixStatic(s)); if (s && f !== s) el.setAttribute('src', f); }
    if (el.tagName === 'LINK' && /icon/.test(el.rel)) { const h = el.getAttribute('href'); if (h && fixStatic(h) !== h) el.setAttribute('href', fixStatic(h)); }
  };
  new MutationObserver((ms) => ms.forEach((m) => {
    if (m.type === 'attributes') fixEl(m.target);
    m.addedNodes && m.addedNodes.forEach((n) => { if (n.nodeType === 1) { fixEl(n); n.querySelectorAll && n.querySelectorAll('img,source,link').forEach(fixEl); } });
  })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });

  // No service workers or real printing inside the portfolio
  if (navigator.serviceWorker) { try { navigator.serviceWorker.register = () => Promise.reject(new Error('demo')); } catch { /* read-only */ } }

  // ── Demo bar: who you are, switch role, back to the portfolio ──
  D.signIn = (roleId) => {
    const r = D.roles.find((x) => x.id === roleId);
    if (!r) return;
    try { localStorage.clear(); Object.entries(r.storage || {}).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))); } catch { /* storage unavailable */ }
    D.setRole(r.id);
    // Next.js demos: each role starts on its own saved page
    if (D.mode === 'next') { location.href = (window.__DEMO_BASE__ || './') + r.start; return; }
    // Apps that keep the session only in memory sign in through their own login form after the reload
    if (D.login && r.credentials) { ss.set(`demo-autologin-${D.app}`, r.id); location.hash = D.login.hash || '#/login'; }
    else location.hash = r.start || '#/';
    location.reload();
  };
  const fillInput = (el, value) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  D.autoLogin = () => {
    const roleId = ss.get(`demo-autologin-${D.app}`);
    if (!roleId || !D.login) return;
    const r = D.roles.find((x) => x.id === roleId);
    if (!r || !r.credentials) return;
    let tries = 0;
    const t = setInterval(() => {
      const user = document.querySelector(D.login.user);
      const pass = document.querySelector(D.login.pass);
      const submit = document.querySelector(D.login.submit);
      if (user && pass && submit) {
        clearInterval(t);
        ss.set(`demo-autologin-${D.app}`, '');
        fillInput(user, r.credentials.user);
        fillInput(pass, r.credentials.pass);
        setTimeout(() => { submit.click(); if (r.start) setTimeout(() => { if (location.hash.startsWith(D.login.hash || '#/login')) location.hash = r.start; }, 1500); }, 150);
      } else if (++tries > 80) clearInterval(t);
    }, 100);
  };
  const bar = () => {
    if (document.getElementById('demo-bar')) return;
    const css = document.createElement('style');
    css.textContent = `
      #demo-bar{position:fixed;z-index:2147483000;left:max(10px,env(safe-area-inset-left,0px));bottom:calc(env(safe-area-inset-bottom,0px) + 10px);
        font:500 12.5px/1.2 system-ui,'Segoe UI',sans-serif;color:#fff;background:rgba(17,20,26,.92);border-radius:999px;
        display:flex;align-items:center;gap:6px;padding:5px 6px 5px 12px;box-shadow:0 6px 20px rgba(0,0,0,.25);direction:ltr;max-width:calc(100vw - 20px)}
      #demo-bar b{font-weight:700;letter-spacing:.02em;white-space:nowrap}
      #demo-bar .dmb{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.12);white-space:nowrap}
      #demo-bar .dmb:hover,#demo-bar .dmb:focus-visible{background:rgba(255,255,255,.24)}
      #demo-bar .dmb[aria-current=true]{background:#fff;color:#11141a}
      #demo-bar .roles{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
      #demo-bar .x{opacity:.8}
      #demo-bar.min .roles,#demo-bar.min .lbl,#demo-bar.min .rst{display:none}`;
    document.head.appendChild(css);
    const el = document.createElement('div');
    el.id = 'demo-bar';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Demo controls');
    el.innerHTML = `<b>DEMO</b><span class="lbl" style="opacity:.75">${D.roles.length ? 'View as' : 'Changes stay until you close the tab'}</span>
      <span class="roles">${D.roles.map((r) => `<button class="dmb" type="button" data-r="${r.id}" aria-current="${r.id === D.role}">${r.label}</button>`).join('')}</span>
      <button class="dmb rst" type="button" title="Start over with the original demo data">Reset</button>
      ${D.back ? `<a class="dmb" href="${D.back}">Portfolio</a>` : ''}
      <button class="dmb x" type="button" aria-label="Hide demo bar" title="Hide">–</button>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) D.signIn(b.dataset.r);
      if (e.target.closest('.x')) el.classList.toggle('min');
      if (e.target.closest('.rst')) D.reset();
    });
    document.body.appendChild(el);
  };
  // Inside the portfolio's demo frame the page around it shows the role switch and reset
  D.framed = window.top !== window;
  const boot = () => { if (!D.framed) bar(); D.autoLogin(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
