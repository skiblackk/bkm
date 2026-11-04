# BKM Operations Hub acceptance checklist

- [ ] Stabilize the restored app: `/` and protected routes load, `/manus-routes.json` returns valid JSON, production build passes, diagnostics are registered, and existing E2E regression remains green.
- [ ] Client management supports server-authorized create, view, edit, archive, duplicate prevention, search, status/industry filters, and truthful empty/error states without exposing unrelated client records.
- [ ] Engagement and task management shows linked client context, assigned staff, status/priority/date filters, mobile-safe layouts, comments, and permission-protected updates.
- [ ] Staff administration remains restricted to Benjamin Mutua, supports user provisioning, explicit permission assignment, deactivation, and audit logging.
- [x] The notification bell opens a recipient-scoped notification centre with real unread counts, read/unread filters, mark-all-read, related-record navigation, and supported event generation.
- [x] Authorized staff can create and reuse one-to-one private conversations, send and receive messages, see unread/read states, receive notifications, and cannot access another participant's conversation.
- [ ] Document intake accepts PDF, CSV, TXT, XLSX, and XLS within the stated size limit; stores the document record; preserves the user's instruction, audience, purpose, and detail request; reports truthful processing status; and exposes source fields/rows for review.
- [ ] Document intelligence supports follow-up questions grounded in the uploaded document and exports verified PDF/XLSX reports whose totals and labels match the reviewed result.
- [ ] CEO Copilot answers from current BKM records, performs reliable application calculations, cites evidence, clearly identifies missing data, and executes only authorized, confirmation-safe actions.
- [ ] Accounting posts only balanced entries with valid accounts, blocks duplicate references and closed-period edits, supports controlled reversals, logs important actions, and keeps draft/reversed entries out of reports according to policy.
- [ ] Trial balance, profit and loss, balance sheet, cash summary, receivables/payables aging, and period comparisons are deterministic, date/currency/basis-labeled, drillable to source entries, and exportable where implemented.
- [ ] Automated accounting tests cover balanced/unbalanced journals, posted/draft/reversed entries, trial balance, profit and loss, balance sheet, date boundaries, and unauthorized edits using fictional known balances.
- [ ] Gmail, WhatsApp, and SMS integrations distinguish configured from reachable from successfully tested; secrets remain server-side; provider errors, retries, duplicate inbound events, and sending status are recorded honestly.
- [ ] Central notifications support categories, priority, timestamps, read status, related links, preferences, and duplicate prevention.
- [ ] Demo/test/real data boundaries are explicit; public demos use fictional records; refresh preserves saved work in persistent mode; reset is documented and safe.
- [ ] Final verification report states PASS, PARTIAL, BLOCKED, or NOT IMPLEMENTED for every major feature, with the exact test and remaining limitation; production readiness is not claimed without security, data-integrity, accounting, and operational evidence.

## Executive redesign outcomes
- [ ] Admin command centre has grouped navigation, a light top bar, an internal section index, a compact executive heading, and a priority-first layout separating attention items from configuration and destructive controls.
- [ ] Workspace navigation is role-aware, preserves all existing routes, provides a deliberate mobile navigation path, and removes or implements the current non-functional global-search affordance.
- [ ] Dashboard and admin metrics use actual repository/accounting records, share one configured as-of date/reporting period, label demo data clearly, and do not invent comparisons or percentages.
- [ ] Finance and accounting surfaces use professional statement tables with firm/report metadata, currency, period, reconciliation state, account drill-down, print-friendly hierarchy, and existing PDF/spreadsheet exports.
- [ ] Server-side API responses and mutation routes enforce permissions by resource; unauthorized users cannot retrieve finance, staff, document, assistant or private-message data merely through a hidden route.
- [ ] Existing broadcast delivery, private-message participant isolation, notifications, CRUD workflows, document processing, assistant behavior and exports remain regression-green after the redesign.
- [ ] Responsive layouts provide mobile-safe decision views for attendance, finance and operational tables rather than relying only on wide horizontal scrolling.


## Standalone administration and presence outcomes
- [ ] Access and Audit is a dedicated `/admin/access` workspace with a user directory, account status, role and effective permission visibility, searchable/filterable audit events, protected audit records, and no private message contents exposed.
- [ ] People and Attendance is a dedicated `/admin/people` workspace with staff directory, employee role/capacity information, daily attendance records, present/late/absent metrics, attendance history context, and explicit separation between physical attendance and online presence.
- [ ] Communications is a dedicated `/admin/communications` workspace with one-to-one private messaging, unread/read state, announcements, notification context, and server-side participant privacy.
- [ ] Finance and Audit is a dedicated `/admin/finance` workspace with accounting-engine metrics, general ledger, reconciliation state, financial period/currency labels, audit context, and restricted PDF/XLSX exports.
- [ ] All four workspaces have dedicated landing routes, contextual navigation, module-specific metrics, tables/filters, actions, reporting affordances, and permission enforcement at route/API/export boundaries.
- [ ] Authorized staff presence records sign-in and meaningful heartbeat activity, distinguishes online from offline, shows last-seen information where permitted, expires stale sessions, and appears in staff and messaging views without relying on browser online events.
- [ ] Presence notifications and preferences do not reveal private message content, do not duplicate on heartbeat updates, and prioritize message notifications over routine presence changes.
- [ ] Separate-account tests cover direct-route/API restrictions, role and permission changes, audit protection, attendance, announcements, message privacy, presence expiry, duplicate presence events, financial access and export restrictions.
