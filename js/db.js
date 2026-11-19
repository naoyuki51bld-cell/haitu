import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured =
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-');

export const sb = configured && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/** Supabase の結果を取り出す。エラーなら throw。 */
export async function q(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
