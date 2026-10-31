/* RepTracker demo: sign-in, plus a live day in the field for the two demo reps (positions, visits, trail). */
(function () {
  const D = window.DEMO;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'demo-admin', role: 'admin' })}.demo`;
  const me = () => (D.fixtures.admin['GET /api/v1/me'] || { b: { user: { id: 'demo', role: 'admin', name: 'admin' } } }).b;
  D.on('POST', /^\/api\/v1\/auth\/login$/, () => { D.setRole('admin'); return { b: { accessToken: TOKEN, refreshToken: 'demo', user: me().user } }; });
  D.on('GET', /^\/api\/v1\/me$/, () => (D.role === 'admin' ? { b: me() } : { s: 401, b: { message: 'Unauthorized' } }));

  // Two reps moving slowly around their areas in Cairo and Giza
  const REPS = [
    { repId: 'rep-seed-001', repName: 'أحمد محمد', base: [30.0626, 31.2497], customer: ['cust-seed-001', 'سوبر ماركت الخليج'] },
    { repId: 'rep-seed-002', repName: 'محمد علي', base: [30.0131, 31.2089], customer: null },
  ];
  const pos = (r, t) => { const a = t / 90000 + (r.repId.endsWith('2') ? 2 : 0); return [r.base[0] + 0.012 * Math.sin(a), r.base[1] + 0.015 * Math.cos(a * 0.8)]; };
  D.on('GET', /^\/api\/v1\/(admin|branch)\/gps\/live$/, () => {
    const now = Date.now();
    return {
      b: {
        reps: REPS.map((r) => {
          const [lat, lng] = pos(r, now);
          return { repId: r.repId, repName: r.repName, branchId: null, branchName: null, latitude: lat, longitude: lng, accuracy: 12, lastSeen: new Date(now - 40000).toISOString(), loggedInSince: new Date(now - 4 * 3600e3).toISOString(), inVisit: !!r.customer, visitStartTime: r.customer ? new Date(now - 11 * 60e3).toISOString() : null, customerId: r.customer?.[0] || null, customerName: r.customer?.[1] || null };
        }),
        branches: [],
      },
    };
  });
  D.on('GET', /^\/api\/v1\/(admin|branch)\/gps\/trail\/([^/?]+)/, (req, m) => {
    const r = REPS.find((x) => x.repId === m[2]) || REPS[0];
    const now = Date.now();
    return { b: { points: Array.from({ length: 40 }, (_, i) => { const t = now - (40 - i) * 6 * 60e3; const [lat, lng] = pos(r, t); return { latitude: lat, longitude: lng, timestamp: new Date(t).toISOString() }; }) } };
  });
  D.on('GET', /^\/api\/v1\/(admin|branch)\/dashboard$/, () => ({ b: { repsActive: 2, pendingCustomers: 1, todayVisits: 7, todayGpsPings: 186 } }));
})();
