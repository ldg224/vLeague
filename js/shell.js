// Shared start-up for the signed-in pages behind the league page's header buttons. Each page calls enterPlace() once: it signs the
// visitor in (or sends them on), wires the top bar and footer, paints the club's colour and band, draws the nav, and
// loads the club row, the league data and the account's settings together.
import { onColour, accentFor } from './club-colour.js';
import { enter, chrome, safeColour, esc } from './member.js';
import { prefs } from './prefs.js';
import { db } from './auth.js';
import { loadSeason } from './dashboard-data.js';
import { icon } from './icons.js';

// The old menu (Home, My club, Inbox, Matches, League, Draft, Settings) is gone (WR-06): the league page is the whole site and
// its tabs do those jobs. The pages behind its header buttons (My club, Settings, Kits, Draft) keep one way back.
function drawNav() {
  const nav = document.getElementById('places');
  if (!nav) return;
  nav.setAttribute('aria-label', 'Back to the league');
  nav.innerHTML = `<a class="places-back" href="league.html">${icon('arrow-left')}<span>League</span></a>`;
}

// Kept so the retired Home and Inbox scripts still load; there is no tab bar to put a count on any more.
export function badge() {}

// The club's primary colour runs the page (css/member.css, body.themed): --club is the colour itself, --on-club the text that
// reads on top of it. A club with no valid colour yet stays vLeague blue.
export function paintClub(club) {
  if (!club) return;
  const colour = safeColour(club.colour), s = document.body.style;
  s.setProperty('--club', colour);
  s.setProperty('--on-club', onColour(colour));
  // The accent shade for each theme (WR-03); css picks the one for the current theme.
  s.setProperty('--club-accent-dark', accentFor(colour, 'dark'));
  s.setProperty('--club-accent-light', accentFor(colour, 'light'));
  document.body.classList.add('themed');
  document.getElementById('band')?.classList.add('on');
}

// ctx = { me: { user, profile }, club, season, team, prefs, main } or null if the visitor was sent elsewhere.
// place is 'club' | 'draft' | 'settings' | 'league' (the page's own file name, used to come back after sign-in).
// club: the Supabase clubs row (null if the account has none). season: the league's season.json (null if it didn't
// load). team: the season's entry for this club (matched on code; the two stay in step until fixtures move to
// Supabase in 0.11).
export async function enterPlace(place) {
  chrome();
  drawNav();
  const me = await enter(`${place}.html`);
  if (!me) return null;
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
