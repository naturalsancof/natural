import {createClient} from '@supabase/supabase-js';

// Same public project the static board ships with. A Vite env var can override
// it; otherwise preview and production keep using this publishable key.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://xxqomjohueqgifggrtix.supabase.co';

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_To4vyVGWsJwkgUUv7sa_XQ_ulU51yVJ';

let client;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }

  return client;
}
