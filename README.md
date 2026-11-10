# DocLens — Document Intelligence & Fraud Detection

DocLens is an offline, privacy-first document intelligence platform that extracts structured financial data, detects fraud and discrepancies, and compares documents (invoices, receipts, purchase orders, contracts, and bank statements).

Everything runs locally on your machine. Documents are never transmitted to external servers, cloud providers, or third-party APIs.

---

## Table of Contents

- [Key Features](#key-features)
- [How DocLens Works](#how-doclens-works)
  - [1. Ingestion & Preprocessing](#1-ingestion--preprocessing)
  - [2. OCR & Text Extraction](#2-ocr--text-extraction)
  - [3. Entity & Field Extraction](#3-entity--field-extraction)
  - [4. Fraud & Anomaly Detection Engine](#4-fraud--anomaly-detection-engine)
  - [5. Document Comparison Engine](#5-document-comparison-engine)
  - [6. Local Database & Storage](#6-local-database--storage)
- [Quick Start Guide](#quick-start-guide)
  - [Method 1: One-Click Startup (Windows .bat)](#method-1-one-click-startup-windows-bat)
  - [Method 2: Manual Command Line](#method-2-manual-command-line)
- [Supported Document Types & Extracted Fields](#supported-document-types--extracted-fields)
- [Fraud Detection Rules & Risk Scoring](#fraud-detection-rules--risk-scoring)
- [Side-by-Side Comparison & PO Matching](#side-by-side-comparison--po-matching)
- [Sample Documents & Test Scenarios](#sample-documents--test-scenarios)
- [REST API Reference](#rest-api-reference)
- [Configuration & Environment Variables](#configuration--environment-variables)
- [Project Directory Structure](#project-directory-structure)
- [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Key Features

- **100% Local & Privacy-Preserving**: No cloud dependencies or internet access required after initial installation.
- **Multimodal Document Support**: Processes images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`), PDFs (`.pdf`), plain text (`.txt`), and CSVs (`.csv`).
- **Automated Document Classification**: Automatically classifies documents as Invoices, Receipts, Purchase Orders, Contracts, or Bank Statements with confidence scoring.
- **Table & Line-Item Extraction**: Parses detailed item descriptions, quantities, unit prices, and line totals.
- **Heuristic Fraud Detection**: 18+ automated fraud and anomaly checks including arithmetic reconciliation, double-billing, purchase order overbilling, altered bank balances, missing signatures, and round-figure structuring.
- **Intelligent 2-Way Comparison**: Side-by-side diffing, cross-type field mapping (e.g. Purchase Order vs. Invoice), fuzzy item matching, and text-level Longest Common Subsequence (LCS) diffing.
- **Zero-Setup Embedded Database**: Built on Node.js native `node:sqlite` (`DatabaseSync`), requiring zero external database installations or configurations.
- **Fast, Lightweight Web UI**: Instant-loading single-page application built with vanilla JavaScript, modern CSS, and no complex frontend build steps.

---

## How DocLens Works

```
                               ┌─────────────────────────────────────────────────────────────┐
                               │                    Incoming Document                        │
                               │        (PNG, JPG, WEBP, BMP, PDF, TXT, CSV)                 │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                                              ▼
                               ┌─────────────────────────────────────────────────────────────┐
                               │                   Format-Specific OCR /                     │
                               │                      Text Extraction                        │
                               │  - Tesseract.js (Images)                                    │
                               │  - pdf-parse (PDFs)                                         │
                               │  - UTF-8 Stream Decoder (TXT / CSV)                         │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                                              ▼
                               ┌─────────────────────────────────────────────────────────────┐
                               │                 Information Extraction Engine               │
                               │  - Document Type Classifier (Keyword frequency & layout)    │
                               │  - Field Extractors (Regex heuristics, currencies, dates)   │
                               │  - Tabular Line Items & Transaction Reconciler              │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                                              ▼
                               ┌─────────────────────────────────────────────────────────────┐
                               │                 Fraud & Risk Assessment Engine              │
                               │  - Arithmetic Reconciliation (Subtotal + Tax = Total)       │
                               │  - Line Item Math Check (Qty x Unit Price = Amount)         │
                               │  - Structured Thresholds & Round Amounts                    │
                               │  - Date Sequence & Future Date Verification                 │
                               │  - GSTIN / Tax ID Format Validator                          │
                               │  - Contract Signatures & Auto-Renewal Clauses               │
                               │  - Bank Statement Running Balance Integrity                 │
                               │  - Cross-Doc Check (SHA-256 Duplicates, PO Overbilling)     │
                               └──────────────────────────────┬──────────────────────────────┘
                                                              │
                                                              ▼
                               ┌─────────────────────────────────────────────────────────────┐
                               │               Storage & Presentation Layer                  │
                               │  - Local SQLite Database (data/doclens.db)                  │
                               │  - Original File Store (data/uploads/)                      │
                               │  - Real-time Analytics Dashboard & Comparison Workspace    │
                               └─────────────────────────────────────────────────────────────┘
```

### 1. Ingestion & Preprocessing
When files are uploaded through the browser (`/api/documents`):
1. **Multer** receives the multipart file stream in memory (up to 15 MB per file, up to 10 files per batch).
2. The file's MIME type and magic byte signatures are inspected (`looksLike()` in `server/ocr.js`) to prevent file extension spoofing.
3. A unique UUID is assigned and the raw file is persisted inside `data/uploads/`.
4. A SHA-256 cryptographic hash of the document buffer is computed to enable exact-duplicate detection.

### 2. OCR & Text Extraction (`server/ocr.js`)
Depending on the file format:
- **Scanned Images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`)**: Processed using **Tesseract.js** in a serial worker queue. DocLens uses the pre-downloaded English trained data cached in `data/eng.traineddata`, ensuring OCR operates without network calls.
- **PDF Documents (`.pdf`)**: Parsed using **pdf-parse** to extract embedded text layers and calculate page counts.
- **Plain Text / CSV (`.txt`, `.csv`)**: Read directly via Node's native UTF-8 buffer decoding.

### 3. Entity & Field Extraction (`server/extract.js`)
Once raw text is available, DocLens extracts structured data:
- **Type Classification**: Scores keyword occurrences across 6 categories (`invoice`, `receipt`, `purchase_order`, `contract`, `bank_statement`, `other`). The type with the highest confidence is selected automatically (and can be manually overridden in the UI).
- **Date Parser**: Normalizes diverse date formats (ISO `YYYY-MM-DD`, slash/dash formats `DD/MM/YYYY` or `MM/DD/YYYY`, and month names like `12 Aug 2026`) into standard ISO format.
- **Currency & Amount Detection**: Identifies INR (₹, Rs.), USD ($), EUR (€), GBP (£), etc., and normalizes formatted numbers with commas.
- **Counterparties & References**: Extracts vendor/merchant names, buyers, customer names, PO numbers, and invoice identifiers.
- **Line-Item Tables**: Recognizes tabular structures, parsing item descriptions, quantities, unit prices, and line totals.
- **Bank Statement Transactions**: Parses dates, withdrawal/deposit amounts, descriptions, and running balance sequences.

### 4. Fraud & Anomaly Detection Engine (`server/fraud.js`)
Every document undergoes 18+ automated compliance and fraud audits. The engine calculates an aggregate **Risk Score (0–100)** and categorizes the document into **Low**, **Medium**, or **High** risk:
- **Single High flag** = Document automatically classified as **High Risk**.
- **Single Medium flag** or **3+ Low flags** = Document classified as **Medium Risk**.
- Otherwise classified as **Low Risk**.

Whenever a new document is ingested or deleted, DocLens automatically re-evaluates all existing documents (`reassessAll()`), ensuring historical cross-document checks (e.g. duplicate billing, PO overbilling) update dynamically.

### 5. Document Comparison Engine (`server/compare.js`)
The comparison system performs multi-layered 2-way verification:
- **Field Alignment**: Maps synonymous fields across different document types (e.g. matching an Invoice's `vendor` against a Purchase Order's `vendor`, or `customer` against `buyer`).
- **Line-Item Fuzzy Matching**: Matches individual line items using token-level Jaccard similarity, pinpointing differences in quantities, unit prices, or total amounts.
- **LCS Line Diff**: Uses the Longest Common Subsequence algorithm to highlight exact line additions, removals, and unchanged text.

### 6. Local Database & Storage (`server/db.js`)
- Uses Node.js native embedded SQLite (`node:sqlite DatabaseSync`).
- Data is stored in `data/doclens.db`.
- Uploaded files are stored in `data/uploads/`.
- No separate database daemon or server process (such as PostgreSQL or MySQL) is required.

---

## Quick Start Guide

### Method 1: One-Click Startup (Windows .bat)

A startup script `start.bat` (and alias `run.bat`) is included in the project root:

1. Double-click **`start.bat`** (or **`run.bat`**) in Windows Explorer.
   - Alternatively, open Command Prompt or PowerShell in the project directory and run:
     ```cmd
     start.bat
     ```
2. The batch script will automatically:
   - Check if Node.js is installed (and check common paths if it is not in your system PATH).
   - Verify Node.js version is v22.5.0 or newer.
   - Check if all required npm packages are installed; if missing, it runs `npm install` automatically.
   - Ensure the `data/` and `data/uploads/` folders exist.
   - Launch the server at `http://localhost:3000`.
   - Automatically open your default web browser to `http://localhost:3000`.

To stop the server at any time, press **`Ctrl+C`** in the command prompt window.

---

### Method 2: Manual Command Line

#### Prerequisites
- **Node.js**: v22.5.0 or later (Node 22, 23, or 24 recommended).
  Check your version:
  ```bash
  node -v
  ```

#### Installation Steps
1. Open a terminal in the project directory:
   ```bash
   cd path/to/vedikaproj
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```
   Or run in development mode with automatic restart on file change:
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## Supported Document Types & Extracted Fields

| Document Type | Primary Fields Extracted | Special Features |
| :--- | :--- | :--- |
| **Invoice** | Invoice #, Vendor, Customer, Issue Date, Due Date, PO Reference, Tax ID (GSTIN/VAT), Subtotal, Tax, Total | Tabular line items, GSTIN validation, PO cross-referencing |
| **Receipt** | Receipt #, Merchant, Date, Payment Method (Cash/Card/UPI), Subtotal, Tax, Total | Cash payment flags, quick expense tracking |
| **Purchase Order** | PO #, Buyer, Vendor, Order Date, Delivery Date, Subtotal, Tax, Total | Tabular line items, buyer/vendor validation |
| **Contract** | First Party, Second Party, Effective Date, End Date, Term, Contract Value, Governing Law, Signature Count, Auto-Renewal Clause | Unsigned contract detection, auto-renewal trap alerts |
| **Bank Statement**| Bank, Account Holder, Account #, Period Start, Period End, Opening Balance, Total Credits, Total Debits, Closing Balance | Transaction breakdown, running balance verification |
| **Other** | Generic text, detected dates, amounts, counterparties | Free-form OCR extraction |

---

## Fraud Detection Rules & Risk Scoring

DocLens evaluates every document against 18 deterministic audit rules:

### Arithmetic & Integrity Checks
- **`TOTAL_MISMATCH` (High)**: Subtotal + Tax does not match the stated Total.
- **`LINE_ITEMS_MISMATCH` (High)**: Sum of individual line item amounts does not equal the subtotal/total.
- **`LINE_CALC_ERROR` (Medium)**: Quantity multiplied by unit price does not equal the line amount.
- **`TAX_RATE_ANOMALY` (Medium)**: Tax exceeds 40% of the subtotal.

### Cross-Document & Duplicate Checks
- **`DUPLICATE_FILE` (High)**: Exact cryptographic match (identical SHA-256 hash) to a previously uploaded file.
- **`DUPLICATE_NUMBER` (High)**: The same invoice/receipt number has already been submitted by the same vendor (double-billing alert).
- **`SIMILAR_DOCUMENT` (Medium)**: Identical vendor and total amount submitted within a 7-day window.
- **`PO_OVERBILLING` (High)**: An invoice referencing a Purchase Order exceeds the PO total by more than 2%.
- **`PO_VENDOR_MISMATCH` (Medium)**: An invoice references a PO, but the vendor name differs from the PO recipient.

### Banking & Transaction Checks
- **`BALANCE_BREAK` (High)**: The running balance in a bank statement does not mathematically follow from transaction amounts.
- **`STATEMENT_MISMATCH` (High)**: Opening balance + credits − debits does not equal the stated closing balance.

### Date & Timing Checks
- **`DATE_ORDER` (Medium)**: Chronological contradiction (e.g. due date occurs before issue date, or delivery before order date).
- **`FUTURE_DATE` (Medium)**: Document date is in the future.
- **`WEEKEND_DATE` (Low)**: Commercial invoice or receipt dated on a Sunday.

### Compliance & Contract Checks
- **`INVALID_TAX_ID` (Medium)**: GSTIN fails the statutory 15-character structure validation.
- **`LARGE_CASH` (Medium)**: Cash payment exceeding ₹10,000 / $10,000 without banking trail.
- **`MISSING_SIGNATURE` (Medium)**: Contract lacks signatures from both parties (< 2 signatures detected).
- **`MISSING_FIELDS` (Medium / Low)**: Core mandatory fields (such as vendor, date, or total) are absent.
- **`AUTO_RENEWAL` (Low)**: Contract contains an automatic renewal clause requiring cancellation notice.
- **`NO_END_DATE` (Low)**: Contract has an effective date but no termination date or term length.

### Heuristic Risk Scoring
- **`ROUND_AMOUNT` (Low)**: Total is an exact multiple of 1,000 for amounts ≥ 10,000 (common indicator of fabricated claims).
- **`JUST_UNDER_THRESHOLD` (Low)**: Amount sits just within 1% below common corporate approval thresholds (e.g. ₹9,900, ₹49,500, ₹99,000).
- **`LOW_OCR_CONFIDENCE` (Low)**: Tesseract OCR confidence is below 65%.
- **`NO_TEXT` (Medium)**: Document contains fewer than 20 characters of readable text.

---

## Side-by-Side Comparison & PO Matching

The **Compare** workspace allows 2-way verification of any two documents in the system:

1. **Select Two Documents**: Choose Document A and Document B (e.g. PO vs. Invoice, or Contract v1 vs. Contract v2).
2. **Field-Level Diff**: Compares amounts, counterparties, and dates with clear status indicators (`Match`, `Different`, `Only in A`, `Only in B`). Shows numerical deltas and percentage discrepancies.
3. **Line-Item Diff**: Automatically pairs items with similar descriptions and flags changes in quantity, unit pricing, or total item cost.
4. **Text Diff**: Side-by-side textual diff displaying additions (`+`), removals (`−`), and overall text similarity percentage.

---

## Sample Documents & Test Scenarios

DocLens includes 14 pre-built sample documents in the `samples/` folder. You can load them directly via the UI by clicking **"Load sample documents"** on the Upload page, or by sending `POST /api/samples`.

| Sample File | Type | Scenario / Flag Demonstrated |
| :--- | :--- | :--- |
| `01-purchase-order-apex.txt` | Purchase Order | Base PO for Apex Office Supplies (₹3,65,800.00). |
| `02-invoice-apex-4471.txt` | Invoice | Matching valid invoice for PO-2026-0114. |
| `03-invoice-apex-4471-resubmitted.txt` | Invoice | Duplicate submission of invoice #4471 (`DUPLICATE_NUMBER` double billing). |
| `04-purchase-order-zenith.txt` | Purchase Order | Base PO for Zenith Solutions (₹1,00,300.00). |
| `05-invoice-zenith-overbilled.txt` | Invoice | Overbilled invoice claiming ₹1,29,800.00 against ₹1,00,300.00 PO (`PO_OVERBILLING`). |
| `06-invoice-sunrise-errors.txt` | Invoice | Arithmetic errors in line items and totals (`TOTAL_MISMATCH`, `LINE_ITEMS_MISMATCH`). |
| `07-receipt-cafe.txt` | Receipt | Legitimate cafe expense receipt. |
| `08-receipt-cash-consulting.txt` | Receipt | Large cash payment with round figures (`LARGE_CASH`, `ROUND_AMOUNT`). |
| `09-contract-brightpath-msa.txt` | Contract | Valid master service agreement signed by both parties. |
| `10-contract-orbit-unsigned.txt` | Contract | Unsigned contract with auto-renewal clause (`MISSING_SIGNATURE`, `AUTO_RENEWAL`). |
| `11-bank-statement-northwind-oct.txt` | Bank Statement | Fully reconciled corporate bank statement. |
| `12-bank-statement-orbit-altered.txt` | Bank Statement | Statement with altered figures (`BALANCE_BREAK`, `STATEMENT_MISMATCH`). |
| `13-invoice-brightpath.pdf` | Invoice (PDF) | Native binary PDF invoice testing `pdf-parse` extraction. |
| `14-receipt-pharmacy-scan.png` | Receipt (PNG) | Scanned image receipt testing `Tesseract.js` OCR and camera confidence. |

---

## REST API Reference

### Document Operations

#### `GET /api/documents`
List all ingested documents (metadata, risk scores, flags, without full raw text).

#### `POST /api/documents`
Upload one or multiple files for ingestion.
- **Content-Type**: `multipart/form-data`
- **Field**: `files` (up to 10 files, max 15MB each)
- **Response**: Array of ingestion results: `[{ ok: true, document: { ... } }, ...]`

#### `GET /api/documents/:id`
Retrieve full details for a document, including parsed fields, line items, flags, and complete extracted text.

#### `GET /api/documents/:id/file`
Download or stream the original uploaded file (inline preview).

#### `PATCH /api/documents/:id`
Manually change the document type classification.
- **Payload**: `{"doc_type": "invoice"}` (or `"receipt"`, `"purchase_order"`, `"contract"`, `"bank_statement"`, `"auto"`)

#### `DELETE /api/documents/:id`
Delete a document and its stored file from the disk.

---

### Comparison & Analytics

#### `GET /api/compare?a=:id&b=:id`
Perform side-by-side comparison between two documents.
- **Parameters**: `a` (Doc ID 1), `b` (Doc ID 2)
- **Response**: Summary metrics, field-by-field diff, line items diff, and text diff lines.

#### `GET /api/analytics?days=:n&type=:type`
Retrieve dashboard KPIs:
- Total documents and financial volume
- Flagged documents and Value at Risk (VAR)
- Risk level distribution (Low / Medium / High)
- Monthly volume & spending trends
- Top counterparties by transaction value
- Top triggered fraud flags

#### `POST /api/samples`
Load all un-ingested files from the `samples/` directory into the active database.

#### `GET /api/meta`
Returns schema definitions, supported document types, field configurations, and upload limits.

---

## Configuration & Environment Variables

You can customize DocLens by setting environment variables in your terminal or before running `start.bat`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP web server. |
| `HOST` | `127.0.0.1` | Network interface to bind (`127.0.0.1` for local-only, `0.0.0.0` for LAN access). |
| `DATA_DIR` | `<project>/data` | Directory where SQLite database (`doclens.db`) and files are saved. |
| `DEFAULT_CURRENCY` | `INR` | Default currency code (`INR`, `USD`, `EUR`, `GBP`). |

Example (PowerShell):
```powershell
$env:PORT = "8080"
node server/index.js
```

---

## Project Directory Structure

```
vedikaproj/
│
├── data/                       # Local database & file storage (created automatically)
│   ├── doclens.db              # SQLite database (documents, fields, flags)
│   ├── eng.traineddata         # Tesseract OCR language model
│   └── uploads/                # Stored raw uploaded documents (UUID-named)
│
├── public/                     # Frontend client (Vanilla JS, HTML5, CSS3)
│   ├── app.js                  # Single-page application logic & routing
│   ├── index.html              # Main HTML entry point
│   └── styles.css              # Application design system & responsive layout
│
├── samples/                    # 14 pre-configured test documents for fraud checks
│   ├── 01-purchase-order-apex.txt
│   ├── 02-invoice-apex-4471.txt
│   ├── ...
│   ├── 13-invoice-brightpath.pdf
│   └── 14-receipt-pharmacy-scan.png
│
├── server/                     # Backend server code (Node.js & Express)
│   ├── compare.js              # 2-way comparison & diffing engine
│   ├── db.js                   # SQLite database initialization & CRUD operations
│   ├── extract.js              # Classifier, regex patterns, table extraction
│   ├── fraud.js                # Fraud, compliance, and anomaly rules engine
│   ├── index.js                # Express app routes and API handlers
│   └── ocr.js                  # Tesseract OCR & PDF text extraction pipeline
│
├── package.json                # Project dependencies and npm scripts
├── README.md                   # Complete documentation
├── read.md                     # Documentation mirror
├── run.bat                     # Windows startup shortcut
└── start.bat                   # Windows setup & auto-launch batch script
```

---

## Troubleshooting & FAQ

### 1. `Cannot find module 'node:sqlite'`
DocLens uses Node's built-in SQLite engine, which requires **Node.js v22.5.0 or newer**.
Run `node -v` to check your version. If your version is older than 22, download the latest version from [nodejs.org](https://nodejs.org/).

### 2. OCR is slow on large image files
Image OCR runs on the CPU using Tesseract.js WebAssembly. For faster processing:
- Ensure uploaded images are under 5 MB.
- Upload native PDFs or text documents when available (PDF text extraction is near-instantaneous).

### 3. Port 3000 is already in use
If another application is using port 3000, specify a custom port:
```cmd
set PORT=4000
start.bat
```

### 4. How do I reset or clear all documents?
To completely reset DocLens to a clean state:
1. Stop the server (`Ctrl+C`).
2. Delete `data/doclens.db` and any files inside `data/uploads/` (keep `data/eng.traineddata`).
3. Restart the server using `start.bat`.

---

## License

Private / Internal. All rights reserved.
