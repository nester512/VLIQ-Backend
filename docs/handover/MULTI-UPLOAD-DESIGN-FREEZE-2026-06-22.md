# Multi-file receipt — design freeze (2026-06-22)

> **Phase-1 deliverable (Opus).** Frozen DB / API / pipeline / FSM / frontend contracts for
> "one seller submission = one Receipt with 1–5 attachments (+ optional scanned QR)".
> Implementation blocks (A–E) MUST follow this; the shared contract is not changed inside a block.
> Branch base: `fix/qr-flow`. Source of truth: `docs/VLIQ PRD+BRD/Use cases VLIQ.md` (S3, A2) +
> `FLOW Seller`s recipt.md`.

## 0. As-is (audit summary)

- **Receipt = 1 file**: columns `file_kind/file_url/file_hash` are singular; `RECEIPTS` has no child table.
- **N receipts per submission**: the *frontend* `UploadPage` loops `for (const file of selectedFiles)` →
  one `POST /receipts/upload` (→ one Receipt) per file. Files and scanned QR are **mutually exclusive**
  (each clears the other); QR uses a separate `/qr-payload` flow.
- **QR extractor returns one candidate** (`extract()` → first fiscal-preferred), never all barcodes.
  No PDF rasterization (PDF QR never extracted).
- **Hard 409 on ingest** for duplicate `file_hash` / `fn,fd,fp` / `qr_raw`, backed by partial UNIQUE
  indexes `uq_receipt_file_hash_active`, `uq_receipt_qr_raw_active`, `uq_receipt_fn_fd_fp`.
- **Pipeline** processes a single `receipt.file_url`; normal terminal status is `on_review`
  (admin decides — no auto-approve, no auto-bonus). Demo mode short-circuits before QR extraction.
- **Admin DTO** exposes one `file_url`; SwipeDeck renders one `<img>`; PDF unsupported;
  `ReceiptDetailSheet` shows a synthetic `ReceiptGraphic` + single zoom link.
- **Review queue** already filters `status=on_review` only (good). Rejected receipts are visible per-seller
  in `SellerReceiptsPage` (all statuses) — usable as history/entity view.

## 1. Domain model (frozen)

`Receipt` (1) → (N) `ReceiptAttachment`, with `1 ≤ N ≤ 5`. Receipt = one logical receipt = one submission.

### `vliq.receipt_attachment`
| column | type | notes |
|---|---|---|
| `id` | bigint PK | autoincrement |
| `receipt_id` | bigint FK→`receipt.id` `ON DELETE CASCADE` | indexed |
| `position` | int | 0-based display order, unique within receipt |
| `kind` | enum `attachment_kind_enum` (`image`,`pdf`) | derived from server-validated MIME |
| `mime_type` | varchar(127) | server-validated |
| `storage_uri` | varchar(1000) | `s3://…` / `local://…` — internal, never raw to clients |
| `file_hash` | varchar(128) | sha256 of bytes; **indexed, NOT unique** (dup = signal) |
| `size_bytes` | int | server-measured |
| `extraction` | JSONB null | per-attachment evidence: `{qr_candidates:[…], pdf_pages:int, warnings:[…]}` (provenance) |
| `created_at` | timestamptz | |

Constraints: `UNIQUE(receipt_id, position)`; plain index on `file_hash` and on `receipt_id`.
Cascade is explicit (`CASCADE`) — Receipts are *soft*-deleted (`is_deleted`), so attachments persist
in practice; hard delete cascades.

### `vliq.receipt` changes
- `file_url`, `file_hash`, `file_kind` → **made nullable** (legacy mirror of `attachments[0]`, kept for
  backward-compatible reads). New code reads `attachments` as the primary source. Documented future
  cleanup migration will drop them.
- New column `upload_idempotency_key` varchar(64) nullable; partial UNIQUE index
  `uq_receipt_idem_key (seller_id, upload_idempotency_key) WHERE upload_idempotency_key IS NOT NULL`.
- Drop UNIQUE indexes `uq_receipt_file_hash_active`, `uq_receipt_qr_raw_active`, `uq_receipt_fn_fd_fp`;
  replace with **non-unique** partial indexes (`ix_…`) so duplicate search stays fast but never hard-blocks.

`qr_raw/fn/fd/fp/total_sum/shop_name/...` stay on Receipt as the **resolved** receipt-level fiscal data
(the single confident identity, when there is one). The optional **scanned QR** input is stored in
`receipt.qr_raw` at finalize as one extraction candidate.

## 2. Migration (Block A owns it) — `0005_receipt_attachments`, down_revision `0004_city_table`

1. create enum `attachment_kind_enum`; create table `receipt_attachment` (+ indexes/unique).
2. **Backfill**: for every receipt with a real file
   (`file_url IS NOT NULL AND file_url NOT LIKE 'qr://%' AND file_kind <> 'qr'`) insert one attachment
   `position=0`, `kind = pdf if file_kind='pdf' else image`, `mime_type` best-effort from `file_kind`
   (`photo→image/jpeg`, `screenshot→image/png`, `pdf→application/pdf`), `storage_uri=file_url`,
   `file_hash=file_hash`, `size_bytes=0`, `created_at=receipt.created_at`.
   **QR-only rows** (`qr://inline` / `file_kind='qr'`) get **no** attachment but stay readable.
