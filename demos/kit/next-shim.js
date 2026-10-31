/* Next.js demos: each page is a saved server render. Moving between pages loads the saved page
 * (in place of Next's client navigation, which would ask a server for page data). */
(function () {
  const D = window.DEMO;
  const base = window.__DEMO_BASE__ || './';
  const pages = D.pages || {};
  const images = D.images || {};
  const norm = (p) => (p.replace(/\/$/, '') || '/');

  const toast = (msg) => {
    let el = document.getElementById('demo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;z-index:2147483001;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 64px);background:rgba(17,20,26,.94);color:#fff;font:500 13px system-ui,sans-serif;padding:10px 16px;border-radius:10px;max-width:calc(100vw - 32px);direction:ltr;text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 2600);
  };

  // A route in this demo (exact, else the closest saved page of the same section)
  const fileFor = (route) => {
    const r = norm(route);
    if (pages[r]) return pages[r];
    return null;
  };
  D.go = (route) => {
    const f = fileFor(route);
    if (f) { location.href = base + f; return true; }
    toast('This page is not part of the demo — try the menu.');
    return false;
  };

  // Links: load the saved page
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|sms|javascript):/i.test(href)) return;
    let u;
    try { u = new URL(href, location.origin + '/'); } catch { return; }
    if (u.origin !== location.origin) return; // other sites open normally
    if (href.startsWith('/') || u.pathname.startsWith('/')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (u.hash && norm(u.pathname) === norm(window.__DEMO_ROUTE__ || '/')) { const t = document.getElementById(u.hash.slice(1)); if (t) t.scrollIntoView(); return; }
      D.go(u.pathname);
    }
  }, true);

  // Page data requests from Next's router: prefetches get an empty answer, navigations load the saved page
  const runtimeFetch = window.fetch;
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : input && input.url;
    const headers = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || {});
    let u = null;
    try { u = new URL(url, location.href); } catch { /* not a URL */ }
    const isRsc = u && u.origin === location.origin && (headers.get('rsc') === '1' || u.searchParams.has('_rsc'));
    if (isRsc) {
      if (headers.get('next-router-prefetch') || headers.get('next-router-segment-prefetch')) return Promise.resolve(new Response(null, { status: 204 }));
      D.go(u.pathname);
      return new Promise(() => {}); // the page is being replaced
    }
    if (u && u.origin === location.origin && headers.get('next-action')) {
      toast('Saving is turned off in this demo.');
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return runtimeFetch.apply(this, arguments);
  };

  // Optimized images rendered after load → the saved copies
  const IMG = /\/_next\/image\?url=([^&]+)&/;
  const fixImg = (el) => {
    if (el.tagName !== 'IMG') return;
    const s = el.getAttribute('src');
    const m = s && s.match(IMG);
    if (m) { const f = images[decodeURIComponent(m[1])]; if (f) { el.setAttribute('src', f); el.removeAttribute('srcset'); } }
    else if (s && s.startsWith('/') && D.staticPrefixes && D.staticPrefixes.some((p) => s.startsWith(p))) el.setAttribute('src', s.slice(1));
    const ss = el.getAttribute('srcset');
    if (ss && ss.includes('/_next/image')) {
      const mm = ss.match(IMG);
      const f = mm && images[decodeURIComponent(mm[1])];
      if (f) { el.removeAttribute('srcset'); el.setAttribute('src', f); }
    }
  };
  new MutationObserver((ms) => ms.forEach((m) => {
    if (m.type === 'attributes') fixImg(m.target);
    m.addedNodes && m.addedNodes.forEach((n) => { if (n.nodeType === 1) { fixImg(n); n.querySelectorAll && n.querySelectorAll('img').forEach(fixImg); } });
  })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
})();
