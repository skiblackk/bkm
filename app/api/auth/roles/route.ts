import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/** Public role list for the sign-up form (System Administrator is never assignable there). */
export async function GET() {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ roles: ['Team Member'] });
  const { data } = await admin.from('roles').select('name').neq('name', 'System Administrator').order('name');
  const names = (data ?? []).map((role) => role.name as string);
  return NextResponse.json({ roles: names.length ? names : ['Team Member'] });
}
