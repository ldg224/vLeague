// Editor -> Goal of the week (S-05). For one finished round:
//   1. "Find the best 15": reads the round's match files in this browser, scores every open-play goal (js/goal-wow.js) and keeps the top 15.
//   2. Thumbs: the 15 play one by one as 5-second clips; Yes or No on each until 5 are Yes. (Out of goals with fewer than 5? Look at the No pile again.)
//   3. Open voting for the 5 until a time (managers vote, never for their own club; the tally stays hidden until it ends).
//   4. Results: the tally, the winner, and an Instagram caption to copy.
// Everything is one row in gotw_rounds (supabase/migrations/0057_goal_of_week.sql); each Yes / No is saved as it is made, so the office can stop and come back.
import { goalMoments, shortlist, describe } from './goal-wow.js';
import { loadMatchFile } from './match-file.js';
import { ClipStage, recordClip } from './goal-clip.js';
import { rounds } from './league-fixtures.js';
import { icon } from './icons.js';

export const gotwView = () => '<h1>Goal of the week</h1><div id="gw-root"><p class="quiet">Loading…</p></div>';

let offKeys = null;   // the keyboard handler of the open panel, removed when the tab is drawn again
const WANT = 5, POOL = 15;
const when = d => new Date(d).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).replace(/\bam\b/, 'am').replace(/\bpm\b/, 'pm');

