/* Clinic demo logic: the parts of the backend a visitor exercises, kept in memory for the visit.
 * Everything else is answered from the recorded data by the shared runtime. */
(function () {
  const D = window.DEMO;
  const F = D.fixtures;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const day = (iso) => String(iso || '').slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fixture = (key) => { for (const r of [D.role, 'owner', 'assistant', 'patient', 'guest']) if (F[r] && F[r][key]) return clone(F[r][key].b); return null; };

  // ── Reference data ──
  const roleUser = (id) => (D.roles.find((r) => r.id === id) || {}).storage?.user;
  const doctors = () => (fixture('GET /api/doctors') || { doctors: [] }).doctors;
  const doctorRef = (id) => { const d = doctors().find((x) => String(x._id) === String(id)) || doctors()[0]; return d && { _id: d._id, name: d.name, color: d.color, isOwner: d.isOwner, specialtyKey: d.specialtyKey }; };
  const createdPatients = D.keep('patients', []);
  const patients = () => [...createdPatients, ...((fixture('GET /api/patients') || { patients: [] }).patients)];
  const patientRef = (id) => { const p = patients().find((x) => String(x._id) === String(id)); return p ? { _id: p._id, name: p.name, phone: p.phone || null, email: p.email || null } : { _id: id, name: 'مريض' }; };

  // ── Appointments: one table for the visit ──
  const isAppt = (o) => o && o.time && o.status && o.date && o.patientId && typeof o.patientId === 'object' && o.doctorId && typeof o.doctorId === 'object';
  const table = new Map();
  D.allRecords(isAppt).forEach((a) => table.set(String(a._id), a));
  const newAppts = D.keep('appts', []);
  newAppts.forEach((a) => table.set(String(a._id), a));
  const current = (a) => Object.assign(clone(a), D.state.patches.get(String(a._id)) || {});
  const list = () => [...table.values()].map(current);
  const sortAppts = (arr) => arr.sort((a, b) => `${day(a.date)}${a.time}`.localeCompare(`${day(b.date)}${b.time}`));

  D.on('GET', /^\/api\/appointments\/?$/, (req) => {
    let rows = list();
    if (req.query.date) rows = rows.filter((a) => day(a.date) === req.query.date);
    if (req.query.doctorId === 'owner') rows = rows.filter((a) => a.doctorId?.isOwner);
    else if (req.query.doctorId) rows = rows.filter((a) => String(a.doctorId?._id) === req.query.doctorId);
    if (req.query.status) rows = rows.filter((a) => a.status === req.query.status);
    return { b: { appointments: sortAppts(rows) } };
  });
  D.on('GET', /^\/api\/appointments\/my$/, () => {
    const me = roleUser('patient');
    const recorded = fixture('GET /api/appointments/my') || { appointments: [] };
    const mine = list().filter((a) => a._mine).map((a) => ({ ...a, patientId: a.patientId._id, doctorId: a.doctorId._id }));
    return { b: { appointments: [...mine, ...recorded.appointments.map((a) => Object.assign(a, D.state.patches.get(String(a._id)) || {}))], me } };
  });

  const STATUS = { checkin: 'checked_in', complete: 'completed', noshow: 'no_show', accept: 'confirmed', reject: 'rejected', 'staff-cancel': 'cancelled', cancel: 'cancelled' };
  D.on('PATCH', /^\/api\/appointments\/([0-9a-z]+)\/(checkin|complete|noshow|accept|reject|staff-cancel|cancel)$/, (req, m) => {
    const status = STATUS[m[2]];
    const fields = { status };
    if (status === 'checked_in') fields.checkedInAt = nowIso();
    if (status === 'completed') fields.completedAt = nowIso();
    D.patch(m[1], fields);
    const a = table.get(m[1]);
    return { b: { message: 'تم تحديث حالة الموعد بنجاح', appointment: a ? current(a) : { _id: m[1], ...fields } } };
  });
  D.on('PATCH', /^\/api\/appointments\/([0-9a-z]+)\/reschedule$/, (req, m) => {
    const { date, time, doctorId } = req.body || {};
    D.patch(m[1], { date: `${date}T00:00:00.000Z`, time, ...(doctorId && { doctorId: doctorRef(doctorId) }) });
    const a = table.get(m[1]);
    return { b: { message: 'تم نقل الموعد', appointment: a ? current(a) : null } };
  });

  const newAppt = (fields) => {
    const a = {
      _id: D.newId(), status: 'confirmed', type: 'regular', source: 'walkin', createdBy: null, followUpOf: null,
      checkedInAt: null, completedAt: null, service: null, price: null, notes: '', createdAt: nowIso(), __v: 0, invoice: null, ...fields,
    };
    table.set(String(a._id), a);
    newAppts.push(a);
    return a;
  };
  D.on('POST', /^\/api\/appointments\/staff$/, (req) => {
    const b = req.body || {};
    const a = newAppt({ patientId: patientRef(b.patientId), doctorId: doctorRef(b.doctorId), date: `${b.date}T00:00:00.000Z`, time: b.time, service: b.service || null, source: b.source || 'walkin', notes: b.notes || '' });
    return { s: 201, b: { message: 'تم حجز الموعد', appointment: current(a) } };
  });
  const patientBooking = (req) => {
    const b = req.body || {};
    const me = roleUser('patient') || { _id: 'guest', name: b.name || 'مريض جديد' };
    const owner = doctors().find((d) => d.isOwner);
    const a = newAppt({ patientId: { _id: me._id || me.id, name: me.name, phone: me.phone || b.phone || null }, doctorId: doctorRef(owner?._id), date: `${b.date}T00:00:00.000Z`, time: b.time, service: b.service || null, status: 'pending', source: 'online', type: b.type || 'regular', notes: b.notes || '', _mine: true });
    return { s: 201, b: { message: 'تم إرسال طلب الحجز', appointment: { ...current(a), patientId: a.patientId._id, doctorId: a.doctorId._id } } };
  };
  D.on('POST', /^\/api\/appointments(\/followup)?$/, patientBooking);
  D.on('POST', /^\/api\/auth\/register-and-book$/, (req) => {
    D.setRole('patient');
    const r = patientBooking(req);
    return { s: 201, b: { ...r.b, accessToken: 'demo-token', refreshToken: 'demo-refresh', user: roleUser('patient') } };
  });

  // Free times: recorded, minus anything booked or moved there during the visit
  const taken = (doctorId, date) => new Set(list().filter((a) => day(a.date) === date && String(a.doctorId?._id) === String(doctorId) && !['cancelled', 'rejected'].includes(a.status)).map((a) => a.time));
  D.on('GET', /^\/api\/doctors\/([0-9a-z]+)\/slots$/, (req, m) => {
    const rec = fixture(`GET ${req.pathQ}`) || { date: req.query.date, slots: [] };
    const t = taken(m[1], req.query.date);
    return { b: { ...rec, slots: (rec.slots || []).filter((s) => !t.has(s)) } };
  });
  D.on('GET', /^\/api\/availability\/slots$/, (req) => {
    const rec = fixture(`GET ${req.pathQ}`) || { date: req.query.date, slots: [] };
    const owner = doctors().find((d) => d.isOwner);
    const t = owner ? taken(owner._id, req.query.date) : new Set();
    return { b: { ...rec, slots: (rec.slots || []).filter((s) => !t.has(s)) } };
  });

  // ── Billing ──
  const invoices = (() => { const o = D.keep('invoices', {}); return { get: (k) => o[k], set: (k, v) => { o[k] = v; }, has: (k) => k in o, values: () => Object.values(o) }; })();
  const payments = D.keep('payments', []);
  const allInvoices = () => {
    const rec = (fixture('GET /api/billing/invoices') || { invoices: [] }).invoices;
    return [...invoices.values(), ...rec];
  };
  const invoiceSummary = (inv) => ({ _id: inv._id, number: inv.number, status: inv.status, total: inv.total, paid: inv.paid });
  D.on('GET', /^\/api\/billing\/invoices$/, (req) => {
    let rows = allInvoices().map((i) => Object.assign(clone(i), D.state.patches.get(String(i._id)) || {}));
    if (req.query.patientId) rows = rows.filter((i) => String(i.patientId?._id || i.patientId) === req.query.patientId);
    return { b: { invoices: rows } };
  });
  D.on('GET', /^\/api\/billing\/invoices\/([0-9a-z]+)$/, (req, m) => {
    const created = invoices.get(m[1]);
    if (created) return { b: { invoice: created, payments: payments.filter((p) => String(p.invoiceId) === m[1]) } };
    const rec = fixture(`GET /api/billing/invoices/${m[1]}`);
    if (!rec) return { s: 404, b: { message: 'الفاتورة غير موجودة' } };
    rec.payments = [...(rec.payments || []), ...payments.filter((p) => String(p.invoiceId) === m[1])];
    return { b: rec };
  });
  D.on('POST', /^\/api\/billing\/invoices$/, (req) => {
    const b = req.body || {};
    const appt = b.appointmentId ? table.get(String(b.appointmentId)) : null;
    const items = (b.items || []).map((i) => ({ service: String(i.service || '').trim(), tooth: i.tooth || null, price: Number(i.price) || 0 }));
    if (!items.length) return { s: 400, b: { message: 'أضف بنداً واحداً على الأقل' } };
    const subtotal = items.reduce((s, i) => s + i.price, 0);
    const discount = Number(b.discount) || 0;
    const number = Math.max(0, ...allInvoices().map((i) => i.number || 0)) + 1;
    const total = subtotal - discount;
    const me = roleUser(D.role) || {};
    const inv = {
      _id: D.newId(), number, patientId: appt ? current(appt).patientId : patientRef(b.patientId), doctorId: appt ? current(appt).doctorId : doctorRef(b.doctorId),
      appointmentId: b.appointmentId || null, items, subtotal, discount, total, paid: 0, status: total === 0 ? 'paid' : 'unpaid',
      note: b.note || null, voidReason: null, voidedBy: null, voidedAt: null, createdBy: { _id: me._id || me.id, name: me.name }, createdAt: nowIso(), __v: 0,
    };
    invoices.set(String(inv._id), inv);
    if (appt) D.patch(appt._id, { invoice: invoiceSummary(inv) });
    return { s: 201, b: { message: 'تم إنشاء الفاتورة', invoice: inv } };
  });
  D.on('POST', /^\/api\/billing\/payments$/, (req) => {
    const b = req.body || {};
    const id = String(b.invoiceId);
    const inv = invoices.get(id) || Object.assign(clone(allInvoices().find((i) => String(i._id) === id) || {}), D.state.patches.get(id) || {});
    if (!inv._id) return { s: 404, b: { message: 'الفاتورة غير موجودة' } };
    const amount = Number(b.amount) || 0;
    const remaining = inv.total - inv.paid;
    if (amount <= 0 || amount > remaining + 0.001) return { s: 400, b: { message: 'المبلغ أكبر من المتبقي' } };
    const me = roleUser(D.role) || {};
    const p = { _id: D.newId(), invoiceId: inv._id, patientId: inv.patientId?._id, doctorId: inv.doctorId?._id, amount, method: 'cash', receivedBy: { _id: me._id || me.id, name: me.name }, note: b.note || null, voided: false, receivedAt: nowIso(), createdAt: nowIso(), _doctor: inv.doctorId, _patient: inv.patientId, _invoiceNumber: inv.number };
    payments.push(p);
    const paid = inv.paid + amount;
    const fields = { paid, status: paid >= inv.total ? 'paid' : 'partial' };
    if (invoices.has(id)) Object.assign(invoices.get(id), fields); else D.patch(id, fields);
    // the appointment's invoice badge follows
    const appt = list().find((a) => a.invoice && String(a.invoice._id) === id);
    if (appt) D.patch(appt._id, { invoice: { ...appt.invoice, ...fields } });
    return { s: 201, b: { message: 'تم تسجيل الدفعة', payment: p, invoice: { ...inv, ...fields } } };
  });
  // Cash day: today's payments taken during the visit are added
  D.on('GET', /^\/api\/cash\/day$/, (req) => {
    const date = req.query.date || todayKey();
    const rec = fixture(`GET /api/cash/day?date=${date}`) || { date, payments: [], expected: 0, byDoctor: [], close: null };
    if (date !== todayKey() || !payments.length) return { b: rec };
    const extra = payments.map((p) => ({ ...p, invoiceId: { _id: p.invoiceId, number: p._invoiceNumber }, patientId: p._patient, doctorId: p._doctor }));
    const byDoctor = clone(rec.byDoctor || []);
    payments.forEach((p) => {
      const row = byDoctor.find((r) => String(r.doctor?._id || r._id) === String(p.doctorId));
      if (row) { row.total = (row.total || 0) + p.amount; row.count = (row.count || 0) + 1; } else byDoctor.push({ doctor: p._doctor, total: p.amount, count: 1 });
    });
    return { b: { ...rec, payments: [...extra, ...(rec.payments || [])], expected: (rec.expected || 0) + payments.reduce((s, p) => s + p.amount, 0), byDoctor } };
  });

  // ── Patients ──
  D.on('POST', /^\/api\/patients$/, (req) => {
    const b = req.body || {};
    const p = { _id: D.newId(), name: b.name, phone: b.phone ? `+2${String(b.phone).replace(/^\+?2?/, '')}` : null, email: b.email || null, role: 'patient', createdAt: nowIso() };
    createdPatients.unshift(p);
    return { s: 201, b: { message: 'تم إضافة المريض', patient: p } };
  });
  D.on('GET', /^\/api\/patients$/, (req) => {
    let rows = patients();
    const q = (req.query.search || req.query.q || '').trim();
    if (q) rows = rows.filter((p) => (p.name || '').includes(q) || (p.phone || '').includes(q));
    return { b: { patients: rows } };
  });

  // ── Medical records ──
  const visits = D.keep('visits', []);
  const teeth = D.keep('teeth', []);
  D.on('GET', /^\/api\/records\/patients\/([0-9a-z]+)$/, (req, m) => {
    const rec = fixture(`GET /api/records/patients/${m[1]}`) || { history: null, teeth: [], visits: [], plans: [], attachments: [] };
    rec.visits = [...visits.filter((v) => String(v.patientId) === m[1]), ...(rec.visits || [])];
    const mineTeeth = teeth.filter((t) => t.patientId === m[1]);
    rec.teeth = [...(rec.teeth || []).filter((t) => !mineTeeth.some((x) => x.tooth === t.tooth)), ...mineTeeth.map(({ patientId, ...t }) => t)];
    return { b: rec };
  });
  D.on('POST', /^\/api\/records\/patients\/([0-9a-z]+)\/visits$/, (req, m) => {
    const b = req.body || {};
    const v = { _id: D.newId(), patientId: m[1], ...b, doctorId: doctorRef(b.doctorId), date: b.date || nowIso(), procedures: (b.procedures || []).filter((p) => p.name), createdAt: nowIso() };
    visits.unshift(v);
    return { s: 201, b: { message: 'تم حفظ الزيارة', visit: v } };
  });
  D.on('PATCH', /^\/api\/records\/visits\/([0-9a-z]+)$/, (req, m) => {
    const v = visits.find((x) => String(x._id) === m[1]);
    if (v) Object.assign(v, req.body || {}, { doctorId: doctorRef((req.body || {}).doctorId || v.doctorId?._id) });
    else D.patch(m[1], req.body || {});
    return { b: { message: 'تم تعديل الزيارة', visit: v || { _id: m[1], ...(req.body || {}) } } };
  });
  D.on('GET', /^\/api\/records\/visits\/([0-9a-z]+)$/, (req, m) => {
    const v = visits.find((x) => String(x._id) === m[1]);
    if (!v) return undefined; // recorded
    const rec = fixture(`GET /api/records/patients/${v.patientId}`) || {};
    return { b: { visit: { ...v, patientId: patientRef(v.patientId) }, history: rec.history || null } };
  });
  D.on('GET', /^\/api\/records\/appointments\/([0-9a-z]+)$/, (req, m) => {
    const a = table.get(m[1]);
    const rec = fixture(`GET /api/records/appointments/${m[1]}`);
    const visit = visits.find((v) => String(v.appointmentId) === m[1]) || rec?.visit || null;
    if (!a && !rec) return { s: 404, b: { message: 'الموعد غير موجود' } };
    const appt = a ? current(a) : rec.appointment;
    return { b: { appointment: { ...appt, doctorId: doctorRef(appt.doctorId?._id || appt.doctorId) }, visit } };
  });
  D.on('POST', /^\/api\/records\/patients\/([0-9a-z]+)\/teeth$/, (req, m) => {
    const t = { patientId: m[1], tooth: String(req.body.tooth), condition: req.body.condition, note: req.body.note || '', recordedAt: nowIso() };
    teeth.push(t);
    return { s: 201, b: { message: 'تم تحديث حالة السن', record: { _id: D.newId(), ...t } } };
  });

  // ── Settings that change what the visitor sees ──
  const settings = D.keep('settings', { clinicEdits: null, presets: null });
  D.on('GET', /^\/api\/clinic$/, () => {
    const rec = fixture('GET /api/clinic');
    if (rec && settings.clinicEdits) {
      const { brand, ...rest } = settings.clinicEdits;
      Object.assign(rec.clinic, rest);
      if (brand) { Object.assign(rec.clinic.brandSettings || (rec.clinic.brandSettings = {}), brand); Object.assign(rec.clinic.brand, Object.fromEntries(Object.entries(brand).filter(([, v]) => v !== ''))); }
      if (rest.clinicName) rec.clinic.brand.clinicName = rest.clinicName;
    }
    return { b: rec };
  });
  D.on('PUT', /^\/api\/clinic$/, (req) => {
    settings.clinicEdits = { ...(settings.clinicEdits || {}), ...(req.body || {}), brand: { ...(settings.clinicEdits?.brand || {}), ...((req.body || {}).brand || {}) } };
    return { b: { message: 'تم حفظ بيانات العيادة' } };
  });
  D.on('GET', /^\/api\/records\/presets$/, () => ({ b: { presets: settings.presets || (fixture('GET /api/records/presets') || { presets: {} }).presets } }));
  D.on('PUT', /^\/api\/records\/presets\/([a-z]+)$/, (req, m) => {
    settings.presets = { ...(settings.presets || (fixture('GET /api/records/presets') || { presets: {} }).presets) };
    if (req.body?.reset) { delete settings.presets[m[1]]; return { b: { message: 'تمت استعادة الاختيارات الافتراضية', presets: null } }; }
    const rx = (req.body.rx || []).filter((r) => r.line).map((r) => ({ label: r.label || r.line.split(' — ')[0].slice(0, 40), line: r.line }));
    settings.presets[m[1]] = { ...(settings.presets[m[1]] || {}), ...req.body, ...(req.body.rx && { rx }) };
    return { b: { message: 'تم حفظ الاختيارات', presets: settings.presets[m[1]] } };
  });

  // ── Sign in / out (any password works in the demo) ──
  const signInAs = (role) => {
    const r = D.roles.find((x) => x.id === role);
    D.setRole(role);
    return { b: { accessToken: r.storage.token, refreshToken: 'demo-refresh', user: r.storage.user } };
  };
  D.on('POST', /^\/api\/auth\/login$/, (req) => {
    const email = String(req.body?.email || '').toLowerCase();
    if (email.startsWith('assistant')) return signInAs('assistant');
    if (email.startsWith('dentist') || email.startsWith('owner') || email.startsWith('doctor')) return signInAs('owner');
    return signInAs('patient');
  });
  D.on('POST', /^\/api\/auth\/register$/, () => signInAs('patient'));
  D.on('POST', /^\/api\/auth\/refresh$/, () => ({ b: { accessToken: (D.roles.find((r) => r.id === D.role) || {}).storage?.token || 'demo' } }));
  D.on('POST', /^\/api\/auth\/logout$/, () => { D.setRole('guest'); return { b: { message: 'ok' } }; });
  D.on('GET', /^\/api\/notifications\//, () => ({ b: {} }));
  D.on('POST', /^\/api\/notifications\//, () => ({ b: {} }));
})();
