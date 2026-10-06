// Editor -> News (0.18): write a post, choose who it's for, see it as a manager will, and keep the history.
// Audience: Everyone (guests too), Every manager, or chosen clubs. The database enforces it (0019_news_posts.sql).
// Starters fill the form from the season so a round preview or a deadline reminder takes one click to write.
import { markdown, ago } from './places.js';
import { kickoff } from './dashboard-data.js';

let rows = null, editing = null;   // rows: the posts so far (null = loading); editing: a post's id being edited

export const newsView = () => `<h1>News</h1><div id="news-root"><p class="quiet">Loading…</p></div>`;

const fmt = d => d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Starters: each returns { title, body } from what the season knows, or null when there's nothing to say yet.
function starters({ season, deadlines, clubs }) {
  const now = new Date(), name = c => clubs.find(x => x.code === c)?.short_name || clubs.find(x => x.code === c)?.name || c;
  const upcoming = (season?.fixtures || []).map(f => ({ f, k: kickoff(f) })).filter(x => x.k && x.k > now && !x.f.postponed)
    .sort((a, b) => a.k - b.k);
  const week = upcoming[0]?.f.week;
  const list = upcoming.filter(x => x.f.week === week);
  const next = (deadlines || []).filter(d => !d.locked_at && new Date(d.locks_at) > now).sort((a, b) => new Date(a.locks_at) - new Date(b.locks_at))[0];
  const out = [];
  if (list.length) out.push({ key: `Week ${week} preview`, title: `Week ${week}: what's on`,
    body: `Week ${week} kicks off ${fmt(list[0].k)}.\n\n${list.map(x => `- ${name(x.f.home)} v ${name(x.f.away)}, ${fmt(x.k)}`).join('\n')}\n\nGood luck, {manager}.` });
  if (next) out.push({ key: 'Deadline reminder', title: `Week ${next.week} line-ups lock ${fmt(new Date(next.locks_at))}`,
    body: `Line-ups for week ${next.week} lock on **${fmt(new Date(next.locks_at))}**. Check My club: if {team} hasn't picked a team, it's not too late.` });
  out.push({ key: 'Blank', title: '', body: '' });
  return out;
}

const audienceText = r => (r.audience ? r.audience.join(', ') : r.public ? 'Everyone' : 'Every manager');

