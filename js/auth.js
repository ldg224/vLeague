// Sign-in for vLeague, backed by Supabase Auth (email + password; accounts are made by the league office).
//   signIn(email, password, remember)  -> { user } or throws with a readable message
//   currentUser()                      -> the signed-in user, or null
//   signOut()
//   ready                              -> false until js/config.js has the project's URL and key

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const ready = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let client = null;

// "Remember me" keeps the session in localStorage; otherwise it lasts until the browser tab closes.
const REMEMBER = 'vleague-remember';
function storage() {
  let remember = true;
  try { remember = localStorage.getItem(REMEMBER) !== 'no'; } catch { /* storage blocked */ }
  try { return remember ? window.localStorage : window.sessionStorage; } catch { return undefined; }
}

async function sb() {
  if (!ready) throw new Error('The sign-in service isn’t connected yet. The league office needs to finish the setup (docs/BACKEND.md).');
  if (!client) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, storage: storage(), storageKey: 'vleague-auth' } });
  }
  return client;
}

// Supabase's messages, in plain words.
function explain(error) {
  const m = String(error?.message || error || '');
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(m)) return 'This account hasn’t been confirmed yet. Ask the league office.';
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  if (/fetch|network|failed to load/i.test(m)) return 'Couldn’t reach the sign-in service. Check your connection and try again.';
  return m || 'Something went wrong. Try again.';
}

export async function signIn(email, password, remember = true) {
  try { localStorage.setItem(REMEMBER, remember ? 'yes' : 'no'); } catch { /* storage blocked */ }
  client = null;   // rebuild with the chosen storage
  const c = await sb();
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(explain(error));
  return data;
}

export async function currentUser() {
  if (!ready) return null;
  try {
    const { data } = await (await sb()).auth.getSession();
    return data.session?.user || null;
  } catch { return null; }
}

export async function signOut() {
  if (ready) try { await (await sb()).auth.signOut(); } catch { /* already signed out */ }
}