export async function mountGotw({ db, esc, explain, clubs, season, deadlines }) {
  const root = document.getElementById('gw-root');
  if (!root) return;
  offKeys?.(); offKeys = null;
  if (!season) { root.innerHTML = '<p class="quiet">The season hasn’t loaded. Refresh the page.</p>'; return; }
  const client = await db();
  const nameOf = code => clubs.find(c => c.code === code)?.name || code;
  // The Test matches (week 99, made in Editor > Test) count as a round here, so the whole thing can be tried before a real round has been played.
  const list = [...rounds(season), { week: 99, label: 'Test matches' }].filter(r => season.fixtures.some(f => f.week === r.week && (r.week === 99 || !f.test) && f.result?.file));
  if (!list.length) { root.innerHTML = '<p class="quiet">No round has been played yet.</p>'; return; }
  let week = Number(sessionStorage.getItem('gw-week')) || list[list.length - 1].week;
  if (!list.some(r => r.week === week)) week = list[list.length - 1].week;
  let row = null, stage = null, busy = '', msg = '';
  const label = w => list.find(r => r.week === w)?.label || `Round ${w}`;

  const load = async () => {
    const { data, error } = await client.from('gotw_rounds').select('*').eq('week', week).maybeSingle();
    if (error) { msg = explain(error); }
    row = data || null;
  };
  const save = async patch => {
    const { error } = await client.from('gotw_rounds').upsert({ week, ...patch }, { onConflict: 'week' });
    if (error) { msg = explain(error); return false; }
    row = { ...(row || { candidates: [], finalists: [], status: 'picking' }), week, ...patch };
    return true;
  };
  const sel = () => `<label class="nw-field gw-pick">Round<select id="gw-week">${list.map(r => `<option value="${r.week}"${r.week === week ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>`;
  const head = html => `<div class="gw">${sel()}${html}<p class="nw-msg" role="status">${esc(msg)}</p></div>`;
  const stop = () => { stage?.destroy(); stage = null; };
  const done = () => (row?.candidates || []).filter(c => c.d === 'y');
  const nextUp = () => (row?.candidates || []).find(c => !c.d);

  // ------------------------------------------------ views
  function draw() {
    stop();
    offKeys?.(); offKeys = null;
    const st = row?.status;
    if (busy) root.innerHTML = head(`<section class="nw-card"><h2>${esc(label(week))}</h2><p class="gw-busy">${esc(busy)}</p></section>`);
    else if (!row || !row.candidates.length) drawStart();
    else if (st === 'picking') {
      if (nextUp()) drawSwipe();
      else if (done().length > WANT) narrow();   // pool watched, still too many Yes: show just those again
      else drawConfirm();
    }
    else if (st === 'voting') drawVoting();
    else drawResults();
    root.querySelector('#gw-week')?.addEventListener('change', async e => { week = Number(e.target.value); sessionStorage.setItem('gw-week', week); msg = ''; await load(); draw(); });
  }

  // A pass is over with more than WANT Yes: the Yes goals go round again, the No goals drop out of this pass.
  async function narrow() {
    row.candidates.forEach(x => { x.d = x.d === 'y' ? null : 'x'; });
    await save({ candidates: row.candidates, finalists: [] });
    msg = `You said Yes to more than ${WANT}. Here they are again; keep going until ${WANT} are left.`;
    draw();
  }
  const resetWeek = async () => {
    if (!confirm(`Throw away ${label(week)}’s goals, choices and any votes, and start again?`)) return;
    const { error } = await client.from('gotw_rounds').delete().eq('week', week);
    if (error) { msg = explain(error); draw(); return; }
    row = null; msg = 'Cleared. Find the best 15 to start again.'; draw();
  };

  function drawStart() {
    root.innerHTML = head(`<section class="nw-card"><h2>${esc(label(week))}</h2>
      <p class="nw-note">Reads this round’s match files and picks the ${POOL} best goals by a “wow” score: unlikely shots, long range, volleys, headers, long passing moves, beaten defenders, late and equalising goals. Penalties and own goals are never in it.</p>
      <div class="nw-actions"><button class="btn" id="gw-find" type="button">Find the best ${POOL}</button></div></section>`);
    root.querySelector('#gw-find').addEventListener('click', find);
  }

  async function find() {
    const fixtures = season.fixtures.filter(f => f.week === week && (week === 99 || !f.test) && f.result?.file);
    const all = [];
    for (let i = 0; i < fixtures.length; i++) {
      busy = `Reading match ${i + 1} of ${fixtures.length}…`; draw();
      try { all.push(...goalMoments(await loadMatchFile(fixtures[i]), fixtures[i])); } catch (e) { msg = `A match file wouldn’t load (${fixtures[i].home} v ${fixtures[i].away}); the rest were read.`; }
    }
    busy = '';
    const top = shortlist(all, POOL).map(m => ({ ...m, d: null }));
    if (!top.length) { msg = 'No open-play goals found in this round.'; draw(); return; }
    await save({ status: 'picking', candidates: top, finalists: [] });
    draw();
  }

  const who = m => `${esc(m.scorerName || 'Unknown')} <span>${esc(nameOf(m.team))}</span>`;
  const fixLine = m => `${esc(nameOf(m.home))} v ${esc(nameOf(m.away))}, ${m.minute}′`;

  function drawSwipe() {
    const all = row.candidates, c = all.filter(x => x.d !== 'x'), seen = c.filter(x => x.d).length, yes = done().length, cur = nextUp();
    root.innerHTML = head(`<section class="nw-card gw-swipe">
      <div class="gw-count"><span><b>${yes} of ${WANT}</b> chosen</span><span>${seen} of ${c.length} watched${c.length < all.length ? ` (of the ${all.length}, ${all.length - c.length} dropped)` : ''}</span></div>
      <div class="gw-stage"><canvas id="gw-cv" width="1280" height="720" aria-label="Goal clip"></canvas><button class="gw-play" id="gw-toggle" type="button" aria-label="Pause">${icon('play')}</button><div class="gw-load" id="gw-load">Loading the clip…</div></div>
      <div class="gw-who"><b>${who(cur)}</b><span>${fixLine(cur)}</span><small>${esc(describe(cur))}, wow score ${cur.wow.toFixed(0)}</small></div>
      <div class="gw-thumbs">
        <button class="gw-no" id="gw-no" type="button">${icon('thumbs-down')}<span>No</span></button>
        <button class="gw-undo" id="gw-undo" type="button" ${seen ? '' : 'disabled'}>Back</button>
        <button class="gw-yes" id="gw-yes" type="button">${icon('thumbs-up')}<span>Yes</span></button>
      </div>
      <div class="nw-actions">${yes === WANT ? `<button class="btn" id="gw-enough" type="button">Go with these ${WANT}</button>` : ''}<button class="btn ghost" id="gw-all" type="button">Show all ${all.length} again</button><button class="btn ghost" id="gw-reset" type="button">Reset this week</button></div>
      <p class="nw-note">Keys: left arrow No, right arrow Yes, space plays or pauses. The clip is the 5 seconds around the goal and loops.</p></section>`);
    stage = new ClipStage(root.querySelector('#gw-cv'), season);
    const tg = root.querySelector('#gw-toggle'), ld = root.querySelector('#gw-load');
    stage.onState = on => { tg.classList.toggle('on', on); tg.setAttribute('aria-label', on ? 'Pause' : 'Play'); tg.innerHTML = icon(on ? 'pause' : 'play'); };
    stage.show(cur).then(() => { ld.hidden = true; }).catch(e => { ld.textContent = `${e.message || 'The clip wouldn’t load.'} You can still say Yes or No from the facts.`; });
    const nxt = c.filter(x => !x.d)[1]; if (nxt) stage.renderer(nxt).catch(() => {});   // warm the next one while this plays
    const decide = async d => { cur.d = d; await save({ candidates: all }); draw(); };
    root.querySelector('#gw-enough')?.addEventListener('click', async () => { all.forEach(x => { if (x.d !== 'y') x.d = 'x'; }); await save({ candidates: all, finalists: [] }); draw(); });
    root.querySelector('#gw-all').addEventListener('click', async () => { all.forEach(x => { x.d = null; }); await save({ candidates: all, finalists: [] }); draw(); });
    root.querySelector('#gw-reset').addEventListener('click', resetWeek);
    root.querySelector('#gw-yes').addEventListener('click', () => decide('y'));
    root.querySelector('#gw-no').addEventListener('click', () => decide('n'));
    root.querySelector('#gw-undo').addEventListener('click', async () => {
      const last = [...c].reverse().find(x => x.d); if (!last) return;
      last.d = null; await save({ candidates: all, finalists: [] }); draw();
    });
    tg.addEventListener('click', () => stage.toggle());
    const keys = e => {
      if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); decide('y'); } else if (e.key === 'ArrowLeft') { e.preventDefault(); decide('n'); } else if (e.key === ' ') { e.preventDefault(); stage.toggle(); }
    };
    document.addEventListener('keydown', keys); offKeys = () => document.removeEventListener('keydown', keys);
  }

  // Five Yes (or out of goals): check the five, set the closing time, open the ballot.
  function drawConfirm() {
    const yes = done(), c = row.candidates, left = c.filter(x => x.d === 'n' || x.d === 'x');
    const nextLock = (deadlines || []).map(d => new Date(d.locks_at || d.locked_at)).filter(d => d > new Date()).sort((a, b) => a - b)[0];
    const opts = [...(nextLock ? [['lock', `When the next round locks (${when(nextLock)})`]] : []), ['24', 'In 1 day'], ['48', 'In 2 days'], ['72', 'In 3 days'], ['168', 'In a week']];
    const rows = yes.map((m, i) => `<li><span class="gw-n">${i + 1}</span><span class="gw-t"><b>${who(m)}</b><small>${fixLine(m)}, ${esc(describe(m))}</small></span><button class="gw-x" data-key="${esc(m.key)}" type="button">Take out</button></li>`).join('');
    root.innerHTML = head(`<section class="nw-card"><h2>${esc(label(week))}: your ${yes.length}</h2>
      ${yes.length < WANT ? `<p class="nw-note">You said Yes to ${yes.length} of ${c.length}; you wanted ${WANT}. ${left.length ? 'Look at the No pile again, or go ahead with fewer.' : ''}</p>` : ''}
      <ol class="gw-list">${rows || '<li class="quiet">No goals chosen yet.</li>'}</ol>
      <div class="nw-actions">${left.length ? '<button class="btn ghost" id="gw-again" type="button">Look at the No pile again</button>' : ''}<button class="btn ghost" id="gw-all" type="button">Show all ${c.length} again</button><button class="btn ghost" id="gw-reset" type="button">Reset this week</button></div>
      ${yes.length >= 2 ? `<label class="nw-field">Voting closes<select id="gw-close">${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <p class="nw-note">Opening voting adds a Vote tab for every signed-in person (managers vote, the tab’s dot flashes until they do). It goes again when voting closes.</p>
      <div class="nw-actions"><button class="btn" id="gw-open" type="button">Open voting for ${yes.length}</button></div>` : ''}</section>`);
    root.querySelectorAll('.gw-x').forEach(b => b.addEventListener('click', async () => { c.find(x => x.key === b.dataset.key).d = 'n'; await save({ candidates: c, finalists: [] }); draw(); }));
    root.querySelector('#gw-again')?.addEventListener('click', async () => { left.forEach(x => { x.d = null; }); await save({ candidates: c, finalists: [] }); draw(); });
    root.querySelector('#gw-all').addEventListener('click', async () => { c.forEach(x => { x.d = null; }); await save({ candidates: c, finalists: [] }); draw(); });
    root.querySelector('#gw-reset').addEventListener('click', resetWeek);
    root.querySelector('#gw-open')?.addEventListener('click', async () => {
      const v = root.querySelector('#gw-close').value, now = Date.now();
      const closes = v === 'lock' ? nextLock : new Date(now + Number(v) * 3600e3);
      await save({ status: 'voting', finalists: yes.map(m => m.key), opens_at: new Date(now).toISOString(), closes_at: closes.toISOString() });
      draw();
    });
  }

  async function tally() {
    const { data, error } = await client.rpc('gotw_tally', { p_week: week });
    if (error) { msg = explain(error); return []; }
    return (data || []).map(r => ({ pick: r.pick, votes: Number(r.votes) }));
  }
  const finals = () => row.finalists.map(k => row.candidates.find(c => c.key === k)).filter(Boolean);

  async function drawVoting() {
    const t = await tally(), total = t.reduce((s, r) => s + r.votes, 0), over = row.closes_at && new Date(row.closes_at) <= new Date();
    root.innerHTML = head(`<section class="nw-card"><h2>${esc(label(week))}: voting ${over ? 'has ended' : 'is open'}</h2>
      <p class="nw-note">${over ? 'The time is up.' : `Managers have until ${when(row.closes_at)}.`} ${total} vote${total === 1 ? '' : 's'} so far (only you can see this; managers see the tally when it ends).</p>
      <ol class="gw-list">${finals().map((m, i) => `<li><span class="gw-n">${i + 1}</span><span class="gw-t"><b>${who(m)}</b><small>${fixLine(m)}</small></span><span class="gw-votes">${t.find(r => r.pick === m.key)?.votes || 0}</span></li>`).join('')}</ol>
      <div class="nw-actions"><button class="btn" id="gw-end" type="button">${over ? 'Show the results' : 'Close voting now'}</button><button class="btn ghost" id="gw-reset" type="button">Reset this week</button></div></section>`);
    root.querySelector('#gw-reset').addEventListener('click', resetWeek);
    root.querySelector('#gw-end').addEventListener('click', async () => { await save({ status: 'closed', closes_at: over ? row.closes_at : new Date().toISOString() }); draw(); });
  }

  async function drawResults() {
    const t = await tally(), total = t.reduce((s, r) => s + r.votes, 0);
    const ranked = finals().map(m => ({ m, v: t.find(r => r.pick === m.key)?.votes || 0 })).sort((a, b) => b.v - a.v || b.m.wow - a.m.wow);
    const pct = v => (total ? Math.round(v / total * 100) : 0);
    const caption = [`GOAL OF THE WEEK, ${label(week)}`, '', ...ranked.map((r, i) => `${i + 1}. ${r.m.scorerName} (${nameOf(r.m.team)}), ${nameOf(r.m.home)} v ${nameOf(r.m.away)} ${r.m.minute}′: ${r.v} vote${r.v === 1 ? '' : 's'} (${pct(r.v)}%)`),
      '', `${total} manager${total === 1 ? '' : 's'} voted.`, '', '#vLeague #GoalOfTheWeek'].join('\n');
    root.innerHTML = head(`<section class="nw-card"><h2>${esc(label(week))}: results</h2>
      ${total ? '' : '<p class="nw-note">Nobody voted.</p>'}
      <ol class="gw-list">${ranked.map((r, i) => `<li${i === 0 && r.v ? ' class="win"' : ''}><span class="gw-n">${i + 1}</span><span class="gw-t"><b>${who(r.m)}</b><small>${fixLine(r.m)}</small><i class="gw-bar" style="--w:${pct(r.v)}%"></i></span><span class="gw-votes">${r.v}<small>${pct(r.v)}%</small></span></li>`).join('')}</ol>
      <label class="nw-field">Instagram caption <small>copy it for the post</small><textarea id="gw-cap" readonly>${esc(caption)}</textarea></label>
      <div class="nw-actions"><button class="btn" id="gw-copy" type="button">Copy caption</button><button class="btn" id="gw-clip" type="button" ${ranked[0]?.v ? '' : 'disabled'}>Download the winner’s clip</button><button class="btn ghost" id="gw-reopen" type="button">Open voting again</button><button class="btn ghost" id="gw-reset" type="button">Reset this week</button></div></section>`);
    root.querySelector('#gw-reset').addEventListener('click', resetWeek);
    root.querySelector('#gw-copy').addEventListener('click', async e => { try { await navigator.clipboard.writeText(caption); e.target.textContent = 'Copied'; } catch { root.querySelector('#gw-cap').select(); msg = 'Select the text and copy it.'; } });
    root.querySelector('#gw-clip').addEventListener('click', async e => {
      const w = ranked[0]?.m, b = e.currentTarget; if (!w) return;
      b.disabled = true; b.textContent = 'Recording 5 seconds… keep this tab open';
      try {
        const { blob, ext } = await recordClip(season, w);
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `goal-of-the-week-${label(week).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        b.textContent = `Downloaded (${ext.toUpperCase()})`;
      } catch (err) { msg = err.message || 'The clip wouldn’t record.'; b.textContent = 'Download the winner’s clip'; root.querySelector('.nw-msg').textContent = msg; }
      b.disabled = false;
    });
    root.querySelector('#gw-reopen').addEventListener('click', async () => { await save({ status: 'voting', closes_at: new Date(Date.now() + 24 * 3600e3).toISOString() }); draw(); });
  }

  await load();
  draw();
}
