/* Courses demo: admin sign-in (any password) — the rest replays the recorded platform. */
(function () {
  const D = window.DEMO;
  const login = () => { const f = D.fixtures.admin && Object.entries(D.fixtures.admin).find(([k]) => k.startsWith('POST /api/auth/login')); return f ? f[1].b : null; };
  D.on('POST', /^\/api\/auth\/login$/, () => { D.setRole('admin'); const r = login(); return r ? { b: r } : { s: 401, b: { message: 'Demo unavailable' } }; });
  D.on('POST', /^\/api\/auth\/refresh$/, () => { const r = login(); return r ? { b: r } : { s: 401, b: {} }; });
  D.on('POST', /^\/api\/auth\/logout$/, () => { D.setRole('guest'); return { b: { statusCode: 200, message: 'Success' } }; });
})();
