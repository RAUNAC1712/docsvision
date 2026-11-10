'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const db = require('./db');
const { readDocument } = require('./ocr');
const { analyse, DOC_TYPES, FIELD_DEFS } = require('./extract');
const { assess } = require('./fraud');
const { compare } = require('./compare');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 10 } });
app.use(express.json());

const httpError = (status, message) => Object.assign(new Error(message), { status });
const round2 = (n) => Math.round(n * 100) / 100;
const listView = ({ text, ...doc }) => doc;

function reassessAll() {
  const docs = db.all();
  for (const doc of docs) {
    const result = assess(doc, docs.filter((d) => d.id !== doc.id));
    if (result.risk_score !== doc.risk_score || JSON.stringify(result.flags) !== JSON.stringify(doc.flags)) {
      db.update(doc.id, result);
    }
  }
}

async function ingest(filename, buffer) {
  const read = await readDocument(filename, buffer);
  const stored_name = `${crypto.randomUUID()}${read.ext}`;
  const stored_path = path.join(db.UPLOAD_DIR, stored_name);
  fs.writeFileSync(stored_path, buffer);
  let id;
  try {
    id = db.insert({
      filename,
      stored_name,
      mime: read.mime,
      size: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      uploaded_at: new Date().toISOString(),
      type_overridden: false,
      ocr_method: read.ocr_method,
      ocr_confidence: read.ocr_confidence,
      pages: read.pages,
      text: read.text,
      flags: [],
      risk_score: 0,
      risk_level: 'low',
      ...analyse(read.text),
    });
  } catch (err) {
    fs.rmSync(stored_path, { force: true });
    throw err;
  }
  reassessAll();
  return db.get(id);
}

function requireDoc(req) {
  const doc = db.get(Number(req.params.id));
  if (!doc) throw httpError(404, 'Document not found.');
  return doc;
}

app.get('/api/meta', (req, res) => {
  res.json({ types: DOC_TYPES, fields: FIELD_DEFS, max_file_bytes: MAX_FILE_BYTES });
});

app.get('/api/documents', (req, res) => {
  res.json(db.all().reverse().map(listView));
});

app.post('/api/documents', upload.array('files', 10), async (req, res) => {
  if (!req.files || !req.files.length) throw httpError(400, 'No file was uploaded.');
  const results = [];
  for (const file of req.files) {
    // Multer decodes multipart filenames as latin1.
    const filename = path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    try {
      results.push({ ok: true, document: listView(await ingest(filename, file.buffer)) });
    } catch (err) {
      results.push({ ok: false, filename, error: err.message });
    }
  }
  res.status(results.some((r) => r.ok) ? 201 : 422).json(results);
});

app.get('/api/documents/:id', (req, res) => {
  res.json(requireDoc(req));
});

app.get('/api/documents/:id/file', (req, res) => {
  const doc = requireDoc(req);
  res.set({
    'Content-Type': doc.mime === 'text/plain' ? 'text/plain; charset=utf-8' : doc.mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
  });
  res.sendFile(doc.stored_name, { root: db.UPLOAD_DIR });
});

app.patch('/api/documents/:id', (req, res) => {
  const doc = requireDoc(req);
  const type = req.body && req.body.doc_type;
  if (type !== 'auto' && !DOC_TYPES[type]) throw httpError(400, 'Unknown document type.');
  db.update(doc.id, { ...analyse(doc.text, type === 'auto' ? null : type), type_overridden: type !== 'auto' });
  reassessAll();
  res.json(db.get(doc.id));
});

app.delete('/api/documents/:id', (req, res) => {
  const doc = requireDoc(req);
  db.remove(doc.id);
  fs.rmSync(path.join(db.UPLOAD_DIR, doc.stored_name), { force: true });
  reassessAll();
  res.status(204).end();
});

app.get('/api/compare', (req, res) => {
  const a = db.get(Number(req.query.a));
  const b = db.get(Number(req.query.b));
  if (!a || !b) throw httpError(404, 'Pick two documents to compare.');
  if (a.id === b.id) throw httpError(400, 'Pick two different documents.');
  res.json({ a: listView(a), b: listView(b), ...compare(a, b) });
});

app.post('/api/samples', async (req, res) => {
  const existing = new Set(db.all().map((d) => d.sha256));
  const files = fs.existsSync(SAMPLES_DIR) ? fs.readdirSync(SAMPLES_DIR).sort() : [];
  const out = { added: 0, skipped: 0, errors: [] };
  for (const name of files) {
    const buffer = fs.readFileSync(path.join(SAMPLES_DIR, name));
    if (existing.has(crypto.createHash('sha256').update(buffer).digest('hex'))) {
      out.skipped++;
      continue;
    }
    try {
      await ingest(name, buffer);
      out.added++;
    } catch (err) {
      out.errors.push(`${name}: ${err.message}`);
    }
  }
  res.json(out);
});

