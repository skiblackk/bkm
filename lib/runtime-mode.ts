/**
 * Runtime environment facts. The application serves exactly one store — the
 * Supabase repository — so there is no demonstration mode to switch between.
 */
export const hasSupabaseConfiguration = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const hasDatabaseConfiguration = Boolean(process.env.DATABASE_URL || hasSupabaseConfiguration);

export function productionReadiness() {
  return { mode: 'production', supabaseConfigured: hasSupabaseConfiguration, databaseConfigured: hasDatabaseConfiguration, realRepositoryConnected: hasSupabaseConfiguration } as const;
}
