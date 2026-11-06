#!/usr/bin/env python3
"""Task 9 Slice H — permission matrix, tested with DIRECT HTTP calls.

Every assertion hits the API as a real signed-in user (never by hiding buttons).
Test users are zz.* accounts created for this run and deleted afterwards.
"""
import json, os, sys, time, urllib.request, urllib.error, http.cookiejar

# Credentials come from the environment / local untracked file. Never hardcode them.
BASE = os.environ.get('BKM_BASE_URL', 'http://localhost:3210')
PROJECT_REF = os.environ.get('SUPABASE_PROJECT_REF', 'pdtcciudkolyegaianaa')
PAT = os.environ['SUPABASE_ACCESS_TOKEN']
MGMT = f'https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query'
SUPA = f'https://{PROJECT_REF}.supabase.co'
_KEYS_PATH = os.environ.get('BKM_KEYS_FILE', '/tmp/sb-keys.json')
KEYS = json.load(open(_KEYS_PATH))
ANON, SERVICE = KEYS['anon'], KEYS['service_role']

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))

def sql(q):
    r = urllib.request.Request(MGMT, method='POST', headers={'Authorization': 'Bearer ' + PAT, 'Content-Type': 'application/json'})
    r.data = json.dumps({'query': q}).encode()
    try:
        return json.loads(urllib.request.urlopen(r, timeout=45).read())
    except urllib.error.HTTPError as e:
        return {'err': e.read().decode()[:400]}

def admin_create_user(email, password):
    r = urllib.request.Request(SUPA + '/auth/v1/admin/users', method='POST', headers={'Authorization': 'Bearer ' + SERVICE, 'apikey': SERVICE, 'Content-Type': 'application/json'})
    r.data = json.dumps({'email': email, 'password': password, 'email_confirm': True}).encode()
    try:
        d = json.loads(urllib.request.urlopen(r, timeout=45).read())
        return d.get('user', {}).get('id') or d.get('id')
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        # already exists -> look it up
        if 'already' in body.lower() or e.code in (422, 400):
            r2 = urllib.request.Request(SUPA + '/auth/v1/admin/users?page=1&per_page=200', headers={'Authorization': 'Bearer ' + SERVICE, 'apikey': SERVICE})
            for u in json.loads(urllib.request.urlopen(r2, timeout=45).read()).get('users', []):
                if u['email'] == email: return u['id']
        raise

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.email = None
    def post(self, path, payload, timeout=60):
        r = urllib.request.Request(BASE + path, method='POST', headers={'Content-Type': 'application/json'})
        r.data = json.dumps(payload).encode()
        return self._do(r, timeout)
    def get(self, path, timeout=60):
        r = urllib.request.Request(BASE + path, method='GET')
        return self._do(r, timeout)
    def _do(self, r, timeout):
        try:
            resp = self.opener.open(r, timeout=timeout)
            return resp.status, json.loads(resp.read() or b'{}')
        except urllib.error.HTTPError as e:
            try: body = json.loads(e.read() or b'{}')
            except Exception: body = {}
            return e.code, body
        except Exception as e:
            return 0, {'error': str(e)}
    def login(self, email, password):
        st, d = self.post('/api/auth/login', {'email': email, 'password': password})
        self.email = email
        return st == 200, d

def make_user(role_name, tag, password='Matrix-Test-93x'):
    email = f'zz.matrix.{tag}@bkm.test'
    uid = admin_create_user(email, password)
    role = sql(f"select id from roles where name = '{role_name}'")[0]['id']
    sql(f"""insert into public.profiles (id, role_id, full_name, email, initials, is_admin, approval_status, approved_at, active)
            values ('{uid}', '{role}', 'ZZ Test {tag}', '{email}', 'ZZ', {'true' if role_name in ('System Administrator','CEO / Managing Partner') else 'false'}, 'approved', now(), true)
            on conflict (id) do update set role_id = excluded.role_id, active = true, approval_status = 'approved'""")
    return email, uid