export async function mountNews({ db, esc, explain, clubs, season, deadlines }) {
  const root = document.getElementById('news-root');
  const client = await db();
  const load = async () => {
    const { data, error } = await client.from('news').select('*').eq('kind', 'post').order('created_at', { ascending: false }).limit(100);
    rows = error ? [] : data;
    if (error) root.querySelector('.ed-msg')?.append(explain(error));
  };
  if (!rows) await load();

  const picks = starters({ season, deadlines, clubs });
  const cur = editing ? rows.find(r => r.id === editing) : null;
  const aud = cur ? (cur.audience ? 'clubs' : cur.public ? 'all' : 'managers') : 'all';
  const chosen = new Set(cur?.audience || []);

  root.innerHTML = `
    <form class="ed-news" novalidate>
      <h2>${cur ? 'Edit post' : 'New post'}</h2>
      ${cur ? '' : `<p class="ed-starters">Start from: ${picks.map((s, i) => `<button class="btn ghost small" type="button" data-start="${i}">${esc(s.key)}</button>`).join(' ')}</p>`}
      <div class="ed-fields">
        <label>Title<input name="title" maxlength="120" required value="${esc(cur?.title || '')}"></label>
        <label>Message <small>**bold**, *italic*, - lists, [link](https://…). {team} and {manager} fill in for each manager.</small>
          <textarea name="body" rows="7" maxlength="4000">${esc(cur?.body || '')}</textarea></label>
      </div>
      <fieldset class="ed-aud"><legend>Who is it for?</legend>
        ${[['all', 'Everyone', 'Guests on the dashboard and every manager'], ['managers', 'Every manager', 'Signed-in managers only'], ['clubs', 'Chosen clubs', 'Only the clubs you tick']]
          .map(([v, l, h]) => `<label class="ed-radio"><input type="radio" name="aud" value="${v}"${v === aud ? ' checked' : ''}> <b>${l}</b> <small>${h}</small></label>`).join('')}
        <div class="ed-clubs" ${aud === 'clubs' ? '' : 'hidden'}>${clubs.map(c => `<label><input type="checkbox" name="club" value="${esc(c.code)}"${chosen.has(c.code) ? ' checked' : ''}> ${esc(c.short_name || c.name)}</label>`).join('')}</div>
      </fieldset>
      <label class="ed-digest"><input type="checkbox" name="pinned"${cur?.pinned ? ' checked' : ''}> Pin to the top</label>
      <details class="ed-preview" open><summary>How a manager sees it</summary><div class="ed-prev-body"></div></details>
      <div class="ed-actions"><button class="btn" type="submit">${cur ? 'Save changes' : 'Publish'}</button>
        ${cur ? '<button class="btn ghost" type="button" data-act="cancel">Cancel</button>' : ''}</div>
      <p class="ed-msg" role="status"></p>
    </form>
    <h2>Posted</h2>
    ${rows.length ? `<ul class="ed-posts">${rows.map(r => `<li data-id="${r.id}">
      <b>${esc(r.title)}</b> ${r.pinned ? '<span class="ed-pill">Pinned</span>' : ''}
      <small>${esc(audienceText(r))} · ${esc(ago(new Date(r.created_at)))}</small>
      <span class="ed-actions"><button class="btn ghost small" data-act="edit">Edit</button>
        <button class="btn ghost small" data-act="pin">${r.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn ghost small" data-act="del">Delete</button></span></li>`).join('')}</ul>` : '<p class="quiet">Nothing posted yet.</p>'}`;

  const form = root.querySelector('form'), msg = form.querySelector('.ed-msg');
  const preview = () => {
    form.querySelector('.ed-prev-body').innerHTML = `<h3>${esc(form.title.value || 'Title')}</h3>`
      + markdown(form.body.value, { team: 'Your club', manager: 'manager' });
  };
  preview();
  form.addEventListener('input', preview);
  form.addEventListener('change', () => {
    form.querySelector('.ed-clubs').hidden = form.aud.value !== 'clubs';
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('[data-start]');
    if (b) { const s = picks[+b.dataset.start]; form.title.value = s.title; form.body.value = s.body; preview(); form.title.focus(); }
    if (e.target.closest('[data-act="cancel"]')) { editing = null; mountNews({ db, esc, explain, clubs, season, deadlines }); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const title = form.title.value.trim(), body = form.body.value.trim();
    const mode = form.aud.value, codes = [...form.querySelectorAll('[name=club]:checked')].map(i => i.value);
    if (!title) { msg.textContent = 'Give the post a title.'; form.title.focus(); return; }
    if (mode === 'clubs' && !codes.length) { msg.textContent = 'Tick at least one club.'; return; }
    const row = { kind: 'post', title, body: body || null, pinned: form.pinned.checked,
      public: mode === 'all', audience: mode === 'clubs' ? codes : null };
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = 'Saving…';
    const { error } = cur ? await client.from('news').update(row).eq('id', cur.id) : await client.from('news').insert(row);
    btn.disabled = false;
    if (error) { msg.textContent = explain(error); return; }
    editing = null; rows = null;
    await mountNews({ db, esc, explain, clubs, season, deadlines });
    root.querySelector('.ed-msg').textContent = cur ? 'Saved.' : 'Posted.';
  });

  root.querySelector('.ed-posts')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = +b.closest('li').dataset.id, r = rows.find(x => x.id === id);
    if (b.dataset.act === 'edit') { editing = id; await mountNews({ db, esc, explain, clubs, season, deadlines }); scrollTo(0, 0); return; }
    if (b.dataset.act === 'del' && b.textContent !== 'Sure?') { b.textContent = 'Sure?'; setTimeout(() => { b.textContent = 'Delete'; }, 4000); return; }
    const { error } = b.dataset.act === 'del' ? await client.from('news').delete().eq('id', id)
      : await client.from('news').update({ pinned: !r.pinned }).eq('id', id);
    if (error) { msg.textContent = explain(error); return; }
    rows = null;
    await mountNews({ db, esc, explain, clubs, season, deadlines });
  });
}
