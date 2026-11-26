/**
 * Security headers.
 *
 * These are the controls from the November 2026 external assessment (BKM-01,
 * BKM-04, BKM-05). They are applied at the edge to every path, so an API route
 * added later cannot forget them.
 *
 * Deliberately NOT included: a strict `default-src`. This app emits inline RSC
 * payload scripts (`self.__next_f.push`) and a nonce has to be threaded through
 * middleware before a strict policy can be turned on. Adding one without that
 * work would break hydration on every page. `frame-ancestors` needs no nonce,
 * so it can ship on its own and closes the actual clickjacking finding.
 *
 * @type {import('next').NextConfig}
 */
const securityHeaders = [
  {
    // frame-ancestors is the control that matters; X-Frame-Options is kept for
    // browsers that predate CSP Level 2 and is ignored by modern ones when both
    // are present. 'none' rather than 'self': nothing in this product frames
    // itself, and 'self' would still allow a compromised same-origin page to
    // frame the control room.
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  // No MIME sniffing: an uploaded file served back as JSON must never be
  // re-interpreted as HTML by a browser guessing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Query strings here carry state such as ?error=sign_in_required; do not leak
  // them to third parties through the Referer header.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

const nextConfig = {
  // Do not advertise the framework on every response (BKM-05).
  poweredByHeader: false,
  // pdfkit resolves its built-in Helvetica metrics at runtime through an
  // import-map subpath (`#standard-fonts/*.cjs`). That specifier is not a file
  // path the bundler or Vercel's tracer can follow, so the deployed function
  // shipped without the metrics and every export failed with "Cannot find
  // module .../Helvetica.cjs". Shipping the files with the trace did not help —
  // the runtime lookup is inside the pnpm store path. Including pdfkit in the
  // bundle instead lets the bundler resolve and inline those imports, which is
  // what the local build was already doing successfully.
  transpilePackages: ['pdfkit'],
  outputFileTracingIncludes: {
    '/api/quotations/**': [
      './node_modules/pdfkit/js/standard-fonts/**/*',
      './node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/standard-fonts/**/*',
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