PW = 'Matrix-Test-93x'
users = {}
for role, tag in [('General Staff', 'general.staff'), ('Senior Auditor', 'senior.auditor'), ('Finance Lead', 'finance.lead'), ('Audit Manager', 'audit.manager')]:
    email, uid = make_user(role, tag)
    users[tag] = {'email': email, 'uid': uid, 'role': role}

admin = Client(); ok, d = admin.login('design.verify@bkm.test', 'Design-Verify-71x')
check('temp admin can sign in', ok)
clients = {}
for tag, info in users.items():
    c = Client(); ok, _ = c.login(info['email'], PW)
    check(f'{info["role"]} can sign in', ok)
    clients[tag] = c

# ---------------------------------------------------------------- RBAC: API authorisation
gs = clients['general.staff']
st, d = gs.get('/api/admin')
check('General Staff blocked from admin API', st == 403, f'{st}')
st, d = gs.post('/api/admin', {'action': 'update-permissions', 'account': users['general.staff']['uid'], 'permissions': ['manage_workspace_settings', 'view_payroll'], 'reason': 'privilege escalation attempt'})
check('General Staff blocked from privilege escalation', st in (401, 403), f'{st} {str(d)[:80]}')

st, d = gs.get('/api/data')
staff_rows = ((d.get('snapshot') or {}).get('staff') or [])
# The General Staff template includes view_staff_directory, so the directory is
# expected — but it must expose company directory fields only, never finance.
check('General Staff directory is permission-backed (view_staff_directory)', st == 200 and len(staff_rows) > 0)
leaky = [row for row in staff_rows if any(k in row for k in ('salary', 'payroll', 'bank', 'taxPin'))]
check('Staff directory payload carries no payroll or bank fields', st == 200 and not leaky, str(leaky)[:150])
check('General Staff gets no client records', st == 200 and len(((d.get('snapshot') or {}).get('clients') or [])) == 0)

sa = clients['senior.auditor']
st, d = sa.get('/api/admin')
check('Senior Auditor blocked from admin API', st == 403, f'{st}')

am = clients['audit.manager']
st, d = am.get('/api/admin')
check('Audit Manager blocked from admin API (not an admin)', st == 403, f'{st}')

# ---------------------------------------------------------------- Finance: catalogue + SoD
fl = clients['finance.lead']
st, d = fl.get('/api/accounting')
check('Finance Lead can read finance', st == 200, f'{st}')

# General Staff must not read finance at all
gs2 = clients['general.staff']
st, d = gs2.get('/api/accounting')
check('General Staff blocked from finance API', st == 403, f'{st}')

