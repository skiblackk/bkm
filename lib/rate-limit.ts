/**
 * Login attempt throttling (BKM-02).
 *
 * The assessment found ten consecutive failures against one account returning
 * 401 every time — no 429, no Retry-After, no delay. On a shared internal
 * control room that is unlimited password guessing against a known work email.
 *
 * Two counters, because they defend different things:
 *
 *   per account — stops an attacker working one known mailbox. This is the
 *                 counter that matters, and it is deliberately slow to clear.
 *   per IP      — stops one source spraying many accounts. Loose enough that a
 *                 whole office behind a single NAT address does not lock itself
 *                 out through ordinary typing mistakes.
 *
 * The lockout message is identical whether or not the account exists, and it is
 * only returned after a failure — never on a successful login — so this cannot
 * be used to enumerate accounts. It also never says "account locked", because
 * that would confirm the address is real.
 *
 * Storage is in-process. On Vercel each serverless instance keeps its own map,
 * so the real limit is per instance; that is a meaningful improvement over no
 * limit at all, but it is not a distributed guarantee. Edge/WAF rules on
 * /api/auth/* should be added as the outer layer — see the report for why that
 * is a dashboard change rather than a code change.
 */

type Bucket = { failures: number; first: number; blockedUntil: number };

const WINDOW_MS = 15 * 60 * 1000;

/** Account rule: 5 failures, then 1s backoff doubling to a 15-minute lock. */
const ACCOUNT_FREE_FAILURES = 5;
/** IP rule: much looser — a shared office address is normal. */
const IP_FREE_FAILURES = 30;

const accounts = new Map<string, Bucket>();
const addresses = new Map<string, Bucket>();

/** Keep the maps from growing without bound on a long-lived instance. */
function sweep(map: Map<string, Bucket>, now: number) {
  if (map.size < 500) return;
  map.forEach((bucket, key) => {
    if (bucket.blockedUntil < now && now - bucket.first > WINDOW_MS) map.delete(key);
  });
}

function progress(map: Map<string, Bucket>, key: string, freeFailures: number): Bucket {
  const now = Date.now();
  sweep(map, now);
  const bucket = map.get(key) ?? { failures: 0, first: now, blockedUntil: 0 };
  if (now - bucket.first > WINDOW_MS && bucket.blockedUntil < now) {
    bucket.failures = 0;
    bucket.first = now;
  }
  if (bucket.failures >= freeFailures) {
    const over = bucket.failures - freeFailures;
    // 5→1s, 6→2s, 7→4s, 8→8s, 9→16s, 10→30s, 12→2m, 14→8m, 16→15m
    const seconds = over < 5 ? Math.min(30, 2 ** over) : Math.min(900, 30 * 2 ** (over - 4));
    bucket.blockedUntil = Math.max(bucket.blockedUntil, now + seconds * 1000);
  }
  bucket.failures += 1;
  map.set(key, bucket);
  return bucket;
}

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function check(map: Map<string, Bucket>, key: string): ThrottleDecision | null {
  const bucket = map.get(key);
  if (!bucket) return null;
  const now = Date.now();
  if (bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) };
  }
  return null;
}

/**
 * Call immediately before authenticating. Returns a refusal if this account or
 * this source is currently inside a backoff window.
 */
export function checkLoginAllowed(email: string, ip: string): ThrottleDecision {
  const account = check(accounts, email.toLowerCase());
  if (account) return account;
  const address = check(addresses, ip);
  if (address) return address;
  return { allowed: true };
}

/** Call after a failed password check, before returning 401. */
export function recordLoginFailure(email: string, ip: string): ThrottleDecision {
  const account = progress(accounts, email.toLowerCase(), ACCOUNT_FREE_FAILURES);
  progress(addresses, ip, IP_FREE_FAILURES);
  const now = Date.now();
  if (account.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((account.blockedUntil - now) / 1000)) };
  }
  return { allowed: true };
}

/** Call on a successful sign-in: the person knew their password. */
export function recordLoginSuccess(email: string) {
  accounts.delete(email.toLowerCase());
}

/** Sign-up: 10 new accounts per source per 15 minutes is generous for an office. */
const signupAttempts = new Map<string, Bucket>();

export function recordSignupAttempt(ip: string): ThrottleDecision {
  const bucket = progress(signupAttempts, ip, 10);
  const now = Date.now();
  if (bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)) };
  }
  return { allowed: true };
}

/** Test seam — resets both counters. */
export function resetLoginThrottle() {
  accounts.clear();
  addresses.clear();
  signupAttempts.clear();
}

/** The one message used for every throttled response. */
export const THROTTLE_MESSAGE = 'Too many sign-in attempts. Wait a moment and try again.';
