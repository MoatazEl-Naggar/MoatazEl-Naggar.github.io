/* ERP demo: sign-in (any username and password) — everything else replays the recorded company data. */
(function () {
  const D = window.DEMO;
  const USER = { id: 'demo-admin', username: 'admin', role: 'ADMIN', isActive: true, name: 'مدير النظام', phone: null, notes: null };
  D.on('POST', /^\/api\/auth\/login$/, () => { D.setRole('admin'); return { b: { token: 'demo-admin', user: USER } }; });
  D.on('GET', /^\/api\/auth\/me$/, () => ({ b: { user: USER, ...USER } }));
})();
