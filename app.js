/* ADL Plaster Invoices — simple offline PWA. All data stays on this device. */
(function () {
  const { F, totals, hoursFromTimes } = window.INV;
  const $ = s => document.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- storage ---------- */
  const DEF_SETTINGS = {
    tradingName: 'ADL Plaster', legalName: 'Adrian David Lamond', address: '5 Chetwynd Street\nRedbank Plains QLD 4301',
    abn: '69 430 067 647', phone: '0452 665 333', email: 'adlplaster@outlook.com', supplierLine: 'Sole trader, GST registered',
    payee: 'Adrian David Lamond — ADL Plaster', bank: '', bsb: '', account: '',
    rate: 65, gstRate: 10, nextNumber: 'INV00083', due: 'On receipt', defStart: '06:30', defFinish: '14:30',
    expenseNote: 'Added at the receipt total. GST is already on the parking tax invoices. No extra GST added.',
    shareText: 'Hi {name}, please find attached tax invoice {number} for {total}. Thanks, Adrian'
  };
  const DEF_CLIENTS = [{ id: 'inlink', name: 'Inlink Constructions', attention: 'Mark Hanham', address: '2 Satellite Street\nCoorparoo QLD 4150', abn: '25 144 973 208', email: '' }];
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('adl.' + k); return v ? JSON.parse(v) : clone(d); } catch (e) { return clone(d); } },
    set(k, v) { localStorage.setItem('adl.' + k, JSON.stringify(v)); }
  };
  let S = Object.assign(clone(DEF_SETTINGS), ls.get('settings', {}));
  let clients = ls.get('clients', DEF_CLIENTS);
  let invoices = ls.get('invoices', []);
  const saveS = () => ls.set('settings', S), saveC = () => ls.set('clients', clients), saveI = () => ls.set('invoices', invoices);
  if (!localStorage.getItem('adl.clients')) saveC();

  const idb = new Promise((res, rej) => { const r = indexedDB.open('adl-invoice', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const fileOp = (mode, fn) => idb.then(db => new Promise((res, rej) => { const tx = db.transaction('files', mode); const st = tx.objectStore('files'); const r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }));
  const putFile = f => fileOp('readwrite', st => st.put(f));
  const getFile = id => fileOp('readonly', st => st.get(id));
  const delFile = id => fileOp('readwrite', st => st.delete(id));
  const allFiles = () => fileOp('readonly', st => st.getAll());
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- helpers ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k]; if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k === 'value') el.value = v; else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c == null || c === false) return; el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return el;
  }
  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); };
  const field = (lab, inp) => h('div', null, h('label', null, lab), inp);
  function bind(obj, key, attrs, after) {
    const tag = attrs && attrs.textarea ? 'textarea' : (attrs && attrs.options ? 'select' : 'input');
    const a = Object.assign({}, attrs); delete a.textarea; const opts = a.options; delete a.options;
    const el = h(tag, a, opts ? opts.map(o => h('option', { value: o[0] }, o[1])) : null);
    el.value = obj[key] == null ? '' : obj[key];
    el.addEventListener('input', () => { obj[key] = (a.type === 'number') ? (el.value === '' ? '' : Number(el.value)) : el.value; after && after(el); });
    if (tag === 'select') el.addEventListener('change', () => { obj[key] = el.value; after && after(el); });
    return el;
  }
  const incNum = n => { const m = String(n).match(/^(.*?)(\d+)$/); return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : n + '-1'; };
  const numVal = n => { const m = String(n).match(/(\d+)$/); return m ? Number(m[1]) : -1; };
  const invTotal = inv => totals(inv).total;
  const bankMissing = () => !String(S.bank || '').trim() || !String(S.bsb || '').trim() || !String(S.account || '').trim();
  const bankWarn = () => bankMissing() ? h('div', { class: 'card warn' }, h('b', null, '⚠️ Bank details missing'),
    h('div', null, 'Add your bank, BSB and account number in Settings so clients know where to pay. They are printed on every invoice.'),
    h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => go('settings') }, 'Open Settings')) : null;

  /* ---------- navigation ---------- */
  let cur = null, dirty = false, view = 'list';
  const views = {};
  function go(v, arg, opts) {
    if (dirty && cur && !cur._saved && v !== 'edit' && !(opts && opts.force)) { if (!confirm('Discard this unsaved invoice?')) return; }
    if (v !== 'edit' && v !== 'pdf') { cur = null; dirty = false; }
    view = v; window.scrollTo(0, 0);
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (v === 'edit' || v === 'pdf' ? (cur && cur._saved ? 'list' : 'new') : v === 'client' ? 'clients' : v)));
    const main = $('#view'); main.innerHTML = ''; $('#toast').classList.remove('show');
    views[v](main, arg);
  }
  function header(t, back) { $('#title').textContent = t; const b = $('#backBtn'); b.classList.toggle('hidden', !back); b.onclick = back || null; }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const t = b.dataset.tab; if (t === 'new') newInvoice(); else go(t); });

  /* ---------- invoice list ---------- */
  views.list = main => {
    header('Invoices');
    const unpaid = invoices.filter(i => i.status !== 'paid');
    main.append(h('img', { class: 'logo', src: 'icons/logo.jpg', alt: 'ADL Plaster' }));
    main.append(h('div', { class: 'sum' },
      h('div', null, h('span', null, 'Unpaid'), h('b', null, F.money(unpaid.reduce((s, i) => s + invTotal(i), 0))), h('span', null, unpaid.length + ' invoice' + (unpaid.length === 1 ? '' : 's'))),
      h('div', null, h('span', null, 'Next number'), h('b', null, S.nextNumber), h('span', null, '$' + S.rate + '/hr + GST'))));
    const bw = bankWarn(); if (bw) main.append(bw);
    main.append(h('button', { class: 'btn red', onclick: newInvoice }, '＋  New invoice'));
    main.append(h('div', { style: 'height:14px' }));
    if (!invoices.length) main.append(h('div', { class: 'empty' }, 'No invoices yet. Tap “New invoice” to make your first one.'));
    [...invoices].sort((a, b) => numVal(b.number) - numVal(a.number) || (b.created || 0) - (a.created || 0)).forEach(inv => {
      main.append(h('div', { class: 'inv', onclick: () => openInvoice(inv.id) },
        h('div', { class: 'm' }, h('div', { class: 'n' }, inv.number, ' ', h('span', { class: 'pill ' + (inv.status === 'paid' ? 'paid' : 'unpaid') }, inv.status === 'paid' ? 'Paid' : 'Unpaid')),
          h('div', { class: 'c' }, (inv.client && inv.client.name || '—') + ' · ' + F.dFull(inv.date)),
          inv.jobSite ? h('div', { class: 'c' }, inv.jobSite) : null),
        h('div', { class: 'a' }, F.money(invTotal(inv)))));
    });
  };

  /* ---------- editor ---------- */
  function newInvoice() {
    if (dirty && cur && !cur._saved && !confirm('Discard this unsaved invoice?')) return;
    const c = clients[0] || {};
    cur = { id: uid(), number: S.nextNumber, date: today(), due: S.due, clientId: c.id || '', client: clone(c), jobSite: '', jobLines: '', period: '',
      rate: S.rate, gstRate: S.gstRate, days: [], expenses: [], expenseNote: '', flagNote: '', labourNote: '', atts: [], status: 'unpaid', created: Date.now(), _saved: false };
    dirty = false; go('edit', null, { force: true });
  }
  function openInvoice(id) { const inv = invoices.find(i => i.id === id); if (!inv) return; cur = clone(inv); cur._saved = true; dirty = false; go('edit'); }
  function persist(silent) {
    if (!cur) return;
    if (!cur.number) { alert('Please enter an invoice number.'); return false; }
    const clash = invoices.find(i => i.number === cur.number && i.id !== cur.id);
    if (clash && !confirm(`${cur.number} is already used. Save anyway?`)) return false;
    const first = !cur._saved; cur._saved = true; cur.updated = Date.now();
    const rec = clone(cur); delete rec._saved;
    const i = invoices.findIndex(x => x.id === cur.id); if (i >= 0) invoices[i] = rec; else invoices.push(rec);
    saveI();
    if (first && numVal(cur.number) >= numVal(S.nextNumber)) { S.nextNumber = incNum(cur.number); saveS(); }
    dirty = false; if (!silent) toast('Saved ' + cur.number);
    return true;
  }
  let autoT; const changed = () => { dirty = true; refreshTotals(); if (cur && cur._saved) { clearTimeout(autoT); autoT = setTimeout(() => persist(true), 600); } };
  let totalsEl;
  function refreshTotals() {
    if (!totalsEl || !cur) return; const T = totals(cur);
    totalsEl.innerHTML = '';
    totalsEl.append(h('div', { class: 'l' }, h('span', null, `Labour ${F.hrs(T.hours)} hrs ex GST`), h('span', null, F.money(T.labour))),
      h('div', { class: 'l' }, h('span', null, `GST ${T.gstPct}%`), h('span', null, F.money(T.gst))),
      T.exp ? h('div', { class: 'l' }, h('span', null, 'Parking (no extra GST)'), h('span', null, F.money(T.exp))) : null,
      h('div', { class: 'l big' }, h('span', null, 'Balance due'), h('span', null, F.money(T.total))));
  }

  views.edit = main => {
    const inv = cur;
    header(inv._saved ? inv.number : 'New invoice', () => go('list'));
    // status
    if (inv._saved) {
      const seg = h('div', { class: 'seg' }, ['unpaid', 'paid'].map(s => h('button', { class: inv.status === s ? 'on' : '', onclick: () => { inv.status = s; inv.paidDate = s === 'paid' ? today() : ''; persist(true); go('edit'); toast(s === 'paid' ? 'Marked paid 🎉' : 'Marked unpaid'); } }, s === 'paid' ? '✓ Paid' : 'Unpaid')));
      main.append(h('div', { class: 'card' }, seg, inv.status === 'paid' && inv.paidDate ? h('div', { class: 'muted', style: 'margin-top:6px;text-align:center' }, 'Paid ' + F.dFull(inv.paidDate)) : null));
    }
    // client & job
    const cSel = h('select', { onchange: e => { if (e.target.value === '__new') { go('client', { returnToEdit: inv }, { force: true }); return; } const c = clients.find(x => x.id === e.target.value); inv.clientId = c.id; inv.client = clone(c); changed(); } },
      clients.map(c => h('option', { value: c.id }, c.name)), h('option', { value: '__new' }, '＋ Add new client…'));
    cSel.value = inv.clientId;
    main.append(h('div', { class: 'card' }, h('h2', null, 'Client & job'), field('Bill to', cSel),
      field('Job / site', bind(inv, 'jobSite', { placeholder: 'e.g. 12 Smith Street fit-out' }, changed)),
      field('Job details (one per line)', bind(inv, 'jobLines', { textarea: true, placeholder: 'Builder or project name\nScope of work\nSigned day sheet attached' }, changed))));
    // invoice details
    main.append(h('div', { class: 'card' }, h('h2', null, 'Invoice'),
      h('div', { class: 'row' }, field('Number', bind(inv, 'number', { autocapitalize: 'characters' }, changed)), field('Date', bind(inv, 'date', { type: 'date' }, changed))),
      h('div', { class: 'row' }, field('Due', bind(inv, 'due', {}, changed)), field('Rate $/hr + GST', bind(inv, 'rate', { type: 'number', inputmode: 'decimal', step: '0.01' }, changed))),
      field('Period (blank = from work days)', bind(inv, 'period', { placeholder: 'auto' }, changed))));
    // work days
    const daysBox = h('div');
    const renderDays = () => {
      daysBox.innerHTML = '';
      inv.days.forEach((d, i) => {
        const hrs = bind(d, 'hours', { type: 'number', inputmode: 'decimal', step: '0.25' }, changed);
        const recalc = () => { const v = hoursFromTimes(d.start, d.finish, d.brk); if (v != null) { d.hours = v; hrs.value = v; } changed(); };
        daysBox.append(h('div', { class: 'item' },
          h('div', { class: 'hd' }, d.date ? F.dShort(d.date) : 'Day ' + (i + 1)),
          h('button', { class: 'x', 'aria-label': 'Remove day', onclick: () => { inv.days.splice(i, 1); renderDays(); changed(); } }, '×'),
          field('Date', bind(d, 'date', { type: 'date' }, changed)),
          h('div', { class: 'row' }, field('Start', bind(d, 'start', { type: 'time' }, recalc)), field('Finish', bind(d, 'finish', { type: 'time' }, recalc))),
          h('div', { class: 'row' }, field('Unpaid break (min)', bind(d, 'brk', { type: 'number', inputmode: 'numeric', placeholder: '0' }, recalc)), field('Hours', hrs)),
          field('Description', bind(d, 'desc', { placeholder: 'e.g. Framing' }, changed)),
          field('Job', bind(d, 'job', { placeholder: 'e.g. Smith St' }, changed))));
      });
    };
    renderDays();
    main.append(h('div', { class: 'card' }, h('h2', null, 'Work days'), daysBox,
      h('button', { class: 'btn ghost', onclick: () => {
        const last = inv.days[inv.days.length - 1];
        const d = last ? { date: last.date ? addDays(last.date, 1) : today(), start: last.start, finish: last.finish, brk: last.brk || '', hours: last.hours, desc: last.desc, job: last.job }
          : { date: today(), start: S.defStart, finish: S.defFinish, brk: '', hours: hoursFromTimes(S.defStart, S.defFinish) || 8, desc: '', job: inv.jobSite || '' };
        inv.days.push(d); renderDays(); changed();
      } }, '＋ Add work day')));
    // expenses
    const expBox = h('div');
    const renderExp = () => {
      expBox.innerHTML = '';
      inv.expenses.forEach((e, i) => expBox.append(h('div', { class: 'item' },
        h('div', { class: 'hd' }, 'Parking ' + (i + 1)),
        h('button', { class: 'x', 'aria-label': 'Remove', onclick: () => { inv.expenses.splice(i, 1); renderExp(); changed(); } }, '×'),
        h('div', { class: 'row' }, field('Date', bind(e, 'date', { type: 'date' }, changed)), field('Amount incl GST', bind(e, 'amount', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: '0.00' }, changed))),
        field('Details', bind(e, 'details', { textarea: true, placeholder: 'Car park name\nAddress\nEntry – exit times' }, changed)),
        field('Receipt ref', bind(e, 'ref', { placeholder: 'e.g. receipt number' }, changed)))));
    };
    renderExp();
    main.append(h('div', { class: 'card' }, h('h2', null, 'Parking'), h('div', { class: 'muted' }, 'Charged at the receipt total — no extra GST added.'), h('div', { style: 'height:8px' }), expBox,
      h('button', { class: 'btn ghost', onclick: () => { const last = inv.expenses[inv.expenses.length - 1]; inv.expenses.push({ date: last && last.date ? addDays(last.date, 1) : (inv.days[0] && inv.days[0].date) || today(), details: last ? last.details.split('\n').slice(0, 2).join('\n') : '', ref: '', amount: last ? last.amount : '' }); renderExp(); changed(); } }, '＋ Add parking'),
      field('Highlighted note (optional)', bind(inv, 'flagNote', { textarea: true, placeholder: 'e.g. No parking receipt for Thursday, so Thursday parking is not charged.' }, changed))));
    // attachments
    const attBox = h('div');
    const renderAtt = () => {
      attBox.innerHTML = '';
      inv.atts.forEach((a, i) => {
        const img = h('img', { class: 'thumb', alt: '' }); getFile(a.id).then(f => { if (f) img.src = f.dataUrl; });
        attBox.append(h('div', { class: 'item clearfix' }, img,
          h('button', { class: 'x', 'aria-label': 'Remove photo', onclick: () => { if (!confirm('Remove this photo?')) return; inv.atts.splice(i, 1); renderAtt(); changed(); } }, '×'),
          h('div', { class: 'hd' }, `Page ${i + 2}`),
          field('Type', bind(a, 'kind', { options: [['daysheet', 'Signed day sheet'], ['receipt', 'Parking receipt'], ['other', 'Other']] }, () => { renderAtt(); changed(); })),
          a.kind === 'receipt' ? field('Receipt date', bind(a, 'date', { type: 'date' }, changed)) : null,
          a.kind === 'other' ? field('Title', bind(a, 'title', { placeholder: 'e.g. Variation sign-off' }, changed)) : null,
          field('Caption (optional)', bind(a, 'caption', { placeholder: 'e.g. Ref ABC123. $14.00 including GST of $1.27.' }, changed)),
          h('div', { class: 'row', style: 'margin-top:8px' },
            i > 0 ? h('button', { class: 'btn small ghost', onclick: () => { [inv.atts[i - 1], inv.atts[i]] = [inv.atts[i], inv.atts[i - 1]]; renderAtt(); changed(); } }, '↑ Move up') : h('span'))));
      });
    };
    renderAtt();
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async e => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        try {
          const im = await loadImage(f); const id = uid(); await putFile(Object.assign({ id }, im));
          const usedDates = inv.atts.filter(a => a.kind === 'receipt').map(a => a.date);
          const hasSheet = inv.atts.some(a => a.kind === 'daysheet');
          const exp = inv.expenses.find(x => !usedDates.includes(x.date));
          inv.atts.push({ id, kind: hasSheet ? 'receipt' : 'daysheet', date: hasSheet && exp ? exp.date : '', title: '', caption: '' });
        } catch (err) { alert('Could not read that photo: ' + err.message); }
      }
      renderAtt(); changed();
    } });
    main.append(h('div', { class: 'card' }, h('h2', null, 'Photos (day sheet, receipts)'), h('div', { class: 'muted' }, 'Added as extra pages after the invoice.'), h('div', { style: 'height:8px' }), attBox, fileIn,
      h('button', { class: 'btn ghost', onclick: () => fileIn.click() }, '📷 Add photo')));
    // totals + actions
    totalsEl = h('div'); refreshTotals();
    main.append(h('div', { class: 'card totals' }, totalsEl));
    main.append(h('button', { class: 'btn red', onclick: makePdf }, 'Create PDF & send'));
    main.append(h('button', { class: 'btn navy', onclick: () => { if (persist()) go('edit'); } }, inv._saved ? 'Save' : 'Save invoice'));
    if (inv._saved) {
      main.append(h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => duplicate(inv) }, 'Duplicate'),
        h('button', { class: 'btn ghost', style: 'color:#c0302a', onclick: () => { if (!confirm(`Delete ${inv.number}? This can't be undone.`)) return; invoices = invoices.filter(i => i.id !== inv.id); saveI(); inv.atts.forEach(a => delFile(a.id)); dirty = false; cur = null; go('list'); toast('Deleted'); } }, 'Delete')));
    }
    main.append(h('details', { class: 'card', style: 'margin-top:12px' }, h('summary', { class: 'muted' }, 'More options'),
      field('Labour note (blank = automatic)', bind(inv, 'labourNote', { textarea: true, placeholder: INV.labourNote(Object.assign({}, inv, { labourNote: '' }), inv.atts.some(a => a.kind === 'daysheet')) || 'Automatic' }, changed)),
      field('Parking note', bind(inv, 'expenseNote', { textarea: true, placeholder: S.expenseNote }, changed)),
      field('GST %', bind(inv, 'gstRate', { type: 'number', inputmode: 'decimal' }, changed))));
  };
  function duplicate(src) {
    cur = clone(src); Object.assign(cur, { id: uid(), number: S.nextNumber, date: today(), status: 'unpaid', paidDate: '', atts: [], period: '', created: Date.now(), _saved: false });
    dirty = true; go('edit', null, { force: true }); toast('Copy made — update the days, then save');
  }
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { const max = 1700; let w = img.naturalWidth, hh = img.naturalHeight; const k = Math.min(1, max / Math.max(w, hh)); w = Math.round(w * k); hh = Math.round(hh * k);
        const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(img, 0, 0, w, hh);
        URL.revokeObjectURL(url); res({ dataUrl: c.toDataURL('image/jpeg', 0.82), w, h: hh }); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('unsupported image')); };
      img.src = url;
    });
  }
  let logoCache;
  function getLogo() {
    if (logoCache) return Promise.resolve(logoCache);
    return fetch('icons/logo.jpg').then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => { const i = new Image(); i.onload = () => res(logoCache = { dataUrl: fr.result, w: i.naturalWidth, h: i.naturalHeight }); i.src = fr.result; }; fr.readAsDataURL(b); }));
  }
  async function makePdf() {
    if (!cur.days.length && !cur.expenses.length) { alert('Add at least one work day first.'); return; }
    if (persist(true) === false) return;
    toast(bankMissing() ? 'Heads up: bank details are blank — add them in Settings' : 'Making PDF…');
    const atts = [];
    for (const a of cur.atts) { const f = await getFile(a.id); if (f) atts.push(Object.assign({}, a, f)); }
    const doc = INV.build(cur, S, atts, await getLogo());
    const blob = doc.output('blob');
    const name = `${S.tradingName.replace(/\s+/g, '')}-${cur.number}${cur.client && cur.client.name ? '-' + cur.client.name.split(' ')[0] : ''}.pdf`;
    go('pdf', { blob, name, pages: doc.getNumberOfPages() });
  }
  views.pdf = (main, arg) => {
    const inv = cur; header(inv.number, () => go('edit'));
    const file = new File([arg.blob], arg.name, { type: 'application/pdf' });
    const url = URL.createObjectURL(arg.blob);
    window.__lastPdf = arg.blob; // for testing
    const first = (inv.client && inv.client.attention || '').split(' ')[0] || 'there';
    const msg = (S.shareText || '').replace('{name}', first).replace('{number}', inv.number).replace('{total}', F.money(invTotal(inv))).replace('{client}', inv.client && inv.client.name || '');
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    const bw = bankWarn(); if (bw) { bw.querySelector('div').textContent = 'This PDF has blank bank, BSB or account details. Add them in Settings, then create the PDF again.'; main.append(bw); }
    main.append(h('div', { class: 'card', style: 'text-align:center' },
      h('div', { style: 'font-size:46px' }, '📄'), h('div', { style: 'font-weight:700;font-size:18px' }, arg.name),
      h('div', { class: 'muted' }, `${arg.pages} page${arg.pages > 1 ? 's' : ''} · ${(arg.blob.size / 1024 / 1024).toFixed(1)} MB · Balance due ${F.money(invTotal(inv))}`)));
    main.append(h('button', { class: 'btn red', onclick: async () => {
      if (!canShare) { toast('Sharing not supported here — downloading'); dl(); return; }
      try { await navigator.share({ files: [file], title: `Tax invoice ${inv.number}`, text: msg }); } catch (e) { if (e.name !== 'AbortError') { toast('Share failed — downloading'); dl(); } }
    } }, canShare ? '⬆︎ Share (Mail, Outlook, Messages…)' : '⬇︎ Download PDF'));
    const dl = () => { const a = h('a', { href: url, download: arg.name }); document.body.append(a); a.click(); a.remove(); };
    main.append(h('a', { class: 'btn navy', href: url, target: '_blank', rel: 'noopener' }, 'Preview PDF'));
    if (canShare) main.append(h('button', { class: 'btn ghost', onclick: dl }, 'Download instead'));
    main.append(h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', null, 'Message (copied with share)'), h('div', null, msg),
      h('button', { class: 'btn small ghost', style: 'margin-top:8px', onclick: () => navigator.clipboard && navigator.clipboard.writeText(msg).then(() => toast('Copied')) }, 'Copy message')));
    main.append(h('button', { class: 'btn ghost', onclick: () => go('list') }, 'Done'));
  };

  /* ---------- clients ---------- */
  views.clients = main => {
    header('Clients');
    clients.forEach(c => main.append(h('div', { class: 'inv', onclick: () => go('client', { id: c.id }) },
      h('div', { class: 'm' }, h('div', { class: 'n' }, c.name), h('div', { class: 'c' }, [c.attention && 'Attn: ' + c.attention, (c.address || '').split('\n').pop()].filter(Boolean).join(' · '))), h('div', { class: 'muted' }, '›'))));
    main.append(h('button', { class: 'btn', onclick: () => go('client', {}) }, '＋ Add client'));
  };
  views.client = (main, arg) => {
    const ret = arg && arg.returnToEdit ? arg.returnToEdit : null;
    const existing = arg && arg.id ? clients.find(c => c.id === arg.id) : null;
    const c = existing ? clone(existing) : { id: uid(), name: '', attention: '', address: '', abn: '', email: '' };
    const back = () => { if (ret) { cur = ret; dirty = true; go('edit'); } else go('clients'); };
    header(existing ? 'Edit client' : 'New client', back);
    main.append(h('div', { class: 'card' },
      field('Business name', bind(c, 'name', { placeholder: 'e.g. Inlink Constructions' })),
      field('Attention', bind(c, 'attention', { placeholder: 'Contact person' })),
      field('Address', bind(c, 'address', { textarea: true, placeholder: 'Street\nSuburb QLD 4000' })),
      field('ABN', bind(c, 'abn', { inputmode: 'numeric' })),
      field('Email (optional)', bind(c, 'email', { type: 'email' }))));
    main.append(h('button', { class: 'btn', onclick: () => {
      if (!c.name.trim()) { alert('Enter a business name'); return; }
      const i = clients.findIndex(x => x.id === c.id); if (i >= 0) clients[i] = c; else clients.push(c); saveC(); toast('Client saved');
      if (ret) { ret.clientId = c.id; ret.client = clone(c); cur = ret; dirty = true; go('edit'); } else go('clients');
    } }, 'Save client'));
    if (existing && !ret) main.append(h('button', { class: 'btn ghost', style: 'color:#c0302a', onclick: () => { if (confirm('Delete ' + c.name + '? Existing invoices keep their copy.')) { clients = clients.filter(x => x.id !== c.id); saveC(); go('clients'); } } }, 'Delete client'));
  };

  /* ---------- settings ---------- */
  views.settings = main => {
    header('Settings');
    const s = S; const ch = () => saveS();
    main.append(h('div', { class: 'card' }, h('h2', null, 'Invoicing'),
      h('div', { class: 'row' }, field('Rate $/hr (+GST)', bind(s, 'rate', { type: 'number', inputmode: 'decimal', step: '0.01' }, ch)), field('GST %', bind(s, 'gstRate', { type: 'number', inputmode: 'decimal' }, ch))),
      h('div', { class: 'row' }, field('Next invoice no.', bind(s, 'nextNumber', { autocapitalize: 'characters' }, ch)), field('Due', bind(s, 'due', {}, ch))),
      h('div', { class: 'row' }, field('Usual start', bind(s, 'defStart', { type: 'time' }, ch)), field('Usual finish', bind(s, 'defFinish', { type: 'time' }, ch))),
      field('Parking note', bind(s, 'expenseNote', { textarea: true }, ch)),
      field('Share message ({name} {number} {total})', bind(s, 'shareText', { textarea: true }, ch))));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Business'),
      field('Trading name', bind(s, 'tradingName', {}, ch)), field('Your name', bind(s, 'legalName', {}, ch)),
      field('Address', bind(s, 'address', { textarea: true }, ch)), field('ABN', bind(s, 'abn', {}, ch)),
      h('div', { class: 'row' }, field('Phone', bind(s, 'phone', { type: 'tel' }, ch)), field('Email', bind(s, 'email', { type: 'email' }, ch))),
      field('Supplier line', bind(s, 'supplierLine', {}, ch))));
    main.append(h('div', { class: 'card' }, h('h2', null, 'Bank details'),
      field('Payee', bind(s, 'payee', {}, ch)), field('Bank', bind(s, 'bank', {}, ch)),
      h('div', { class: 'row' }, field('BSB', bind(s, 'bsb', { inputmode: 'numeric' }, ch)), field('Account', bind(s, 'account', { inputmode: 'numeric' }, ch)))));
    const imp = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const data = JSON.parse(await f.text()); if (!data || !data.invoices) throw new Error('Not an ADL backup file');
        if (!confirm(`Restore backup from ${data.exported || 'file'}? This replaces ${invoices.length} invoice(s) on this phone with ${data.invoices.length}.`)) return;
        S = Object.assign(clone(DEF_SETTINGS), data.settings || {}); clients = data.clients || []; invoices = data.invoices || [];
        saveS(); saveC(); saveI(); for (const fl of (data.files || [])) await putFile(fl);
        toast('Backup restored'); go('list');
      } catch (err) { alert('Could not restore: ' + err.message); }
    } });
    main.append(h('div', { class: 'card' }, h('h2', null, 'Backup'), h('div', { class: 'muted' }, 'Everything is stored only on this phone. Save a backup to Files or email it to yourself now and then.'),
      h('button', { class: 'btn', onclick: exportBackup }, 'Export backup'), imp, h('button', { class: 'btn ghost', onclick: () => imp.click() }, 'Restore from backup')));
    main.append(h('div', { class: 'muted', style: 'text-align:center;margin-top:16px' }, 'ADL Invoices · works offline · v1'));
  };
  async function exportBackup() {
    const files = await allFiles();
    const used = new Set(invoices.flatMap(i => (i.atts || []).map(a => a.id)));
    const data = { app: 'adl-invoice', version: 1, exported: new Date().toISOString(), settings: S, clients, invoices, files: files.filter(f => used.has(f.id)) };
    const name = `adl-invoices-backup-${today()}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  }

  window.addEventListener('beforeunload', e => { if (dirty && cur && !cur._saved) { e.preventDefault(); e.returnValue = ''; } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  go('list');
})();
