// "What's new" (0.33; a line in Home's notice strip since 0.68): the latest app update, read from CHANGELOG.md (so there is nothing
// extra to write at release time). Shows the version and the one "Headlines:" line of that version (2 short items), nothing more; a version without the line shows nothing.
// Returns { ver, date, bullets } or null if the changelog can't be read or the version has no headlines.
const clean = t => t.replace(/\*\*/g, '').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function whatsNew() {
  try {
    const res = await fetch('CHANGELOG.md', { cache: 'no-cache' });
    if (!res.ok) return null;
    const lines = (await res.text()).split('\n');
    const start = lines.findIndex(l => /^## \d/.test(l));
    if (start < 0) return null;
    const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    const sec = lines.slice(start + 1, end < 0 ? undefined : end);
    const [, ver, y, m, d] = lines[start].match(/^## (\S+)(?: \((\d+)-(\d+)-(\d+)\))?/) || [];
    // A version's manager-facing headlines: one line "Headlines: first | second" (a few words each, 2 at most). Nothing else is shown.
    const hl = sec.find(l => /^Headlines:/i.test(l));
    const bullets = hl ? hl.replace(/^Headlines:\s*/i, '').split('|').map(t => clean(t)).filter(Boolean).slice(0, 2) : [];
    if (!ver || !bullets.length) return null;
    return { ver, date: y ? `${+d} ${MONTHS[m - 1]}` : '', bullets };
  } catch { return null; }
}
