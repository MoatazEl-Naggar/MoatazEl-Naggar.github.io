/* Dewan demo: sign-in (any username and password) — everything else replays the recorded demo company.
 * Vouchers (سندات) work for the visit: save, edit, delete, post and reverse, with their effect on the
 * treasuries, customer and supplier balances, the dashboard, the review screen and the posting effect.
 * The changes are kept for the browser tab (sessionStorage) and cleared by Reset or closing the tab. */
(function () {
  const D = window.DEMO;
  const me = () => { const f = D.fixtures.admin && D.fixtures.admin['GET /api/auth/me']; return f ? f.b.data : { id: 1, username: 'admin', role: 'ADMIN' }; };
  D.on('POST', /^\/api\/auth\/login$/, () => { D.setRole('admin'); return { b: { success: true, data: { accessToken: 'demo-admin', user: me() } } }; });
  D.on('POST', /^\/api\/auth\/refresh$/, () => (D.role === 'admin' ? { b: { success: true, data: { accessToken: 'demo-admin' } } } : { s: 401, b: { success: false, message: 'Unauthorized' } }));
  D.on('POST', /^\/api\/auth\/logout$/, () => { D.setRole('guest'); return { b: { success: true } }; });
  D.on('GET', /^\/api\/auth\/me$/, () => ({ b: { success: true, data: me() } }));

  // ── Vouchers ──
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const fx = (pathQ) => { const f = D.findFixture('GET', pathQ); return f ? clone(f.b) : null; };
  const ok = (data) => ({ b: { success: true, data } });
  const fail = (message, s = 400) => ({ s, b: { success: false, message } });
  const round2 = (n) => Math.round(n * 100) / 100;

  const LABEL = { CASH_PAYMENT: 'صرف نقدي', CASH_RECEIPT: 'قبض نقدي', CHECK_RECEIPT: 'قبض شيك', CHECK_PAYMENT: 'صرف شيك' };
  const TREASURY_EFFECT = { CASH_RECEIPT: 1, CASH_PAYMENT: -1 };
  const INFLOW = { CASH_RECEIPT: true, CHECK_RECEIPT: true };

  const recorded = D.allRecords((v) => v.voucherNumber != null && LABEL[v.type] && 'amount' in v && 'treasuryId' in v);
  const recordedById = new Map(recorded.map((v) => [v.id, v]));
  const treasuries = (fx('/api/treasuries') || { data: [] }).data;
  const accounts = (fx('/api/accounts') || { data: [] }).data;
  const customers = (fx('/api/customers') || { data: [] }).data;
  const suppliers = (fx('/api/suppliers') || { data: [] }).data;
  const accountByKey = (k) => accounts.find((a) => a.systemKey === k);
  const accName = (a) => (a ? `${a.code} ${a.name}` : '');
  const entryNumbers = D.allRecords((o) => o.entryNumber != null).map((o) => o.entryNumber);

  const st = D.keep('vouchers', {
    created: [], changes: {}, deleted: [], entries: {},
    nextId: Math.max(0, ...recorded.map((v) => v.id)) + 1,
    nextEntry: Math.max(0, ...entryNumbers) + 1,
    numbers: {}, treasury: {}, customer: {}, supplier: {},
  });
  const nextNumber = (type) => {
    if (!st.numbers[type]) st.numbers[type] = Math.max(0, ...recorded.filter((v) => v.type === type).map((v) => v.voucherNumber));
    return ++st.numbers[type];
  };

  const decorate = (v) => {
    const t = treasuries.find((x) => x.id === v.treasuryId);
    const c = v.partyType === 'CUSTOMER' ? customers.find((x) => x.id === v.partyId) : null;
    const s = v.partyType === 'SUPPLIER' ? suppliers.find((x) => x.id === v.partyId) : null;
    const a = v.accountId ? accounts.find((x) => x.id === v.accountId) : null;
    let treasury = null;
    if (t) { treasury = { ...clone(t), balance: 0 }; delete treasury.account; }
    return {
      ...v,
      treasury,
      account: a ? { id: a.id, code: a.code, name: a.name } : null,
      customer: c ? { id: c.id, name: c.name } : null,
      supplier: s ? { id: s.id, name: s.name } : null,
    };
  };
  const isCreated = (id) => st.created.some((v) => v.id === id);
  const getVoucher = (id) => {
    if (st.deleted.includes(id)) return null;
    const c = st.created.find((v) => v.id === id);
    if (c) return decorate(c);
    const r = recordedById.get(id);
    return r ? decorate({ ...r, ...(st.changes[id] || {}) }) : null;
  };
  const allVouchers = () => [
    ...st.created.map(decorate).sort((a, b) => b.id - a.id),
    ...recorded.filter((v) => !st.deleted.includes(v.id)).map((v) => decorate({ ...v, ...(st.changes[v.id] || {}) })),
  ];
  const touched = () => allVouchers().filter((v) => isCreated(v.id) || st.changes[v.id]);

  const clean = (b) => {
    const o = {};
    for (const k of ['date', 'amount', 'treasuryId', 'partyType', 'partyId', 'accountId', 'checkNumber', 'checkDate', 'bankName', 'notes']) if (b && k in b) o[k] = b[k];
    for (const k of ['amount', 'treasuryId', 'partyId', 'accountId']) if (k in o) o[k] = o[k] === '' || o[k] == null ? null : Number(o[k]);
    for (const k of ['checkNumber', 'checkDate', 'bankName', 'notes', 'partyType']) if (k in o && o[k] === '') o[k] = null;
    if ('partyType' in o) {
      if (!o.partyType || o.partyType === 'OTHER') o.partyId = null;
      if (o.partyType !== 'OTHER') o.accountId = null;
    }
    return o;
  };

  // The journal lines a voucher makes when posted (the same accounts the server uses)
  const linesOf = (v) => {
    const party = (v.customer && v.customer.name) || (v.supplier && v.supplier.name) || null;
    const counter = v.partyType === 'CUSTOMER' ? accName(accountByKey('RECEIVABLES'))
      : v.partyType === 'SUPPLIER' ? accName(accountByKey('PAYABLES')) : v.account ? `${v.account.code} ${v.account.name}` : '';
    const treasuryAcc = v.treasury ? accName(accounts.find((a) => a.id === v.treasury.accountId)) || v.treasury.name : '';
    const money = v.type === 'CHECK_RECEIPT' ? accName(accountByKey('NOTES_RECEIVABLE')) : v.type === 'CHECK_PAYMENT' ? accName(accountByKey('NOTES_PAYABLE')) : treasuryAcc;
    const moneyLine = { account: money, party: null };
    const counterLine = { account: counter, party };
    return INFLOW[v.type]
      ? [{ ...moneyLine, debit: v.amount, credit: 0 }, { ...counterLine, debit: 0, credit: v.amount }]
      : [{ ...counterLine, debit: v.amount, credit: 0 }, { ...moneyLine, debit: 0, credit: v.amount }];
  };
  const describe = (v) => `سند ${LABEL[v.type]} رقم ${v.voucherNumber}${v.notes ? ` — ${v.notes}` : v.checkNumber ? ` — شيك ${v.checkNumber}` : ''}`;

  // Post (+1) or reverse (−1): move the treasury and the party balance
  const applyEffect = (v, sign) => {
    const amt = Number(v.amount) * sign;
    const t = TREASURY_EFFECT[v.type];
    if (t && v.treasuryId) st.treasury[v.treasuryId] = round2((st.treasury[v.treasuryId] || 0) + t * amt);
    if (v.partyType === 'CUSTOMER' && v.partyId) st.customer[v.partyId] = round2((st.customer[v.partyId] || 0) + (INFLOW[v.type] ? -amt : amt));
    if (v.partyType === 'SUPPLIER' && v.partyId) st.supplier[v.partyId] = round2((st.supplier[v.partyId] || 0) + (INFLOW[v.type] ? amt : -amt));
  };
  const now = () => new Date().toISOString();
  const setStatus = (v, status) => {
    if (isCreated(v.id)) Object.assign(st.created.find((x) => x.id === v.id), { status, updatedAt: now() });
    else st.changes[v.id] = { ...(st.changes[v.id] || {}), status, updatedAt: now() };
  };
  const postOne = (id) => {
    const v = getVoucher(id);
    if (!v) return 'السند غير موجود';
    if (v.status !== 'DRAFT') return 'السند مرحل بالفعل';
    applyEffect(v, 1);
    st.entries[id] = [{ id: st.nextEntry, entryNumber: st.nextEntry, date: v.date, description: describe(v), sourceType: 'VOUCHER', reversalOf: null, lines: linesOf(v) }];
    st.nextEntry++;
    setStatus(v, 'POSTED');
    return null;
  };
  const reverseOne = (id) => {
    const v = getVoucher(id);
    if (!v) return 'السند غير موجود';
    if (v.status !== 'POSTED') return 'لا يمكن عكس سند غير مرحل';
    applyEffect(v, -1);
    const base = st.entries[id] || (fx(`/api/posting-effect?doc=voucher&id=${id}`) || { data: { entries: [] } }).data.entries;
    const orig = base.find((e) => !e.reversalOf) || base[0];
    const rev = orig && {
      id: st.nextEntry, entryNumber: st.nextEntry, date: now(), description: `عكس ${orig.description || describe(v)}`, sourceType: 'VOUCHER_REVERSAL', reversalOf: orig.entryNumber,
      lines: orig.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
    };
    st.nextEntry++;
    st.entries[id] = rev ? [...base, rev] : base;
    setStatus(v, 'REVERSED');
    return null;
  };

  D.on('GET', /^\/api\/vouchers$/, (req) => {
    const { type } = req.query;
    return ok(allVouchers().filter((v) => !type || v.type === type));
  });
  D.on('GET', /^\/api\/vouchers\/(\d+)$/, (req, m) => { const v = getVoucher(+m[1]); return v ? ok(v) : fail('السند غير موجود', 404); });
  D.on('POST', /^\/api\/vouchers$/, (req) => {
    const b = req.body || {};
    if (!LABEL[b.type]) return undefined;
    const v = { id: st.nextId++, voucherNumber: nextNumber(b.type), type: b.type, amount: 0, treasuryId: null, accountId: null, partyType: null, partyId: null, checkNumber: null, checkDate: null, bankName: null, notes: null, ...clean(b), status: 'DRAFT', createdBy: me().id, createdAt: now(), updatedAt: now() };
    if (!v.date) v.date = now();
    st.created.push(v);
    return ok(decorate(v));
  });
  D.on('PUT', /^\/api\/vouchers\/(\d+)$/, (req, m) => {
    const id = +m[1]; const v = getVoucher(id);
    if (!v) return fail('السند غير موجود', 404);
    if (v.status !== 'DRAFT') return fail('لا يمكن تعديل سند مرحل أو معكوس');
    const fields = { ...clean(req.body), updatedAt: now() };
    if (isCreated(id)) Object.assign(st.created.find((x) => x.id === id), fields);
    else st.changes[id] = { ...(st.changes[id] || {}), ...fields };
    return ok(getVoucher(id));
  });
  D.on('DELETE', /^\/api\/vouchers\/(\d+)$/, (req, m) => {
    const id = +m[1]; const v = getVoucher(id);
    if (!v) return fail('السند غير موجود', 404);
    if (v.status !== 'DRAFT') return fail('لا يمكن حذف سند مرحل أو معكوس');
    if (isCreated(id)) st.created = st.created.filter((x) => x.id !== id); else st.deleted.push(id);
    return ok({ id });
  });
  D.on('POST', /^\/api\/vouchers\/(\d+)\/post$/, (req, m) => { const e = postOne(+m[1]); return e ? fail(e) : ok(getVoucher(+m[1])); });
  D.on('POST', /^\/api\/vouchers\/(\d+)\/reverse$/, (req, m) => { const e = reverseOne(+m[1]); return e ? fail(e) : ok(getVoucher(+m[1])); });
  D.on('GET', /^\/api\/posting-effect$/, (req) => {
    if (req.query.doc !== 'voucher') return undefined;
    const id = +req.query.id;
    if (!st.entries[id]) return undefined;
    const v = getVoucher(id);
    return ok({ reversed: !!v && v.status === 'REVERSED', stock: [], entries: st.entries[id] });
  });

  // Review and posting screen (vouchers tab)
  const inRange = (v, q) => { const d = String(v.date).slice(0, 10); return (!q.dateFrom || d >= q.dateFrom) && (!q.dateTo || d <= q.dateTo); };
  D.on('GET', /^\/api\/review\/vouchers$/, (req) => {
    const status = req.query.status || 'DRAFT';
    const base = (fx(req.pathQ) || { data: [] }).data;
    const mine = touched();
    const ids = new Set(mine.map((v) => v.id));
    return ok([...mine.filter((v) => v.status === status && inRange(v, req.query)), ...base.filter((r) => !ids.has(r.id) && !st.deleted.includes(r.id))]);
  });
  D.on('GET', /^\/api\/review\/counts$/, (req) => {
    if (req.query.type !== 'vouchers') return undefined;
    const counts = { DRAFT: 0, POSTED: 0, REVERSED: 0, ...((fx(req.pathQ) || { data: {} }).data) };
    for (const v of touched()) {
      if (!inRange(v, req.query)) continue;
      const r = recordedById.get(v.id);
      if (r) counts[r.status] = Math.max(0, (counts[r.status] || 0) - 1);
      counts[v.status] = (counts[v.status] || 0) + 1;
    }
    for (const id of st.deleted) { const r = recordedById.get(id); if (r && inRange(r, req.query)) counts[r.status] = Math.max(0, counts[r.status] - 1); }
    return ok(counts);
  });
  D.on('POST', /^\/api\/review\/(post|reverse)-batch$/, (req, m) => {
    const b = req.body || {};
    if (b.type !== 'vouchers') return undefined;
    const failed = [];
    let n = 0;
    for (const id of b.ids || []) { const e = (m[1] === 'post' ? postOne : reverseOne)(+id); if (e) failed.push({ id, message: e }); else n++; }
    return ok(m[1] === 'post' ? { posted: n, failed } : { reversed: n, failed });
  });

  // Balances that vouchers move
  const withTreasury = (t) => ({ ...t, balance: round2(t.balance + (st.treasury[t.id] || 0)) });
  D.on('GET', /^\/api\/treasuries$/, (req) => {
    const b = fx(req.pathQ);
    if (!b) return undefined;
    b.data = b.data.map(withTreasury);
    return { b };
  });
  D.on('GET', /^\/api\/(customers|suppliers)$/, (req, m) => {
    const b = fx(req.pathQ);
    if (!b || !Array.isArray(b.data)) return undefined;
    const d = st[m[1] === 'customers' ? 'customer' : 'supplier'];
    b.data = b.data.map((p) => (d[p.id] ? { ...p, balance: round2((p.balance || 0) + d[p.id]) } : p));
    return { b };
  });
  D.on('GET', /^\/api\/dashboard\/summary$/, (req) => {
    const b = fx(req.pathQ);
    if (!b) return undefined;
    const d = b.data;
    const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
    d.cash.treasuries = d.cash.treasuries.map(withTreasury);
    d.cash.total = round2(d.cash.treasuries.reduce((s, t) => s + t.balance, 0));
    d.receivables = round2(d.receivables + sum(st.customer));
    d.payables = round2(d.payables + sum(st.supplier));
    d.pending.vouchers = allVouchers().filter((v) => v.status === 'DRAFT').length;
    return { b };
  });
})();
