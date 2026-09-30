// Shared by the signed-in pages (home.html, editor.html): who is signed in, their club, and crest links.
import { currentUser, myProfile, landingPage, signOut, db } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { VERSION } from './version.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const safeColour = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#64b5f6');
export const crestUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/crests/${path}` : '');

// Load the signed-in account for a page that belongs to `page` ('home.html' or 'editor.html').
// No session -> sign in. Signed in but this isn't your page -> your page. Otherwise { user, profile }.
export async function enter(page) {
  const user = await currentUser();
  if (!user) { location.replace('index.html?signin'); return null; }
  const profile = await myProfile();
  const mine = landingPage(profile);
  if (mine !== page) { location.replace(mine); return null; }
  return { user, profile };
}

export async function clubs() {
  const { data, error } = await (await db()).from('clubs').select('*').order('name');
  if (error) throw new Error('The clubs didn’t load.');
  return data;
}

// Footer version and the Sign out button, the same on every signed-in page.
export function chrome() {
  const v = document.getElementById('version');
  if (v) v.textContent = `v${VERSION}`;
  document.getElementById('signout')?.addEventListener('click', async () => {
    await signOut();
    location.replace('index.html?signin');
  });
}
