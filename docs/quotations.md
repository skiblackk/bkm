# Quotations — how the delivery system works

Live at **https://bkm-livid.vercel.app/quotations** (staff sign-in required).
Migration `020_quotations_delivery.sql` is applied to project `pdtcciudkolyegaianaa`.

## What a quotation is

A quotation is a numbered record, not a printed page. The record holds the
priced lines; the PDF is generated from the record, and every issue writes an
immutable snapshot plus the PDF bytes to storage under
`quotations/{quotation-id}/rev-{n}.pdf`. Re-opening a quotation always shows
what the client actually received, even after later edits create a new revision.

Numbers come from `next_quotation_number()` / `next_invoice_number()` and are
`QT-YYYY-NNNN` / `INV-YYYY-NNNN`. Uniqueness is a database index, and creation
retries on conflict.

## Statuses

```
Draft ──issue──▶ Sent ──client opens link──▶ Viewed ──▶ Accepted | Rejected
  │                │                            │
  └────────────────┴──────── validity date ────┴──▶ Expired
```

The database enforces the transitions (`quotation_status_guard`), stamps the
matching timestamp (`quotation_status_stamp`) and writes a dated event with the
channel that caused it (`quotation_status_log`). Accepted and Rejected are
terminal.

## Delivery

| Channel | What happens |
| --- | --- |
| **PDF** | `/api/quotations/pdf?id=…` renders, stores and returns the file. A storage row carries the sha256 and byte size. |
| **Preview** | Same route with `mode=inline` — opens in a tab instead of downloading. |
| **WhatsApp** | `action: whatsapp` returns a `wa.me` deep link pre-filled with the client's saved number and the prepared message, and records the share. The PDF is downloaded alongside and attached by hand — WhatsApp cannot attach a file from a link. |
| **Email** | `action: email` renders the PDF and attaches it. Delivery happens only when `RESEND_API_KEY` is set; otherwise the message is recorded as prepared, the response says so plainly, and the text is returned for copying. |
| **Client link** | `/quote/{public_token}` — read-only, `noindex`, no sign-in. First open moves Sent → Viewed. The client can accept or decline from the page. |

## Conversion

`quotation_accept(…)` moves the quotation to Accepted and raises the invoice in
one transaction, copying the lines into `invoice_items`. It is idempotent: a
second call returns the invoice already raised rather than creating another.

## Permissions

`create_quotations`, `edit_quotations`, `issue_quotations`, `share_quotations`,
`record_quotation_decisions`, `convert_quotations` — granted to CEO, System
Administrator, Operations Manager and Finance Lead in full; Audit Manager holds
five (no conversion); Senior Auditor holds edit and share.

## Two deployment constraints worth remembering

1. **pdfkit must not be bundled.** Its standard fonts resolve through a
   `createRequire` on an import-map specifier (`#standard-fonts/*.cjs`), which
   cannot be resolved from inside a serverless bundle. It is listed in
   `serverExternalPackages`.
2. **The document must not start on Helvetica.** pdfkit's constructor loads its
   default font immediately, so the document is created with
   `font: assets/fonts/Inter-400.ttf`. Inter 400/500/600/700 ship in
   `assets/fonts` and are added to the function trace via
   `outputFileTracingIncludes`.

Both were found by testing the deployed function, not the local build — locally
the files are simply present on disk.