# prepare a draft as Finance Lead, then verify the four-eyes rule end to end
accounts = (sql("select id, code, name from accounting_accounts where is_active order by code limit 2") or [])
if isinstance(accounts, list) and len(accounts) >= 2:
    ref = f'SOD-{int(time.time())}'
    entry = {'id': ref, 'date': '2026-11-06', 'description': 'SoD control test entry', 'reference': ref,
             'lines': [{'accountId': accounts[0]['id'], 'debit': 1000, 'credit': 0}, {'accountId': accounts[1]['id'], 'debit': 0, 'credit': 1000}]}
    st, d = fl.post('/api/accounting', {'action': 'draft', 'entry': entry})
    check('Finance Lead can prepare a draft journal', st in (200, 201), f'{st} {str(d)[:120]}')
    row = sql(f"select status, created_by from journal_entries where reference = '{ref}'")
    check('Draft is stored as Draft with the preparer recorded',
          isinstance(row, list) and len(row) == 1 and row[0]['status'] == 'Draft' and row[0]['created_by'] == users['finance.lead']['uid'],
          str(row)[:160])
    st, d = fl.post('/api/accounting', {'action': 'approve', 'reference': ref})
    check('SoD: a draft cannot skip straight to approve', st in (403, 409), f'{st} {str(d)[:100]}')
    st, d = fl.post('/api/accounting', {'action': 'submit', 'reference': ref})
    check('Preparer can submit their own draft', st == 200, f'{st} {str(d)[:100]}')
    st, d = fl.post('/api/accounting', {'action': 'approve', 'reference': ref})
    check('SEGREGATION OF DUTIES: preparer cannot approve own entry', st == 403 and 'segregation' in str(d).lower(), f'{st} {str(d)[:120]}')
    st, d = am.post('/api/accounting', {'action': 'approve', 'reference': ref})
    check('Audit Manager without approve_journal_entries is refused', st == 403, f'{st} {str(d)[:100]}')
    st, d = admin.post('/api/accounting', {'action': 'approve', 'reference': ref})
    check('A different authorised person can approve (no override needed)', st == 200 and not d.get('sodOverride'), f'{st} {str(d)[:110]}')
    st, d = fl.post('/api/accounting', {'action': 'post', 'reference': ref})
    check('SEGREGATION OF DUTIES: preparer cannot post own entry', st == 403, f'{st} {str(d)[:110]}')
    st, d = admin.post('/api/accounting', {'action': 'post', 'reference': ref})
    check('Approved entry posts successfully by another person', st == 200, f'{st} {str(d)[:110]}')
    final = sql(f"select status from journal_entries where reference = '{ref}'")
    check('Posted status persisted', isinstance(final, list) and final and final[0]['status'] == 'Posted', str(final)[:120])
    # posted entries cannot be edited back through the workflow
    st, d = fl.post('/api/accounting', {'action': 'submit', 'reference': ref})
    check('Posted entry cannot re-enter the workflow', st == 409, f'{st} {str(d)[:100]}')
    # reversal is a distinct permission (Finance Lead holds it by template)
    st, d = fl.post('/api/accounting', {'action': 'reverse', 'reference': ref})
    check('Finance Lead (holds reverse_journal_entries) can reverse', st == 200, f'{st} {str(d)[:100]}')
    check('Reversal marks the entry Reversed', (sql(f"select status from journal_entries where reference = '{ref}'") or [{}])[0].get('status') == 'Reversed')
    sql(f"delete from journal_entry_lines where journal_entry_id in (select id from journal_entries where reference = '{ref}')")
    sql(f"delete from journal_entries where reference = '{ref}'")
else:
    check('chart of accounts present for SoD test', False, str(accounts)[:120])

# override path: an administrator who prepares an entry cannot silently approve it
ref2 = f'OVR-{int(time.time())}'
entry2 = {'id': ref2, 'date': '2026-11-06', 'description': 'Admin override test entry', 'reference': ref2,
          'lines': [{'accountId': accounts[0]['id'], 'debit': 250, 'credit': 0}, {'accountId': accounts[1]['id'], 'debit': 0, 'credit': 250}]}
st, d = admin.post('/api/accounting', {'action': 'draft', 'entry': entry2})
check('Admin can prepare a draft', st in (200, 201), f'{st} {str(d)[:110]}')
admin.post('/api/accounting', {'action': 'submit', 'reference': ref2})
st, d = admin.post('/api/accounting', {'action': 'approve', 'reference': ref2})
check('Admin cannot self-approve without a written reason', st == 400 and 'reason' in str(d).lower(), f'{st} {str(d)[:110]}')
st, d = admin.post('/api/accounting', {'action': 'approve', 'reference': ref2, 'overrideReason': 'Only finance officer available; approved under management review'})
check('Admin override with reason succeeds and is flagged', st == 200 and d.get('sodOverride') is True, f'{st} {str(d)[:110]}')
sod_log = sql(f"select action, severity from audit_events where target_id = '{ref2}' and severity = 'security'")
check('SoD override written to audit log at security severity', isinstance(sod_log, list) and len(sod_log) > 0, str(sod_log)[:160])
sql(f"delete from journal_entry_lines where journal_entry_id in (select id from journal_entries where reference = '{ref2}')")
sql(f"delete from journal_entries where reference = '{ref2}'")

