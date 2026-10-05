// Public browser configuration only. Never put a service_role key in this project.
export const SUPABASE_URL = 'https://xxqomjohueqgifggrtix.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_To4vyVGWsJwkgUUv7sa_XQ_ulU51yVJ';

export function getSupabaseClient() {
  if (!window.supabase) {
    throw new Error('Supabase SDK 未加载，请检查网络后重试。');
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
