'use strict';

const view = document.getElementById('view');
const tooltip = document.getElementById('tooltip');
let META = null;
let renderToken = 0;

/* ---------- helpers ---------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'svg') el.innerHTML = v; // static icon markup only
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  compare: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  low: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  medium: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  high: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  neutral: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
const icon = (name) => h('span', { class: 'icon', 'aria-hidden': 'true', svg: `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>` });

async function api(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok && !Array.isArray(data)) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(message) {
  const el = h('div', { class: 'toast' }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

function money(n, currency = 'INR', compact = false) {
  if (n == null) return '—';
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: compact || Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
  }).format(n);
}
// Date-only values are calendar dates; full timestamps are shown in local time.
const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const typeLabel = (t) => (META.types[t] || META.types.other).label;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
const riskBadge = (level) => h('span', { class: `badge tone-${level}` }, icon(level), RISK_LABEL[level]);
const typeChip = (type) => h('span', { class: 'chip' }, typeLabel(type));

function formatValue(kind, value, currency) {
  if (value == null || value === '') return null;
  if (kind === 'money') return money(value, currency);
  if (kind === 'date') return fmtDate(value);
  if (kind === 'bool') return value ? 'Yes' : 'No';
  return String(value);
}

function pageHead(title, subtitle, actions) {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, title), subtitle && h('p', {}, subtitle)), actions && h('div', { class: 'actions' }, actions));
}

function table(columns, rows, opts = {}) {
  return h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
    h('tbody', {}, rows.map((row, i) =>
      h('tr', opts.rowAttrs ? opts.rowAttrs(row, i) : {}, columns.map((c) => {
        const cell = c.render(row, i);
        const extra = c.cellClass ? c.cellClass(row) : '';
        return h('td', { class: [c.num ? 'num' : '', extra].filter(Boolean).join(' ') || null }, cell == null ? '—' : cell);
      }))
    ))
  );
}

async function loadSamples(button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Loading samples…';
  try {
    const r = await api('/api/samples', { method: 'POST' });
    toast(r.added ? `Added ${plural(r.added, 'sample document')}.` : 'Sample documents are already loaded.');
    r.errors.forEach((e) => toast(e));
  } catch (err) {
    toast(err.message);
  }
  button.disabled = false;
  button.textContent = original;
  route();
}

/* ---------- tooltip ---------- */

