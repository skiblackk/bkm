# BKM Operations Hub — CEO Demo Readiness

**Assessment:** Ready for a controlled CEO demonstration as an internal management and decision-support demo. Not yet production-ready for real client records or unattended external communication.

## Changes completed in this acceptance pass

- Added Benjamin-only AI message triage UI with:
  - Urgent / High / Normal / Low priority
  - Message summary
  - Classification reasoning
  - Editable suggested reply
  - Needs approval / Approved / Rejected state
  - Approve and Reject controls
  - Audit logging for decisions
  - Explicit demo-sample labeling
- Added server-side permission enforcement for:
  - Workspace data
  - Assistant requests and task actions
  - Document listing and upload
  - Financial exports
  - Document scan exports
  - Internal messages
- Added validated task-status input handling.
- Replaced repeated live operational date comparisons with a configurable Kenya-time demo date.
- Made seeded attendance records use the configured demo date.
- Documented the demo date, triage boundaries, provider status, and in-memory persistence limitation.
- Expanded the E2E script to cover protected APIs, grounded assistant answers, accounting balance validation, duplicate check-in, duplicate check-out, provisioning, task assignment, direct chat, and broadcast protection.

## Verified flows

- Benjamin Mutua administrator sign-in
- Ordinary-user sign-in and mandatory check-in
- Named attendance, late staff, and approved leave handling
- Duplicate check-in and duplicate check-out rejection
- Task assignment and task status changes
- Internal direct messages and administrator broadcast protection
- Record-grounded assistant response naming Mary Wanjiku for the seeded late-attendance query
- Deterministic trial balance and balance-sheet equation check
- Gmail Respond.io bridge status and approved test send
- Inbound webhook normalization into Benjamin’s communication inbox
- AI triage display and human approval state change without automatic external sending
- Responsive admin dashboard and mobile task layout
- Production build and health endpoint

## Validation results

- `pnpm typecheck` — passed
- `pnpm build` — passed
- `pnpm e2e` — passed
- `git diff --check` — passed
- Unauthenticated `/api/data` — rejected with `401`
- Unauthenticated assistant request — rejected before accessing records
- Unauthenticated financial export — rejected before generating a file
- `pnpm lint` — not completed because the installed Next.js command opens an interactive first-run ESLint migration prompt; no lint configuration was changed automatically

## Known limitations to disclose during the presentation

1. The current preview uses an in-memory demonstration repository. Page refreshes retain state while the server process is alive; restarting the process resets the seeded state.
2. Supabase migrations and seed scripts exist, but the current preview is not using Supabase as its live source of truth.
3. The accounting engine is deterministic and reports are calculated from journal records. Document approval is intentionally separate from posting; the demo does not silently create journal entries from extracted documents.
4. Gmail through Respond.io was connected and tested. WhatsApp and SMS still require their provider channels to be connected and tested.
5. The current AI triage classifier is a safe deterministic demonstration classifier. Production should persist inbound messages and drafts and connect the approved server-side LLM workflow to client, engagement, and conversation history.
6. Gmail deliverability still depends on the company domain’s SPF, DKIM, DMARC alignment, sender reputation, and the Respond.io SMTP configuration.
7. External replies remain human-approved. The triage approval state is not an automatic send; the controlled send step must remain explicit.

## CEO presentation path

1. Open `/` and choose **Benjamin Mutua**.
2. Open the admin command center.
3. Show attendance: Mary Wanjiku is late, Brian Otieno is not checked in, and Joseph Mwangi is on approved leave.
4. Show the financial overview and open the workspace finance view for trial balance and statements.
5. Open the AI Assistant and ask:
   - `Who is late today?`
   - `Create a trial balance`
   - `How is the firm doing?`
6. Open the **Message triage for Benjamin** section.
7. Edit the suggested reply, then approve or reject it and point out that no external message is sent automatically.
8. For a live webhook demonstration, post a test Gmail event to:

   `POST /api/webhooks/communications?channel=gmail`

9. Explain the provider boundary honestly: Gmail is connected through Respond.io; WhatsApp and SMS are awaiting channel authorization.

## Environment variables

- `BKM_DEMO_DATE=2026-10-01`
- `NEXT_PUBLIC_BKM_DEMO_DATE=2026-10-01`
- `RESPOND_IO_API_TOKEN` — server-side secret store only
- `RESPOND_IO_API_BASE_URL=https://api.respond.io/v2`
- `RESPOND_IO_WORKSPACE_ID`
- `RESPOND_IO_GMAIL_CHANNEL_ID`
- `RESPOND_IO_WEBHOOK_SECRET`
- `BKM_GMAIL_WEBHOOK_SECRET`
- `BKM_SMS_WEBHOOK_SECRET`
- `BKM_WHATSAPP_WEBHOOK_SECRET`

The complete implementation notes remain in `README.md`.
