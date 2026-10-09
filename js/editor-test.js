// Editor → Test (S-21): make a test match with controls. A made-up match for trying the broadcast, Game centre and highlights without
// touching the season (see startTestMatch in js/simulate.js): pick the two clubs, set the final score, and script events at set minutes
// (a goal from open play; a penalty scored, saved or missed; a yellow, red or second yellow). It plays out live as soon as it is made.

const EVENTS = [['goal', 'Goal, from open play'], ['penalty_scored', 'Penalty, scored'], ['penalty_saved', 'Penalty, saved'], ['penalty_missed', 'Penalty, missed'],
  ['yellow', 'Yellow card'], ['red', 'Red card'], ['second_yellow', 'Second yellow (sent off)']];

export function testView() {
  return '<h1>Test</h1><div id="tt-root"><p class="quiet">Loading…</p></div>';
}

export async function mountTest(ctx) {
  const root = document.getElementById('tt-root');
  if (!root) return;
  const { esc } = ctx;
  const active = ctx.clubs.filter(c => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  let looks = [{ key: 'classic', name: 'Classic' }], tests = 0, busy = false, rows = [];
  let msg = '', msgHtml = '';

  async function load() {
    const c = await ctx.db();
    const [lk, fx] = await Promise.all([c.from('looks').select('key, name').order('name'), c.from('fixtures').select('id').eq('week', 99)]);
    if (lk.data?.length) looks = lk.data;
    tests = (fx.data || []).length;
  }

  const clubOpts = (sel, other) => `<option value="">Random club</option>${active.map(c => `<option value="${esc(c.code)}"${c.code === sel ? ' selected' : ''}${c.code === other ? ' disabled' : ''}>${esc(c.name)}</option>`).join('')}`;
  const rowHtml = (r, i) => `<div class="tt-row" data-i="${i}">
      <label>Minute<input type="number" min="1" max="90" step="1" value="${esc(r.minute)}" data-f="minute"></label>
      <label>Team<select data-f="team"><option value="home"${r.team === 'home' ? ' selected' : ''}>Home</option><option value="away"${r.team === 'away' ? ' selected' : ''}>Away</option></select></label>
      <label>Event<select data-f="kind">${EVENTS.map(([k, l]) => `<option value="${k}"${r.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn ghost small" type="button" data-del="${i}" aria-label="Remove this event">Remove</button></div>`;

  function draw() {
    const keep = { home: root.querySelector('#tt-home')?.value ?? '', away: root.querySelector('#tt-away')?.value ?? '', look: root.querySelector('#tt-look')?.value ?? 'random',
      gh: root.querySelector('#tt-gh')?.value ?? '', ga: root.querySelector('#tt-ga')?.value ?? '', exact: root.querySelector('#tt-exact')?.checked ?? false, skip: root.querySelector('#tt-skip')?.checked ?? false };
    root.innerHTML = `
      <div id="tt-sim" class="fx-sim" role="status" hidden></div>
      <section class="ed-sec"><h2>The match</h2>
        <div class="ed-fields tt-two"><label>Home club<select id="tt-home">${clubOpts(keep.home, keep.away)}</select></label>
          <label>Away club<select id="tt-away">${clubOpts(keep.away, keep.home)}</select></label></div>
        <div class="ed-fields tt-two"><label>Final score, home <i>blank = let the match decide</i><input id="tt-gh" type="number" min="0" step="1" value="${esc(keep.gh)}"></label>
          <label>Final score, away <i>blank = let the match decide</i><input id="tt-ga" type="number" min="0" step="1" value="${esc(keep.ga)}"></label></div>
        <label class="tt-check"><input id="tt-exact" type="checkbox"${keep.exact ? ' checked' : ''}> Only the scripted goals count (the score is exactly the goals and scored penalties listed)</label>
        <label class="tt-check"><input id="tt-skip" type="checkbox"${keep.skip ? ' checked' : ''}> Skip to highlights (the match is already finished, so there is no live broadcast to wait for)</label>
        <label class="tt-look">Scoreboard look<select id="tt-look"><option value="random">Random look</option>${looks.map(l => `<option value="${esc(l.key)}"${keep.look === l.key ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <p class="ed-hint">The players are made up, in memory only. No real player, club or table changes. Setting a final score adds that many open-play goals at spread-out minutes, and turns on “only the scripted goals count”.</p></section>
      <section class="ed-sec"><h2>Events at set minutes</h2>
        ${rows.length ? rows.map(rowHtml).join('') : '<p class="quiet">None yet. Add a penalty, a card or both.</p>'}
        <div class="ed-actions"><button class="btn ghost small" type="button" data-add>Add an event</button></div>
        <p class="ed-hint">A goal comes from open play: around that minute that team takes a shot, and it goes in whatever the defence and keeper do (if they can't get a shot away within about six minutes, they get a scored penalty instead). A penalty is awarded once the team has the ball near the box around its minute. A card goes to the player nearest the ball. A second yellow gives the first yellow a few minutes earlier if nobody has one.</p></section>
      <p class="tt-msg" role="alert">${msgHtml || esc(msg)}</p>
      <div class="ed-actions"><button class="btn" type="button" data-play ${busy ? 'disabled' : ''}>Play the test match</button>
        ${tests ? `<button class="btn ghost" type="button" data-clean ${busy ? 'disabled' : ''}>Remove test matches (${tests})</button>` : ''}</div>`;
  }

  // The events to send: the rows, plus scored penalties to make up the final score.
  function buildScript() {
    const script = [];
    for (const r of rows) {
      const minute = Math.round(+r.minute);
      if (!(minute >= 1 && minute <= 90)) throw new Error('Each event needs a minute from 1 to 90.');
      script.push({ minute, team: r.team, kind: r.kind });
    }
    const gh = root.querySelector('#tt-gh').value.trim(), ga = root.querySelector('#tt-ga').value.trim();
    let exact = root.querySelector('#tt-exact').checked;
    if (gh !== '' || ga !== '') {
      const h = Math.round(+gh || 0), a = Math.round(+ga || 0);
      if (!(h >= 0 && a >= 0) || !Number.isFinite(h + a)) throw new Error('The final score needs whole numbers, 0 or more.');
      // Scripted goals already in the rows count towards the target.
      const have = side => script.filter(s => s.team === side && (s.kind === 'penalty_scored' || s.kind === 'goal')).length;
      const need = { home: h - have('home'), away: a - have('away') };
      if (need.home < 0 || need.away < 0) throw new Error('There are more goals in the list than the final score allows.');
      const total = need.home + need.away;
      const sides = [...Array(need.home).fill('home'), ...Array(need.away).fill('away')].sort(() => Math.random() - 0.5);
      sides.forEach((side, i) => script.push({ minute: Math.round(8 + (i + 0.5) * (78 / Math.max(1, total))), team: side, kind: 'goal' }));
      exact = true;
    }
    return { script, exact };
  }

  async function play() {
    if (busy) return;
    let built;
    try { built = buildScript(); } catch (e) { msg = e.message; msgHtml = ''; draw(); return; }
    const skip = root.querySelector('#tt-skip').checked, homeCode = root.querySelector('#tt-home').value, awayCode = root.querySelector('#tt-away').value, look = root.querySelector('#tt-look').value;
    if (homeCode && awayCode && homeCode === awayCode) { msg = 'Pick two different clubs.'; draw(); return; }
    msg = ''; msgHtml = ''; busy = true; draw();
    const panel = root.querySelector('#tt-sim');
    panel.hidden = false;
    panel.innerHTML = '<p class="fx-sim-what">Test match</p><div class="vid-bar"><span></span></div><p class="fx-sim-status"></p>';
    const bar = panel.querySelector('.vid-bar span'), status = panel.querySelector('.fx-sim-status');
    try {
      const [sim, c] = await Promise.all([import('./simulate.js'), ctx.db()]);
      const r = await sim.startTestMatch(c, ctx.clubs, { look, looks, homeCode, awayCode, script: built.script, onlyScriptGoals: built.exact, skipToHighlights: root.querySelector('#tt-skip').checked,
        onStatus: t => { status.textContent = t; },
        onProgress: frac => { bar.style.width = `${Math.round(Math.min(1, frac) * 100)}%`; status.textContent = frac < 0.02 ? 'Loading the simulator (the first time takes a moment)…' : `Playing the match… ${Math.round(frac * 100)}%`; } });
      bar.style.width = '100%';
      const link = `game.html?id=${encodeURIComponent(r.id)}`;
      msg = ''; msgHtml = `${esc(r.home.name)} v ${esc(r.away.name)} ends ${r.score[0]}–${r.score[1]} and is ${skip ? 'ready: the highlights are waiting' : 'live now'}. <a href="${esc(link)}" target="_blank" rel="noopener">Open the Game centre</a>. It also shows in Matches.`;
      await load(); busy = false; draw();
    } catch (e) {
      msg = e.message; busy = false;
      try { await load(); } catch { /* shown below */ }
      draw();
    }
  }

  async function clean() {
    if (busy || !tests || !confirm(`Remove ${tests} test match${tests === 1 ? '' : 'es'}? They disappear for everyone.`)) return;
    busy = true; draw();
    try { const n = await (await import('./simulate.js')).removeTestMatches(await ctx.db()); msg = `${n} test match${n === 1 ? '' : 'es'} removed.`; }
    catch (e) { msg = e.message; }
    busy = false;
    try { await load(); } catch { /* shown below */ }
    draw();
  }

  root.addEventListener('click', e => {
    if (e.target.closest('[data-add]')) { rows.push({ minute: rows.length ? Math.min(90, +rows[rows.length - 1].minute + 10) : 30, team: 'home', kind: 'goal' }); draw(); return; }
    const del = e.target.closest('[data-del]'); if (del) { rows.splice(+del.dataset.del, 1); draw(); return; }
    if (e.target.closest('[data-play]')) play();
    else if (e.target.closest('[data-clean]')) clean();
  });
  root.addEventListener('change', e => {
    const row = e.target.closest('.tt-row'); if (row && e.target.dataset.f) { rows[+row.dataset.i][e.target.dataset.f] = e.target.value; return; }
    if (e.target.id === 'tt-home' || e.target.id === 'tt-away') draw();
  });

  try { await load(); } catch { /* the page still works */ }
  draw();
}
