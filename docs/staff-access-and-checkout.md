# Access requests, staff activity, check-out and WhatsApp reach

This covers the five things reported from the floor after the quotations work,
what was actually broken, and how each is now closed off. Everything here is
live on `main` (`0e904ac`) and on https://bkm-livid.vercel.app.

---

## 1. A permission request now reaches the administrator

**What was wrong.** A staff member could ask for a permission and the row was
written to `approval_requests` — and that was the end of it. Four separate
breaks, all of which had to be fixed:

| Break | Effect |
| --- | --- |
| `AccessPermissionsWorkspace` (its Requests tab) was imported on `/admin/users` only through a page nobody opened | the queue was not on any screen an administrator visits |
| The access tab of the command centre rendered only user management, audit and control panels | even the admin dashboard did not show requests |
| `approval_requests` inserts notified nobody | no bell, no pop-up, no count |
| `/api/approvals` `decide` changed only `status` | approving granted nothing at all |

**What happens now.**

- The request form in **My workspace → Access request centre** is a dropdown of
  the catalogue, narrowed to the permissions that account does not already
  hold (server-evaluated, so it cannot offer something already granted).
- On submit the API writes the row, then notifies **every administrator** with
  a `high` priority notification whose `link_path` is
  `/admin?tab=access&view=requests`. The staff member is told how many
  administrators were actually notified.
- **Access & audit** in the command centre (and `/admin/access`) leads with
  **Permission requests**: waiting-on-you / already-decided tabs, the reason,
  who asked and in what role, how many admins were notified, and
  **Approve & grant** / **Decline** with an optional note back.
- A **pop-up** (bottom-right) appears within 20 seconds of a request being
  raised, anywhere in the command centre, with Grant / Decline **inside the
  toast**. It is shown once per browser — a toast that reappears on every screen
  change is a nuisance, not a notification.
- The rail badge next to *Access & audit* counts waiting requests as well as
  pending sign-ups.

## 2. Approving actually grants the permission

`decide_approval_request(request, decision, actor, actor_name, note)` runs as one
transaction: it flips the status, stamps `decided_by` / `decided_by_name` /
`decided_at`, and — for an approved `access_request` whose payload holds a
permission key — inserts the `user_permissions` row (`effect = 'allow'`,
`granted_by`, reason naming the approval). A stale `deny` row on the same key is
removed first, so an old deny cannot silently cancel the new allow.

A second decision on the same request is refused with `409` rather than
double-granting. The requester gets a notification that says what they can now
do, and the decision is written to the audit trail with `severity = 'security'`.

> Verified end to end: request → notification → approve → the permission appears
> in `getEffectiveAccess` for that user, and the person is told in their own bell.

## 3. Check-out exists, and administrators are not exempt

A working day is a row in `staff_sessions`:

- **Arrival gate.** Everyone — the administrator included — lands on *Check in
  before you start work* until the day is opened. Arriving no longer counts as
  checking in; only the button does.
- **Heartbeat.** The client pings every 60 s; *online* means seen in the last
  five minutes.
- **Sign-out goes through check-out.** The Sign out button opens the check-out
  dialog (what you finished today, optional) and only then ends the session.
  There is no other path out of the workspace.
- **One record.** The server closes the session *and* the attendance register in
  the same call, so a check-out is never written twice.
- **Forced check-out.** An administrator can close somebody else's forgotten
  session from **People & attendance**; the person is notified.

`bkm_open_session` is idempotent (a second device reuses the open session — a
unique partial index enforces one open session per person) and
`bkm_close_session` refuses to touch anyone else's session unless the caller
holds `force_checkout`.

## 4. Staff can see their own record

**My workspace** now shows, for the signed-in person:

- the audit rows **for them** — the same rows the administrator reads, from the
  `staff_activity_feed` view over `audit_events`;
- their leave and access requests, with the deciding administrator's name and
  note;
