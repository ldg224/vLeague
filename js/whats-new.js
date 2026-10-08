// "What's new" (0.33): a small note on a manager's Home about the latest app update, read from CHANGELOG.md (so there is nothing
// extra to write at release time). Shows the version and the one "Headlines:" line of that version (2 short items), nothing more; a version without the line shows nothing.
// No page code beyond building the HTML; returns '' if the changelog can't be read.
const clean = t => t.replace(/\*\*/g, '').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function whatsNew(esc) {
  try {
    const res = await fetch('CHANGELOG.md', { cache: 'no-cache' });
    if (!res.ok) return '';
    const lines = (await res.text()).split('\n');
    const start = lines.findIndex(l => /^## \d/.test(l));
    if (start < 0) return '';
    const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    const sec = lines.slice(start + 1, end < 0 ? undefined : end);
    const [, ver, y, m, d] = lines[start].match(/^## (\S+)(?: \((\d+)-(\d+)-(\d+)\))?/) || [];
    // A version's manager-facing headlines: one line "Headlines: first | second" (a few words each, 2 at most). Nothing else is shown.
    const hl = sec.find(l => /^Headlines:/i.test(l));
    const bullets = hl ? hl.replace(/^Headlines:\s*/i, '').split('|').map(t => clean(t)).filter(Boolean).slice(0, 2) : [];
    if (!ver || !bullets.length) return '';
    const date = y ? `${+d} ${MONTHS[m - 1]}` : '';
    return `<section class="hm-new"><p class="hm-new-head"><span class="hm-new-tag">What’s new</span> <b>v${esc(ver)}</b>${date ? ` <small>${esc(date)}</small>` : ''}</p>
      <ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul></section>`;
  } catch { return ''; }
}
