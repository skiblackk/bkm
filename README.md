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

## Delivered in this stage

- Responsive enterprise workspace shell with dashboard, clients, engagements, tasks, staff, quotations, reports and assistant views.
- Named demo login accounts for David Kamau, Mary Wanjiku and Faith Njeri.
- Seeded fictional client, engagement, task, document, quotation, report and activity records.
- Admin command center with named staff attendance records, check-in/check-out actions, duplicate-check-in protection, late/missing/approved-leave states, workload context and attention signals.
- Deterministic double-entry accounting sample with journal entries, ledger, trial balance, balance sheet, income statement and cash flow calculations. Unbalanced entries are rejected before insertion.
- Document-intelligence review state with extracted transaction preview, unusual-item flag and explicit human approval gate before future accounting conversion.
- Client evidence intake inside each client record: upload PDF, CSV or TXT files, server-side text/PDF extraction, GPT-5 Mini structured analysis when the configured provider is available, transaction-like row detection, warnings and a reviewable upload history.
- Read-only assistant tools for clients, engagements, tasks, deadlines, workload, activity, attendance, management overview and accounting summaries. Assistant answers are generated from server-side retrieved records, not canned UI responses.
- Supabase PostgreSQL migrations and RLS policies under `supabase/`, plus idempotent managed-development migrations/seed scripts under `db/`.

## Demo credentials

Choose a seeded account on the login screen. These are demonstration sessions only. Production deployment must connect Supabase Auth with email/password, password reset, account status and configurable RBAC before real client data is introduced.

## Security and production boundaries

- Secret values are server-side only; no credentials are embedded in client code.
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

## Next production stages

1. Connect Supabase Auth, user profiles and configurable RBAC policies.
2. Replace in-memory repository writes with Supabase server repositories and transactions.
3. Connect Supabase Storage private buckets, signed URLs and real PDF/DOCX/XLSX extraction.
4. Add accounting posting approvals, AR/AP, reconciliation and immutable financial audit history.
5. Add DOCX generation, client portal, email/WhatsApp providers and notification preferences.
6. Add rate limiting, monitoring, deployment configuration, security review and full automated test coverage.