- their open session and a **Check out for today** button;
- the WhatsApp number field (below).

The visibility is deliberately symmetrical: nothing is recorded about a person
that the person cannot read.

## 5. The administrator sees what the team is doing

**People & attendance** opens with two panels driven by the same data:

- **Who is on duty** — every session, with in/out times, whether they are active
  now or idle since when, the check-out note, and a *Check out* override.
- **What the team is doing** — the audit trail, newest first, searchable and
  filterable by person. Read-only verbs (`view`, `sign_in`, heartbeats) are
  filtered out: an administrator wants to see changes, not a scroll of page
  views. Nothing is removed from `audit_events`; this is a reading filter.

The feed resolves names from the profile rather than trusting `actor_name`, and
scrubs any UUID out of the detail text — older attendance rows had written the
staff member's id into the audit row, which is how a raw uuid ended up on
screen. `updateAttendance` now takes the acting session, so new rows name the
person.

**Check-out also lands in the attendance table** the administrator already uses,
and the existing late-arrival alerts are unchanged.

## 6. WhatsApp: capturing numbers, and what a broadcast can honestly do

**Storage.** `profiles.phone` holds the number in international form
(`2547XXXXXXXX` / `2541XXXXXXXX`), normalised from whatever was typed
(`0722 123 456`, `+254 722 123 456`, `254-722-123456`), with a check constraint
so junk cannot be stored, plus `whatsapp_opt_in`. Staff save it themselves in
**My workspace**, which is also where they see whether a number is on file and
whether they have declined broadcasts.

**Broadcast.** There is no WhatsApp Business provider attached to this workspace,
so **nothing is sent by the server**. What the administrator gets is a prepared
broadcast:

1. write the message (900 characters, plain text — WhatsApp links cannot attach
   files);
2. choose the audience, or leave it at everyone with a number;
3. **Prepare** turns it into one `wa.me` chat per person, with the message
   pre-filled, each opened from the administrator's own WhatsApp;
4. each chat can be marked **Sent**, and the workspace records that the
   administrator says they pressed send — not that WhatsApp delivered it.

People with no number, or who declined broadcasts, are listed as skipped rather
than silently dropped. The screen states this in plain words, including that a
WhatsApp provider is needed before anything can be confirmed as delivered.

To make it real end to end later, add a provider (Meta Cloud API or a BSP) and
replace the `broadcast-whatsapp` hand-off in `app/api/staff/route.ts` with a
send call; the broadcast and recipient tables are already there to hold the
result.

---

## Where it lives

| Concern | File |
| --- | --- |
| Session / check-out / activity / numbers (server) | `lib/staff-activity.ts` |
| Sessions + activity + broadcast API | `app/api/staff/route.ts` |
| Request queue API | `app/api/access-requests/route.ts` |
| Request queue UI | `components/access-request-console.tsx` |
| Pop-up on a new request | `components/access-request-toasts.tsx` |
| On-duty board + team activity | `components/staff-activity-board.tsx` |
| WhatsApp broadcast panel | `components/whatsapp-broadcast.tsx` |
| Arrival gate, check-out dialog | `components/staff-session.tsx` |
| My workspace | `components/employee-self-service.tsx` |
| Decision + grant (transaction) | `supabase/migrations/021_access_requests_activity_whatsapp.sql` → `decide_approval_request` |

## Testing

- `pw/b-partb-e2e.js` — the full walk in a browser against a local server:
  arrival gate → request → notification → approve → grant verified through
  `/api/permissions` → own activity → admin feed → number saved → broadcast
  prepared with working `wa.me` links → sign-out blocked until check-out.
- `pw/partb-prod.js` — the production read-back against
  https://bkm-livid.vercel.app: **11/11 pass**, including that the arrival gate
  is shown to the administrator and that signing out asks for a check-out.
- Reference screenshots: `bkm-partb-admin.png`, `bkm-partb-checkout.png`,
  `bkm-partb-production.png`.
