// The four places a manager moves between (0.5): Home, My club, Inbox, League. Each page calls enterPlace() once:
// it signs the visitor in (or sends them on), wires the top bar and footer, paints the club accent and band, draws
// the nav, and loads the club row and the league data together.
import { enter, chrome, safeColour, esc } from './member.js';
import { db } from './auth.js';
import { loadSeason } from './dashboard-data.js';

const ICON = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  club: '<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/>',
  inbox: '<path d="M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  league: '<path d="M5 6h14M5 12h14M5 18h14"/><path d="M5 6h.01M5 12h.01M5 18h.01" stroke-width="3"/>',
};
export const PLACES = [
  { id: 'home', label: 'Home', href: 'home.html' },
  { id: 'club', label: 'My club', href: 'club.html' },
  { id: 'inbox', label: 'Inbox', href: 'inbox.html' },
  { id: 'league', label: 'League', href: 'league.html' },
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

export function paintClub(club) {
  if (!club) return;
  document.body.style.setProperty('--club', safeColour(club.accent || club.colour));
  document.getElementById('band')?.classList.add('on');
}

// ctx = { me: { user, profile }, club, season, team, main } or null if the visitor was sent elsewhere.
// club: the Supabase clubs row (null if the account has none). season: the league's season.json (null if it didn't
// load). team: the season's entry for this club (matched on code; the two stay in step until fixtures move to
// Supabase in 0.8).
export async function enterPlace(place) {
  chrome();
  drawNav(place);
  const me = await enter(`${place}.html`);
  if (!me) return null;
  const code = me.profile?.club;
  const [club, season] = await Promise.all([
    code ? db().then(c => c.from('clubs').select('*').eq('code', code).maybeSingle()).then(r => r.data || null).catch(() => null) : null,
    loadSeason().catch(() => null),
  ]);
  paintClub(club);
  const team = club && season ? season.teams.find(t => t.code === club.code) || null : null;
  return { me, club, season, team, main: document.getElementById('main') };
}