3. add `upload_idempotency_key` + partial unique index.
4. alter `file_url/file_hash/file_kind` → nullable.
5. drop the 3 UNIQUE indexes; create non-unique partial replacements.
6. `downgrade`: reverse (drop attachment table/enum/idem column, re-create UNIQUE indexes, set columns NOT
   NULL — may fail if nulls exist; documented). Migration-behavior tests assert backfill + index changes.

## 3. Fiscal identity (Block B owns `src/receipt_ocr/fiscal_identity.py`)

`FiscalIdentity` = normalized `(fn, fd, fp)`, **confident only if all three present & non-empty after
normalization**. Normalization (single source, unit-tested): strip, remove all non-alphanumeric chars
(whitespace/separators = format noise), uppercase; no leading-zero stripping. Incomplete triple → `None`
(not confident). Hashable/frozen for set membership.

## 4. Candidate aggregation (Block B) — runs in ALL modes (demo & full)

Sources per submission: scanned QR + every image attachment + every PDF page. Each source yields raw QR
strings → `parse_qr_string` → `FiscalIdentity` (confident only). (OCR-derived identity is a no-op under
`OCR_MODE=demo`; hook left for future.) Decision on the **set of unique confident identities**:

| unique identities | outcome |
|---|---|
| **0** | never auto-reject → `on_review`; persist extraction evidence |
| **1** | one receipt → continue normal flow (enrich; historical-dup → *signal*) |
| **>1** | `MULTIPLE_RECEIPTS_DETECTED` → terminal **system rejection** |

Examples (all frozen): `[A,A,A,A,A]`→1·ok; `[A,None,A]`→1·ok; `[None,None]`→on_review; `[A,B]`→reject;
A&B in one image→reject; A&B on different PDF pages→reject; scanned A + files A→ok; scanned A + file B→reject;
scanned A + some files unreadable→ok; no scanned + files A→ok. Indirect OCR hints never auto-reject —
only ≥2 confident normalized identities do.

### Centralized TODO (exactly one, in the pipeline reject path)
```python
# TODO(VLIQ-multi-receipt-split):
# Split confidently detected fiscal identities into separate Receipt records
# while preserving attachment/page provenance.
```
Forbidden now: split into many Receipts, auto-assign pages→receipt, partial accept, losing attachments.

## 5. Pipeline (Block B owns orchestrator) — package-aware

1. load Receipt + ordered attachments (+ `receipt.qr_raw` scanned candidate).
2. **idempotency guard**: if status already terminal (`approved/rejected/paid_out`) → no-op return.
3. `pending → ocr_in_progress` (system; no-op if already there — retry-safe).
4. extract candidates from each attachment (images: all QR barcodes; PDF: rasterize pages via
   `pypdfium2`, all QR per page) + scanned QR; record per-attachment `extraction` evidence; one
   attachment/page failure is a **warning**, never fatal.
5. aggregate identities (§4).
6. **>1 → system rejection** (§6) and stop (no OFD, no bonus).
7. **0 or 1**: demo → `on_review` (+ historical-dup signals); full → existing OFD/SKU/bonus flow,
   ending `on_review` with a *suggested* bonus (admin decides). Parsing failures still land `on_review`
   (never stuck `pending`). Historical duplicate (`file_hash` / `fn,fd,fp` matches a prior receipt) →
   fraud **signal** (`duplicate_of_id`), never auto-reject, never 409.

## 6. System rejection (`MULTIPLE_RECEIPTS_DETECTED`)
Within one `session.begin()`: keep Receipt + all attachments; `status=rejected`;
`rejection_reason = "В одной загрузке обнаружено несколько разных чеков. Загрузите каждый чек отдельно."`;
append fraud signal `{signal:"multiple_receipts_detected", severity:"high", details:{identities:[…fn/fd/fp…]}}`
(machine code = rejection code); store extraction evidence; `notification_outbox.enqueue(template="receipt.rejected",
payload={receipt_id, reason})`. FSM edge `ocr_in_progress → rejected (system)` **already exists** — minimal,
no admin-rights granted to system. Idempotent: terminal-status guard (§5.2) ⇒ retry never re-notifies /
re-rejects / re-creates. System-rejected receipts (`status=rejected`) are naturally **out of the active
queue** (queue = `on_review` only) and visible in history/entity.

## 7. Package upload API (Block A owns; frozen — frontend/back may not change independently)

All paths funnel through one service `create_receipt_package(session, *, seller_id, brand_id,
attachments, scanned_qr, idempotency_key) -> Receipt` (atomic: 1 Receipt + N attachments; enqueue **one**
job after commit; idempotent by key). Server-side validation: `1 ≤ N ≤ 5`; MIME ∈ {jpeg,png,webp,pdf};
size ≤ limit; positions unique & in `0..N-1`; each object belongs to the seller's upload session & exists
in storage; storage key cannot be swapped; scanned QR optional; **QR without any file is rejected**.

