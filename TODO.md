# BKM Operations Hub acceptance checklist

- [ ] Stabilize the restored app: `/` and protected routes load, `/manus-routes.json` returns valid JSON, production build passes, diagnostics are registered, and existing E2E regression remains green.
- [ ] Client management supports server-authorized create, view, edit, archive, duplicate prevention, search, status/industry filters, and truthful empty/error states without exposing unrelated client records.
- [ ] Engagement and task management shows linked client context, assigned staff, status/priority/date filters, mobile-safe layouts, comments, and permission-protected updates.
- [ ] Staff administration remains restricted to Benjamin Mutua, supports user provisioning, explicit permission assignment, deactivation, and audit logging.
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
