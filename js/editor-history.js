// Editor -> History (0.66): the league's past seasons, for history.html and the team pages' trophy cabinets.
//   Competitions: the trophies a season can have, each with a default picture for the winner and the runner-up.
//   Past teams: clubs that have left (name, code, manager), so they can still be credited.
//   Seasons: for each competition, who won and who was runner-up (a current club or a past team), and that award's own
//   picture if that year's trophy looked different. Every change saves straight away. Tables: 0050_league_history.sql.
import { trophyUrl } from './history-data.js';
import { uploadTrophy } from './trophy.js';

export const historyView = () => '<h1>History</h1><div id="hi-root"><p class="quiet">Loading…</p></div>';

const PLACES = [['winner', 'Winner'], ['runner_up', 'Runner-up']];
let msg = '', openSeason = null;   // openSeason: a season just added, opened so it can be filled in

export async function mountHistory(ctx) {
  const root = document.getElementById('hi-root');
  if (!root) return;
  const { esc, explain } = ctx;
  const client = await ctx.db();
  const need = r => { if (r.error) throw new Error(explain(r.error)); return r.data || []; };
  let comps, seasons, past, awards;
  try {
    [comps, seasons, past, awards] = await Promise.all([
      client.from('history_competitions').select('*').order('sort').order('id'),
      client.from('history_seasons').select('*').order('sort', { ascending: false }).order('id', { ascending: false }),
      client.from('history_past_teams').select('*').order('name'),
      client.from('history_awards').select('*'),
    ].map(p => p.then(need)));
  } catch (e) {
    root.innerHTML = `<p class="empty">History didn’t load. ${esc(e.message)}${/history_/.test(e.message) ? ' (Has migration 0050 been applied?)' : ''}</p>`;
    return;
  }
  const clubs = [...ctx.clubs].sort((a, b) => a.name.localeCompare(b.name));
  const awardOf = (s, c, place) => awards.find(a => a.season === s && a.competition === c && a.place === place);
  const pic = (path, alt = '') => (path ? `<img class="hi-pic" src="${esc(trophyUrl(path))}" alt="${esc(alt)}">` : '<span class="hi-pic none" aria-hidden="true"></span>');

  const teamSelect = (a, label) => `<select data-team aria-label="${esc(label)}"><option value="">Not set</option>
    <optgroup label="Clubs">${clubs.map(c => `<option value="c:${esc(c.code)}"${a?.club === c.code ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>
    ${past.length ? `<optgroup label="Past teams">${past.map(p => `<option value="p:${p.id}"${a?.past_team === p.id ? ' selected' : ''}>${esc(p.name)}${p.code ? ` (${esc(p.code)})` : ''}</option>`).join('')}</optgroup>` : ''}</select>`;

  const upload = (attrs, label) => `<label class="link-btn hi-up">${label}<input type="file" accept="image/png" ${attrs} hidden></label>`;

  function compsHtml() {
    return `<section class="hi-sect"><h2>Competitions</h2>
      <p class="quiet">The trophies a season can have. Each has a picture for the winner and one for the runner-up (400 × 400 PNG); a season can swap in its own.</p>
      ${comps.length ? `<ul class="hi-list">${comps.map((c, i) => `<li class="hi-comp" data-comp="${c.id}">
        <input class="hi-name" data-comp-name value="${esc(c.name)}" maxlength="40" aria-label="Competition name">
        ${PLACES.map(([pl, l]) => { const k = pl === 'winner' ? 'winner_art' : 'runner_art'; return `<span class="hi-art">${pic(c[k], `${c.name} ${l.toLowerCase()} trophy`)}<span>${l}<br>${upload(`data-comp-art="${k}"`, c[k] ? 'Change' : 'Upload')}${c[k] ? ` · <button type="button" class="link-btn" data-comp-clear="${k}">Remove</button>` : ''}</span></span>`; }).join('')}
        <span class="hi-acts"><button type="button" class="link-btn" data-move="-1" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" class="link-btn" data-move="1" ${i < comps.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
        <button type="button" class="link-btn danger" data-comp-del>Delete</button></span></li>`).join('')}</ul>` : '<p class="empty">No competitions yet. Add the first one, for example “League”.</p>'}
      <form class="hi-add" data-add="comp"><input name="name" maxlength="40" required placeholder="New competition, e.g. Grand Final" aria-label="New competition name"><button class="btn small">Add competition</button></form></section>`;
  }

  function pastHtml() {
    return `<section class="hi-sect"><h2>Past teams</h2>
      <p class="quiet">Clubs that have left the league, so their wins still count.</p>
      ${past.length ? `<ul class="hi-list">${past.map(p => `<li class="hi-past" data-past="${p.id}">
        <input data-past-f="name" value="${esc(p.name)}" maxlength="40" required aria-label="Team name" placeholder="Name">
        <input data-past-f="code" value="${esc(p.code || '')}" maxlength="4" aria-label="Code" placeholder="Code" class="hi-code">
        <input data-past-f="manager_name" value="${esc(p.manager_name || '')}" maxlength="40" aria-label="Manager name" placeholder="Manager">
        <button type="button" class="link-btn danger" data-past-del>Delete</button></li>`).join('')}</ul>` : ''}
      <form class="hi-add" data-add="past"><input name="name" maxlength="40" required placeholder="Team name" aria-label="Past team name"><input name="code" maxlength="4" placeholder="Code" aria-label="Code" class="hi-code"><input name="manager_name" maxlength="40" placeholder="Manager" aria-label="Manager name"><button class="btn small">Add past team</button></form></section>`;
  }

  function seasonsHtml() {
    return `<section class="hi-sect"><h2>Seasons</h2>
      <form class="hi-add" data-add="season"><input name="name" maxlength="40" required placeholder="e.g. Season 1" aria-label="New season name"><button class="btn small">Add season</button></form>
      ${!seasons.length ? '<p class="empty">No seasons yet.</p>' : !comps.length ? '<p class="empty">Add a competition above to record winners.</p>' : ''}
      ${seasons.map((s, i) => `<details class="hi-season" data-season="${s.id}"${i === 0 ? ' open' : ''}><summary><b>${esc(s.name)}</b><span class="quiet">${comps.map(c => awardOf(s.id, c.id, 'winner')).filter(Boolean).length} of ${comps.length} winners set</span></summary>
        <div class="hi-season-in">
          <label class="hi-sname">Name <input data-season-name value="${esc(s.name)}" maxlength="40"></label>
          ${comps.map(c => `<div class="hi-award-c"><h3>${esc(c.name)}</h3>${PLACES.map(([pl, l]) => {
            const a = awardOf(s.id, c.id, pl), def = pl === 'winner' ? c.winner_art : c.runner_art;
            return `<div class="hi-award" data-comp="${c.id}" data-place="${pl}">${pic(a?.art_path || def, `${c.name} ${l.toLowerCase()} trophy`)}
              <span class="hi-award-l">${l}</span>${teamSelect(a, `${s.name} ${c.name} ${l}`)}
              ${a ? `<span class="hi-award-pic">${a.art_path ? 'Own picture' : def ? 'Usual picture' : 'No picture'} · ${upload('data-award-art', 'Upload')}${a.art_path ? ` · <button type="button" class="link-btn" data-award-clear>Use usual</button>` : ''}</span>` : ''}</div>`;
          }).join('')}</div>`).join('')}
          <label class="hi-notes">Notes (optional, shown on the History page)<textarea data-season-notes maxlength="2000" rows="2">${esc(s.notes || '')}</textarea></label>
          <div class="hi-acts"><button type="button" class="link-btn" data-smove="1" ${i ? '' : 'disabled'}>Move up</button><button type="button" class="link-btn" data-smove="-1" ${i < seasons.length - 1 ? '' : 'disabled'}>Move down</button><button type="button" class="link-btn danger" data-season-del>Delete season</button></div>
        </div></details>`).join('')}</section>`;
  }

  const open = new Set([...root.querySelectorAll('.hi-season[open]')].map(d => d.dataset.season));
  root.innerHTML = `<p class="hi-msg" role="status">${esc(msg)}</p>${seasonsHtml()}${compsHtml()}${pastHtml()}`;
  if (openSeason) open.add(String(openSeason));
  if (open.size) for (const d of root.querySelectorAll('.hi-season')) d.open = open.has(d.dataset.season);
  msg = ''; openSeason = null;

  const redraw = async note => { msg = note || ''; await mountHistory(ctx); };
  const run = async (p, note) => { const r = await p; if (r.error) { root.querySelector('.hi-msg').textContent = explain(r.error); return false; } await redraw(note); return true; };
  const t = name => String(name || '').trim().replace(/\s+/g, ' ');


  root.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.add, v = n => t(f.elements[n]?.value);
    if (kind === 'comp') await run(client.from('history_competitions').insert({ name: v('name'), sort: (comps.at(-1)?.sort ?? 0) + 1 }), `Added ${v('name')}.`);
    if (kind === 'season') {
      const r = await client.from('history_seasons').insert({ name: v('name'), sort: (seasons[0]?.sort ?? 0) + 1 }).select('id').single();
      if (!r.error) openSeason = r.data?.id;
      await run(Promise.resolve(r), `Added ${v('name')}.`);
    }
    if (kind === 'past') await run(client.from('history_past_teams').insert({ name: v('name'), code: v('code').toUpperCase() || null, manager_name: v('manager_name') || null }), `Added ${v('name')}.`);
  };

  root.onchange = async e => {
    const el = e.target, comp = el.closest('[data-comp]'), seas = el.closest('[data-season]'), pastRow = el.closest('[data-past]');
    try {
      if (el.matches('[data-comp-name]')) await run(client.from('history_competitions').update({ name: t(el.value) }).eq('id', comp.dataset.comp), 'Saved.');
      else if (el.matches('[data-comp-art]')) {
        root.querySelector('.hi-msg').textContent = 'Uploading…';
        await run(client.from('history_competitions').update({ [el.dataset.compArt]: await uploadTrophy(el.files[0]) }).eq('id', comp.dataset.comp), 'Picture saved.');
      } else if (el.matches('[data-past-f]')) {
        const k = el.dataset.pastF, val = k === 'code' ? t(el.value).toUpperCase() : t(el.value);
        if (k === 'code' && val && !/^[A-Z0-9]{2,4}$/.test(val)) { root.querySelector('.hi-msg').textContent = 'A code is 2 to 4 letters or numbers.'; return; }
        await run(client.from('history_past_teams').update({ [k]: val || null }).eq('id', pastRow.dataset.past), 'Saved.');
      } else if (el.matches('[data-season-name]')) await run(client.from('history_seasons').update({ name: t(el.value) }).eq('id', seas.dataset.season), 'Saved.');
      else if (el.matches('[data-season-notes]')) await run(client.from('history_seasons').update({ notes: el.value.trim() || null }).eq('id', seas.dataset.season), 'Saved.');
      else if (el.matches('[data-team]')) {
        const s = Number(seas.dataset.season), c = Number(comp.dataset.comp), place = comp.dataset.place, a = awardOf(s, c, place);
        if (!el.value) { if (a) await run(client.from('history_awards').delete().eq('id', a.id), 'Cleared.'); return; }
        const [kind, id] = [el.value.slice(0, 1), el.value.slice(2)];
        const who = kind === 'c' ? { club: id, past_team: null } : { club: null, past_team: Number(id) };
        await run(a ? client.from('history_awards').update(who).eq('id', a.id) : client.from('history_awards').insert({ season: s, competition: c, place, ...who }), 'Saved.');
      } else if (el.matches('[data-award-art]')) {
        const a = awardOf(Number(seas.dataset.season), Number(comp.dataset.comp), comp.dataset.place);
        root.querySelector('.hi-msg').textContent = 'Uploading…';
        await run(client.from('history_awards').update({ art_path: await uploadTrophy(el.files[0]) }).eq('id', a.id), 'Picture saved.');
      }
    } catch (err) { root.querySelector('.hi-msg').textContent = err.message || 'That didn’t save.'; }
  };

  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b || b.type === 'submit' || b.form) return;
    const comp = b.closest('[data-comp]'), seas = b.closest('[data-season]'), pastRow = b.closest('[data-past]');
    if (b.matches('[data-comp-clear]')) await run(client.from('history_competitions').update({ [b.dataset.compClear]: null }).eq('id', comp.dataset.comp), 'Picture removed.');
    else if (b.matches('[data-award-clear]')) {
      const a = awardOf(Number(seas.dataset.season), Number(comp.dataset.comp), comp.dataset.place);
      await run(client.from('history_awards').update({ art_path: null }).eq('id', a.id), 'Using the usual picture.');
    } else if (b.matches('[data-comp-del]')) {
      const c = comps.find(x => x.id === Number(comp.dataset.comp)), n = awards.filter(a => a.competition === c.id).length;
      if (confirm(`Delete ${c.name}?${n ? ` Its ${n} winner/runner-up record${n === 1 ? '' : 's'} will be deleted too.` : ''}`)) await run(client.from('history_competitions').delete().eq('id', c.id), `Deleted ${c.name}.`);
    } else if (b.matches('[data-season-del]')) {
      const s = seasons.find(x => x.id === Number(seas.dataset.season));
      if (confirm(`Delete ${s.name} and everything recorded for it?`)) await run(client.from('history_seasons').delete().eq('id', s.id), `Deleted ${s.name}.`);
    } else if (b.matches('[data-past-del]')) {
      const p = past.find(x => x.id === Number(pastRow.dataset.past));
      if (awards.some(a => a.past_team === p.id)) { root.querySelector('.hi-msg').textContent = `${p.name} is credited in a season. Change those first.`; return; }
      if (confirm(`Delete ${p.name}?`)) await run(client.from('history_past_teams').delete().eq('id', p.id), `Deleted ${p.name}.`);
    } else if (b.matches('[data-move]')) await swap(comps, comps.findIndex(x => x.id === Number(comp.dataset.comp)), Number(b.dataset.move), 'history_competitions');
    else if (b.matches('[data-smove]')) await swap(seasons, seasons.findIndex(x => x.id === Number(seas.dataset.season)), -Number(b.dataset.smove), 'history_seasons');
  };

  // Swap two neighbours' sort values (renumbering first, so equal values still move).
  async function swap(list, i, dir, table) {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    const base = table === 'history_seasons' ? list.length : 0, sortOf = k => (table === 'history_seasons' ? base - k : k);
    const updates = list.map((x, k) => ({ id: x.id, sort: sortOf(k === i ? j : k === j ? i : k) }));
    for (const u of updates) { const r = await client.from(table).update({ sort: u.sort }).eq('id', u.id); if (r.error) { root.querySelector('.hi-msg').textContent = explain(r.error); return; } }
    await redraw('Moved.');
  }
}
