/**
 * Shared request guard for the quotation routes.
 *
 * Same rule as /api/actions (BKM-04): these routes authenticate from a cookie,
 * so a cross-site POST must be refused before anything else happens. Kept in
 * one place so a route added later cannot quietly skip it.
 */
export function crossSiteRequest(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  // GET downloads carry no body and no content type; only POST is checked.
  if (request.method !== 'GET' && !type.toLowerCase().startsWith('application/json')) return true;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function blocked() {
  return new Response(JSON.stringify({ error: 'This request was not made from the application.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