function showTip(content, x, y) {
  tooltip.replaceChildren(
    ...(content.title ? [h('div', { class: 'tt-title' }, content.title)] : []),
    ...content.rows.map((r) => h('div', { class: 'tt-row' }, h('b', {}, r.value), h('span', {}, r.label)))
  );
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 8))}px`;
  tooltip.style.top = `${Math.max(8, y + 16 + box.height > window.innerHeight ? y - box.height - 10 : y + 16)}px`;
}
const hideTip = () => { tooltip.hidden = true; };

function attachTip(el, getContent, label) {
  el.tabIndex = 0;
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('pointermove', (e) => showTip(getContent(), e.clientX, e.clientY));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    showTip(getContent(), r.left + r.width / 2, r.bottom - 8);
  });
  el.addEventListener('blur', hideTip);
  return el;
}

/* ---------- charts ---------- */

function chartCard(title, subtitle, chart, tableSpec) {
  const tableEl = h('div', { class: 'table-wrap', hidden: true }, table(tableSpec.columns, tableSpec.rows));
  const chartEl = h('div', { class: 'viz' }, chart);
  const toggle = h('button', {
    class: 'btn small', type: 'button', 'aria-pressed': 'false',
    onclick() {
      const on = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(on));
      tableEl.hidden = !on;
      chartEl.hidden = on;
    },
  }, 'Table');
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, title), h('p', {}, subtitle)), toggle),
    chartEl, tableEl);
}

function barList(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'Nothing to show for this selection.');
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return h('div', { class: 'bars' }, rows.map((r) =>
    attachTip(
      h('div', { class: 'bar-row' },
        h('span', { class: 'name' }, r.name),
        h('span', { class: 'track' },
          h('span', { class: 'bar', style: { width: `calc((100% - 78px) * ${r.value / max})` } }),
          h('span', { class: 'val' }, r.display))),
      () => ({ title: r.name, rows: r.tip }),
      `${r.name}: ${r.tip.map((t) => `${t.value} ${t.label}`).join(', ')}`
    )
  ));
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = 0; v < max + step - 1e-9; v += step) ticks.push(v);
  return ticks;
}

function columnChart(data, formatTick) {
  if (!data.length) return h('p', { class: 'muted' }, 'Nothing to show for this selection.');
  const max = Math.max(...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const pct = (v) => `${(v / top) * 100}%`;
  const peak = data.findIndex((d) => d.value === max);
  return h('div', { class: 'columns', style: { 'margin-top': '22px' } },
    h('div', { class: 'yaxis', 'aria-hidden': 'true' }, ticks.map((t) => h('span', { style: { bottom: pct(t) } }, formatTick(t)))),
    h('div', { class: 'plot' },
      ticks.slice(1).map((t) => h('i', { class: 'gridline', style: { bottom: pct(t) } })),
      h('div', { class: 'cols' }, data.map((d, i) =>
        attachTip(
          h('div', { class: 'col' },
            i === peak && max > 0 && h('span', { class: 'col-label' }, d.display),
            h('span', { class: 'col-bar', style: { height: pct(d.value) } })),
          () => ({ title: d.title, rows: d.tip }),
          `${d.title}: ${d.tip.map((t) => `${t.value} ${t.label}`).join(', ')}`
        )
      ))),
    h('div', { class: 'xaxis' }, data.map((d) => h('span', {}, d.label)))
  );
}

function riskBar(byRisk, total) {
  const names = { low: 'Low', medium: 'Medium', high: 'High' };
  const bar = h('div', { class: 'segbar', role: 'img', 'aria-label': byRisk.map((r) => `${names[r.level]}: ${r.count}`).join(', ') },
    byRisk.filter((r) => r.count > 0).map((r) =>
      attachTip(
        h('span', { class: `seg level-${r.level}`, style: { flex: `${r.count} 1 0` } }, String(r.count)),
        () => ({ title: `${names[r.level]} risk`, rows: [{ value: r.count, label: `of ${plural(total, 'document')} (${Math.round((r.count / total) * 100)}%)` }] }),
        `${names[r.level]} risk: ${r.count} of ${plural(total, 'document')}`
      )
    ));
  // A block too narrow for its figure prints none; the table view and tooltip keep it.
  requestAnimationFrame(() => bar.querySelectorAll('.seg').forEach((s) => { if (s.scrollWidth > s.clientWidth) s.textContent = ''; }));
  return h('div', {}, bar,
    h('div', { class: 'legend' }, byRisk.map((r) => h('span', {}, h('i', { style: { background: `var(--${{ low: 'good', medium: 'warning', high: 'critical' }[r.level]})` } }), names[r.level]))));
}

/* ---------- dashboard ---------- */

async function dashboard() {
  const token = renderToken;
  const state = { type: '', days: '' };
  const body = h('div');
  const first = await api('/api/analytics');
  if (token !== renderToken) return;

  if (!first.kpis.documents) {
    const sampleBtn = h('button', { class: 'btn', type: 'button', onclick: () => loadSamples(sampleBtn) }, 'Load sample documents');
    view.replaceChildren(
      pageHead('Dashboard', 'Everything DocLens has read, checked and flagged.'),
      h('section', { class: 'card empty' },
        h('h2', {}, 'No documents yet'),
        h('p', {}, 'Upload invoices, receipts, purchase orders, contracts or bank statements to see extracted data and fraud checks here.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/upload' }, icon('upload'), 'Upload documents'), sampleBtn)));
    return;
  }

  const select = (label, key, options) =>
    h('label', { class: 'field' }, label,
      h('select', { onchange(e) { state[key] = e.target.value; load(); } }, options.map(([v, text]) => h('option', { value: v }, text))));

  view.replaceChildren(
    pageHead('Dashboard', 'Everything DocLens has read, checked and flagged.', h('a', { class: 'btn primary', href: '#/upload' }, icon('upload'), 'Upload documents')),
    h('div', { class: 'filters' },
      select('Period', 'days', [['', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['180', 'Last 180 days']]),
      select('Document type', 'type', [['', 'All types'], ...Object.entries(META.types).filter(([t]) => t !== 'other').map(([t, v]) => [t, v.plural])])),
    body);

  async function load(data) {
    body.style.opacity = '0.5';
    const a = data || (await api(`/api/analytics?type=${state.type}&days=${state.days}`));
    if (token !== renderToken) return;
    body.style.opacity = '1';
    body.replaceChildren(...analyticsView(a));
  }
  load(first);
}

function analyticsView(a) {
  const k = a.kpis;
  const cur = a.currency;
  const kpi = (label, value, sub) => h('section', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub' }, sub));
  if (!k.documents) return [h('section', { class: 'card empty' }, h('h2', {}, 'No documents match these filters'), h('p', {}, 'Try a longer period or a different document type.'))];

  const monthName = (m, i) => {
    const d = new Date(m + '-01T00:00:00');
    return d.toLocaleDateString('en-GB', i === 0 || d.getMonth() === 0 ? { month: 'short', year: 'numeric' } : { month: 'short' });
  };
  const longMonth = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const sevLabel = { high: 'High', medium: 'Medium', low: 'Low' };

  return [
    h('div', { class: 'grid kpis' },
      kpi('Documents processed', k.documents.toLocaleString('en-IN'), k.scanned ? `${k.scanned} read by OCR at ${k.avg_ocr_confidence}% avg confidence` : 'None needed image OCR'),
      kpi('Total value', money(k.total_value, cur, true), a.other_currencies.length ? `${cur} only; excludes ${a.other_currencies.join(', ')}` : 'Across documents with an amount'),
      kpi('Flagged for review', k.flagged.toLocaleString('en-IN'), `${k.high_risk} high risk`),
      kpi('Value at risk', money(k.value_at_risk, cur, true), 'Amount on flagged documents')),

    h('div', { class: 'grid two' },
      chartCard('Value processed by month', `Sum of document amounts in ${cur}, by document date`,
        columnChart(a.by_month.map((m, i) => ({
          label: monthName(m.month, i), title: longMonth(m.month), value: m.value, display: money(m.value, cur, true),
          tip: [{ value: money(m.value, cur), label: 'value' }, { value: m.count, label: m.count === 1 ? 'document' : 'documents' }],
        })), (t) => money(t, cur, true)),
        { columns: [{ label: 'Month', render: (m) => longMonth(m.month) }, { label: 'Documents', num: true, render: (m) => m.count }, { label: 'Value', num: true, render: (m) => money(m.value, cur) }], rows: a.by_month }),
      chartCard('Risk levels', `How ${plural(k.documents, 'document')} scored on fraud checks`,
        riskBar(a.by_risk, k.documents),
        { columns: [{ label: 'Risk level', render: (r) => riskBadge(r.level) }, { label: 'Documents', num: true, render: (r) => r.count }, { label: 'Share', num: true, render: (r) => `${Math.round((r.count / k.documents) * 100)}%` }], rows: a.by_risk })),

    h('div', { class: 'grid three' },
      chartCard('Documents by type', 'Number of documents of each kind',
        barList(a.by_type.map((t) => ({ name: t.label, value: t.count, display: t.count, tip: [{ value: t.count, label: t.count === 1 ? 'document' : 'documents' }, { value: money(t.value, cur), label: 'total value' }] }))),
        { columns: [{ label: 'Type', render: (t) => t.label }, { label: 'Documents', num: true, render: (t) => t.count }, { label: 'Value', num: true, render: (t) => money(t.value, cur) }], rows: a.by_type }),
      chartCard('Top counterparties', `Vendors and parties by total value in ${cur}`,
        barList(a.top_counterparties.map((p) => ({ name: p.name, value: p.value, display: money(p.value, cur, true), tip: [{ value: money(p.value, cur), label: 'value' }, { value: p.count, label: p.count === 1 ? 'document' : 'documents' }] }))),
        { columns: [{ label: 'Counterparty', render: (p) => p.name }, { label: 'Documents', num: true, render: (p) => p.count }, { label: 'Value', num: true, render: (p) => money(p.value, cur) }], rows: a.top_counterparties }),
      chartCard('Most common flags', 'Fraud and quality checks that fired most often',
        barList(a.top_flags.map((f) => ({ name: f.title, value: f.count, display: f.count, tip: [{ value: f.count, label: f.count === 1 ? 'document' : 'documents' }, { value: sevLabel[f.severity], label: 'severity' }] }))),
        { columns: [{ label: 'Check', render: (f) => f.title }, { label: 'Severity', render: (f) => sevLabel[f.severity] }, { label: 'Documents', num: true, render: (f) => f.count }], rows: a.top_flags })),

    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Needs review'), h('p', {}, 'Highest-risk documents first')), h('a', { class: 'btn small', href: '#/documents' }, 'All documents')),
      a.flagged.length
        ? h('div', { class: 'table-wrap' }, table([
            { label: 'Document', render: (d) => [h('a', { class: 'doc-name', href: `#/documents/${d.id}` }, d.filename), h('div', { class: 'doc-sub' }, d.counterparty || typeLabel(d.doc_type))] },
            { label: 'Type', render: (d) => typeChip(d.doc_type) },
            { label: 'Main concern', render: (d) => [d.top_flag, d.flag_count > 1 && h('div', { class: 'doc-sub' }, `+ ${plural(d.flag_count - 1, 'more flag')}`)] },
            { label: 'Amount', num: true, render: (d) => (d.amount == null ? '—' : money(d.amount, d.currency)) },
            { label: 'Risk', render: (d) => riskBadge(d.risk_level) },
          ], a.flagged, { rowAttrs: (d) => ({ class: 'link', onclick: (e) => { if (!e.target.closest('a')) location.hash = `#/documents/${d.id}`; } }) }))
        : h('p', { class: 'muted' }, 'No documents are flagged in this selection.')),
  ];
}

