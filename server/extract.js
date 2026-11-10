'use strict';

const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || 'INR';

const DOC_TYPES = {
  invoice: { label: 'Invoice', plural: 'Invoices' },
  receipt: { label: 'Receipt', plural: 'Receipts' },
  purchase_order: { label: 'Purchase order', plural: 'Purchase orders' },
  contract: { label: 'Contract', plural: 'Contracts' },
  bank_statement: { label: 'Bank statement', plural: 'Bank statements' },
  other: { label: 'Other', plural: 'Other' },
};

// Field order and display kind for each type; the UI renders from this.
const FIELD_DEFS = {
  invoice: [
    ['invoice_number', 'Invoice number', 'text'],
    ['vendor', 'Vendor', 'text'],
    ['customer', 'Billed to', 'text'],
    ['issue_date', 'Issue date', 'date'],
    ['due_date', 'Due date', 'date'],
    ['po_reference', 'PO reference', 'text'],
    ['tax_id', 'Tax ID', 'text'],
    ['subtotal', 'Subtotal', 'money'],
    ['tax', 'Tax', 'money'],
    ['total', 'Total', 'money'],
  ],
  receipt: [
    ['receipt_number', 'Receipt number', 'text'],
    ['merchant', 'Merchant', 'text'],
    ['date', 'Date', 'date'],
    ['payment_method', 'Payment method', 'text'],
    ['subtotal', 'Subtotal', 'money'],
    ['tax', 'Tax', 'money'],
    ['total', 'Total', 'money'],
  ],
  purchase_order: [
    ['po_number', 'PO number', 'text'],
    ['buyer', 'Buyer', 'text'],
    ['vendor', 'Vendor', 'text'],
    ['order_date', 'Order date', 'date'],
    ['delivery_date', 'Delivery date', 'date'],
    ['subtotal', 'Subtotal', 'money'],
    ['tax', 'Tax', 'money'],
    ['total', 'Total', 'money'],
  ],
  contract: [
    ['title', 'Title', 'text'],
    ['party_a', 'First party', 'text'],
    ['party_b', 'Second party', 'text'],
    ['effective_date', 'Effective date', 'date'],
    ['end_date', 'End date', 'date'],
    ['term', 'Term', 'text'],
    ['contract_value', 'Contract value', 'money'],
    ['governing_law', 'Governing law', 'text'],
    ['signature_count', 'Signatures found', 'number'],
    ['auto_renewal', 'Auto-renewal clause', 'bool'],
  ],
  bank_statement: [
    ['bank', 'Bank', 'text'],
    ['account_holder', 'Account holder', 'text'],
    ['account_number', 'Account number', 'text'],
    ['period_start', 'Period start', 'date'],
    ['period_end', 'Period end', 'date'],
    ['opening_balance', 'Opening balance', 'money'],
    ['total_credits', 'Total credits', 'money'],
    ['total_debits', 'Total debits', 'money'],
    ['closing_balance', 'Closing balance', 'money'],
  ],
  other: [],
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_NAMES = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const DATE_SRC = [
  '\\d{4}-\\d{1,2}-\\d{1,2}',
  '\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}',
  `\\d{1,2}(?:st|nd|rd|th)?[\\s\\-]+${MONTH_NAMES}\\.?,?[\\s\\-]+\\d{2,4}`,
  `${MONTH_NAMES}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`,
].join('|');
const DATE_RE = new RegExp(`\\b(?:${DATE_SRC})\\b`, 'i');
const DATE_RE_G = new RegExp(`\\b(?:${DATE_SRC})\\b`, 'gi');

function iso(y, m, d) {
  if (y < 100) y += 2000;
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) {
    let d = +m[1];
    let mo = +m[2];
    // Day-first by default; flip only when the first part cannot be a day-first date.
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return iso(+m[3], mo, d);
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([a-z]{3})[a-z]*\.?,?[\s\-]+(\d{2,4})$/))) {
    return iso(+m[3], MONTHS[m[2]], +m[1]);
  }
  if ((m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    return iso(+m[3], MONTHS[m[1]], +m[2]);
  }
  return null;
}