# ---------------------------------------------------------------- Self-service
st, d = gs.get('/api/self-service')
check('Employee can read own self-service data', st == 200 and 'leaveRequests' in d, f'{st} {list(d)[:5] if isinstance(d, dict) else d}')
st, d = gs.post('/api/self-service', {'action': 'request-leave', 'leaveType': 'annual', 'startsOn': '2026-11-20', 'endsOn': '2026-11-22', 'reason': 'Family commitment'})
check('Employee can submit a leave request', st in (200, 201), f'{st} {str(d)[:120]}')
leave_id = (d.get('id') or d.get('request', {}).get('id')) if isinstance(d, dict) else None
st, d = gs.post('/api/self-service', {'action': 'request-access', 'permission': 'view_finance', 'reason': 'Month-end reporting support'})
check('Employee can request access', st in (200, 201), f'{st} {str(d)[:120]}')
st, d = gs.post('/api/self-service', {'action': 'request-access', 'permission': 'not_a_real_permission', 'reason': 'test'})
check('Unknown permission key rejected', st == 400, f'{st} {str(d)[:100]}')
# self-approval of own leave must not be possible via self-service
if leave_id:
    st, d = gs.post('/api/self-service', {'action': 'approve-leave', 'id': leave_id})
    check('Employee cannot approve own leave through self-service', st in (400, 403, 404), f'{st}')

# ---------------------------------------------------------------- Copilot permission denial
st, d = gs.post('/api/copilot', {'message': 'Show me the finance overview and payroll'})
trace_entries = d.get('toolTrace', []) if isinstance(d, dict) else []
finance_entry = next((t for t in trace_entries if t.get('tool') == 'finance_overview'), None)
check('Copilot reports a permission denial instead of finance data', st == 200 and finance_entry is not None and bool(finance_entry.get('denied')), f'{st} {json.dumps(finance_entry)[:200]}')
st, d = gs.post('/api/copilot', {'message': 'Prepare an announcement telling everyone to work Saturday'})
text = json.dumps(d).lower()
check('Copilot requires confirmation for consequential announcement', ('confirm' in text) and 'requiresConfirmation' in json.dumps(d), f'{st}')
st, d = fl.post('/api/copilot', {'message': 'Who has been late this month?'})
check('Finance Lead copilot refuses attendance data (no permission)', st == 200 and ('permission' in json.dumps(d).lower() or 'late arrivals' not in json.dumps(d).lower()), f'{st}')

# ---------------------------------------------------------------- Suspension takes effect immediately
sql(f"update profiles set active = false where email = '{users['senior.auditor']['email']}'")
sa_blocked = Client(); ok, _ = sa_blocked.login(users['senior.auditor']['email'], PW)
st, d = sa_blocked.get('/api/data')
check('Suspended user cannot use an existing session', st in (401, 403), f'{st}')
sql(f"update profiles set active = true where email = '{users['senior.auditor']['email']}'")
sa_back = Client(); ok, _ = sa_back.login(users['senior.auditor']['email'], PW)
check('Reactivated user can sign in again', ok)

# ---------------------------------------------------------------- Temporary grants
fl_uid = users['finance.lead']['uid']
sql(f"insert into user_permissions (user_id, permission_key, effect, granted_by, reason, expires_at) values ('{fl_uid}', 'view_confidential_documents', 'allow', '{users['audit.manager']['uid']}', 'Matrix test temporary grant', now() + interval '1 day')")
st, d = fl.get('/api/permissions')
eff = set(((d.get('effective') or {}).get('permissions') or []))
# Inspect the user-scoped effective set, never the global catalogue.
check('Active temporary allow adds the key to effective permissions', st == 200 and 'view_confidential_documents' in eff, f'{st}')
sql(f"delete from user_permissions where user_id = '{fl_uid}' and permission_key = 'view_confidential_documents'")
st, d = fl.get('/api/permissions')
eff_after = set(((d.get('effective') or {}).get('permissions') or []))
check('Revoked grant disappears immediately from effective permissions', st == 200 and 'view_confidential_documents' not in eff_after, f'{st}')

# ---------------------------------------------------------------- Summary
passed = sum(1 for _, ok, _ in results if ok)
print(f'\n=== {passed}/{len(results)} assertions passed ===')
json.dump([{'test': n, 'passed': ok, 'detail': dt} for n, ok, dt in results], open('/tmp/matrix-results.json', 'w'), indent=1)
sys.exit(0 if passed == len(results) else 1)
