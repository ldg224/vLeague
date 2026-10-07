// Editor -> News: write a post, give it a look (accent colour, picture, button), choose who it's for, optionally email it
// to managers, and see what they'll see while you type. Below: everything posted so far.
// Audience: Everyone (guests too), Every manager, or chosen clubs. The database enforces it (0019_news_posts.sql).
// Starters fill the form from the season, so a round preview or a deadline reminder is one click.
import { kickoff } from './dashboard-data.js';
import { ago } from './places.js';
import { newsCard, COLOURS, safeColour, safeUrl, imageUrl } from './news-card.js';

let rows = null, editing = null;   // rows: the posts so far (null = loading); editing: the id of the post being edited
let draftImage = '';               // the picture on the form: a path in the `news` bucket

export const newsView = () => `<h1>News</h1><div id="news-root"><p class="quiet">Loading…</p></div>`;

const fmt = d => d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Starters: each fills the form from what the season knows.
function starters({ season, deadlines, clubs }) {
  const now = new Date(), name = c => clubs.find(x => x.code === c)?.short_name || clubs.find(x => x.code === c)?.name || c;
  const upcoming = (season?.fixtures || []).map(f => ({ f, k: kickoff(f) })).filter(x => x.k && x.k > now && !x.f.postponed)
    .sort((a, b) => a.k - b.k);
  const week = upcoming[0]?.f.week;
  const wk = w => season?.rounds?.[w]?.label || `Week ${w}`;   // "Round 4", "Christmas Cup"...
  const list = upcoming.filter(x => x.f.week === week);
  const next = (deadlines || []).filter(d => !d.locked_at && new Date(d.locks_at) > now).sort((a, b) => new Date(a.locks_at) - new Date(b.locks_at))[0];
  const out = [];
  if (list.length) out.push({ key: `${wk(week)} preview`, title: `${wk(week)}: what's on`,
    body: `${wk(week)} kicks off ${fmt(list[0].k)}.\n\n${list.map(x => `- ${name(x.f.home)} v ${name(x.f.away)}, ${fmt(x.k)}`).join('\n')}\n\nGood luck, {manager}.` });
  if (next) out.push({ key: 'Deadline reminder', title: `${wk(next.week)} line-ups lock ${fmt(new Date(next.locks_at))}`,
    body: `Line-ups for ${wk(next.week)} lock on **${fmt(new Date(next.locks_at))}**. Check My club: if {team} hasn't picked a team, it's not too late.`,
    button: { label: 'Open My club', url: 'https://ldg224.github.io/vLeague/club.html' } });
  return out;
}

// A picture, shrunk in the browser to at most 1200 px wide (a phone photo is several MB; news doesn't need that).
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1200 / bmp.width), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('That picture couldn’t be read.'))), 'image/jpeg', 0.85));
}

const audienceText = (r, names) => (r.audience ? r.audience.map(c => names.get(c) || c).join(', ') : r.public ? 'Everyone' : 'Every manager');

