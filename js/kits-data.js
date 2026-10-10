// Kits in the match views (S-23, S-20): load every club's kits and pick what each side wears in a match.
//   loadKits()                        -> { CODE: { home, away, gk, special } }, each { design, logoUrl, artUrl } (logo and whole-kit design only once approved)
//   matchKits(kits, homeCode, awayCode, clubs) -> { home: { field, gk }, away: { field, gk } }, each a { design, logoUrl, main } or null
// Rules: the home side wears its home kit. The away side wears its away kit only if it has made one and the two main colours clash
// (S-20: the manager designs it, nothing is made up for them); otherwise its home kit. A goalkeeper wears the club's goalkeeper kit if
// there is one. A side with no kit at all gets null, and the views fall back to the club colours as before.
import { db } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { cleanDesign, kitsClash } from './kit.js';

const logoUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/kits/${path}` : '');

export async function loadKits() {
  try {
    const { data } = await (await db()).from('club_kits').select('*').range(0, 999);
    const out = {};
    for (const r of data || []) (out[r.club] ||= {})[r.slot] = { design: cleanDesign(r.design), logoUrl: r.logo_status === 'approved' ? logoUrl(r.logo_path) : '', artUrl: r.art_status === 'approved' ? logoUrl(r.art_path) : '' };
    return out;
  } catch { return {}; }   // no kits table yet, or offline: the views use club colours
}

const wrap = k => (k ? { ...k, main: k.design.colours[0] } : null);

// colours: { CODE: '#rrggbb' } the clubs' own colours, used to judge a clash when a side has no kit yet.
// picks: { CODE: 'home' | 'away' | 'special' } the kit each team's locked sheet chose; no pick (or a kit that no longer exists) = automatic.
export function matchKits(kits, homeCode, awayCode, colours = {}, picks = {}) {
  const h = kits?.[homeCode] || {}, a = kits?.[awayCode] || {};
  const home = h[picks[homeCode]] || h.home || null;
  let away = a[picks[awayCode]] || a.home || null;
  const seen = (k, code) => k?.design || { colours: [colours[code]] };
  if (!a[picks[awayCode]] && a.away && kitsClash(seen(home, homeCode), seen(away, awayCode))) away = a.away;
  return { home: { field: wrap(home), gk: wrap(h.gk) }, away: { field: wrap(away), gk: wrap(a.gk) } };
}
