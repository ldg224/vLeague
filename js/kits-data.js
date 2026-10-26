// Kits in the match views (S-23, S-20): load every club's kits and pick what each side wears in a match.
//   loadKits()                        -> { CODE: { home, away, gk, special, special2, special3 } }, each { design, logoUrl, artUrl } (logo and whole-kit design only once approved)
//   matchKits(kits, homeCode, awayCode, clubs) -> { home: { field, gk }, away: { field, gk } }, each a { design, logoUrl, main } or null
// Rules: the home side wears its home kit. The away side wears its away kit only if it has made one and the two main colours clash
// (S-20: the manager designs it, nothing is made up for them); otherwise its home kit. If the shirts still clash (no away or special kit made)
// the away side gets a plain contrasting shirt for the match views, never saved. A goalkeeper wears the club's goalkeeper kit if
// there is one. A side with no kit at all gets null, and the views fall back to the club colours as before.
import { db } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { cleanDesign, kitsClash, SPECIALS } from './kit.js';
import { isHex } from './club-colour.js';

const logoUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/kits/${path}` : '');

export async function loadKits() {
  try {
    const { data } = await (await db()).from('club_kits').select('*').range(0, 999);
    const out = {};
    for (const r of data || []) (out[r.club] ||= {})[r.slot] = { design: cleanDesign(r.design), logoUrl: r.logo_status === 'approved' ? logoUrl(r.logo_path) : '', artUrl: r.art_status === 'approved' ? logoUrl(r.art_path) : '' };
    return out;
  } catch { return {}; }   // no kits table yet, or offline: the views use club colours
}

// The kits the Editor chose for one match (0052): { [CODE]: slot }, only for the sides it chose for. Empty before that migration is run.
export async function loadFixtureKits(id, home, away) {
  try {
    const { data } = await (await db()).from('fixtures').select('home_kit, away_kit').eq('id', id).limit(1);
    const r = data?.[0] || {};
    return { ...(r.home_kit ? { [home]: r.home_kit } : {}), ...(r.away_kit ? { [away]: r.away_kit } : {}) };
  } catch { return {}; }
}

const wrap = k => (k ? { ...k, main: k.design.colours[0] } : null);

// colours: { CODE: '#rrggbb' } the clubs' own colours, used to judge a clash when a side has no kit yet.
// picks: { CODE: 'home' | 'away' | 'special' | 'special2' | 'special3' } the kit each team wears: the Editor's choice for this match, else the team's locked sheet; no pick (or a kit that no longer exists) = automatic.
export function matchKits(kits, homeCode, awayCode, colours = {}, picks = {}) {
  const h = kits?.[homeCode] || {}, a = kits?.[awayCode] || {};
  const home = h[picks[homeCode]] || h.home || null;
  let away = a[picks[awayCode]] || a.home || null;
  const seen = (k, code) => k?.design || { colours: [colours[code]] };
  if (!a[picks[awayCode]] && a.away && kitsClash(seen(home, homeCode), seen(away, awayCode))) away = a.away;
  // Still too alike: the first of the club's special kits that tells the shirts apart.
  const specials = SPECIALS.map(s => a[s]).filter(Boolean);
  if (!a[picks[awayCode]] && kitsClash(seen(home, homeCode), seen(away, awayCode))) away = specials.find(k => k !== away && !kitsClash(seen(home, homeCode), seen(k, awayCode))) || away;
  // Still too alike and the club has made no away kit and no special kit: for the match views only, the away side wears a plain shirt in white or near-black,
  // whichever is further from the home side's colours, with its own club colour as the trim. Nothing is saved; a club that made an away or special kit always wears one of them.
  if (!a[picks[awayCode]] && !a.away && !specials.length && kitsClash(seen(home, homeCode), seen(away, awayCode))) {
    const hd = seen(home, homeCode), ink = [hd.colours?.[0], hd.colours?.[1]].filter(isHex);
    const far = c => Math.min(...ink.map(h => Math.hypot(...[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) - parseInt(h.slice(i, i + 2), 16)))));
    const plain = ['#ffffff', '#151a24'].sort((p, q) => far(q) - far(p))[0], trim = isHex(colours[awayCode]) ? colours[awayCode] : plain;
    away = { design: cleanDesign({ pattern: 'plain', colours: [plain, trim, trim] }), logoUrl: '', artUrl: '' };
  }
  return { home: { field: wrap(home), gk: wrap(h.gk) }, away: { field: wrap(away), gk: wrap(a.gk) } };
}
