import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const secureContext = process.env.NODE_ENV === 'production' || headerStore.get('x-forwarded-proto') === 'https' || headerStore.get('origin')?.startsWith('https://') === true;
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, {
            ...options,
            path: '/',
            sameSite: secureContext ? 'none' : 'lax',
            secure: secureContext,
          }));
        } catch { /* Server Components cannot always mutate cookies. */ }
      },
    },
  });
}