function toNumber(token) {
  const n = parseFloat(String(token).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Numeric tokens on a line that could be amounts: skips percentages, dates and
// digits glued to letters ("A4", "80gsm").
function amountTokens(line) {
  const cleaned = line.replace(DATE_RE_G, (d) => ' '.repeat(d.length));
  const out = [];
  const re = /\d[\d,]*(?:\.\d{1,2})?/g;
  let m;
  while ((m = re.exec(cleaned))) {
    const before = cleaned[m.index - 1] || ' ';
    const after = cleaned[m.index + m[0].length] || ' ';
    if (/[A-Za-z]/.test(before) || /[A-Za-z%]/.test(after)) continue;
    if (after === ' ' && cleaned[m.index + m[0].length + 1] === '%') continue;
    const n = toNumber(m[0].replace(/,+$/, ''));
    if (n !== null) out.push(n);
  }
  return out;
}

function findAmount(lines, labels, exclude) {
  for (const label of labels) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const m = line.match(label);
      if (!m || (exclude && exclude.test(line))) continue;
      const tokens = amountTokens(line.slice(m.index + m[0].length));
      if (tokens.length) return tokens[tokens.length - 1];
    }
  }
  return null;
}

function findDate(lines, labels) {
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(label);
      if (!m) continue;
      const rest = lines[i].slice(m.index + m[0].length);
      const d = rest.match(DATE_RE) || (lines[i + 1] && !rest.trim() ? lines[i + 1].match(DATE_RE) : null);
      const parsed = d && parseDate(d[0]);
      if (parsed) return parsed;
    }
  }
  return null;
}

function cleanValue(v) {
  return v
    .split(/\s{3,}|\t/)[0]
    .replace(/^[\s:#\-–.]+/, '')
    .replace(/[\s,;:]+$/, '')
    .slice(0, 90)
    .trim();
}

function findText(lines, labels) {
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(label);
      if (!m) continue;
      let value = cleanValue(lines[i].slice(m.index + m[0].length));
      if (!value) {
        const next = lines.slice(i + 1).find((l) => l.trim());
        value = next ? cleanValue(next) : '';
      }
      if (value && /[A-Za-z]/.test(value)) return value;
    }
  }
  return null;
}

function findNumberId(text, patterns) {
  for (const re of patterns) {
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
      if (/\d/.test(m[1])) return m[1].replace(/[.,;\-\/]+$/, '').toUpperCase();
    }
  }
  return null;
}

function firstHeading(lines, skip) {
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.length < 3 || !/[A-Za-z]{3}/.test(t)) continue;
    if (skip && skip.test(t)) continue;
    return titleCase(cleanValue(t));
  }
  return null;
}

// Letterheads are often ALL CAPS; normalise so the same party reads the same everywhere.
function titleCase(s) {
  if (!s || /[a-z]/.test(s)) return s;
  return s
    .split(' ')
    .map((tok) => (/^(?:[A-Z]{1,2}|LLP|LLC|USA)$/.test(tok) ? tok : tok.replace(/[A-Z]+/g, (w) => w[0] + w.slice(1).toLowerCase())))
    .join(' ');
}