/* ---------- documents list ---------- */

async function documentsList() {
  const token = renderToken;
  const docs = await api('/api/documents');
  if (token !== renderToken) return;
  const state = { q: '', type: '', risk: '' };
  const body = h('div', { class: 'table-wrap' });

  function draw() {
    const q = state.q.trim().toLowerCase();
    const rows = docs.filter((d) =>
      (!state.type || d.doc_type === state.type) && (!state.risk || d.risk_level === state.risk) &&
      (!q || [d.filename, d.counterparty, d.doc_number].some((v) => v && v.toLowerCase().includes(q))));
    body.replaceChildren(rows.length
      ? table([
          { label: 'Document', render: (d) => [h('a', { class: 'doc-name', href: `#/documents/${d.id}` }, d.filename), h('div', { class: 'doc-sub' }, d.doc_number ? `No. ${d.doc_number}` : `Document #${d.id}`)] },
          { label: 'Type', render: (d) => typeChip(d.doc_type) },
          { label: 'Counterparty', render: (d) => d.counterparty },
          { label: 'Date', render: (d) => (d.doc_date ? fmtDate(d.doc_date) : null) },
          { label: 'Amount', num: true, render: (d) => (d.amount == null ? null : money(d.amount, d.currency)) },
          { label: 'Risk', render: (d) => [riskBadge(d.risk_level), d.flags.length > 0 && h('div', { class: 'doc-sub' }, plural(d.flags.length, 'flag'))] },
        ], rows, { rowAttrs: (d) => ({ class: 'link', onclick: (e) => { if (!e.target.closest('a')) location.hash = `#/documents/${d.id}`; } }) })
      : h('div', { class: 'empty' }, docs.length ? 'No documents match these filters.' : 'No documents yet. Upload one to get started.'));
  }

  const select = (label, key, options) =>
    h('label', { class: 'field' }, label, h('select', { onchange(e) { state[key] = e.target.value; draw(); } }, options.map(([v, t]) => h('option', { value: v }, t))));

  view.replaceChildren(
    pageHead('Documents', `${plural(docs.length, 'document')} processed.`, h('a', { class: 'btn primary', href: '#/upload' }, icon('upload'), 'Upload documents')),
    h('div', { class: 'filters' },
      h('label', { class: 'field' }, 'Search', h('input', { type: 'search', placeholder: 'File name, party or number', oninput(e) { state.q = e.target.value; draw(); } })),
      select('Type', 'type', [['', 'All types'], ...Object.entries(META.types).map(([t, v]) => [t, v.plural])]),
      select('Risk', 'risk', [['', 'All levels'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])),
    h('section', { class: 'card' }, body));
  draw();
}

/* ---------- upload ---------- */

function uploadView() {
  const queue = h('div', { class: 'queue' });
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: '.png,.jpg,.jpeg,.webp,.bmp,.pdf,.txt,.csv', onchange() { handle(input.files); input.value = ''; } });
  const zone = h('div', {
    class: 'dropzone', role: 'button', tabindex: '0',
    onclick: () => input.click(),
    onkeydown(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover(e) { e.preventDefault(); zone.classList.add('over'); },
    ondragleave() { zone.classList.remove('over'); },
    ondrop(e) { e.preventDefault(); zone.classList.remove('over'); handle(e.dataTransfer.files); },
  }, icon('upload'), h('strong', {}, 'Drop documents here, or click to choose'),
    h('span', {}, `Images (PNG, JPG, WEBP, BMP), PDF or text files, up to ${Math.round(META.max_file_bytes / 1048576)} MB each`));

  let chain = Promise.resolve();
  function handle(files) {
    for (const file of files) {
      const status = h('span', { class: 'muted' }, 'Waiting…');
      const right = h('div', { class: 'actions' });
      const item = h('div', { class: 'queue-item' }, h('div', { class: 'grow' }, h('div', { class: 'doc-name' }, file.name), status), right);
      queue.prepend(item);
      chain = chain.then(async () => {
        right.replaceChildren(h('span', { class: 'spinner' }));
        status.textContent = /^image\//.test(file.type) ? 'Running OCR…' : 'Reading text…';
        try {
          const form = new FormData();
          form.append('files', file);
          const [result] = await api('/api/documents', { method: 'POST', body: form });
          if (!result.ok) throw new Error(result.error);
          const d = result.document;
          status.textContent = [d.counterparty, d.amount != null && money(d.amount, d.currency), plural(d.flags.length, 'flag')].filter(Boolean).join(' · ');
          right.replaceChildren(typeChip(d.doc_type), riskBadge(d.risk_level), h('a', { class: 'btn small', href: `#/documents/${d.id}` }, 'View'));
        } catch (err) {
          status.textContent = err.message;
          right.replaceChildren(h('span', { class: 'badge tone-high' }, icon('high'), 'Failed'));
        }
      });
    }
  }

  const sampleBtn = h('button', { class: 'btn', type: 'button', onclick: () => loadSamples(sampleBtn) }, 'Load sample documents');
  view.replaceChildren(
    pageHead('Upload', 'Each file is read with OCR, classified, turned into structured data and checked for signs of fraud.', sampleBtn),
    zone, input, queue);
}

