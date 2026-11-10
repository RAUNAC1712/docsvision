'use strict';

const path = require('node:path');
const { DATA_DIR } = require('./db');

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/plain',
};

function looksLike(ext, buf) {
  const head = buf.subarray(0, 12);
  switch (ext) {
    case '.png': return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case '.jpg':
    case '.jpeg': return head[0] === 0xff && head[1] === 0xd8;
    case '.webp': return head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP';
    case '.bmp': return head.subarray(0, 2).toString() === 'BM';
    case '.pdf': return head.subarray(0, 4).toString() === '%PDF';
    default: return !buf.subarray(0, 4096).includes(0);
  }
}

let workerPromise = null;
let queue = Promise.resolve();

function getWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker('eng', 1, { cachePath: DATA_DIR }).catch((err) => {
      workerPromise = null;
      throw new Error(`OCR engine could not start (${err.message || err}). The first run needs internet access to download language data.`);
    });
  }
  return workerPromise;
}

// Tesseract handles one image at a time per worker, so jobs are serialised.
function recognise(buffer) {
  const job = queue.then(async () => {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    return { text: data.text || '', confidence: data.confidence };
  });
  queue = job.catch(() => {});
  return job;
}

async function readDocument(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  const mime = TYPES[ext];
  if (!mime) {
    const err = new Error(`Unsupported file type "${ext || filename}". Upload a PNG, JPG, WEBP, BMP, PDF or TXT file.`);
    err.status = 415;
    throw err;
  }
  if (!looksLike(ext, buffer)) {
    const err = new Error(`"${filename}" does not look like a valid ${ext.slice(1).toUpperCase()} file.`);
    err.status = 415;
    throw err;
  }

  if (mime.startsWith('image/')) {
    const { text, confidence } = await recognise(buffer);
    return { ext, mime, text, ocr_method: 'tesseract', ocr_confidence: confidence, pages: 1 };
  }
  if (mime === 'application/pdf') {
    const { PDFParse } = require('pdf-parse');
    // A private copy: the PDF engine may take ownership of the bytes it is given.
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const text = (result.text || '').replace(/^\s*-- \d+ of \d+ --\s*$/gm, '').trim();
      return { ext, mime, text, ocr_method: 'pdf-text', ocr_confidence: null, pages: result.total };
    } catch (err) {
      throw Object.assign(new Error(`Could not read "${filename}" as a PDF (${err.message}).`), { status: 422 });
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  return { ext, mime, text: buffer.toString('utf8').replace(/^﻿/, ''), ocr_method: 'plain-text', ocr_confidence: null, pages: 1 };
}

module.exports = { readDocument, TYPES };
