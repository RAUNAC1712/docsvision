'use strict';

const { FIELD_DEFS } = require('./extract');

const MAX_LINES = 400;
const tokens = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []);

function similarity(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / Math.max(x.size, y.size);
}

function sameValue(kind, a, b) {
  if (kind === 'money' || kind === 'number') return Math.abs(a - b) < 0.005;
  if (kind === 'text') return String(a).toLowerCase().replace(/[^a-z0-9]/g, '') === String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
  return a === b;
}

// Fields that mean the same thing under different names across document types.
// Document numbers and dates are left out: a PO and its invoice are expected to differ there.
const ALIASES = {
  vendor: ['vendor', 'merchant'],
  buyer: ['customer', 'buyer'],
};

function compareFields(a, b) {
  const defsA = FIELD_DEFS[a.doc_type] || [];
  const defsB = FIELD_DEFS[b.doc_type] || [];
  const rows = [];
  const usedB = new Set();
  const present = (v) => v !== null && v !== undefined && v !== '';

  for (const [key, label, kind] of defsA) {
    let other = defsB.find(([k]) => k === key);
    if (!other && a.doc_type !== b.doc_type) {
      const group = Object.values(ALIASES).find((g) => g.includes(key));
      other = group && defsB.find(([k]) => group.includes(k) && !usedB.has(k));
    }
    const va = a.fields[key];
    const vb = other ? b.fields[other[0]] : undefined;
    if (other) usedB.add(other[0]);
    if (!present(va) && !present(vb)) continue;
    const row = { label: other && other[1] !== label ? `${label} / ${other[1]}` : label, kind, a: present(va) ? va : null, b: present(vb) ? vb : null };
    if (present(va) && present(vb)) {
      row.status = sameValue(kind, va, vb) ? 'match' : 'different';
      if (kind === 'money' && row.status === 'different') {
        row.delta = Math.round((vb - va) * 100) / 100;
        row.delta_pct = va ? Math.round(((vb - va) / va) * 1000) / 10 : null;
      }
    } else {
      row.status = present(va) ? 'only_a' : 'only_b';
    }
    rows.push(row);
  }
  for (const [key, label, kind] of defsB) {
    if (usedB.has(key) || !present(b.fields[key])) continue;
    rows.push({ label, kind, a: null, b: b.fields[key], status: 'only_b' });
  }
  return rows;
}

function compareLineItems(a, b) {
  const itemsA = a.fields.line_items || [];
  const itemsB = [...(b.fields.line_items || [])];
  if (!itemsA.length && !itemsB.length) return [];
  const rows = [];
  for (const item of itemsA) {
    let best = -1;
    let bestScore = 0.5;
    itemsB.forEach((cand, i) => {
      const s = similarity(item.description, cand.description);
      if (s > bestScore) [best, bestScore] = [i, s];
    });
    if (best === -1) {
      rows.push({ status: 'only_a', a: item, b: null });
      continue;
    }
    const match = itemsB.splice(best, 1)[0];
    const changed = ['quantity', 'unit_price', 'amount'].filter((k) => Math.abs(item[k] - match[k]) > 0.005);
    rows.push({ status: changed.length ? 'different' : 'match', a: item, b: match, changed });
  }
  for (const item of itemsB) rows.push({ status: 'only_b', a: null, b: item });
  return rows;
}

function diffLines(textA, textB) {
  const prep = (t) => String(t || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, MAX_LINES);
  const a = prep(textA);
  const b = prep(textB);
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ op: 'same', text: a[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: 'removed', text: a[i++] });
    else out.push({ op: 'added', text: b[j++] });
  }
  while (i < a.length) out.push({ op: 'removed', text: a[i++] });
  while (j < b.length) out.push({ op: 'added', text: b[j++] });
  const total = a.length + b.length;
  return { lines: out, similarity: total ? Math.round(((2 * lcs[0][0]) / total) * 100) : 100 };
}

function compare(a, b) {
  const fields = compareFields(a, b);
  const line_items = compareLineItems(a, b);
  const text = diffLines(a.text, b.text);
  const findings = [];
  const differing = fields.filter((r) => r.status === 'different');

  if (a.sha256 === b.sha256) findings.push({ tone: 'critical', text: 'These two files are byte-for-byte identical.' });
  const total = fields.find((r) => r.kind === 'money' && /total|value/i.test(r.label) && r.status === 'different' && !/sub/i.test(r.label));
  if (total) {
    findings.push({
      tone: 'critical',
      text: `${total.label}: document B is ${total.delta > 0 ? 'higher' : 'lower'} by ${Math.abs(total.delta).toLocaleString('en-IN', { minimumFractionDigits: 2 })}${total.delta_pct != null ? ` (${total.delta_pct > 0 ? '+' : ''}${total.delta_pct}%)` : ''}.`,
    });
  }
  const changedItems = line_items.filter((r) => r.status === 'different');
  if (changedItems.length) {
    findings.push({ tone: 'warning', text: `${changedItems.length} line item${changedItems.length > 1 ? 's' : ''} changed in quantity, price or amount.` });
  }
  const unmatched = line_items.filter((r) => r.status === 'only_a' || r.status === 'only_b').length;
  if (unmatched) findings.push({ tone: 'warning', text: `${unmatched} line item${unmatched > 1 ? 's appear' : ' appears'} in only one of the documents.` });
  if (!findings.length) {
    findings.push(differing.length
      ? { tone: 'warning', text: `${differing.length} extracted field${differing.length > 1 ? 's differ' : ' differs'} between the documents.` }
      : { tone: 'good', text: 'All fields found in both documents agree.' });
  }

  return {
    summary: {
      matching: fields.filter((r) => r.status === 'match').length,
      different: differing.length,
      one_sided: fields.filter((r) => r.status === 'only_a' || r.status === 'only_b').length,
      text_similarity: text.similarity,
    },
    findings,
    fields,
    line_items,
    text_diff: text.lines,
  };
}

module.exports = { compare };