/* ---------- document detail ---------- */

async function documentDetail(id) {
  const token = renderToken;
  let doc;
  try {
    doc = await api(`/api/documents/${id}`);
  } catch (err) {
    view.replaceChildren(h('a', { class: 'back', href: '#/documents' }, icon('back'), 'Documents'), h('section', { class: 'card empty' }, h('h2', {}, 'Document not found'), h('p', {}, err.message)));
    return;
  }
  if (token !== renderToken) return;
  const f = doc.fields;
  const cur = doc.currency;
  const fileUrl = `/api/documents/${doc.id}/file`;

  const preview = doc.mime.startsWith('image/')
    ? h('img', { src: fileUrl, alt: `Scan of ${doc.filename}` })
    : doc.mime === 'application/pdf'
      ? h('iframe', { src: fileUrl, title: doc.filename })
      : h('pre', { class: 'text' }, doc.text);

  const typeSelect = h('select', {
    'aria-label': 'Document type',
    async onchange() {
      try {
        await api(`/api/documents/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_type: typeSelect.value }) });
      } catch (err) { toast(err.message); }
      route();
    },
  }, h('option', { value: 'auto' }, 'Detect automatically'), Object.entries(META.types).map(([t, v]) => h('option', { value: t, selected: doc.type_overridden && t === doc.doc_type }, v.label)));

  const fieldDefs = META.fields[doc.doc_type] || [];
  const ocrNote = {
    tesseract: `Read from the image by Tesseract OCR at ${Math.round(doc.ocr_confidence)}% confidence.`,
    'pdf-text': `Read from the PDF text layer (${plural(doc.pages || 1, 'page')}).`,
    'plain-text': 'Read directly from the text file.',
  }[doc.ocr_method];

  const sev = { high: 'High', medium: 'Medium', low: 'Low' };
  const itemsCard = (f.line_items || []).length > 0 && h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Line items')),
    h('div', { class: 'table-wrap' }, table([
      { label: 'Description', render: (i) => i.description },
      { label: 'Qty', num: true, render: (i) => i.quantity },
      { label: 'Unit price', num: true, render: (i) => money(i.unit_price, cur) },
      { label: 'Amount', num: true, render: (i) => money(i.amount, cur) },
    ], f.line_items)));
  const txCard = (f.transactions || []).length > 0 && h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Transactions')),
    h('div', { class: 'table-wrap' }, table([
      { label: 'Date', render: (t) => fmtDate(t.date) },
      { label: 'Description', render: (t) => [t.description, t.consistent === false && h('div', {}, h('span', { class: 'badge tone-high' }, icon('high'), 'Balance does not follow'))] },
      { label: 'Type', render: (t) => (t.type === 'credit' ? 'Credit' : 'Debit') },
      { label: 'Amount', num: true, render: (t) => money(t.amount, cur) },
      { label: 'Balance', num: true, render: (t) => money(t.balance, cur) },
    ], f.transactions)));

  view.replaceChildren(
    h('a', { class: 'back', href: '#/documents' }, icon('back'), 'Documents'),
    pageHead(doc.filename,
      `${typeLabel(doc.doc_type)}${doc.type_overridden ? ' (set manually)' : doc.type_confidence ? `, detected with ${doc.type_confidence}% confidence` : ''} · uploaded ${fmtDate(doc.uploaded_at)}`,
      [typeSelect,
        h('a', { class: 'btn', href: `#/compare?a=${doc.id}` }, icon('compare'), 'Compare'),
        h('button', {
          class: 'btn danger', type: 'button',
          async onclick() {
            if (!confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
            await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
            toast('Document deleted.');
            location.hash = '#/documents';
          },
        }, icon('trash'), 'Delete')]),
    h('div', { class: 'grid detail' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Original'), h('p', {}, ocrNote)), h('a', { class: 'btn small', href: fileUrl, target: '_blank', rel: 'noopener' }, 'Open file')),
          h('div', { class: 'preview' }, preview)),
        doc.ocr_method !== 'plain-text' && h('section', { class: 'card' },
          h('details', {}, h('summary', {}, 'Extracted text'), h('div', { class: 'preview' }, h('pre', { class: 'text' }, doc.text || 'No text could be read.'))))),
      h('div', { class: 'stack' },
        h('section', { class: `card tone-${doc.risk_level}` },
          h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Fraud and quality checks'), h('p', {}, doc.flags.length ? `${plural(doc.flags.length, 'check')} raised a concern` : 'All checks passed')), riskBadge(doc.risk_level)),
          h('div', { class: 'score' }, h('b', {}, doc.risk_score), h('span', { class: 'muted' }, '/ 100 risk score')),
          h('div', { class: 'meter', role: 'img', 'aria-label': `Risk score ${doc.risk_score} out of 100` }, h('i', { style: { width: `${Math.max(doc.risk_score, 2)}%` } })),
          doc.flags.length > 0 && h('div', { class: 'flags' }, doc.flags.map((flag) =>
            h('div', { class: `flag tone-${flag.severity}` }, icon(flag.severity),
              h('div', {}, h('span', { class: 'sev' }, `${sev[flag.severity]} severity`), h('strong', {}, flag.title), h('p', {}, flag.detail),
                flag.related_id && h('p', {}, h('a', { href: `#/documents/${flag.related_id}` }, `Open document #${flag.related_id}`), ' · ', h('a', { href: `#/compare?a=${flag.related_id}&b=${doc.id}` }, 'Compare the two'))))))),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Extracted data'), h('p', {}, fieldDefs.length ? `Currency: ${cur}` : 'This document type has no structured fields.'))),
          h('dl', { class: 'fields' }, fieldDefs.map(([key, label, kind]) => {
            const v = formatValue(kind, f[key], cur);
            return h('div', {}, h('dt', {}, label), h('dd', { class: v == null ? 'missing' : null }, v == null ? 'Not found' : v));
          }))),
        itemsCard, txCard)));
}

/* ---------- compare ---------- */

async function compareView(params) {
  const token = renderToken;
  const docs = await api('/api/documents');
  if (token !== renderToken) return;
  const result = h('div');
  const option = (d) => h('option', { value: d.id }, `#${d.id} · ${typeLabel(d.doc_type)} · ${d.filename}`);
  const picker = (name) => h('select', { id: `pick-${name}`, onchange: run }, h('option', { value: '' }, 'Choose a document'), docs.map(option));
  const selA = picker('a');
  const selB = picker('b');
  selA.value = params.get('a') || '';
  selB.value = params.get('b') || '';

  const pairs = [];
  for (const d of docs) {
    if (d.doc_type === 'invoice' && d.fields.po_reference) {
      const po = docs.find((o) => o.doc_type === 'purchase_order' && o.doc_number === d.fields.po_reference);
      if (po) pairs.push({ a: po.id, b: d.id, label: `${po.doc_number} vs invoice #${d.id}` });
    }
    const dup = d.flags.find((fl) => fl.related_id && /DUPLICATE|SIMILAR/.test(fl.code));
    if (dup) pairs.push({ a: dup.related_id, b: d.id, label: `#${dup.related_id} vs #${d.id} (possible duplicate)` });
  }
  pairs.sort((x, y) => y.b - x.b);

  function pick(a, b) { selA.value = a; selB.value = b; run(); }
  async function run() {
    if (!selA.value || !selB.value) { result.replaceChildren(); return; }
    history.replaceState(null, '', `#/compare?a=${selA.value}&b=${selB.value}`);
    try {
      const data = await api(`/api/compare?a=${selA.value}&b=${selB.value}`);
      if (token !== renderToken) return;
      result.replaceChildren(...comparison(data));
    } catch (err) {
      result.replaceChildren(h('section', { class: 'card empty' }, err.message));
    }
  }

  view.replaceChildren(
    pageHead('Compare', 'Put two documents side by side to see which fields, line items and text differ, such as an invoice against its purchase order.'),
    docs.length < 2
      ? h('section', { class: 'card empty' }, h('h2', {}, 'You need at least two documents'), h('p', {}, 'Upload more documents to compare them.'), h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/upload' }, 'Upload documents')))
      : h('section', { class: 'card', style: { 'margin-bottom': '16px' } },
          h('div', { class: 'pickers' },
            h('label', { class: 'field' }, 'Document A', selA),
            h('button', { class: 'btn', type: 'button', 'aria-label': 'Swap documents', onclick: () => pick(selB.value, selA.value) }, icon('swap')),
            h('label', { class: 'field' }, 'Document B', selB)),
          pairs.length > 0 && h('div', { class: 'suggest' }, 'Suggested:', pairs.slice(0, 5).map((p) => h('button', { class: 'btn small', type: 'button', onclick: () => pick(p.a, p.b) }, p.label)))),
    result);
  run();
}

function comparison(c) {
  const STATUS = { match: ['low', 'Match', 'match'], different: ['medium', 'Different', 'different'], only_a: ['neutral', 'Only in A', 'neutral'], only_b: ['neutral', 'Only in B', 'neutral'] };
  const statusBadge = (s) => h('span', { class: `badge tone-${STATUS[s][2]}` }, icon(STATUS[s][0]), STATUS[s][1]);
  const kpi = (label, value) => h('section', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  const val = (row, side) => formatValue(row.kind, row[side], c[side].currency);
  const docHead = (d, side) => h('a', { href: `#/documents/${d.id}` }, `${side}: ${d.filename}`);
  const item = (i, cur) => (i ? `${i.quantity} × ${money(i.unit_price, cur)} = ${money(i.amount, cur)}` : null);
  const toneIcon = { critical: 'high', warning: 'medium', good: 'low' };
  const mark = { added: '+', removed: '−', same: ' ' };

  return [
    h('div', { class: 'grid kpis' },
      kpi('Fields that match', c.summary.matching), kpi('Fields that differ', c.summary.different),
      kpi('Fields in only one', c.summary.one_sided), kpi('Text similarity', `${c.summary.text_similarity}%`)),
    h('div', { class: 'findings' }, c.findings.map((fd) => h('div', { class: `flag tone-${fd.tone}` }, icon(toneIcon[fd.tone]), h('div', {}, h('strong', {}, fd.text))))),
    h('section', { class: 'card', style: { 'margin-bottom': '16px' } },
      h('div', { class: 'card-head' }, h('h2', {}, 'Fields')),
      c.fields.length
        ? h('div', { class: 'table-wrap' }, table([
            { label: 'Field', render: (r) => r.label },
            { label: docHead(c.a, 'A'), render: (r) => val(r, 'a'), cellClass: (r) => (r.status === 'different' ? 'changed' : '') },
            { label: docHead(c.b, 'B'), render: (r) => val(r, 'b') && [val(r, 'b'), r.delta != null && h('div', { class: 'doc-sub' }, `${r.delta > 0 ? '+' : '−'}${money(Math.abs(r.delta), c.b.currency)}${r.delta_pct != null ? ` (${r.delta_pct > 0 ? '+' : ''}${r.delta_pct}%)` : ''}`)], cellClass: (r) => (r.status === 'different' ? 'changed' : '') },
            { label: 'Result', render: (r) => statusBadge(r.status) },
          ], c.fields))
        : h('p', { class: 'muted' }, 'No structured fields were found in either document.')),
    c.line_items.length > 0 && h('section', { class: 'card', style: { 'margin-bottom': '16px' } },
      h('div', { class: 'card-head' }, h('h2', {}, 'Line items')),
      h('div', { class: 'table-wrap' }, table([
        { label: 'Item', render: (r) => (r.a || r.b).description },
        { label: 'Document A', render: (r) => item(r.a, c.a.currency), cellClass: (r) => (r.status === 'different' ? 'changed' : '') },
        { label: 'Document B', render: (r) => item(r.b, c.b.currency), cellClass: (r) => (r.status === 'different' ? 'changed' : '') },
        { label: 'Result', render: (r) => statusBadge(r.status) },
      ], c.line_items))),
    h('section', { class: 'card' },
      h('details', {}, h('summary', {}, `Text differences (${c.text_diff.filter((l) => l.op !== 'same').length} changed lines)`),
        h('p', { class: 'muted', style: { 'margin-bottom': '10px' } }, 'Lines marked − appear only in document A; lines marked + appear only in document B.'),
        h('div', { class: 'diff' }, c.text_diff.map((l) => h('div', { class: l.op }, h('span', {}, mark[l.op]), h('span', {}, l.text)))))),
  ];
}

/* ---------- router ---------- */

const NAV = [['', 'Dashboard', 'dashboard'], ['documents', 'Documents', 'file'], ['upload', 'Upload', 'upload'], ['compare', 'Compare', 'compare']];

async function route() {
  renderToken++;
  hideTip();
  const [pathPart, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [section = '', id] = pathPart.split('/').filter(Boolean);
  document.getElementById('nav').replaceChildren(...NAV.map(([key, label, ic]) =>
    h('a', { href: `#/${key}`, 'aria-current': key === section ? 'page' : null }, icon(ic), label)));
  try {
    if (!META) META = await api('/api/meta');
    if (section === 'documents' && id) await documentDetail(id);
    else if (section === 'documents') await documentsList();
    else if (section === 'upload') uploadView();
    else if (section === 'compare') await compareView(new URLSearchParams(query || ''));
    else await dashboard();
  } catch (err) {
    view.replaceChildren(h('section', { class: 'card empty' }, h('h2', {}, 'Something went wrong'), h('p', {}, err.message)));
  }
}

window.addEventListener('hashchange', route);
route();
