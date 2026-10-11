// A news post as the reader sees it (0.19): an accent bar, an optional picture, the message and an optional button.
// The Editor's preview and a manager's Inbox both draw posts here, so they always match.
// Pure helpers, no page code, and no imports beyond the backend address, so any page can load it.
//   post: { title, body, data: { colour, image, button: { label, url } } }
import { SUPABASE_URL } from './config.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const COLOURS = [['#1e88e5', 'Blue'], ['#2e9e5b', 'Green'], ['#e0a21b', 'Gold'], ['#d9534f', 'Red'], ['#8e5bd0', 'Purple'], ['#64748b', 'Grey']];
export const safeColour = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1e88e5');
export const safeUrl = u => (/^https:\/\/[^\s"'<>]+$/i.test(u || '') ? u : '');
export const imageUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/news/${encodeURI(path)}` : '');

function inline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// {team}, {manager}: filled in for whoever is reading. Escaped first, so a post can't carry markup.
export function markdown(text, vars = {}) {
  const t = String(text ?? '').replace(/\{(team|manager)\}/g, (_, k) => vars[k] || (k === 'team' ? 'your club' : 'manager'));
  return esc(t).split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => {
    if (/^(#{1,3}) /.test(p)) return `<h4>${inline(p.replace(/^#{1,3} /, ''))}</h4>`;
    if (/^[-*] /m.test(p)) return `<ul>${p.split('\n').map(l => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`;
    return `<p>${inline(p).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// The post without its title (the Inbox shows the title on the row that opens it).
export function newsBody(post, vars) {
  const d = post.data || {}, img = imageUrl(d.image), url = safeUrl(d.button?.url), label = String(d.button?.label || '').trim();
  return `<div class="nc-body" style="--nc:${safeColour(d.colour)}">
    ${img ? `<img class="nc-img" src="${esc(img)}" alt="" loading="lazy">` : ''}
    <div class="nc-text">${markdown(post.body, vars)}</div>
    ${url && label ? `<p class="nc-act"><a class="nc-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></p>` : ''}
  </div>`;
}

// The whole card, title included (the Editor's preview).
export const newsCard = (post, vars) => `<article class="nc"><h3 class="nc-title">${esc(post.title || 'Title')}</h3>${newsBody(post, vars)}</article>`;
