

## Complete redesign phase: accounting integrity first

The first implementation phase for the broader redesign focuses on the accounting foundation because every finance screen, export and AI explanation depends on it. The engine now validates posted journal entries against the chart of accounts, rejects duplicate references and malformed lines, filters reports by a stated period, excludes non-posted entries, computes debit/credit totals from the same selected ledger records, and exposes controlled administrator-only posting and reversal endpoints with audit events. Financial exports and the finance UI consume the same metadata and explicit trial-balance difference, and a repeatable API regression script covers reconciliation, invalid journals, duplicate references, unauthorized mutation and reversal.

Provider settings, expanded document intelligence and the remaining cross-application control audit remain subsequent phases. They are not represented as complete merely because the existing assistant or document screens exist.
