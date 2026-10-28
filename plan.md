# BKM Operations Hub — implementation plan

## Objective
Deliver a trustworthy BenKim Associates operations platform for Benjamin Mutua: secure role-controlled operations, client and engagement records, document intelligence, deterministic accounting, and honest communication/integration status.

## Current architecture
- Next.js App Router with TypeScript and Tailwind CSS.
- Server routes under `app/api` and shared domain logic under `lib`.
- Current demo repository is in-memory; MySQL and Supabase migrations exist but runtime repository selection is not yet wired.
- Built-in OpenAI-compatible server proxy powers the CEO Copilot.
- Respond.io client is server-side and token-backed, but live provider verification is not yet complete.

## Design direction
- **Design movement:** restrained executive operations console: editorial spacing, navy authority, teal trust, and a single BKM gold accent.
- **Core principles:** evidence before interpretation; calm density; obvious next action; mobile-first readability.
- **Color philosophy:** navy anchors authority and access control, teal communicates verified operational progress, gold is reserved for attention and decision points, and warm canvas surfaces reduce glare.
- **Layout paradigm:** asymmetric command-center layout with a persistent navigation rail on desktop and a compact task-oriented bottom navigation on mobile.
- **Signature elements:** BKM mark in the navigation, thin rule-based section headers, and compact evidence/source panels beside executive summaries.
- **Interaction philosophy:** every consequential action shows its target, status, and result; destructive or external actions require explicit authorization; long work shows truthful processing state.
- **Animation:** short page entrance and panel transitions only; no decorative motion that competes with accounting or evidence.
- **Typography:** system sans for reliable rendering, strong tabular numerals for finance, and restrained uppercase labels for metadata rather than yellow subheading clutter.
- **Brand essence:** a dependable Kenyan professional-services operations room for Benjamin Mutua; precise, composed, accountable.
- **Brand voice:** direct and executive-readable. Example: “Three deadlines need attention this week.” / “The balance agrees to the ledger; open the account to inspect the entries.”
- **Wordmark/logo:** use the supplied BKM logo asset, never a text-only substitute.
- **Signature color:** BKM teal, used for verified work and primary actions.

## Implementation sequence
1. Stabilize and audit: route/health verification, diagnostics, E2E regression, error status correctness, upload validation, and demo-data labeling.
2. Complete core operations: client create/edit/archive and duplicate prevention; server-side permission enforcement; task and engagement filters; truthful pagination; notifications.
3. Wire persistence: introduce a repository interface with an explicit demo adapter and a database adapter, preserving existing data and keeping demo mode reproducible. Add environment separation and migration/seed documentation.
4. Complete document intelligence: preserve user instructions, support PDF/CSV/TXT/XLSX end to end, persist extraction metadata, show source rows/fields, support follow-up questions, and verify PDF/XLSX exports.
5. Validate accounting: add posted/draft/reversed state rules, period close protection, duplicate/reference safeguards, aging and cash summaries where records support them, and automated known-balance tests.
6. Expand assistant actions: use verified tools for lookup, client/task/report actions; require confirmation for consequential actions; never claim external delivery without a successful provider response.
7. Verify integrations: Respond.io status should distinguish configured, reachable, and successfully tested; inbound webhook deduplication and notification records should be durable.
8. Presentation readiness: clean demo reset boundary, fictional data labels, verified route navigation, mobile checks, and a final feature verification table.

## Project structure
- `app/`: page routes and protected API endpoints.
- `components/`: dashboard, operations, assistant, upload, and report UI.
- `lib/`: domain types, repository adapters, auth, accounting, document parsing, AI, exports, integrations.
- `db/migrations/`, `supabase/migrations/`: schema evolution.
- `db/seed/`: fictional demo data.
- `scripts/`: migration, seed, and E2E checks.
- `public/`: brand and route-manifest assets.

## Constraints and honest limits
- No production client data will be created, deleted, or sent externally without authorization.
- Accounting figures remain application-calculated; AI only explains verified results.
- External Gmail/WhatsApp delivery is reported as verified only after a real provider response.
- The first implementation batch prioritizes defects that affect correctness and demo trust; persistence migration follows as a separate controlled change.
