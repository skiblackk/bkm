# BKM Operations Hub — initial audit

| Item | Exists? | Works end to end? | Notes |
|---|---:|---:|---|
| Protected app shell and route manifest | Yes | Yes | Preview shell and referenced chunks returned HTTP 200; existing route manifest is served separately from the app shell. |
| Production build and TypeScript diagnostics | Yes | Yes | Production build already passed after restore; diagnostics were re-registered. |
| Demo authentication/logout | Yes | Partial | Demo cookie is HttpOnly and cross-site Preview-aware on sign-in; logout currently hard-codes Lax/non-secure attributes and should mirror the public Preview cookie policy. |
| Benjamin Mutua sole administrator | Yes | Yes in demo | Admin navigation and CEO Copilot are restricted by server-side session checks; persistence-backed identity is not active. |
| User provisioning and permissions | Yes | Partial | Admin UI and permission catalog exist; records are still in-memory and need persistent authorization enforcement. |
| Clients | Yes | Partial | Seeded records and create flow exist. Edit/archive, duplicate prevention, server-backed persistence, and full search/filter/pagination are incomplete or not verified. |
| Engagements | Yes | Partial | Seeded linked records and detail views exist; full CRUD, filters, pagination, and persistent writes are incomplete. |
| Tasks/check-ins/chat | Yes | Yes for demo flows | Existing E2E passed task assignment, duplicate attendance protection, direct chat, and broadcast protection. Persistence is not verified. |
| Client-facing document upload | Yes | Partial | Portal and internal upload exist. Internal upload accepts Excel; the client upload component's file picker currently advertises only PDF/CSV/TXT despite scanner support for XLSX/XLS. Portal selection is demo-only and not tenant-authenticated. |
| Document extraction and scan review | Yes | Partial | PDF/CSV/TXT/XLSX code paths exist, source rows/key fields and status UI exist, but durable document/extraction persistence and long-job processing are not wired. |
| User-directed document analysis | Partial | Partial | Instruction is sent by the assistant upload component, but the result path is not yet verified to preserve audience/purpose/detail in persisted analysis or follow-up context. |
| Document PDF/XLSX export | Yes | Yes for reviewed scan input | Export routes generate files after permission checks; live browser download should be included in final regression evidence. |
| CEO Copilot | Yes | Yes for live configured model | Server-side built-in OpenAI-compatible call, grounded context, structured evidence, and live model identity are present. Tool/action coverage is currently limited to task create/complete and needs confirmation-safe expansion. |
| Deterministic accounting | Yes | Yes for current demo reports | Accounting calculations are application code and existing E2E verifies balance; period close, draft/reversal rules, aging, drill-down source views, and persistence remain incomplete. |
| Accounting automated test suite | Partial | Partial | Existing E2E checks balance; the ten required accounting cases are not all represented as isolated automated tests. |
| Quotations | Yes | Partial | Demo quotation builder and calculation exist; statuses, revision history, export, invoice/payment workflow, and authorization lifecycle are incomplete. |
| Gmail via Respond.io | Yes | Partial | Server client, token configuration, read/send routes, and status UI exist. Current status is configuration-based; a successful live send/read test is not proven in this restored session. |
| WhatsApp and SMS | Yes as status/webhook surfaces | No | Webhook endpoints/status surfaces exist, but no configured provider/channel is present and no live delivery is verified. |
| Notifications | Yes | Partial | Schema and demo surfaces exist; event generation, persistence, preferences, and duplicate prevention need completion. |
| Audit trail | Yes | Partial | Audit schema and demo logging exist; full persistent coverage and admin filtering/export are not verified. |
| Demo/test/real data separation | Partial | Partial | Demo labels and fictional seed data are explicit; main runtime remains in-memory, so production separation is not yet enforceable. |
| Database persistence | Prepared | No | MySQL and Supabase migrations/seed scripts exist, but the active repository is still the in-memory adapter. |
| Mobile layout | Yes | Partial | Responsive shell and mobile navigation exist; task/document/table edge cases need targeted screen-size validation. |
| Deployment | Yes | Not re-verified here | A published domain is recorded by the project, but this session only verified the local restored preview; no new publish claim is made. |

## Executed checks in this audit

- `pnpm e2e`: PASS — protected APIs, grounded assistant, accounting balance, provisioning, task assignment, duplicate attendance protection, direct chat, and broadcast protection.
- Preview shell/chunk check: PASS — referenced Next.js JavaScript assets returned HTTP 200.
- Production build: PASS — inherited evidence from the restored session; re-run before final delivery after modifications.

## Highest-priority repairs

1. Correct upload format affordances and validation/error status semantics.
2. Finish client CRUD and duplicate safeguards with server-side authorization.
3. Add accounting rule tests and closed-period/draft/reversal safeguards.
4. Introduce an explicit persistent repository adapter without deleting demo data.
5. Replace integration “connected” claims with configured/reachable/verified states.

## Repair batch completed in this session

The client uploader now exposes PDF, CSV, TXT, XLSX, and XLS; the documents API separates authorization, validation, and internal scan errors; logout mirrors the secure cross-site Preview cookie policy; and duplicate client names/contact emails are rejected before insertion. `pnpm exec tsc --noEmit`, `pnpm build`, clean-state `pnpm e2e`, health/route-manifest checks, and the focused duplicate-client API check all passed. The persistent repository, full CRUD, closed-period accounting, and live external delivery verification remain open items.
