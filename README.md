# BKM Operations Hub

A functional internal-management demonstration for BenKim Associates (BKM). The product is explicitly a **DEMO ENVIRONMENT** and uses fictional organizations, staff, documents, pricing and accounting records only.

## Run locally

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `/` for the workspace or `/admin` for the management command center.

The demonstration uses an explicit historical operating date so the seeded records remain reproducible. Set `BKM_DEMO_DATE=YYYY-MM-DD` for server logic and `NEXT_PUBLIC_BKM_DEMO_DATE=YYYY-MM-DD` for the client build when changing the demo period; the default is `2026-10-01` in `Africa/Nairobi`.

## Delivered in this stage

- Responsive enterprise workspace shell with dashboard, clients, engagements, tasks, staff, quotations, reports and assistant views.
- Named demo login accounts for David Kamau, Mary Wanjiku and Faith Njeri.
- Seeded fictional client, engagement, task, document, quotation, report and activity records.
- Admin command center with named staff attendance records, check-in/check-out actions, duplicate-check-in protection, late/missing/approved-leave states, workload context and attention signals.
- Deterministic double-entry accounting sample with journal entries, ledger, trial balance, balance sheet, income statement and cash flow calculations. Unbalanced entries are rejected before insertion.
- Document-intelligence review state with extracted transaction preview, unusual-item flag and explicit human approval gate before future accounting conversion.
- Client evidence intake inside each client record: upload PDF, CSV, TXT or Excel files up to 50 MB, server-side workbook extraction across all worksheets, GPT-5 Mini instruction-aware analysis when configured, transaction-like row detection, warnings and a reviewable upload history. Large workbooks can be summarized, but a balance sheet still requires classified account balances or a trial balance.
- Instruction-led BKM work assistant that retrieves live records, creates and updates demo tasks from explicit instructions, and prepares management/accounting summaries without pretending to post entries or send messages. Assistant answers are generated from server-side retrieved records, not canned UI responses.
- Benjamin-only AI communication triage desk with priority, message summary, classification reasoning, editable suggested replies, audit-logged approval/rejection controls and no automatic external sending.
- Supabase PostgreSQL migrations and RLS policies under `supabase/`, plus idempotent managed-development migrations/seed scripts under `db/`.

## Demo credentials

Choose a seeded account on the login screen. These are demonstration sessions only. Production deployment must connect Supabase Auth with email/password, password reset, account status and configurable RBAC before real client data is introduced.

## Security and production boundaries

- Secret values are server-side only; no credentials are embedded in client code.
- Workspace data, assistant actions, document access, exports and internal messages require a signed-in session plus the relevant server-side permission. Administrator actions remain restricted to Benjamin Mutua.
- AI access is routed through controlled server tools; no arbitrary SQL is exposed.
- Supabase migrations enable RLS on all business tables and limit AI conversation records to the owning user.
- Documents are currently represented through a private-storage-ready repository boundary; real Supabase Storage buckets, signed URLs and file parsing still need production configuration.
- WhatsApp Business, transactional email, client portal, full notification center, DOCX export, configurable RBAC UI, real Supabase Auth wiring, and live database repository reads remain production stages rather than being presented as complete.

## Current verified demo flow

1. Open `/admin` and review the named attendance table. Brian Otieno is not checked in; Joseph Mwangi is excluded because he has approved leave; Mary Wanjiku is late.
2. Check in/out an eligible staff member. Duplicate check-in and check-out sequencing are rejected.
3. Review the balanced trial balance and financial position generated from deterministic journal records.
4. Review and approve the fictional bank-statement extraction. Approval is explicit; uncertain extraction is not silently posted to accounting.
5. Open the assistant and ask “Who has not checked in today?”, “Who is late today?”, “Create a trial balance”, or “How is the firm doing?”.
6. Open `/admin`, review the seeded AI inbox sample, edit its suggested reply, and approve or reject it. Approval records Benjamin’s decision but does not send externally; a real provider webhook can be posted to `/api/webhooks/communications?channel=gmail` to create a live triage item.

## Demo honesty and reset boundary

- This repository is still a controlled in-memory demonstration repository. Changes survive a page refresh while the server process remains alive, but a process restart resets the seeded state. The README and UI label fictional records, drafts, approvals and demo samples explicitly.
- The Respond.io Gmail bridge was tested for an approved send in the connected workspace. WhatsApp and SMS remain provider-configuration stages until their channels are connected and tested.
- The AI triage panel is a deterministic, record-safe demonstration classifier today. It explains why it escalated a message and requires Benjamin’s approval; a production deployment should persist inbound events and drafts in Supabase and replace the classifier with the approved server-side LLM workflow.
- The accounting reports are calculated by the deterministic journal/ledger engine. Document approval is deliberately separate from posting: the current demonstration does not silently create journal entries from an extraction.
- For a clean demo reset, restart the development/production process after recording any evidence you need. Supabase migration and seed scripts are available for the future persistent repository stage but are not the source of truth for the current in-memory preview.

## Next production stages

1. Connect Supabase Auth, user profiles and configurable RBAC policies.
2. Replace in-memory repository writes with Supabase server repositories and transactions.
3. Connect Supabase Storage private buckets, signed URLs and real PDF/DOCX/XLSX extraction.
4. Add accounting posting approvals, AR/AP, reconciliation and immutable financial audit history.
5. Add DOCX generation, client portal, WhatsApp/SMS providers and notification preferences.
6. Add rate limiting, monitoring, deployment configuration, security review and full automated test coverage.

## Communication webhooks
The protected admin command center exposes a normalized inbound alert endpoint for the three company channels:
- Gmail: `POST /api/webhooks/communications?channel=gmail`
- SMS: `POST /api/webhooks/communications?channel=sms`
- WhatsApp / Respond.io: `POST /api/webhooks/communications?channel=whatsapp`

Set `BKM_GMAIL_WEBHOOK_SECRET`, `BKM_SMS_WEBHOOK_SECRET`, and `BKM_WHATSAPP_WEBHOOK_SECRET` in production. Send the secret in `x-bkm-webhook-secret`. Incoming payloads may use `from`, `email`, `phone`, `subject`, `body`, `text`, or `message`; they are normalized into Benjamin’s review inbox. The demo intentionally does not auto-send replies.

## Respond.io Gmail server bridge
The BKM admin route is ready for Benjamin Mutua’s server-side Respond.io integration:
- Status: `GET /api/integrations/respondio/gmail`
- Read a contact’s Gmail thread: `GET /api/integrations/respondio/gmail?identifier=email:client@example.com`
- Send an approved email reply: `POST /api/integrations/respondio/gmail` with `identifier`, `text`, optional `subject`/`replyToMessageId`, and `approved: true`
- Receive Respond.io events: `POST /api/webhooks/respondio`

Set `RESPOND_IO_API_TOKEN` only in the deployment secret store. The route uses Respond.io API v2, pins the verified `SMTP - Gmail` channel through `RESPOND_IO_GMAIL_CHANNEL_ID`, requires Benjamin’s admin session for access, and refuses outbound sends unless `approved: true`. Configure Respond.io Webhooks to call `/api/webhooks/respondio` for New Incoming Message and New Outgoing Message events.

## Container deployment
The Webdev project is configured for server deployment through the root `Dockerfile`. The container listens on `PORT` (default `3000`) and starts the Next.js production server. `/api/health` is intentionally unauthenticated and returns a small JSON readiness response for the deployment health check.
