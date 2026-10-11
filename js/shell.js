// Shared start-up for the signed-in pages behind the league page's header buttons. Each page calls enterPlace() once: it signs the
// visitor in (or sends them on), wires the top bar and footer, paints the club's colour and band, draws the nav, and
// loads the club row, the league data and the account's settings together.
import { onColour, accentFor, glowFor, topoFor } from './club-colour.js';
import { sheen, pinClock } from './silk.js';
import { enter, chrome, safeColour, esc, crestUrl } from './member.js';
import { prefs } from './prefs.js';
import { db } from './auth.js';
import { loadSeason } from './dashboard-data.js';
import { icon } from './icons.js';
import { mountSubFrame } from './frame.js';

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
  s.setProperty('--topo-o', topoFor(colour));   // the contour lines' strength in dark mode: stronger on a very dark colour
  s.setProperty('--club-glow', glowFor(colour));   // the header panel's glow: lifted when the colour is too dark to shine
  document.body.classList.add('themed');
  document.getElementById('band')?.classList.add('on');
}

// The pages behind the header buttons (WR-26) have an empty <header id="frame"> and the league page's look (body.lg): fill it with the header card.
const PAGE_TITLES = { club: "My club" };   // (Settings has its own big title, so no name under the wordmark)
function drawSubFrame(place, me, club) {
  const el = document.getElementById('frame');
  if (!el || place === 'league') return;
  document.body.classList.toggle('has-club', Boolean(club));
  mountSubFrame(el, { office: me?.profile?.role === 'office', crest: club?.crest_path ? crestUrl(club.crest_path) : '', here: place === 'settings' ? 'settings' : 'club', title: document.body.dataset.title || PAGE_TITLES[place] || '' });
  // The contour lines and the silk fade in once their pictures are loaded, as on the league page (js/league.js).
  if (!document.body.classList.contains('topo-ready')) {
    Promise.all(['assets/img/topo.png', 'assets/img/fabric.png'].map(src => { const i = new Image(); i.src = src; return i.decode().catch(() => {}); }))
      .then(() => requestAnimationFrame(() => { document.body.classList.add('topo-ready'); requestAnimationFrame(pinClock); }));
    setTimeout(() => { document.body.classList.add('silk-seen'); pinClock(); }, 3500);
  }
}

// ctx = { me: { user, profile }, club, season, team, prefs, main } or null if the visitor was sent elsewhere.
// place is 'club' | 'draft' | 'settings' | 'league' (the page's own file name, used to come back after sign-in).
// club: the Supabase clubs row (null if the account has none). season: the league's season.json (null if it didn't
// load). team: the season's entry for this club (matched on code; the two stay in step until fixtures move to
// Supabase in 0.11).
export async function enterPlace(place) {
  chrome();
  drawNav();
  // Localhost only, for looking at the header and the page's frame without signing in (screenshots): ?preview&club=%23c8102e&office
  const q = new URLSearchParams(location.search);
  if (['localhost', '127.0.0.1'].includes(location.hostname) && q.has('preview')) {
    if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
    const [rows, season] = await Promise.all([db().then(c => c.from('clubs').select('*')).then(r => r.data || []).catch(() => []), loadSeason().catch(() => null)]);
    const real = rows.find(c => c.code === q.get('mine'));
    const club = real ? { ...real, ...(q.get('club') ? { colour: q.get('club') } : {}) } : q.get('club') ? { code: q.get('mine') || 'XXX', name: 'Preview club', colour: q.get('club') } : null;
    const me = { user: { id: 'preview' }, profile: { role: q.has('office') ? 'office' : 'manager', club: club?.code, display_name: club?.manager_name || 'Manager' } };
    paintClub(club); drawSubFrame(place, me, club);
    return { me, club, season, team: club && season ? season.teams.find(t => t.code === club.code) || null : null, prefs: {}, main: document.getElementById('main') };
  }
  const me = await enter(`${place}.html`);
  if (!me) return null;
  const code = me.profile?.club;
  const [club, season, settings] = await Promise.all([
    code ? db().then(c => c.from('clubs').select('*').eq('code', code).maybeSingle()).then(r => r.data || null).catch(() => null) : null,
    loadSeason().catch(() => null),
    prefs(),
  ]);
  paintClub(club);
  drawSubFrame(place, me, club);
  const team = club && season ? season.teams.find(t => t.code === club.code) || null : null;
  return { me, club, season, team, prefs: settings, main: document.getElementById('main') };
}

// Every card on the page gets its own splash and silk phase, as on the league page. Call after the page has drawn its cards.
export const styleCards = () => sheen(document);