app.get('/api/analytics', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const days = Number(req.query.days) || 0;
  const since = days ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : null;
  const when = (d) => d.doc_date && d.doc_date <= today ? d.doc_date : d.uploaded_at.slice(0, 10);
  const docs = db.all().filter((d) => (!req.query.type || d.doc_type === req.query.type) && (!since || when(d) >= since));

  const currencyCounts = {};
  for (const d of docs) if (d.amount != null) currencyCounts[d.currency] = (currencyCounts[d.currency] || 0) + 1;
  const currencies = Object.keys(currencyCounts).sort((a, b) => currencyCounts[b] - currencyCounts[a]);
  const currency = currencies[0] || 'INR';
  const value = (d) => (d.amount != null && d.currency === currency ? d.amount : 0);
  const sum = (list) => round2(list.reduce((s, d) => s + value(d), 0));
  const flagged = docs.filter((d) => d.risk_level !== 'low');
  const scanned = docs.filter((d) => d.ocr_method === 'tesseract' && d.ocr_confidence != null);

  const by_type = Object.keys(DOC_TYPES)
    .map((type) => {
      const list = docs.filter((d) => d.doc_type === type);
      return { type, label: DOC_TYPES[type].plural, count: list.length, value: sum(list) };
    })
    .filter((t) => t.type !== 'other' || t.count);

  const months = {};
  for (const d of docs) {
    const key = when(d).slice(0, 7);
    months[key] = months[key] || { month: key, count: 0, value: 0 };
    months[key].count++;
    months[key].value = round2(months[key].value + value(d));
  }
  const by_month = [];
  const keys = Object.keys(months).sort();
  if (keys.length) {
    let [y, m] = keys[0].split('-').map(Number);
    const last = keys[keys.length - 1];
    for (let guard = 0; guard < 240; guard++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      by_month.push(months[key] || { month: key, count: 0, value: 0 });
      if (key === last) break;
      if (++m > 12) [y, m] = [y + 1, 1];
    }
  }

  const parties = {};
  for (const d of docs) {
    if (!d.counterparty || !value(d)) continue;
    const key = d.counterparty.toLowerCase().replace(/[^a-z0-9]/g, '');
    parties[key] = parties[key] || { name: d.counterparty, count: 0, value: 0 };
    parties[key].count++;
    parties[key].value = round2(parties[key].value + value(d));
  }

  const flagCounts = {};
  for (const d of docs) {
    for (const f of d.flags) {
      flagCounts[f.code] = flagCounts[f.code] || { code: f.code, title: f.title, severity: f.severity, count: 0 };
      flagCounts[f.code].count++;
    }
  }

  res.json({
    currency,
    other_currencies: currencies.slice(1),
    kpis: {
      documents: docs.length,
      total_value: sum(docs),
      flagged: flagged.length,
      high_risk: docs.filter((d) => d.risk_level === 'high').length,
      value_at_risk: sum(flagged),
      scanned: scanned.length,
      avg_ocr_confidence: scanned.length ? Math.round(scanned.reduce((s, d) => s + d.ocr_confidence, 0) / scanned.length) : null,
    },
    by_type,
    by_risk: ['low', 'medium', 'high'].map((level) => ({ level, count: docs.filter((d) => d.risk_level === level).length })),
    by_month: by_month.slice(-12),
    top_counterparties: Object.values(parties).sort((a, b) => b.value - a.value).slice(0, 6),
    top_flags: Object.values(flagCounts)
      .sort((a, b) => b.count - a.count || 'hml'.indexOf(a.severity[0]) - 'hml'.indexOf(b.severity[0]))
      .slice(0, 6),
    flagged: flagged
      .sort((a, b) => b.risk_score - a.risk_score || b.id - a.id)
      .slice(0, 8)
      .map((d) => ({
        id: d.id, filename: d.filename, doc_type: d.doc_type, counterparty: d.counterparty, amount: d.amount, currency: d.currency,
        risk_score: d.risk_score, risk_level: d.risk_level, flag_count: d.flags.length, top_flag: d.flags[0] ? d.flags[0].title : null,
      })),
  });
});

app.use('/samples', express.static(SAMPLES_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong.';
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` : err.message;
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, HOST, () => {
  console.log(`DocLens is running at http://localhost:${PORT}`);
});