function detectCurrency(text) {
  const counts = {
    INR: (text.match(/₹|\bRs\.?(?=\s|\d)|\bINR\b/g) || []).length,
    USD: (text.match(/\$|\bUSD\b/g) || []).length,
    EUR: (text.match(/€|\bEUR\b/g) || []).length,
    GBP: (text.match(/£|\bGBP\b/g) || []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : DEFAULT_CURRENCY;
}

const CUR = '(?:(?:Rs\\.?|INR|USD|EUR|GBP|[₹$€£])\\s*)?';
const LINE_ITEM_RE = new RegExp(
  `^\\s*(?:\\d{1,3}[.)]?\\s+)?(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s+${CUR}(\\d[\\d,]*\\.\\d{2})\\s+${CUR}(\\d[\\d,]*\\.\\d{2})\\s*$`,
  'i'
);

function parseLineItems(lines) {
  const items = [];
  for (const line of lines) {
    const m = line.match(LINE_ITEM_RE);
    if (!m || DATE_RE.test(m[1])) continue;
    items.push({
      description: m[1].replace(/\s{2,}/g, ' ').trim(),
      quantity: parseFloat(m[2]),
      unit_price: toNumber(m[3]),
      amount: toNumber(m[4]),
    });
  }
  return items;
}

function taxAmount(lines) {
  const skip = /tax\s*invoice|gstin|tax\s*id|vat\s*(?:no|id)|incl/i;
  const parts = [/\bcgst\b/i, /\bsgst\b/i, /\bigst\b/i]
    .map((re) => findAmount(lines, [re], skip))
    .filter((v) => v !== null);
  if (parts.length) return Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
  return findAmount(lines, [/\btotal\s*tax\b/i, /\btax\s*amount\b/i, /\b(?:gst|vat|sales\s*tax)\b/i, /\btax\b/i], skip);
}

function totals(lines) {
  const subtotal = findAmount(lines, [/\bsub\s*-?\s*total\b/i, /\btaxable\s*(?:value|amount)\b/i, /\bnet\s*amount\b/i]);
  const tax = taxAmount(lines);
  const total = findAmount(
    lines,
    [
      /\bgrand\s*total\b/i,
      /\b(?:total\s*amount|amount\s*due|total\s*due|balance\s*due|net\s*payable|total\s*payable|amount\s*payable|invoice\s*total|order\s*total|amount\s*paid|total\s*paid)\b/i,
      /\btotal\b/i,
    ],
    /sub\s*-?\s*total|total\s*(?:tax|credits?|debits?|items|qty|quantity)/i
  );
  return { subtotal, tax, total };
}

const TITLE_SKIP = /^(?:tax\s*)?invoice$|^(?:cash\s*)?receipt$|^purchase\s*order$|^bill$|^original|^page\b/i;

function extractInvoice(text, lines) {
  const taxIdMatch = text.match(/\b(GSTIN|GST\s*(?:No|Number)|Tax\s*ID|VAT\s*(?:No|ID)|TIN)\.?\s*[:#]?\s*([A-Z0-9]{8,20})\b/i);
  return {
    invoice_number: findNumberId(text, [
      /invoice\s*(?:no|number|num|#|id)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
      /\b(INV[-\/]?\d[\w\-\/]*)\b/i,
    ]),
    vendor:
      findText(lines, [/^\s*(?:vendor|seller|supplier|sold\s*by|billed\s*by|from)\s*[:\-]/i]) ||
      firstHeading(lines, TITLE_SKIP),
    customer: findText(lines, [/\b(?:bill(?:ed)?\s*to|customer|client|sold\s*to|buyer)\s*[:\-]/i, /\bbill(?:ed)?\s*to\b/i]),
    issue_date: findDate(lines, [/\b(?:invoice|issue|bill(?:ing)?)\s*date\b/i, /\bdated?\b/i]),
    due_date: findDate(lines, [/\b(?:due\s*date|payment\s*due|due\s*(?:on|by))\b/i]),
    po_reference: findNumberId(text, [
      /(?:purchase\s*order|p\.?\s?o\.?)\s*(?:no|number|num|#|ref(?:erence)?)?\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
    ]),
    tax_id: taxIdMatch ? taxIdMatch[2].toUpperCase() : null,
    tax_id_kind: taxIdMatch ? (/gst/i.test(taxIdMatch[1]) ? 'GSTIN' : 'OTHER') : null,
    ...totals(lines),
    line_items: parseLineItems(lines),
  };
}

function extractReceipt(text, lines) {
  const pay = text.match(/\b(cash|credit\s*card|debit\s*card|upi|net\s*banking|visa|mastercard|amex|wallet|card)\b/i);
  return {
    receipt_number: findNumberId(text, [
      /(?:receipt|bill|txn|transaction|order)\s*(?:no|number|#|id)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
    ]),
    merchant: firstHeading(lines, TITLE_SKIP),
    date: findDate(lines, [/\bdate\b/i]) || parseDate((text.match(DATE_RE) || [])[0]),
    payment_method: pay ? (/^upi$/i.test(pay[1]) ? 'UPI' : pay[1].toLowerCase().replace(/\s+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())) : null,
    ...totals(lines),
    line_items: parseLineItems(lines),
  };
}

function extractPurchaseOrder(text, lines) {
  return {
    po_number: findNumberId(text, [
      /(?:purchase\s*order|p\.?\s?o\.?)\s*(?:no|number|num|#)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i,
      /\b(PO[-\/]\d[\w\-\/]*)\b/i,
    ]),
    buyer:
      findText(lines, [/^\s*(?:buyer|purchaser|ordered\s*by|bill\s*to)\s*[:\-]/i]) || firstHeading(lines, TITLE_SKIP),
    vendor: findText(lines, [/^\s*(?:vendor|supplier|seller)\s*[:\-]/i, /^\s*to\s*[:\-]/i]),
    order_date: findDate(lines, [/\b(?:order|po)\s*date\b/i, /\bdated?\b/i]),
    delivery_date: findDate(lines, [/\b(?:delivery|deliver\s*by|required\s*by|ship)\s*(?:date)?\b/i]),
    ...totals(lines),
    line_items: parseLineItems(lines),
  };
}

function extractContract(text, lines) {
  const flat = text.replace(/\s+/g, ' ');
  const parties = flat.match(
    /\bbetween\s+(.{3,120}?)\s*(?:\([^)]{0,60}\))?\s*,?\s+and\s+(.{3,120}?)\s*(?:\(|,|\.\s|;)/i
  );
  const law = flat.match(/governed\s+by(?:\s+and\s+construed\s+in\s+accordance\s+with)?\s+the\s+laws\s+of\s+([A-Z][A-Za-z ,]{1,50}?)(?:[.;]|\s+and\b|$)/);
  const term = flat.match(/\b(?:term|period)\s+of\s+((?:[a-z\-]+\s*)?\(?\d*\)?\s*(?:months?|years?))/i);
  const signatures = lines.filter((l) => {
    const m = l.match(/^\s*(?:signed(?:\s*by)?|signature|sd\/-|\/s\/)\s*[:\-]?\s*(.*)$/i);
    return m && /[A-Za-z]{2}/.test(m[1].replace(/_+/g, ''));
  }).length;
  const clean = (s) => (s ? s.replace(/^(?:M\/s\.?\s*)/i, '').replace(/["“”]/g, '').trim() : null);
  return {
    title: firstHeading(lines),
    party_a: clean(parties && parties[1]) || findText(lines, [/^\s*(?:party\s*a|first\s*party|client|customer)\s*[:\-]/i]),
    party_b:
      clean(parties && parties[2]) ||
      findText(lines, [/^\s*(?:party\s*b|second\s*party|service\s*provider|contractor|vendor|consultant)\s*[:\-]/i]),
    effective_date: findDate(lines, [
      /\b(?:effective|commencement|start)\s*date\b/i,
      /\b(?:made|entered\s+into|dated)\s+(?:and\s+entered\s+into\s+)?(?:on|as\s+of)?\b/i,
    ]),
    end_date: findDate(lines, [/\b(?:end|expiry|expiration|termination)\s*date\b/i, /\b(?:expires?|valid)\s+(?:on|until|till)\b/i]),
    term: term ? term[1].replace(/\s+/g, ' ').trim() : null,
    contract_value: findAmount(lines, [
      /\b(?:contract\s*value|total\s*(?:contract\s*value|fees?|consideration)|consideration\s+of|fees?\s+of|sum\s+of)\b/i,
    ]),
    governing_law: law ? law[1].trim() : null,
    signature_count: signatures,
    auto_renewal: /automatically\s+renew|auto[\s-]?renew/i.test(flat),
  };
}

function maskAccount(raw) {
  const digits = raw.replace(/[^\dX*]/gi, '');
  return digits.length > 4 ? `${'•'.repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}` : digits;
}

function extractBankStatement(text, lines) {
  const acct = text.match(/(?:account|a\/c|acct)\.?\s*(?:no|number|#)\.?\s*[:#]?\s*([X*\d][X*\d \-]{5,24})/i);
  const period = text.match(new RegExp(`(?:period|from)\\s*[:\\-]?\\s*(${DATE_SRC})\\s*(?:to|-|–|until)\\s*(${DATE_SRC})`, 'i'));
  const opening = findAmount(lines, [/\bopening\s*balance\b/i, /\bbalance\s*(?:b\/f|brought\s*forward)\b/i]);
  const closing = findAmount(lines, [/\bclosing\s*balance\b/i, /\bbalance\s*(?:c\/f|carried\s*forward)\b/i]);

  const transactions = [];
  let prev = opening;
  const startRe = new RegExp(`^\\s*(${DATE_SRC})\\s+(.*)$`, 'i');
  for (const line of lines) {
    const m = line.match(startRe);
    if (!m || /opening\s*balance|closing\s*balance|b\/f|c\/f/i.test(line)) continue;
    const date = parseDate(m[1]);
    const amounts = (m[2].match(/\d[\d,]*\.\d{2}/g) || []).map(toNumber);
    if (!date || !amounts.length) continue;
    const description = m[2].split(/\s+(?:(?:Rs\.?|INR|[₹$€£])\s*)?\d[\d,]*\.\d{2}/)[0].replace(/\s{2,}/g, ' ').trim();
    let amount = amounts[0];
    let balance = amounts.length > 1 ? amounts[amounts.length - 1] : null;
    let marker = (m[2].match(/\b(CR|DR)\b/i) || [])[1];
    if (amounts.length >= 3) {
      // debit / credit / balance columns
      amount = amounts[0] || amounts[1];
      marker = amounts[0] ? 'DR' : 'CR';
    }
    let type;
    let consistent = null;
    if (balance !== null && prev !== null) {
      const delta = Math.round((balance - prev) * 100) / 100;
      consistent = Math.abs(Math.abs(delta) - amount) < 0.011;
      if (consistent) type = delta >= 0 ? 'credit' : 'debit';
    }
    if (!type) {
      if (marker) type = marker.toUpperCase() === 'CR' ? 'credit' : 'debit';
      else type = /deposit|receipt|refund|interest|inward|credit|received/i.test(description) ? 'credit' : 'debit';
    }
    transactions.push({ date, description, type, amount, balance, consistent });
    if (balance !== null) prev = balance;
  }

  const sum = (t) => Math.round(transactions.filter((x) => x.type === t).reduce((a, x) => a + x.amount, 0) * 100) / 100;
  return {
    bank: firstHeading(lines, /statement|account/i),
    account_holder: findText(lines, [/\b(?:account\s*holder|account\s*name|customer\s*name)\s*[:\-]/i]),
    account_number: acct ? maskAccount(acct[1]) : null,
    period_start: period ? parseDate(period[1]) : transactions.length ? transactions[0].date : null,
    period_end: period ? parseDate(period[2]) : transactions.length ? transactions[transactions.length - 1].date : null,
    opening_balance: opening,
    total_credits: transactions.length ? sum('credit') : null,
    total_debits: transactions.length ? sum('debit') : null,
    closing_balance: closing,
    transactions,
  };
}

const SIGNALS = {
  invoice: [
    [/\btax\s*invoice\b/i, 5], [/\binvoice\b/i, 3], [/\binvoice\s*(?:no|number|#|date)/i, 4], [/\bbill(?:ed)?\s*to\b/i, 3],
    [/\b(?:amount|balance|total)\s*due\b/i, 3], [/\bdue\s*date\b/i, 3], [/\bgstin\b/i, 1], [/\bpayment\s*terms\b/i, 1],
  ],
  receipt: [
    [/\breceipt\b/i, 5], [/\bcashier\b/i, 3], [/\bthank\s*you\b/i, 2], [/\b(?:amount\s*)?paid\b/i, 2], [/\bchange\b/i, 1],
    [/\b(?:upi|cash|card)\b/i, 2], [/\btxn\b/i, 2], [/\breceived\s*with\s*thanks\b/i, 4],
  ],
  purchase_order: [
    [/\bpurchase\s*order\b/i, 8], [/\bp\.?o\.?\s*(?:no|number|#)/i, 5], [/\bship\s*to\b/i, 2], [/\bdelivery\s*date\b/i, 3],
    [/\border\s*date\b/i, 3], [/\bbuyer\b/i, 2], [/\bauthori[sz]ed\s*by\b/i, 1],
  ],
  contract: [
    [/\bagreement\b/i, 4], [/\bcontract\b/i, 2], [/\bhereinafter\b/i, 4], [/\bwhereas\b/i, 3], [/\bparties\b/i, 2],
    [/\bgoverning\s*law\b|\bgoverned\s+by\b/i, 4], [/\bterminat(?:e|ion)\b/i, 2], [/\bconfidential/i, 2],
    [/\bin\s*witness\s*whereof\b/i, 4], [/\bindemnif/i, 2], [/\beffective\s*date\b/i, 2],
  ],
  bank_statement: [
    [/\b(?:bank|account)\s*statement\b|\bstatement\s*of\s*account\b/i, 8], [/\bopening\s*balance\b/i, 5],
    [/\bclosing\s*balance\b/i, 5], [/\baccount\s*(?:no|number|holder)\b/i, 3], [/\bifsc\b|\bswift\b|\biban\b/i, 3],
    [/\bwithdrawals?\b|\bdeposits?\b/i, 2], [/\bstatement\s*period\b/i, 4], [/\b(?:neft|imps|rtgs|ach)\b/i, 2],
  ],
};

function classify(text) {
  const scores = Object.entries(SIGNALS)
    .map(([type, signals]) => [type, signals.reduce((s, [re, w]) => s + (re.test(text) ? w : 0), 0)])
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (best[1] < 4) return { type: 'other', confidence: 0, scores: Object.fromEntries(scores) };
  const confidence = Math.round(Math.min(0.99, 0.5 + (best[1] - second[1]) / (2 * best[1])) * 100);
  return { type: best[0], confidence, scores: Object.fromEntries(scores) };
}

const EXTRACTORS = {
  invoice: extractInvoice,
  receipt: extractReceipt,
  purchase_order: extractPurchaseOrder,
  contract: extractContract,
  bank_statement: extractBankStatement,
  other: () => ({}),
};

// Normalised columns every document shares, used for search, duplicates and analytics.
function summarise(type, f) {
  switch (type) {
    case 'invoice':
      return { doc_number: f.invoice_number, counterparty: f.vendor, doc_date: f.issue_date, amount: f.total };
    case 'receipt':
      return { doc_number: f.receipt_number, counterparty: f.merchant, doc_date: f.date, amount: f.total };
    case 'purchase_order':
      return { doc_number: f.po_number, counterparty: f.vendor, doc_date: f.order_date, amount: f.total };
    case 'contract':
      return { doc_number: null, counterparty: f.party_b, doc_date: f.effective_date, amount: f.contract_value };
    case 'bank_statement':
      return { doc_number: f.account_number, counterparty: f.account_holder || f.bank, doc_date: f.period_end, amount: null };
    default:
      return { doc_number: null, counterparty: null, doc_date: null, amount: null };
  }
}

function analyse(text, forcedType) {
  const normalised = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
  const lines = normalised.split('\n');
  const cls = classify(normalised);
  const type = forcedType && EXTRACTORS[forcedType] ? forcedType : cls.type;
  const fields = EXTRACTORS[type](normalised, lines);
  return {
    doc_type: type,
    type_confidence: forcedType ? 100 : cls.confidence,
    currency: detectCurrency(normalised),
    fields,
    ...summarise(type, fields),
  };
}

module.exports = { analyse, classify, parseDate, DOC_TYPES, FIELD_DEFS };
