// Small pieces shared by My club, Inbox and League (0.5): club names and crests, dates in words, simple news
// markdown. Pure helpers, no page code.
import { esc, crestUrl } from './member.js';
import { logoUrl } from './dashboard-data.js';

const hex = c => (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : '#475569');
export const teamColour = hex;

// Dark or white text, whichever reads on a club colour.
function onColour(c) {
  const h = hex(c).slice(1), n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) >= 150 ? '#061a38' : '#ffffff';
}

export const teamOf = (season, code) => season.teams.find(t => t.code === code)
  || { code: code || '?', name: code || 'To be decided', colour: '#475569' };

// The office approves names, codes and crests in Supabase (0.4), while season.json keeps the old ones until 0.11, so
// a page hands over the clubs rows once (useClubs) and names and crests come from them first.
let rows = new Map();
export const useClubs = list => { rows = new Map((list || []).map(r => [r.code, r])); };
export const nameOf = team => { const r = rows.get(team.code); return r ? r.short_name || r.name : team.name; };
export const fullNameOf = team => rows.get(team.code)?.name || team.name;

// A club's crest, with coloured initials if it has none. A crest that fails to load (a weak phone connection) is tried once
// more before the initials stand in.
export function crest(team, size) {
  const r = rows.get(team.code), colour = r?.colour || team.colour;
  const src = r?.crest_path ? crestUrl(r.crest_path) : logoUrl(team.code);
  return `<span class="crest" style="--s:${size}px;--c:${esc(hex(colour))};--on:${onColour(colour)}">`
    + `<img src="${esc(src)}" alt="" loading="lazy" onerror="if(!this.dataset.r){this.dataset.r=1;var u=this.src;setTimeout(function(){this.src=u+'?r=1'}.bind(this),1500)}else{this.parentNode.classList.add('none');this.remove()}">`
    + `<i>${esc(String(team.code || '?').slice(0, 3))}</i></span>`;
}

// A match rating on a coloured chip: 7.0 and up good, under 6.0 poor.
export const rating = r => `<span class="rating ${r >= 7 ? 'r-hi' : r < 6 ? 'r-lo' : 'r-mid'}">${r.toFixed(1)}</span>`;

const tfmt = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
const dfmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
const sfmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
export const time = d => tfmt.format(d).replace(/\s/g, ' ').toLowerCase();
export function day(d, now = new Date()) {
  const n = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  return { 0: 'Today', 1: 'Tomorrow', [-1]: 'Yesterday' }[n] || dfmt.format(d);
}
export function ago(date, now = new Date()) {
  const m = Math.round((now - date) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return sfmt.format(date);
}

// News text: **bold**, *italic*, __underline__, [links](https://…), "- " lists, blank-line paragraphs.
function inline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
export function markdown(text, vars = {}) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\{(team|manager|due)\}/g, (m, k) => vars[k] ?? m);
  return esc(t).split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => (/^[-*] /m.test(p) ? `<ul>${p.split('\n').map(l => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`
      : `<p>${inline(p).replace(/\n/g, '<br>')}</p>`)).join('');
}
export { inline };
