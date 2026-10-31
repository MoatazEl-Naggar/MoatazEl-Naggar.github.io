/* B2B ordering portal demo: an admin and a demo shop. The shop browses the real catalog, orders,
 * and the order appears for the admin, who can move it through its statuses. */
(function () {
  const D = window.DEMO;
  const F = D.fixtures.admin;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const ADMIN = { id: 1, contact_name: 'Admin', business_name: null, email: 'admin@portal.com', phone: '01000000000', role: 'admin', status: 'active' };
  const SHOP = { id: 900, contact_name: 'حسام علي', business_name: 'سوبر ماركت النور', email: 'shop@example.com', phone: '01011112222', role: 'customer', status: 'active' };
  const userFor = (role) => (role === 'admin' ? ADMIN : role === 'customer' ? SHOP : null);

  D.on('POST', /^\/api\/auth\/login$/, (req) => {
    const id = String(req.body?.identifier || '').toLowerCase();
    const role = id.startsWith('admin') ? 'admin' : 'customer';
    D.setRole(role);
    return { b: { success: true, accessToken: `demo-${role}`, user: userFor(role) } };
  });
  D.on('POST', /^\/api\/auth\/register$/, () => { D.setRole('customer'); return { s: 201, b: { success: true, message: 'تم إنشاء الحساب', accessToken: 'demo-customer', user: SHOP } }; });
  // A guest gets an empty session (a 401 here makes the app jump to /login outside the demo)
  D.on('POST', /^\/api\/auth\/refresh$/, () => (userFor(D.role) ? { b: { success: true, accessToken: `demo-${D.role}`, user: userFor(D.role) } } : { b: { success: false, accessToken: null, user: null } }));
  D.on('POST', /^\/api\/auth\/logout$/, () => { D.setRole('guest'); return { b: { success: true } }; });

  // Orders: recorded ones plus the ones placed during the visit
  const products = () => ((F['GET /api/products'] || { b: { data: [] } }).b.data || []);
  const placed = D.keep('placed', []);
  const recordedOrders = () => ((F['GET /api/admin/orders'] || { b: { data: [] } }).b.data || []);
  const withPatch = (o) => Object.assign(clone(o), D.state.patches.get(String(o.id)) || {});
  D.on('POST', /^\/api\/orders$/, (req) => {
    const items = (req.body?.items || []).map((i, n) => {
      const p = products().find((x) => String(x.id) === String(i.product_id)) || {};
      return { id: 9000 + placed.length * 50 + n, order_id: null, product_id: i.product_id, product_name: p.name || 'منتج', quantity: i.quantity, unit_price: p.price || '0' };
    });
    const id = 1000 + placed.length + 1;
    items.forEach((i) => { i.order_id = id; });
    const total = items.reduce((s, i) => s + Number(i.unit_price) * i.quantity, 0);
    const order = { id, customer_id: SHOP.id, total_amount: String(total), status: 'pending', admin_note: null, created_at: new Date().toISOString(), customer: { id: SHOP.id, business_name: SHOP.business_name, contact_name: SHOP.contact_name }, items };
    placed.unshift(order);
    return { s: 201, b: { success: true, data: order } };
  });
  D.on('GET', /^\/api\/orders\/my$/, () => ({ b: { success: true, data: placed.map(withPatch), pagination: { total: placed.length, page: 1, limit: 20, pages: 1 } } }));
  D.on('GET', /^\/api\/orders\/(\d+)$/, (req, m) => { const o = placed.find((x) => String(x.id) === m[1]); return o ? { b: { success: true, data: withPatch(o) } } : undefined; });
  D.on('GET', /^\/api\/admin\/orders$/, (req) => {
    let rows = [...placed, ...recordedOrders()].map(withPatch);
    if (req.query.status) rows = rows.filter((o) => o.status === req.query.status);
    return { b: { success: true, data: rows, pagination: { total: rows.length, page: 1, limit: 20, pages: 1 } } };
  });
  D.on('GET', /^\/api\/admin\/orders\/(\d+)$/, (req, m) => {
    const o = placed.find((x) => String(x.id) === m[1]);
    if (o) return { b: { success: true, data: { ...withPatch(o), customer: { ...o.customer, phone: SHOP.phone, email: SHOP.email } } } };
    const rec = F[`GET /api/admin/orders/${m[1]}`];
    return rec ? { b: Object.assign(clone(rec.b), { data: withPatch(rec.b.data) }) } : { s: 404, b: { success: false, message: 'الطلب غير موجود' } };
  });
  D.on('PATCH', /^\/api\/admin\/orders\/(\d+)\/(status|note)$/, (req, m) => {
    const fields = m[2] === 'status' ? { status: req.body.status } : { admin_note: req.body.note ?? req.body.admin_note };
    D.patch(m[1], fields);
    return { b: { success: true, data: { id: Number(m[1]), ...fields } } };
  });
  // Dashboard counts include the visit's orders
  D.on('GET', /^\/api\/admin\/dashboard$/, () => {
    const rec = clone((F['GET /api/admin/dashboard'] || { b: { data: {} } }).b);
    if (rec.data && placed.length) {
      for (const k of Object.keys(rec.data)) if (/orders|pending/i.test(k) && typeof rec.data[k] === 'number') rec.data[k] += placed.length;
    }
    return { b: rec };
  });
})();
