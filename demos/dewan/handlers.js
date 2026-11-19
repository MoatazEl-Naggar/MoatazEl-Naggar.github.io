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

  // ── Commercial documents (invoices): save moves stock, posting writes the journal entry ──
  const DIRECTION = { PURCHASE: 1, PURCHASE_RETURN: -1, SALE: -1, SALE_RETURN: 1, STOCK_INCREASE: 1, STOCK_DECREASE: -1, STOCK_ADJUSTMENT: 0, DAMAGE: -1, LOST: -1, VEHICLE_LOAD: -1, VEHICLE_SALE: -1, VEHICLE_RETURN: 1, VEHICLE_SETTLEMENT: -1 };
  const ROLE = { SALE: 'SALES', VEHICLE_SALE: 'SALES', SALE_RETURN: 'SALES_RETURN', VEHICLE_RETURN: 'SALES_RETURN', PURCHASE: 'PURCHASES', PURCHASE_RETURN: 'PURCHASE_RETURN' };
  const GENERAL_KEY = { SALES: 'SALES_GENERAL', SALES_RETURN: 'SALES_RETURN_GENERAL', PURCHASES: 'PURCHASES_GENERAL', PURCHASE_RETURN: 'PURCHASE_RETURN_GENERAL' };
  const CAT_DEBIT = { SALES: false, SALES_RETURN: true, PURCHASES: true, PURCHASE_RETURN: false };
  const INV_LABEL = { SALE: 'فاتورة مبيعات', VEHICLE_SALE: 'فاتورة مبيعات سيارة', SALE_RETURN: 'مردودات مبيعات', PURCHASE: 'فاتورة مشتريات', PURCHASE_RETURN: 'مردودات مشتريات', VEHICLE_RETURN: 'مرتجعات سيارة' };
  const SALE_TYPES = ['SALE', 'VEHICLE_SALE'];
  const round4 = (n) => Math.round(n * 10000) / 10000;
  const clampPct = (n) => Math.min(Math.max(+n || 0, 0), 100);

  const recordedInv = ((fx('/api/invoices?limit=5000') || { data: [] }).data);
  const recordedInvById = new Map(recordedInv.map((i) => [i.id, i]));
  const items = (fx('/api/items?limit=5000&includeInactive=true') || fx('/api/items?limit=5000') || { data: [] }).data;
  const warehouses = (fx('/api/warehouses') || { data: [] }).data;
  const salesReps = (fx('/api/sales-reps') || { data: [] }).data;
  const baseBalances = (fx('/api/inventory/balances') || { data: [] }).data;
  const lineIds = recordedInv.flatMap((i) => (i.lines || []).map((l) => l.id));

  const inv = D.keep('invoices', {
    created: [], changes: {}, deleted: [], entries: {}, stock: {}, avg: {},
    nextId: Math.max(0, ...recordedInv.map((i) => i.id)) + 1,
    nextLine: Math.max(0, ...lineIds) + 1,
    numbers: {},
  });
  const key = (itemId, wh) => `${itemId}:${wh}`;
  const baseQty = (itemId, wh) => { const b = baseBalances.find((x) => x.itemId === itemId && x.warehouseId === wh); return b ? b.quantity : 0; };
  const qtyOf = (itemId, wh) => round4(baseQty(itemId, wh) + (inv.stock[key(itemId, wh)] || 0));
  const totalQty = (itemId) => { const whs = new Set([...baseBalances.filter((b) => b.itemId === itemId).map((b) => b.warehouseId), ...Object.keys(inv.stock).filter((k) => k.startsWith(`${itemId}:`)).map((k) => +k.split(':')[1])]); let s = 0; whs.forEach((w) => { s += qtyOf(itemId, w); }); return s; };
  const avgOf = (itemId) => (itemId in inv.avg ? inv.avg[itemId] : (items.find((i) => i.id === itemId) || {}).avgCost || 0);
  const moveStock = (itemId, wh, delta) => { if (!delta) return; inv.stock[key(itemId, wh)] = round4((inv.stock[key(itemId, wh)] || 0) + delta); };
  const nextInvNumber = (type) => {
    if (!inv.numbers[type]) inv.numbers[type] = Math.max(0, ...recordedInv.filter((i) => i.type === type).map((i) => i.invoiceNumber));
    return ++inv.numbers[type];
  };

  // computeInvoiceTotals, as on the server
  const totalsOf = (lines, invoiceDiscount) => {
    const base = lines.map((l) => {
      const quantity = +l.quantity; const unitPrice = +l.unitPrice;
      const discountPercent = clampPct(l.discountPercent); const taxRate = clampPct(l.taxRate);
      return { itemId: +l.itemId, quantity, unitPrice, discountPercent, taxRate, totalPrice: round2(quantity * unitPrice * (1 - discountPercent / 100)) };
    });
    const subtotal = round2(base.reduce((s, l) => s + l.totalPrice, 0));
    const discountAmount = round2(Math.min(Math.max(+invoiceDiscount || 0, 0), subtotal));
    let allocated = 0;
    const withNet = base.map((l, i) => {
      const share = i === base.length - 1 ? round2(discountAmount - allocated) : subtotal ? round2((discountAmount * l.totalPrice) / subtotal) : 0;
      allocated = round2(allocated + share);
      const netAmount = round2(l.totalPrice - share);
      return { ...l, netAmount, taxAmount: round2((netAmount * l.taxRate) / 100) };
    });
    const taxAmount = round2(withNet.reduce((s, l) => s + l.taxAmount, 0));
    return { lines: withNet, subtotal, discountAmount, taxAmount, totalAmount: round2(subtotal - discountAmount + taxAmount) };
  };

  const itemOf = (id) => { const it = items.find((x) => x.id === id); if (!it) return null; const o = { ...it }; delete o.category; delete o.subCategory; delete o.supplier; delete o.dispensingWarehouse; return o; };
  const decorateInv = (i) => {
    const wh = (id) => warehouses.find((w) => w.id === id) || null;
    const t = i.targetWarehouseId ? wh(i.targetWarehouseId) : null;
    return {
      ...i,
      supplier: i.supplierId ? suppliers.find((s) => s.id === i.supplierId) || null : null,
      customer: i.customerId ? customers.find((c) => c.id === i.customerId) || null : null,
      salesRep: i.salesRepId ? salesReps.find((r) => r.id === i.salesRepId) || null : null,
      warehouse: wh(i.warehouseId),
      targetWarehouse: t ? { id: t.id, name: t.name } : null,
      lines: (i.lines || []).map((l) => ({ ...l, item: l.item || itemOf(l.itemId) })),
    };
  };
  const isNewInv = (id) => inv.created.some((i) => i.id === id);
  const rawInv = (id) => {
    if (inv.deleted.includes(id)) return null;
    const c = inv.created.find((i) => i.id === id);
    if (c) return c;
    const r = recordedInvById.get(id);
    return r ? clone({ ...r, ...(inv.changes[id] || {}) }) : null;
  };
  const getInv = (id) => { const r = rawInv(id); return r ? decorateInv(r) : null; };
  const byDateDesc = (a, b) => (String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  const allInv = () => [...inv.created, ...recordedInv.filter((i) => !inv.deleted.includes(i.id)).map((i) => ({ ...i, ...(inv.changes[i.id] || {}) }))].sort(byDateDesc);
  const touchedInv = () => allInv().filter((i) => isNewInv(i.id) || inv.changes[i.id]);
  const itemName = (id) => (items.find((x) => x.id === id) || {}).name || '';
  const whName = (id) => (warehouses.find((w) => w.id === id) || {}).name || '';

  // Stock on save (applyInvoiceStock); returns an error message or null
  const applyInvStock = (i) => {
    const isMove = i.type === 'VEHICLE_LOAD' || i.type === 'VEHICLE_SETTLEMENT';
    if (isMove && (!i.targetWarehouseId || i.targetWarehouseId === i.warehouseId)) return i.type === 'VEHICLE_LOAD' ? 'حدد مخزن السيارة المحمّل إليه' : 'حدد المخزن الذي تُفرّغ إليه السيارة';
    const deltas = new Map();
    if (i.type === 'STOCK_ADJUSTMENT') {
      const counted = new Map(); i.lines.forEach((l) => counted.set(l.itemId, (counted.get(l.itemId) || 0) + l.quantity));
      const seen = new Set();
      i.lines.forEach((l) => { if (seen.has(l.itemId)) { deltas.set(l.id, 0); return; } seen.add(l.itemId); deltas.set(l.id, round4(counted.get(l.itemId) - qtyOf(l.itemId, i.warehouseId))); });
    } else i.lines.forEach((l) => deltas.set(l.id, l.quantity * (DIRECTION[i.type] || 0)));
    const perItem = new Map(); i.lines.forEach((l) => perItem.set(l.itemId, (perItem.get(l.itemId) || 0) + deltas.get(l.id)));
    for (const [itemId, d] of perItem) {
      if (d < 0 && qtyOf(itemId, i.warehouseId) + d < -0.000001) return `الكمية غير كافية للصنف "${itemName(itemId)}" في ${whName(i.warehouseId)}: المتاح ${qtyOf(itemId, i.warehouseId)} والمطلوب ${-d}`;
      if (isMove && d > 0 && qtyOf(itemId, i.targetWarehouseId) - d < -0.000001) return `الكمية غير كافية للصنف "${itemName(itemId)}" في ${whName(i.targetWarehouseId)}: المتاح ${qtyOf(itemId, i.targetWarehouseId)} والمطلوب ${d}`;
    }
    const setsCost = i.type === 'PURCHASE' || i.isOpening;
    i.lines.forEach((l) => {
      let unitCost = avgOf(l.itemId);
      if (setsCost && l.quantity > 0) {
        unitCost = i.isOpening ? l.unitPrice : l.netAmount / l.quantity;
        const onHand = Math.max(totalQty(l.itemId), 0);
        inv.avg[l.itemId] = round4((onHand * avgOf(l.itemId) + l.quantity * unitCost) / (onHand + l.quantity));
      }
      l.stockDelta = deltas.get(l.id); l.unitCost = round4(unitCost);
    });
    for (const [itemId, d] of perItem) { moveStock(itemId, i.warehouseId, d); if (isMove) moveStock(itemId, i.targetWarehouseId, -d); }
    return null;
  };
  const undoInvStock = (i, clear) => {
    const lines = (i.lines || []).filter((l) => l.stockDelta != null);
    if (i.type === 'PURCHASE' || i.isOpening) lines.forEach((l) => {
      if (!(l.quantity > 0) || l.unitCost == null) return;
      const onHand = totalQty(l.itemId); const remaining = onHand - l.quantity;
      if (remaining > 0) inv.avg[l.itemId] = round4((onHand * avgOf(l.itemId) - l.quantity * l.unitCost) / remaining);
    });
    lines.forEach((l) => { moveStock(l.itemId, i.warehouseId, -l.stockDelta); if (i.targetWarehouseId) moveStock(l.itemId, i.targetWarehouseId, l.stockDelta); });
    if (clear) (i.lines || []).forEach((l) => { l.stockDelta = null; l.unitCost = null; });
  };

  const buildInvoice = (b, base) => {
    const t = totalsOf(b.lines || [], b.discountAmount);
    return {
      ...base,
      date: b.date ? new Date(b.date).toISOString() : base.date || now(),
      warehouseId: +b.warehouseId, supplierId: b.supplierId ? +b.supplierId : null, customerId: b.customerId ? +b.customerId : null,
      salesRepId: b.salesRepId ? +b.salesRepId : null, paymentType: b.paymentType || 'CASH', priceListId: b.priceListId ? +b.priceListId : null,
      treasuryId: b.treasuryId ? +b.treasuryId : null, targetWarehouseId: b.targetWarehouseId ? +b.targetWarehouseId : null, notes: b.notes || null,
      subtotal: t.subtotal, discountAmount: t.discountAmount, taxAmount: t.taxAmount, totalAmount: t.totalAmount, updatedAt: now(),
      lines: t.lines.map((l) => ({ id: inv.nextLine++, invoiceId: base.id, ...l, unitCost: null, stockDelta: null })),
    };
  };
  const invError = (b) => {
    if (!b.lines || !b.lines.length) return 'أضف صنفاً واحداً على الأقل';
    const w = warehouses.find((x) => x.id === +b.warehouseId);
    if (!w || w.isActive === false) return 'المخزن موقوف أو غير موجود';
    return null;
  };

  D.on('GET', /^\/api\/invoices$/, (req) => {
    const q = req.query;
    let rows = allInv();
    if (q.type) rows = rows.filter((i) => i.type === q.type);
    if (q.status) rows = rows.filter((i) => i.status === q.status);
    for (const k of ['supplierId', 'customerId', 'salesRepId']) if (q[k]) rows = rows.filter((i) => i[k] === +q[k]);
    if (q.dateFrom) rows = rows.filter((i) => new Date(i.date) >= new Date(q.dateFrom));
    if (q.dateTo) rows = rows.filter((i) => new Date(i.date) <= new Date(q.dateTo));
    rows = rows.slice(0, +(q.limit || 50)).map(decorateInv);
    return { b: { success: true, data: rows, pagination: { page: 1, limit: +(q.limit || 50), total: rows.length } } };
  });
  D.on('GET', /^\/api\/invoices\/(\d+)$/, (req, m) => { const i = getInv(+m[1]); return i ? ok(i) : fail('الفاتورة غير موجودة', 404); });
  D.on('POST', /^\/api\/invoices$/, (req) => {
    const b = req.body || {};
    if (!(b.type in DIRECTION)) return undefined;
    const e = invError(b); if (e) return fail(e);
    const id = inv.nextId;
    const i = buildInvoice(b, { id, type: b.type, invoiceNumber: 0, isOpening: false, status: 'DRAFT', createdBy: me().id, createdAt: now() });
    const saved = clone({ stock: inv.stock, avg: inv.avg });
    const err = applyInvStock(i); if (err) { Object.assign(inv, saved); return fail(err); }
    inv.nextId++; i.invoiceNumber = nextInvNumber(b.type);
    inv.created.push(i);
    return ok(getInv(id));
  });
  D.on('PUT', /^\/api\/invoices\/(\d+)$/, (req, m) => {
    const id = +m[1]; const cur = rawInv(id);
    if (!cur) return fail('الفاتورة غير موجودة', 404);
    if (cur.status !== 'DRAFT') return fail('لا يمكن تعديل فاتورة مرحلة');
    const b = req.body || {};
    const e = invError(b); if (e) return fail(e);
    const saved = clone({ stock: inv.stock, avg: inv.avg, nextLine: inv.nextLine });
    const work = clone(cur);
    undoInvStock(work, true);
    const next = buildInvoice(b, { ...work, lines: undefined });
    const err = applyInvStock(next);
    if (err) { Object.assign(inv, saved); return fail(err); }
    if (isNewInv(id)) inv.created = inv.created.map((x) => (x.id === id ? next : x)); else inv.changes[id] = next;
    return ok(getInv(id));
  });
  D.on('DELETE', /^\/api\/invoices\/(\d+)$/, (req, m) => {
    const id = +m[1]; const cur = rawInv(id);
    if (!cur) return fail('الفاتورة غير موجودة', 404);
    if (cur.status !== 'DRAFT') return fail('لا يمكن حذف فاتورة مرحلة');
    undoInvStock(cur, true);
    if (isNewInv(id)) inv.created = inv.created.filter((x) => x.id !== id); else { delete inv.changes[id]; inv.deleted.push(id); }
    return ok({ id });
  });

  // Journal entry and balances when posting (createInvoiceJournal)
  const catAccount = (item, role) => {
    const catId = item && (item.subCategoryId || item.categoryId);
    return (catId && accounts.find((a) => a.categoryId === catId && a.categoryRole === role && !a.isGroup)) || accountByKey(GENERAL_KEY[role]);
  };
  const invEntryLines = (i) => {
    const role = ROLE[i.type];
    if (!role) return null;
    const amounts = new Map();
    i.lines.forEach((l) => { const a = catAccount(items.find((x) => x.id === l.itemId), role); const k = accName(a); amounts.set(k, (amounts.get(k) || 0) + l.netAmount); });
    const tax = round2(i.lines.reduce((s, l) => s + l.taxAmount, 0));
    const net = round2([...amounts.values()].reduce((s, v) => s + v, 0));
    const total = round2(net + tax);
    if (!total) return null;
    const isSale = role === 'SALES' || role === 'SALES_RETURN';
    const debit = CAT_DEBIT[role];
    let party;
    if (i.paymentType === 'CASH') {
      const t = treasuries.find((x) => x.id === i.treasuryId) || treasuries.find((x) => x.kind === 'CASH') || treasuries[0];
      party = { account: accName(accounts.find((a) => a.id === (t && t.accountId))), party: null };
    } else if (isSale) party = { account: accName(accountByKey('RECEIVABLES')), party: (customers.find((c) => c.id === i.customerId) || {}).name || null };
    else party = { account: accName(accountByKey('PAYABLES')), party: (suppliers.find((s) => s.id === i.supplierId) || {}).name || null };
    return [
      ...[...amounts].map(([account, amt]) => ({ account, party: null, debit: debit ? round2(amt) : 0, credit: debit ? 0 : round2(amt) })),
      ...(tax ? [{ account: accName(accountByKey(isSale ? 'VAT_OUTPUT' : 'VAT_INPUT')), party: null, debit: debit ? tax : 0, credit: debit ? 0 : tax }] : []),
      { ...party, debit: debit ? 0 : total, credit: debit ? total : 0 },
    ];
  };
  const invMoney = (i, sign) => {
    const role = ROLE[i.type];
    if (!role) return;
    const amt = i.totalAmount * sign;
    const into = role === 'SALES' || role === 'PURCHASE_RETURN' ? 1 : -1; // money in for sales and purchase returns
    if (i.paymentType === 'CASH') {
      const t = treasuries.find((x) => x.id === i.treasuryId) || treasuries.find((x) => x.kind === 'CASH') || treasuries[0];
      if (t) st.treasury[t.id] = round2((st.treasury[t.id] || 0) + into * amt);
    } else if (role === 'SALES' || role === 'SALES_RETURN') { if (i.customerId) st.customer[i.customerId] = round2((st.customer[i.customerId] || 0) + into * amt); }
    else if (i.supplierId) st.supplier[i.supplierId] = round2((st.supplier[i.supplierId] || 0) - into * amt);
  };
  const setInvStatus = (id, status) => {
    if (isNewInv(id)) Object.assign(inv.created.find((x) => x.id === id), { status, updatedAt: now() });
    else inv.changes[id] = { ...(inv.changes[id] || {}), status, updatedAt: now() };
  };
  const postInv = (id) => {
    const i = rawInv(id);
    if (!i) return 'الفاتورة غير موجودة';
    if (i.status !== 'DRAFT') return `الفاتورة رقم ${i.invoiceNumber} ليست مسودة`;
    if (!i.lines || !i.lines.length) return `الفاتورة رقم ${i.invoiceNumber} لا تحتوي على أصناف`;
    if (i.lines.some((l) => l.stockDelta == null)) {
      const copy = clone(i); const e = applyInvStock(copy); if (e) return e;
      if (isNewInv(id)) inv.created = inv.created.map((x) => (x.id === id ? copy : x)); else inv.changes[id] = { ...(inv.changes[id] || {}), lines: copy.lines };
    }
    const lines = invEntryLines(rawInv(id));
    inv.entries[id] = lines ? [{ id: st.nextEntry, entryNumber: st.nextEntry, date: i.date, description: `${INV_LABEL[i.type]} رقم ${i.invoiceNumber}`, sourceType: 'INVOICE', reversalOf: null, lines }] : [];
    if (lines) st.nextEntry++;
    invMoney(i, 1);
    setInvStatus(id, 'POSTED');
    return null;
  };
  const reverseInv = (id) => {
    const i = rawInv(id);
    if (!i) return 'الفاتورة غير موجودة';
    if (i.status !== 'POSTED') return 'لا يمكن عكس مستند غير مرحل';
    undoInvStock(i, false);
    if (!isNewInv(id)) inv.changes[id] = { ...(inv.changes[id] || {}), lines: i.lines };
    const base = inv.entries[id] || (fx(`/api/posting-effect?doc=invoice&id=${id}`) || { data: { entries: [] } }).data.entries;
    const orig = base.find((e) => !e.reversalOf);
    inv.entries[id] = orig ? [...base, { id: st.nextEntry, entryNumber: st.nextEntry, date: now(), description: `عكس ${orig.description}`, sourceType: 'INVOICE_REVERSAL', reversalOf: orig.entryNumber, lines: orig.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) }] : base;
    if (orig) st.nextEntry++;
    invMoney(i, -1);
    setInvStatus(id, 'REVERSED');
    return null;
  };
  D.on('POST', /^\/api\/invoices\/(\d+)\/post$/, (req, m) => { const e = postInv(+m[1]); return e ? fail(e) : ok(getInv(+m[1])); });
  D.on('POST', /^\/api\/invoices\/(\d+)\/reverse$/, (req, m) => { const e = reverseInv(+m[1]); return e ? fail(e) : ok(getInv(+m[1])); });
  D.on('GET', /^\/api\/posting-effect$/, (req) => {
    if (req.query.doc !== 'invoice') return undefined;
    const id = +req.query.id;
    if (!isNewInv(id) && !inv.changes[id]) return undefined;
    const i = getInv(id);
    if (!i) return fail('الفاتورة غير موجودة', 404);
    const stock = [];
    i.lines.filter((l) => l.stockDelta).forEach((l) => {
      stock.push({ item: l.item.name, code: l.item.code, warehouse: whName(i.warehouseId), quantity: l.stockDelta, unitCost: l.unitCost });
      if (i.targetWarehouseId) stock.push({ item: l.item.name, code: l.item.code, warehouse: whName(i.targetWarehouseId), quantity: -l.stockDelta, unitCost: l.unitCost });
    });
    const recordedEntries = (fx(`/api/posting-effect?doc=invoice&id=${id}`) || { data: { entries: [] } }).data.entries;
    return ok({ reversed: i.status === 'REVERSED', stock, entries: inv.entries[id] || recordedEntries });
  });

  // Review screen (commercial documents tab)
  D.on('GET', /^\/api\/review\/commercial-transactions$/, (req) => {
    const status = req.query.status || 'DRAFT';
    const base = (fx(req.pathQ) || { data: [] }).data;
    const mine = touchedInv();
    const ids = new Set([...mine.map((i) => i.id), ...inv.deleted]);
    const strip = (i) => { const d = decorateInv(i); delete d.lines; delete d.salesRep; return d; };
    return ok([...mine.filter((i) => i.status === status && inRange(i, req.query)).map(strip), ...base.filter((r) => !ids.has(r.id))]);
  });
  D.on('GET', /^\/api\/review\/counts$/, (req) => {
    if (req.query.type !== 'invoices') return undefined;
    const counts = { DRAFT: 0, POSTED: 0, REVERSED: 0, ...((fx(req.pathQ) || { data: {} }).data) };
    for (const i of touchedInv()) {
      if (!inRange(i, req.query)) continue;
      const r = recordedInvById.get(i.id);
      if (r) counts[r.status] = Math.max(0, (counts[r.status] || 0) - 1);
      counts[i.status] = (counts[i.status] || 0) + 1;
    }
    for (const id of inv.deleted) { const r = recordedInvById.get(id); if (r && inRange(r, req.query)) counts[r.status] = Math.max(0, counts[r.status] - 1); }
    return ok(counts);
  });
  D.on('POST', /^\/api\/review\/(post|reverse)-batch$/, (req, m) => {
    const b = req.body || {};
    if (b.type !== 'invoices') return undefined;
    const failed = []; let n = 0;
    for (const id of b.ids || []) { const e = (m[1] === 'post' ? postInv : reverseInv)(+id); if (e) failed.push({ id, message: e }); else n++; }
    return ok(m[1] === 'post' ? { posted: n, failed } : { reversed: n, failed });
  });

  // Stock balances (item picker, inventory report): recorded balances plus this visit's moves
  D.on('GET', /^\/api\/inventory\/balances$/, (req) => {
    const q = req.query;
    const own = {};
    if (q.excludeInvoiceId) {
      const i = rawInv(+q.excludeInvoiceId);
      if (i && i.status === 'DRAFT') (i.lines || []).forEach((l) => {
        if (!l.stockDelta) return;
        own[key(l.itemId, i.warehouseId)] = (own[key(l.itemId, i.warehouseId)] || 0) - l.stockDelta;
        if (i.targetWarehouseId) own[key(l.itemId, i.targetWarehouseId)] = (own[key(l.itemId, i.targetWarehouseId)] || 0) + l.stockDelta;
      });
    }
    const rows = baseBalances.map((b) => ({ ...b }));
    const seen = new Set(rows.map((b) => key(b.itemId, b.warehouseId)));
    let n = 0;
    Object.keys(inv.stock).forEach((k) => {
      if (seen.has(k)) return;
      const [itemId, wid] = k.split(':').map(Number);
      const it = items.find((x) => x.id === itemId); const w = warehouses.find((x) => x.id === wid);
      if (it && w) rows.push({ id: -(++n), itemId, warehouseId: wid, quantity: 0, item: { ...it, supplier: undefined, subCategory: undefined, dispensingWarehouse: undefined }, warehouse: w, pending: 0 });
    });
    const data = rows
      .filter((r) => (!q.warehouseId || r.warehouseId === +q.warehouseId) && (!q.categoryId || (r.item && r.item.categoryId === +q.categoryId)))
      .map((r) => {
        const quantity = round4(r.quantity + (inv.stock[key(r.itemId, r.warehouseId)] || 0) + (own[key(r.itemId, r.warehouseId)] || 0));
        return { ...r, quantity, item: r.item && { ...r.item, avgCost: avgOf(r.itemId) }, pending: r.pending || 0, expected: round4(quantity + (r.pending || 0)) };
      })
      .filter((r) => (q.filter === 'POSITIVE' ? r.quantity > 0 : q.filter === 'NEGATIVE' ? r.quantity < 0 : true));
    return ok(data);
  });

  // Balances that vouchers and invoices move
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
    // Sales and purchases count from saving (drafts included, reversed left out), as on the server
    const mine = touchedInv();
    if (mine.length || inv.deleted.length) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const live = (i) => i && i.status !== 'REVERSED';
      const adjust = (bucket, types, from) => {
        const counts = (i) => live(i) && types.includes(i.type) && new Date(i.date) >= from;
        for (const i of [...mine, ...inv.deleted.map((id) => ({ ...recordedInvById.get(id), status: 'REVERSED' }))]) {
          const r = recordedInvById.get(i.id);
          const was = counts(r) ? 1 : 0; const is = counts(i) ? 1 : 0;
          if (was === is && (!was || r.totalAmount === i.totalAmount)) continue;
          bucket.total = round2(bucket.total - was * (r ? r.totalAmount : 0) + is * i.totalAmount);
          bucket.count += is - was;
        }
      };
      adjust(d.salesToday, SALE_TYPES, today);
      adjust(d.salesMonth, SALE_TYPES, monthStart);
      adjust(d.purchasesMonth, ['PURCHASE'], monthStart);
      const dayKey = (x) => { const t = new Date(x); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
      if (Array.isArray(d.salesSeries)) for (const i of mine) {
        const r = recordedInvById.get(i.id);
        const s = d.salesSeries.find((x) => x.date === dayKey(i.date));
        if (!s || !SALE_TYPES.includes(i.type)) continue;
        s.total = round2(s.total - (live(r) ? r.totalAmount : 0) + (live(i) ? i.totalAmount : 0));
      }
      const n = d.recent.length || 8;
      const ids = new Set(mine.map((i) => i.id));
      const short = (i) => { const x = decorateInv(i); return { id: x.id, invoiceNumber: x.invoiceNumber, type: x.type, date: x.date, totalAmount: x.totalAmount, status: x.status, customer: x.customer ? { name: x.customer.name } : null, supplier: x.supplier ? { name: x.supplier.name } : null }; };
      d.recent = [...mine.map(short), ...d.recent.filter((r) => !ids.has(r.id) && !inv.deleted.includes(r.id))].sort(byDateDesc).slice(0, n);
    }
    d.pending.invoices = allInv().filter((i) => i.status === 'DRAFT').length;
    return { b };
  });
})();
