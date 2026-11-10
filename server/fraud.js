'use strict';

// One high flag is enough for high risk; one medium flag (or three low) for medium.
const WEIGHT = { high: 40, medium: 18, low: 7 };
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const APPROVAL_THRESHOLDS = [10000, 25000, 50000, 100000, 200000, 500000, 1000000];

const round2 = (n) => Math.round(n * 100) / 100;
const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
const norm = (s) => String(s || '').toLowerCase().replace(/\b(?:pvt|private|ltd|limited|llp|inc|llc|co|corp|m\/s)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const sameParty = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
const fmt = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function checkArithmetic(doc, add) {
  const f = doc.fields;
  if (f.subtotal != null && f.tax != null && f.total != null && !near(f.subtotal + f.tax, f.total)) {
    add('TOTAL_MISMATCH', 'high', 'Totals do not add up',
      `Subtotal ${fmt(f.subtotal)} + tax ${fmt(f.tax)} = ${fmt(f.subtotal + f.tax)}, but the stated total is ${fmt(f.total)} (difference ${fmt(round2(f.total - f.subtotal - f.tax))}).`);
  }
  const items = f.line_items || [];
  if (items.length) {
    const sum = round2(items.reduce((a, i) => a + i.amount, 0));
    const target = f.subtotal != null ? f.subtotal : f.tax == null ? f.total : null;
    if (target != null && !near(sum, target)) {
      add('LINE_ITEMS_MISMATCH', 'high', 'Line items do not match the subtotal',
        `Line items sum to ${fmt(sum)} but the document states ${fmt(target)}.`);
    }
    const bad = items.filter((i) => !near(round2(i.quantity * i.unit_price), i.amount));
    if (bad.length) {
      add('LINE_CALC_ERROR', 'medium', 'Quantity × price does not equal the line amount',
        bad.slice(0, 3).map((i) => `"${i.description}": ${i.quantity} × ${fmt(i.unit_price)} ≠ ${fmt(i.amount)}`).join('; ') + '.');
    }
  }
  if (f.subtotal > 0 && f.tax != null && f.tax / f.subtotal > 0.4) {
    add('TAX_RATE_ANOMALY', 'medium', 'Unusually high tax rate',
      `Tax is ${Math.round((f.tax / f.subtotal) * 100)}% of the subtotal.`);
  }
}

function checkAmountPatterns(doc, add) {
  const amount = doc.amount;
  if (amount == null || !['invoice', 'receipt'].includes(doc.doc_type)) return;
  if (amount >= 10000 && amount % 1000 === 0) {
    add('ROUND_AMOUNT', 'low', 'Suspiciously round amount', `The total is exactly ${fmt(amount)}. Round figures are more common in fabricated documents.`);
  }
  const limit = APPROVAL_THRESHOLDS.find((t) => amount < t && amount >= t * 0.99);
  if (limit) {
    add('JUST_UNDER_THRESHOLD', 'low', 'Amount sits just under a common approval limit',
      `${fmt(amount)} is within 1% below ${fmt(limit)}, a pattern seen when payments are structured to avoid review.`);
  }
}

function checkDates(doc, add, today) {
  const f = doc.fields;
  const pairs = [
    ['issue_date', 'due_date', 'Due date is before the issue date'],
    ['order_date', 'delivery_date', 'Delivery date is before the order date'],
    ['effective_date', 'end_date', 'End date is before the effective date'],
    ['period_start', 'period_end', 'Statement period ends before it starts'],
  ];
  for (const [a, b, title] of pairs) {
    if (f[a] && f[b] && f[b] < f[a]) add('DATE_ORDER', 'medium', title, `${f[b]} comes before ${f[a]}.`);
  }
  if (doc.doc_date && doc.doc_date > today && doc.doc_type !== 'contract') {
    add('FUTURE_DATE', 'medium', 'Document is dated in the future', `The document date ${doc.doc_date} is after today (${today}).`);
  }
  if (doc.doc_date && ['invoice', 'receipt'].includes(doc.doc_type) && new Date(doc.doc_date + 'T00:00:00Z').getUTCDay() === 0) {
    add('WEEKEND_DATE', 'low', 'Issued on a Sunday', `${doc.doc_date} falls on a Sunday, which is unusual for business documents.`);
  }
}

function checkCompleteness(doc, add) {
  const f = doc.fields;
  const required = {
    invoice: [['invoice_number', 'invoice number'], ['vendor', 'vendor'], ['issue_date', 'issue date'], ['total', 'total']],
    receipt: [['receipt_number', 'receipt number'], ['merchant', 'merchant'], ['date', 'date'], ['total', 'total']],
    purchase_order: [['po_number', 'PO number'], ['vendor', 'vendor'], ['order_date', 'order date'], ['total', 'total']],
    contract: [['party_a', 'first party'], ['party_b', 'second party'], ['effective_date', 'effective date']],
    bank_statement: [['account_number', 'account number'], ['opening_balance', 'opening balance'], ['closing_balance', 'closing balance']],
  }[doc.doc_type];
  if (!required) return;
  const missing = required.filter(([key]) => f[key] == null || f[key] === '').map(([, label]) => label);
  if (missing.length) {
    add('MISSING_FIELDS', missing.length >= 2 ? 'medium' : 'low', 'Key details are missing',
      `Could not find: ${missing.join(', ')}.`);
  }
}

function checkTypeSpecific(doc, add) {
  const f = doc.fields;
  if (doc.doc_type === 'invoice' && f.tax_id && f.tax_id_kind === 'GSTIN' && !GSTIN_RE.test(f.tax_id)) {
    add('INVALID_TAX_ID', 'medium', 'GSTIN is not in a valid format', `"${f.tax_id}" does not match the 15-character GSTIN structure.`);
  }
  if (doc.doc_type === 'receipt' && /cash/i.test(f.payment_method || '') && doc.amount >= 10000) {
    add('LARGE_CASH', 'medium', 'Large cash payment', `${fmt(doc.amount)} was paid in cash, which leaves no banking trail.`);
  }
  if (doc.doc_type === 'contract') {
    if ((f.signature_count || 0) < 2) {
      add('MISSING_SIGNATURE', 'medium', 'Contract is not signed by both parties',
        `Found ${f.signature_count || 0} completed signature${f.signature_count === 1 ? '' : 's'}; expected at least 2.`);
    }
    if (!f.end_date && !f.term) {
      add('NO_END_DATE', 'low', 'No end date or term', 'The contract does not state when it ends.');
    }
    if (f.auto_renewal) {
      add('AUTO_RENEWAL', 'low', 'Auto-renewal clause', 'The contract renews automatically unless notice is given.');
    }
  }
  if (doc.doc_type === 'bank_statement') {
    const tx = f.transactions || [];
    const breaks = tx.map((t, i) => ({ t, i })).filter(({ t }) => t.consistent === false);
    if (breaks.length) {
      add('BALANCE_BREAK', 'high', 'Running balance does not follow from the transactions',
        breaks.slice(0, 3).map(({ t, i }) => `Row ${i + 1} (${t.date}, ${t.description}): amount ${fmt(t.amount)} does not explain the balance of ${fmt(t.balance)}`).join('; ') + '.');
    }
    if (tx.length && f.opening_balance != null && f.closing_balance != null) {
      const expected = round2(f.opening_balance + f.total_credits - f.total_debits);
      if (!near(expected, f.closing_balance)) {
        add('STATEMENT_MISMATCH', 'high', 'Closing balance does not reconcile',
          `Opening ${fmt(f.opening_balance)} + credits ${fmt(f.total_credits)} − debits ${fmt(f.total_debits)} = ${fmt(expected)}, but the closing balance is ${fmt(f.closing_balance)}.`);
      }
    }
  }
}

function checkAgainstOthers(doc, others, add) {
  const earlier = others.filter((o) => o.id < doc.id);
  const copy = earlier.find((o) => o.sha256 === doc.sha256);
  if (copy) {
    add('DUPLICATE_FILE', 'high', 'Exact duplicate of an earlier upload', `This file is identical to document #${copy.id} (${copy.filename}).`, copy.id);
    return;
  }
  if (doc.doc_number && doc.doc_type !== 'bank_statement') {
    const dup = earlier.find((o) => o.doc_type === doc.doc_type && o.doc_number === doc.doc_number && sameParty(o.counterparty, doc.counterparty));
    if (dup) {
      add('DUPLICATE_NUMBER', 'high', 'Document number already submitted',
        `${doc.doc_number} from ${doc.counterparty} was already recorded as document #${dup.id} (${dup.filename}). This may be a double billing.`, dup.id);
    } else if (doc.amount != null && doc.doc_date) {
      const twin = earlier.find((o) => o.doc_type === doc.doc_type && o.amount === doc.amount && o.doc_date &&
        sameParty(o.counterparty, doc.counterparty) && Math.abs(daysBetween(o.doc_date, doc.doc_date)) <= 7);
      if (twin) {
        add('SIMILAR_DOCUMENT', 'medium', 'Same party and amount within a week',
          `Document #${twin.id} (${twin.doc_number || twin.filename}) has the same counterparty and amount, dated ${twin.doc_date}.`, twin.id);
      }
    }
  }
  if (doc.doc_type === 'invoice' && doc.fields.po_reference) {
    const po = others.find((o) => o.doc_type === 'purchase_order' && o.doc_number === doc.fields.po_reference);
    if (po) {
      if (po.amount != null && doc.amount != null && doc.amount > po.amount * 1.02) {
        add('PO_OVERBILLING', 'high', 'Invoice exceeds the purchase order',
          `Invoice total ${fmt(doc.amount)} is ${fmt(round2(doc.amount - po.amount))} (${(((doc.amount - po.amount) / po.amount) * 100).toFixed(1)}%) above ${po.doc_number} (${fmt(po.amount)}).`, po.id);
      }
      if (po.counterparty && doc.counterparty && !sameParty(po.counterparty, doc.counterparty)) {
        add('PO_VENDOR_MISMATCH', 'medium', 'Vendor differs from the purchase order',
          `The invoice is from ${doc.counterparty} but ${po.doc_number} was issued to ${po.counterparty}.`, po.id);
      }
    }
  }
}

function assess(doc, others, today = new Date().toISOString().slice(0, 10)) {
  const flags = [];
  const add = (code, severity, title, detail, related_id) => flags.push({ code, severity, title, detail, related_id: related_id || null });

  if (!doc.text || doc.text.trim().length < 20) {
    add('NO_TEXT', 'medium', 'No readable text', 'OCR could not read this document, so nothing was verified.');
  } else {
    if (doc.ocr_method === 'tesseract' && doc.ocr_confidence != null && doc.ocr_confidence < 65) {
      add('LOW_OCR_CONFIDENCE', 'low', 'Low OCR confidence', `Text was read with ${Math.round(doc.ocr_confidence)}% confidence. Check the extracted values against the original.`);
    }
    checkCompleteness(doc, add);
    checkArithmetic(doc, add);
    checkAmountPatterns(doc, add);
    checkDates(doc, add, today);
    checkTypeSpecific(doc, add);
  }
  checkAgainstOthers(doc, others, add);

  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  const score = Math.min(100, flags.reduce((s, f) => s + WEIGHT[f.severity], 0));
  return { flags, risk_score: score, risk_level: score >= 40 ? 'high' : score >= 18 ? 'medium' : 'low' };
}

module.exports = { assess };
