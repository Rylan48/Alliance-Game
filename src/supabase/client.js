const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};
  const url = process.env.SUPABASE_URL || globalScope.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || globalScope.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || globalScope.SUPABASE_ANON_KEY || '';
  const key = serviceRoleKey || anonKey;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

module.exports = {
  getSupabaseClient
};
