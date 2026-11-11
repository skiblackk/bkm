const supabaseConfiguration = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const isProductionDataMode = process.env.NODE_ENV === 'production' || process.env.BKM_REQUIRE_REAL_AUTH === 'true' || supabaseConfiguration;
export const hasSupabaseConfiguration = supabaseConfiguration;
export const hasDatabaseConfiguration = Boolean(process.env.DATABASE_URL || hasSupabaseConfiguration);

export function assertRealDataReady() {
  if (!isProductionDataMode) return;
  if (!hasSupabaseConfiguration) throw new Error('Production authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before serving internal data.');
  throw new Error('Production Supabase data repository is not connected yet. The application is refusing to serve demonstration records.');
}

export function productionReadiness() {
  return { mode: isProductionDataMode ? 'production' : 'demo', supabaseConfigured: hasSupabaseConfiguration, databaseConfigured: hasDatabaseConfiguration, demoRepositoryAllowed: !isProductionDataMode, realRepositoryConnected: false } as const;
}
