// The league's Instagram (WR-30): link checks and the Overview card. String builders and checks only (no page code), so the tests can run them.
//
//   postLink(text)        'https://www.instagram.com/p/ABC123xyz/?igsh=...' -> 'https://www.instagram.com/p/ABC123xyz/' (posts, reels and tv), or null
//   accountLink(text)     'instagram.com/vleague.official' -> 'https://www.instagram.com/vleague.official/', or null
//   handleOf(url)         '@vleague.official'
//   count(n)              1234 -> '1,234', 12500 -> '12.5K', 2300000 -> '2.3M'
//   instagramCard(row)    the card: account, optional numbers and a Follow button on the left, the newest two posts as Instagram's own embed on the right
//
// The links are checked here and again by the database (supabase/migrations/0052_league_social.sql), and only a checked link ever becomes the
// address of an embed, so a bad row can't point the page anywhere else. row = { instagram_url, instagram_posts: [url], followers, posts } or null.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const DEFAULT_ACCOUNT = 'https://www.instagram.com/vleague.official/';

export function postLink(text) {
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,30})(?:[/?#].*)?$/i.exec(String(text || '').trim());
  return m ? `https://www.instagram.com/${m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase()}/${m[2]}/` : null;
}

export function accountLink(text) {
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#].*)?$/i.exec(String(text || '').trim());
  return m && !['p', 'reel', 'reels', 'tv', 'explore', 'accounts'].includes(m[1].toLowerCase()) ? `https://www.instagram.com/${m[1]}/` : null;
}

export const handleOf = url => `@${(accountLink(url) || DEFAULT_ACCOUNT).split('/')[3]}`;

export function count(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  n = Number(n);
  const short = (v, s) => `${(Math.round(v * 10) / 10).toString().replace(/\.0$/, '')}${s}`;
  return n >= 1e6 ? short(n / 1e6, 'M') : n >= 1e4 ? short(n / 1e3, 'K') : n.toLocaleString('en-AU');
}

const GLYPH = '<svg class="ig-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".6"/></svg>';

export function instagramCard(row) {
  const account = accountLink(row?.instagram_url) || DEFAULT_ACCOUNT;
  const posts = (row?.instagram_posts || []).map(postLink).filter(Boolean).slice(0, 2);
  const stats = [['Followers', count(row?.followers)], ['Posts', count(row?.posts)]].filter(([, v]) => v);
  const side = `<div class="ig-side"><div class="ig-who">${GLYPH}<span><b>${esc(handleOf(account))}</b><small>Instagram</small></span></div>`
    + (stats.length ? `<dl class="ig-stats">${stats.map(([k, v]) => `<div><dd>${esc(v)}</dd><dt>${k}</dt></div>`).join('')}</dl>` : '')
    + `<a class="ig-follow" href="${esc(account)}" target="_blank" rel="noopener noreferrer">Follow</a></div>`;
  const body = posts.length
    ? posts.map(u => `<iframe class="ig-post" src="${esc(u)}embed/" title="Instagram post" loading="lazy" scrolling="no" referrerpolicy="strict-origin-when-cross-origin"></iframe>`).join('')
    : '<div class="sc-empty"><b>No posts yet</b><span>The office adds the latest two in Editor, News.</span></div>';
  return `<section class="lg-card ig" aria-label="Instagram"><div class="lg-card-head"><h2>Instagram</h2></div><div class="ig-body">${side}<div class="ig-posts${posts.length === 1 ? ' is-one' : ''}">${body}</div></div></section>`;
}
