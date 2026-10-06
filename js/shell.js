// The places a manager moves between: Home, My club, Inbox, League (0.5) and Settings (its own tab from 0.7.1;
// managers only, so an account without a club doesn't get it). Each page calls enterPlace() once: it signs the
// visitor in (or sends them on), wires the top bar and footer, paints the club's colour and band, draws the nav, and
// loads the club row, the league data and the account's settings together.
import { onColour } from './club-colour.js';
import { enter, chrome, safeColour, esc } from './member.js';
import { prefs } from './prefs.js';
import { db } from './auth.js';
import { openDraft } from './draft-data.js';
import { loadSeason } from './dashboard-data.js';

const ICON = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  club: '<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/>',
  inbox: '<path d="M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  league: '<path d="M5 6h14M5 12h14M5 18h14"/><path d="M5 6h.01M5 12h.01M5 18h.01" stroke-width="3"/>',
  draft: '<path d="M6 4h12v4a6 6 0 0 1-12 0z"/><path d="M12 14v5M8 20h8"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
};
export const PLACES = [
  { id: 'home', label: 'Home', href: 'home.html' },
  { id: 'club', label: 'My club', href: 'club.html' },
  { id: 'inbox', label: 'Inbox', href: 'inbox.html' },
  { id: 'league', label: 'League', href: 'league.html' },
  { id: 'draft', label: 'Draft', href: 'draft.html' },
  { id: 'settings', label: 'Settings', href: 'settings.html' },
];

function drawNav(current) {
  const nav = document.getElementById('places');
  if (!nav) return;
  nav.setAttribute('aria-label', 'Main');
  nav.innerHTML = PLACES.map(p => `<a href="${p.href}" data-place="${p.id}"${p.id === current ? ' aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[p.id]}</svg><span>${esc(p.label)}</span><b class="dot" hidden></b></a>`).join('');
  document.body.classList.add('has-places');
}

// A small count on a place's tab (e.g. unread Inbox posts). 0 hides it.
export function badge(place, n) {
  const dot = document.querySelector(`#places [data-place="${place}"] .dot`);
  if (!dot) return;
  dot.textContent = n > 9 ? '9+' : String(n);
  dot.hidden = !n;
}

// The club's primary colour runs the page (css/member.css, body.themed): --club is the colour itself, --on-club the text that
// reads on top of it. A club with no valid colour yet stays vLeague blue.
export function paintClub(club) {
  if (!club) return;
  const colour = safeColour(club.colour), s = document.body.style;
  s.setProperty('--club', colour);
  s.setProperty('--on-club', onColour(colour));
  document.body.classList.add('themed');
  document.getElementById('band')?.classList.add('on');
}

// ctx = { me: { user, profile }, club, season, team, prefs, main } or null if the visitor was sent elsewhere.
// place is 'home' | 'club' | 'inbox' | 'league' | 'settings'.
// club: the Supabase clubs row (null if the account has none). season: the league's season.json (null if it didn't
// load). team: the season's entry for this club (matched on code; the two stay in step until fixtures move to
// Supabase in 0.11).
export async function enterPlace(place) {
  chrome();
  drawNav(place);
  const me = await enter(`${place}.html`);
  if (!me) return null;
  if (!me.profile?.club) document.querySelector('#places [data-place="settings"]')?.remove();
  // The Draft tab only exists while a draft is open (0.21): live or paused, inside its window.
  if (place !== 'draft') openDraft().then(d => { if (!d) document.querySelector('#places [data-place="draft"]')?.remove(); });
  const code = me.profile?.club;
  const [club, season, settings] = await Promise.all([
    code ? db().then(c => c.from('clubs').select('*').eq('code', code).maybeSingle()).then(r => r.data || null).catch(() => null) : null,
    loadSeason().catch(() => null),
    prefs(),
  ]);
  paintClub(club);
  const team = club && season ? season.teams.find(t => t.code === club.code) || null : null;
  return { me, club, season, team, prefs: settings, main: document.getElementById('main') };
}
