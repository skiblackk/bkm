# BKM Operations Hub

A functional internal-management demonstration for BenKim Associates (BKM). The repository contains fictional fixtures for local development, but production mode now refuses demo authentication and in-memory business records until the real Supabase repository is connected.

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
- Instruction-led BKM work assistant and Benjamin CEO Copilot now call the server-side live model with current BKM records, evidence, recommended next steps and missing-data disclosure. Task creation/completion remains deterministic application action execution; the AI does not claim those actions happened unless the server confirms them.
- Benjamin-only AI communication triage desk with priority, message summary, classification reasoning, editable suggested replies, audit-logged approval/rejection controls and no automatic external sending.
- Supabase PostgreSQL migrations and RLS policies under `supabase/`, plus idempotent managed-development migrations/seed scripts under `db/`.

## Demo credentials

Choose a seeded account on the login screen only when running in local demo mode. These are demonstration sessions only. Set `BKM_REQUIRE_REAL_AUTH=true` (and use `NODE_ENV=production`) to disable the demo account endpoint and all in-memory business APIs.

## Security and production boundaries

- Secret values are server-side only; no credentials are embedded in client code.
- Workspace data, assistant actions, document access, exports and internal messages require a signed-in session plus the relevant server-side permission. Administrator actions remain restricted to Benjamin Mutua.
- AI access is routed through controlled server tools; no arbitrary SQL is exposed.
- Supabase migrations enable RLS on all business tables. Migration `005_production_rls.sql` replaces broad authenticated reads with permission-scoped policies using `user_permissions`; it must be applied and tested against the target Supabase project before production use.
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

- Local demo mode is a controlled in-memory demonstration repository. Changes survive a page refresh while the server process remains alive, but a process restart resets the seeded state. Production mode refuses this repository instead of presenting it as company data.
- The Respond.io Gmail bridge was tested for an approved send in the connected workspace. WhatsApp and SMS remain provider-configuration stages until their channels are connected and tested.
- The AI triage panel is a deterministic, record-safe demonstration classifier today. It explains why it escalated a message and requires Benjamin’s approval; a production deployment should persist inbound events and drafts in Supabase and replace the classifier with the approved server-side LLM workflow.
- The accounting reports are calculated by the deterministic journal/ledger engine. Document approval is deliberately separate from posting: the current demonstration does not silently create journal entries from an extraction.
- For a clean demo reset, restart the development/production process after recording any evidence you need. Supabase migration and seed scripts are available for the future persistent repository stage but are not the source of truth for the current in-memory preview.

## Next production stages

1. Connect Supabase Auth, user profiles and configurable RBAC policies; establish the first administrator through a private operator-assisted process, never public registration.
2. Replace in-memory repository writes with Supabase server repositories and transactions.
3. Connect Supabase Storage private buckets, signed URLs and real PDF/DOCX/XLSX extraction.
4. Add accounting posting approvals, AR/AP, reconciliation and immutable financial audit history.
5. Add DOCX generation, client portal, WhatsApp/SMS providers and notification preferences.
6. Add rate limiting, monitoring, deployment configuration, security review and full automated test coverage.

## Production readiness boundary

The current application does not claim production readiness. A real deployment requires Supabase Auth session integration, a server-side Supabase data repository for every business surface, applied migrations including `005_production_rls.sql`, configured Storage, and role tests against at least three real test accounts. Until those prerequisites are complete, production mode returns `503 not_ready` from `/api/health`, refuses demo sign-in, and returns honest repository-not-connected errors rather than fictional records.

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
