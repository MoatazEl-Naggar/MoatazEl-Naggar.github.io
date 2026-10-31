/* Dewan demo: sign-in (any username and password) — everything else replays the recorded demo company. */
(function () {
  const D = window.DEMO;
  const me = () => { const f = D.fixtures.admin && D.fixtures.admin['GET /api/auth/me']; return f ? f.b.data : { id: 1, username: 'admin', role: 'ADMIN' }; };
  D.on('POST', /^\/api\/auth\/login$/, () => { D.setRole('admin'); return { b: { success: true, data: { accessToken: 'demo-admin', user: me() } } }; });
  D.on('POST', /^\/api\/auth\/refresh$/, () => (D.role === 'admin' ? { b: { success: true, data: { accessToken: 'demo-admin' } } } : { s: 401, b: { success: false, message: 'Unauthorized' } }));
  D.on('POST', /^\/api\/auth\/logout$/, () => { D.setRole('guest'); return { b: { success: true } }; });
  D.on('GET', /^\/api\/auth\/me$/, () => ({ b: { success: true, data: me() } }));
})();