export async function mountNews(ctx) {
  const { db, esc, explain, clubs, season, deadlines, accounts } = ctx;
  const root = document.getElementById('news-root');
  const client = await db();
  const names = new Map(clubs.map(c => [c.code, c.short_name || c.name]));
  if (!rows) {
    const { data, error } = await client.from('news').select('*').eq('kind', 'post').order('created_at', { ascending: false }).limit(100);
    rows = error ? [] : data;
  }
  const redraw = async note => { rows = null; await mountNews(ctx); if (note) root.querySelector('.nw-msg').textContent = note; };

  const cur = editing ? rows.find(r => r.id === editing) : null;
  if (cur && editing && draftImage === '' && cur.data?.image) draftImage = cur.data.image;
  const d0 = cur?.data || {};
  const aud = cur ? (cur.audience ? 'clubs' : cur.public ? 'all' : 'managers') : 'all';
  const chosen = new Set(cur?.audience || []);
  const picks = cur ? [] : starters({ season, deadlines, clubs });
  const colour = safeColour(d0.colour);

  root.innerHTML = `
  <div class="nw">
    <form class="nw-form" novalidate>
      <section class="nw-card"><h2>${cur ? 'Edit post' : 'Message'}</h2>
        ${picks.length ? `<p class="nw-starters"><span>Start from</span>${picks.map((s, i) => `<button class="nw-chip" type="button" data-start="${i}">${esc(s.key)}</button>`).join('')}</p>` : ''}
        <label class="nw-field">Title<input name="title" maxlength="120" required value="${esc(cur?.title || '')}" placeholder="What's the headline?"></label>
        <div class="nw-field"><span class="nw-label">Message</span>
          <textarea name="body" rows="8" maxlength="4000" aria-label="Message" placeholder="Write the news. {team} and {manager} fill in for each manager.">${esc(cur?.body || '')}</textarea></div>
      </section>

      <section class="nw-card"><h2>Look</h2>
        <div class="nw-field"><span class="nw-label">Accent colour</span>
          <div class="nw-swatches">${COLOURS.map(([c, n]) => `<label title="${n}"><input type="radio" name="colour" value="${c}"${c === colour ? ' checked' : ''}><span style="--c:${c}"></span><span class="sr-only">${n}</span></label>`).join('')}</div></div>
        <div class="nw-field"><span class="nw-label">Picture</span>
          <div class="nw-pic"><div class="nw-thumb" ${draftImage ? '' : 'hidden'}>${draftImage ? `<img src="${esc(imageUrl(draftImage))}" alt="">` : ''}</div>
            <label class="btn ghost small nw-up">${draftImage ? 'Change picture' : 'Add a picture'}<input type="file" name="file" accept="image/png,image/jpeg,image/webp" hidden></label>
            <button class="btn ghost small" type="button" data-act="nopic" ${draftImage ? '' : 'hidden'}>Remove</button></div></div>
        <div class="nw-row"><label class="nw-field">Button text <small>optional</small><input name="blabel" maxlength="30" value="${esc(d0.button?.label || '')}" placeholder="Read more"></label>
          <label class="nw-field">Button link <small>https://…</small><input name="burl" type="url" maxlength="300" value="${esc(d0.button?.url || '')}" placeholder="https://"></label></div>
      </section>

      <section class="nw-card"><h2>Who is it for?</h2>
        <div class="nw-seg" role="radiogroup" aria-label="Audience">${[['all', 'Everyone'], ['managers', 'Every manager'], ['clubs', 'Chosen clubs']]
          .map(([v, l]) => `<label><input type="radio" name="aud" value="${v}"${v === aud ? ' checked' : ''}><span><b>${l}</b></span></label>`).join('')}</div>
        <div class="nw-clubs" ${aud === 'clubs' ? '' : 'hidden'}>${clubs.map(c => `<label class="nw-chip"><input type="checkbox" name="club" value="${esc(c.code)}"${chosen.has(c.code) ? ' checked' : ''}><span>${esc(c.short_name || c.name)}</span></label>`).join('')}</div>
      </section>

      <section class="nw-card"><h2>Send</h2>
        ${cur?.emailed_at ? `<p class="nw-note">Emailed to ${cur.emailed_count ?? 0} manager${cur.emailed_count === 1 ? '' : 's'} ${esc(ago(new Date(cur.emailed_at)))}.</p>`
          : `<label class="nw-toggle"><input type="checkbox" name="email"><span><b>Also email managers</b><small class="nw-count">Everyone with a club gets it.</small></span></label>`}
        <div class="nw-actions"><button class="btn" type="submit">${cur ? 'Save changes' : 'Publish'}</button>
          ${cur ? '<button class="btn ghost" type="button" data-act="test">Send me a test email</button><button class="btn ghost" type="button" data-act="cancel">Cancel</button>' : ''}</div>
        <p class="nw-msg" role="status"></p>
      </section>
    </form>
    <aside class="nw-side"><div class="nw-sticky"><h2>What they'll see</h2><div class="nw-prev"></div></div></aside>
  </div>

  <h2 class="nw-h">Posted</h2>
  ${rows.length ? `<ul class="nw-posts">${rows.map(r => `<li data-id="${r.id}" style="--c:${safeColour(r.data?.colour)}">
    ${r.data?.image ? `<img class="nw-th" src="${esc(imageUrl(r.data.image))}" alt="">` : '<span class="nw-th bar"></span>'}
    <div class="nw-info"><b>${esc(r.title)}</b>
      <small>${esc(audienceText(r, names))} · ${esc(ago(new Date(r.created_at)))}</small>
      <span class="nw-pills">${r.pinned ? '<span class="ed-pill">Pinned</span>' : ''}${r.emailed_at ? `<span class="ed-pill approved">Emailed ${r.emailed_count ?? 0}</span>` : ''}</span></div>
    <span class="nw-btns"><button class="btn ghost small" data-act="edit">Edit</button>
      <button class="btn ghost small" data-act="pin">${r.pinned ? 'Unpin' : 'Pin'}</button>
      <button class="btn ghost small" data-act="del">Delete</button></span></li>`).join('')}</ul>` : '<p class="quiet">Nothing posted yet.</p>'}`;

  const form = root.querySelector('.nw-form'), msg = root.querySelector('.nw-msg'), prev = root.querySelector('.nw-prev');
  const post = () => ({ title: form.title.value.trim(), body: form.body.value.trim(),
    data: { colour: form.colour.value, image: draftImage || undefined,
      button: form.blabel.value.trim() && safeUrl(form.burl.value.trim()) ? { label: form.blabel.value.trim(), url: form.burl.value.trim() } : undefined } });
  const audience = () => ({ mode: form.aud.value, codes: [...form.querySelectorAll('[name=club]:checked')].map(i => i.value) });
  const update = () => {
    prev.innerHTML = newsCard(post(), { team: 'Your club', manager: 'manager' });
    const { mode, codes } = audience(), count = form.querySelector('.nw-count');
    form.querySelector('.nw-clubs').hidden = mode !== 'clubs';
    if (count) {
      const n = (accounts || []).filter(a => a.club && (mode !== 'clubs' || codes.includes(a.club))).length;
      count.textContent = mode === 'clubs' && !codes.length ? 'Tick a club first.' : `Up to ${n} manager${n === 1 ? '' : 's'} (not anyone who turned league news off).`;
    }
  };
  update();
  form.addEventListener('input', update);
  form.addEventListener('change', async e => {
    update();
    if (e.target.name !== 'file' || !e.target.files[0]) return;
    msg.textContent = 'Uploading picture…';
    try {
      const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error } = await client.storage.from('news').upload(path, await shrink(e.target.files[0]), { contentType: 'image/jpeg' });
      if (error) throw error;
      draftImage = path; msg.textContent = '';
      const t = form.querySelector('.nw-thumb'); t.hidden = false; t.innerHTML = `<img src="${esc(imageUrl(path))}" alt="">`;
      form.querySelector('.nw-up').firstChild.textContent = 'Change picture';
      form.querySelector('[data-act=nopic]').hidden = false;
      update();
    } catch (err) { msg.textContent = explain(err); }
  });

  form.addEventListener('click', async e => {
    const start = e.target.closest('[data-start]'), act = e.target.closest('[data-act]')?.dataset.act;
    if (start) {
      const s = picks[+start.dataset.start];
      form.title.value = s.title; form.body.value = s.body;
      form.blabel.value = s.button?.label || ''; form.burl.value = s.button?.url || '';
      update(); form.title.focus();
    }
    if (act === 'nopic') {
      draftImage = ''; form.querySelector('.nw-thumb').hidden = true; e.target.hidden = true;
      form.querySelector('.nw-up').firstChild.textContent = 'Add a picture'; update();
    }
    if (act === 'cancel') { editing = null; draftImage = ''; await redraw(); }
    if (act === 'test') {
      const id = cur.id;
      e.target.disabled = true; msg.textContent = 'Sending a test…';
      const { data, error } = await client.functions.invoke('send-news', { body: { id, test: true } });
      e.target.disabled = false;
      msg.textContent = error || data?.error ? (data?.error || 'The test didn’t send.') : `Test sent to ${data.to}.`;
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const p = post(), { mode, codes } = audience();
    if (!p.title) { msg.textContent = 'Give the post a title.'; form.title.focus(); return; }
    if (mode === 'clubs' && !codes.length) { msg.textContent = 'Tick at least one club.'; return; }
    const wantMail = form.email?.checked;
    const row = { kind: 'post', title: p.title, body: p.body || null, data: p.data,
      public: mode === 'all', audience: mode === 'clubs' ? codes : null };
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; msg.textContent = 'Saving…';
    const q = cur ? client.from('news').update(row).eq('id', cur.id).select('id').single() : client.from('news').insert(row).select('id').single();
    const { data: saved, error } = await q;
    if (error) { btn.disabled = false; msg.textContent = explain(error); return; }
    let note = cur ? 'Saved.' : 'Posted.';
    if (wantMail) {
      msg.textContent = 'Emailing managers…';
      const r = await client.functions.invoke('send-news', { body: { id: saved.id } });
      note += r.error || r.data?.error ? ` The email didn’t send: ${r.data?.error || 'edit the post to try again.'}`
        : ` Emailed ${r.data.sent} manager${r.data.sent === 1 ? '' : 's'}.`;
    }
    editing = null; draftImage = '';
    await redraw(note);
  });

  root.querySelector('.nw-posts')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = +b.closest('li').dataset.id, r = rows.find(x => x.id === id), act = b.dataset.act;
    if (act === 'edit') { editing = id; draftImage = ''; await mountNews(ctx); scrollTo(0, 0); return; }
    if (act === 'del' && b.dataset.sure !== '1') {
      const was = b.textContent; b.dataset.sure = '1'; b.textContent = 'Sure?';
      setTimeout(() => { b.dataset.sure = ''; b.textContent = was; }, 4000); return;
    }
    const { error } = act === 'del' ? await client.from('news').delete().eq('id', id) : await client.from('news').update({ pinned: !r.pinned }).eq('id', id);
    await redraw(error ? explain(error) : '');
  });
}
