// "What's new" (0.33): a small note on a manager's Home about the latest app update, read from CHANGELOG.md (so there is nothing
// extra to write at release time). Shows the version, its one-line summary and the changes that aren't Editor-only.
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
    const summary = clean(sec.find(l => l.trim() && !l.startsWith('-') && !l.startsWith(' ')) || '').replace(/\s*Needs .*$/i, '').replace(/\s*No database change\.?$/i, '').trim();
    const items = [];
    for (const l of sec) {
      if (l.startsWith('- ')) items.push(l.slice(2));
      else if (/^\s+\S/.test(l) && items.length) items[items.length - 1] += ' ' + l.trim();
    }
    const bullets = items.filter(t => !/^\*\*[^*]*Editor/.test(t)).map(t => clean(t.replace(/^\*\*(\w+)[^*]*\*\*\s*/, '$1: '))).filter(Boolean).slice(0, 3)
      .map(t => (t.length > 170 ? t.slice(0, t.lastIndexOf(' ', 167)) + '…' : t));
    if (!ver || (!summary && !bullets.length)) return '';
    const date = y ? `${+d} ${MONTHS[m - 1]}` : '';
    return `<details class="hm-new"><summary><span class="hm-new-tag">What’s new</span> <b>v${esc(ver)}</b>${date ? ` <small>${esc(date)}</small>` : ''}${summary ? ` · ${esc(summary)}` : ''}</summary>
      ${bullets.length ? `<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      <a href="https://github.com/ldg224/vLeague/releases" target="_blank" rel="noopener">All updates</a></details>`;
  } catch { return ''; }
}