### Endpoints
- `POST /receipts/upload-urls` — body `{ files:[{client_id,filename,mime,size}] (1..5) }` →
  `{ upload_session:<signed JWT: seller_id, issued storage keys, exp>, files:[{client_id,position,upload_url,fields,storage_uri}] }`.
  When storage backend isn't S3 → `501` (client falls back to multipart batch).
- `POST /receipts/finalize` — body `{ upload_session, brand_id, idempotency_key, attachments:[{position,storage_uri,mime}] (1..5), scanned_qr? }`
  → `202 ReceiptUploadResponse{receipt_id,status,message}`. Verifies session ownership + keys ⊂ session +
  objects exist; calls the service. Same `idempotency_key` → returns the existing receipt (no 2nd receipt/job).
- `POST /receipts/upload` — **repurposed** multipart batch: `files: list[UploadFile] (1..5)` + `brand_id` +
  `scanned_qr?` + `idempotency_key?` → server-side upload of each file → same service. Dev/no-S3 fallback &
  primary test target (works without presign/S3 mocking). Single file = batch of one (back-compat).
- `POST /receipts/qr-payload` — **deprecated** (OpenAPI `deprecated=true`): QR-only is removed (S3/В-2-A).
  Returns `400 AppError("QR_ONLY_DEPRECATED", user_message="Отсканированный QR можно приложить только вместе с фото или PDF.")`.
  Old QR-only rows remain readable.
- `POST /receipts/upload-url` (singular, legacy) — kept, marked deprecated; unused by the new FE.

No hard 409 at ingest for duplicate hash / qr / fn-fd-fp anymore — duplicates become pipeline signals.

## 8. DTOs (frozen)

### Backend `ReceiptAttachmentRead`
`{ id:int, position:int, kind:"image"|"pdf", mime_type:str, url:str|null }` (`url = to_viewable_url(storage_uri)`).
`ReceiptRead` and `ReceiptStatusResponse` gain `attachments: list[ReceiptAttachmentRead]` (ordered by
position). Legacy `file_url` retained (= `attachments[0].url`) during transition.

### Frontend TS
```ts
interface Attachment { id: number; position: number; kind: 'image' | 'pdf'; mime_type: string; url: string | null }
```
`AdminReceipt` and seller `Receipt`/status types gain `attachments: Attachment[]` (use it as primary; keep
`file_url?` for back-compat). TS DTOs mirror backend schemas — no `any` to paper over mismatches.

## 9. Seller frontend (Block C, uses §7/§8 only)
One submission: choose 1–5 files (mixed image+PDF), `N/5` counter, all tiles previewed (image thumbnail;
PDF safe card name/type/size), remove a single attachment, stable order. Scanned QR is **additive**: scanning
does **not** clear files; selecting files does **not** clear QR; QR re-scan/clear independent; QR optional;
**QR-only submit disabled** (requires ≥1 file). Submit = one upload session → one finalize (no per-file loop).
Prefer presigned batch (`upload-urls`+`finalize`), fall back to multipart batch (`/upload`) on 501/404/network
(mirrors today's single-file fallback). Idempotency key per submission; retry never makes a 2nd receipt.
Shared progress + per-file error; success shows ONE submission.

## 10. Admin frontend (Block D, uses §8 only)
One reusable `AttachmentViewer` (SwipeDeck card, `ReceiptDetailSheet`, entity view): ordered by position,
image fit + fullscreen, PDF viewer/safe card/open, unsupported-MIME fallback, loading + broken-URL states,
attachment counter, accessible **tap-zones / buttons (NOT nested horizontal swipe)** so the outer SwipeDeck
horizontal swipe stays approve/reject. After the last attachment → a **final info card**: receipt + seller +
brand/outlet + recognized fiscal fields + duplicate/fraud signals + sum/date + processing status +
system-rejection reason + extraction warnings + admin actions only when status allows. Review queue stays
`on_review` only; `pending` excluded; `MULTIPLE_RECEIPTS_DETECTED` (=`rejected`) excluded from active queue,
present in history/entity.

## 11. Dependencies
Add **`pypdfium2`** (PDFium bindings; permissive BSD/Apache; manylinux wheels, no system libs) for PDF page
rasterization → QR. Rejected alternatives: PyMuPDF (AGPL), pdf2image (needs poppler binary). Update
`pyproject.toml` + `poetry.lock`. No new frontend deps unless a PDF render needs one (prefer native
`<iframe>`/object + open-in-new for the TMA).

## 12. Out of scope (unchanged): split one package into many Receipts; auto-approve; auto-bonus; real OFD
provider; auth/role changes; deleting old data; unrelated refactors; the pre-existing red
`tests/ofd_client/test_proverkacheka.py::test_unexpected_code__raises_ofd_blocked`.
