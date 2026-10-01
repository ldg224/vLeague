// Settings (0.7). Two kinds:
// - synced: what follows the account to every device (Supabase user_settings): accent, spoiler-free results and the
//   matches already revealed, clock, start page, email choices. prefs() loads them once per page (cached).
// - device: how the app looks on this screen (localStorage 'vleague-device'): text size, reduced motion. Applied by
//   a one-line script in each page's <head> before the page paints, and again by setDevice().
import { db, currentUser } from './auth.js';
import { status } from './dashboard-data.js';

const DEFAULTS = {
  accent: 'club', spoilers: false, clock: '12', start: 'home', revealed: [],
  email: { deadline: '24h', sent_back: true, lineups_out: false, weekly: false, office_digest: true },
};
const CACHE = 'vleague-prefs';
const DEVICE = 'vleague-device';
const DEVICE_DEFAULTS = { text: '100', motion: 'system' };

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const merge = p => ({ ...DEFAULTS, ...p, email: { ...DEFAULTS.email, ...(p?.email || {}) }, revealed: p?.revealed || [] });

// Synchronous view for formatting and spoilers: the last loaded settings (or this device's cached copy).
let current = merge(store.get(CACHE));
let loading = null;
let userId = null;

export function prefs() {
  loading ||= (async () => {
    try {
      const user = await currentUser();
      if (!user) return current;
      userId = user.id;
      const { data, error } = await (await db()).from('user_settings').select('prefs').eq('user_id', user.id).maybeSingle();
      if (!error) { current = merge(data?.prefs); store.set(CACHE, current); }
    } catch { /* keep the cached copy */ }
    return current;
  })();
  return loading;
}
export const prefsNow = () => current;

// setPref('email.deadline', '3h'), setPref('accent', 'blue'). Saves the whole object; resolves once saved.
export async function setPref(path, value) {
  await prefs();
  if (!userId) throw new Error('Sign in first.');
  const next = structuredClone(current);
  const keys = path.split('.');
  let o = next;
  for (const k of keys.slice(0, -1)) o = o[k] ||= {};
  o[keys[keys.length - 1]] = value;
  const { error } = await (await db()).from('user_settings').upsert({ user_id: userId, prefs: next });
  if (error) throw new Error('That didn’t save. Check your connection and try again.');
  current = next;
  store.set(CACHE, current);
  return current;
}

// ---------------------------------------------------------------- this device

export const device = () => ({ ...DEVICE_DEFAULTS, ...(store.get(DEVICE) || {}) });
export function applyDevice(d = device()) {
  const root = document.documentElement;
  root.style.fontSize = d.text === '100' ? '' : `${Number(d.text) || 100}%`;
  root.classList.toggle('reduce-motion', d.motion === 'reduce');
}
export function setDevice(key, value) {
  const d = { ...device(), [key]: value };
  store.set(DEVICE, d);
  applyDevice(d);
  return d;
}

// ---------------------------------------------------------------- account

export async function setDisplayName(name) {
  const { error } = await (await db()).rpc('set_display_name', { p_name: name });
  if (error) throw new Error(/characters|Sign in/.test(error.message) ? error.message : 'Your name didn’t save. Try again.');
}

export async function sendTestEmail() {
  const { data, error } = await (await db()).functions.invoke('send-reminders', { body: { test: true } });
  if (error) {
    const body = await error.context?.json?.().catch(() => null);
    throw new Error(body?.error || 'The test email didn’t send. Try again later.');
  }
  return data;   // { ok: true, to }
}

// Where to go after signing in: the start page from Settings, for anyone who'd land on Home.
export async function startPage(landing) {
  if (landing !== 'home.html') return landing;
  const p = await prefs();
  return { club: 'club.html', inbox: 'inbox.html', league: 'league.html' }[p.start] || 'home.html';
}

// ---------------------------------------------------------------- times (12 or 24-hour clock)

export function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: current.clock !== '24' })
    .replace(/\s+/g, ' ');
}
export function fmtDay(d) {
  return new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------- spoiler-free results

// True when spoiler-free is on, the match has a score showing (live or full time) and this account hasn't
// revealed it yet. Call prefs() first (enterPlace does).
export function spoilerHidden(fx, season, now = new Date()) {
  if (!current.spoilers || !fx) return false;
  const st = status(fx, season, now);
  return (st === 'live' || st === 'ft') && !current.revealed.includes(fx.id);
}

// Reveal one match (or several) everywhere. Kept to the last 300 so the list never grows without end.
export async function revealScore(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const next = [...new Set([...current.revealed, ...list])].slice(-300);
  current = { ...current, revealed: next };
  store.set(CACHE, current);
  try { await setPref('revealed', next); } catch { /* shown on this device anyway */ }
}
