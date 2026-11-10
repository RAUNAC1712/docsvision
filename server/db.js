'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'doclens.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    type_confidence INTEGER NOT NULL DEFAULT 0,
    type_overridden INTEGER NOT NULL DEFAULT 0,
    ocr_method TEXT NOT NULL,
    ocr_confidence REAL,
    pages INTEGER,
    text TEXT NOT NULL DEFAULT '',
    currency TEXT,
    doc_number TEXT,
    counterparty TEXT,
    doc_date TEXT,
    amount REAL,
    fields TEXT NOT NULL DEFAULT '{}',
    flags TEXT NOT NULL DEFAULT '[]',
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'low'
  );
  CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents (sha256);
`);

const COLUMNS = [
  'filename', 'stored_name', 'mime', 'size', 'sha256', 'uploaded_at', 'doc_type', 'type_confidence', 'type_overridden',
  'ocr_method', 'ocr_confidence', 'pages', 'text', 'currency', 'doc_number', 'counterparty', 'doc_date', 'amount',
  'fields', 'flags', 'risk_score', 'risk_level',
];

function hydrate(row) {
  if (!row) return null;
  return { ...row, type_overridden: !!row.type_overridden, fields: JSON.parse(row.fields), flags: JSON.parse(row.flags) };
}

function dehydrate(doc) {
  const out = {};
  for (const c of COLUMNS) {
    if (!(c in doc)) continue;
    let v = doc[c];
    if (c === 'fields' || c === 'flags') v = JSON.stringify(v);
    else if (typeof v === 'boolean') v = v ? 1 : 0;
    else if (v === undefined) v = null;
    out[c] = v;
  }
  return out;
}

const insertStmt = db.prepare(
  `INSERT INTO documents (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`
);

module.exports = {
  DATA_DIR,
  UPLOAD_DIR,
  all: () => db.prepare('SELECT * FROM documents ORDER BY id').all().map(hydrate),
  get: (id) => hydrate(db.prepare('SELECT * FROM documents WHERE id = ?').get(id)),
  insert(doc) {
    const row = dehydrate(doc);
    const { lastInsertRowid } = insertStmt.run(...COLUMNS.map((c) => (c in row ? row[c] : null)));
    return Number(lastInsertRowid);
  },
  update(id, patch) {
    const row = dehydrate(patch);
    const keys = Object.keys(row);
    if (!keys.length) return;
    db.prepare(`UPDATE documents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => row[k]), id);
  },
  remove: (id) => db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0,
};
