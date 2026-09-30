// Sign-in for vLeague, backed by Supabase Auth (email + password; accounts are made by the league office).
//   signIn(email, password, remember)  -> { user } or throws with a readable message
//   currentUser()                      -> the signed-in user, or null
//   signOut()
//   myProfile()                        -> { role, club, display_name } for the signed-in user, or null
//   landingPage(profile)               -> where a signed-in user goes: editor.html (office) or home.html
//   sendPasswordReset(email)           -> emails a link to set-password.html (same result whether or not the account exists)
//   setPassword(password)              -> sets a new password for the session from an invite or reset link
//   setGuest(on), isGuest()            -> the "View as guest" choice, remembered in localStorage
//   db()                               -> the Supabase client, for reading and writing tables (row-level security applies)
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

// A guest browses without an account or a Supabase session; the choice is remembered so a returning guest skips sign-in.
const GUEST = 'vleague-guest';
export function setGuest(on) {
  try { on ? localStorage.setItem(GUEST, 'yes') : localStorage.removeItem(GUEST); } catch { /* storage blocked */ }
}
export function isGuest() {
  try { return localStorage.getItem(GUEST) === 'yes'; } catch { return false; }
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
  if (/should be different/i.test(m)) return 'Choose a password you haven’t used for this account before.';
  if (/at least \d+ characters|weak|too short/i.test(m)) return 'That password is too weak. Use at least 8 characters.';
  if (/session|jwt|expired/i.test(m)) return 'This link has expired. Ask for a new one from the sign-in page.';
  if (/fetch|network|failed to load/i.test(m)) return 'Couldn’t reach the sign-in service. Check your connection and try again.';
  return m || 'Something went wrong. Try again.';
}

export async function signIn(email, password, remember = true) {
  try { localStorage.setItem(REMEMBER, remember ? 'yes' : 'no'); } catch { /* storage blocked */ }
  client = null;   // rebuild with the chosen storage
  const c = await sb();
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(explain(error));
  setGuest(false);
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
  setGuest(false);
  if (ready) try { await (await sb()).auth.signOut(); } catch { /* already signed out */ }
}

// The signed-in user's row in public.profiles (row-level security lets each user read only their own).
export async function myProfile() {
  const user = await currentUser();
  if (!user) return null;
  try {
    const { data, error } = await (await sb()).from('profiles').select('role, club, display_name').eq('id', user.id).maybeSingle();
    return error ? null : data;
  } catch { return null; }
}

// The same client for table queries elsewhere (home, editor), so there's one session.
export const db = () => sb();

export const landingPage = profile => (profile?.role === 'office' ? 'editor.html' : 'home.html');

// Supabase answers the same way for unknown emails, so this never tells anyone which accounts exist.
export async function sendPasswordReset(email) {
  const redirectTo = new URL('set-password.html', location.href).href;
  const { error } = await (await sb()).auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error && /rate limit|too many|fetch|network|failed to load/i.test(error.message || '')) throw new Error(explain(error));
}

// supabase-js reads the session from the email link itself (detectSessionInUrl), so currentUser() works on arrival.
export async function setPassword(password) {
  const { error } = await (await sb()).auth.updateUser({ password });
  if (error) throw new Error(explain(error));
  setGuest(false);
}
