// Editor -> History: the league's past seasons, for history.html, the Seasons tab and the team pages' trophy cabinets.
// Rebuilt 1.46.0 around how the office thinks about it: "Season 3, under this name, these clubs won these trophies".
//   Seasons card: one row per season, newest first (its name, the name the league ran under, who won what). A row opens into its form:
//     name, league name (pick an earlier one or type a new one), one line per trophy (winner and runner-up, or one holder for the
//     Wooden spoon and the Shield), notes. A team that has left is added from the club picker itself.
//   Trophies & past teams card: the set-up that is done once (the trophies with their usual pictures, and the logos of clubs that left).
// The tables are unchanged (0050_league_history.sql, 0053, 0054): league names live in history_leagues, oldest first; the newest is the
// name the current season runs under. A name no season uses any more is tidied away, except the newest.
// Every change saves straight away and only the part it touches is drawn again, so the page never jumps.
import { trophyUrl } from './history-data.js';
import { uploadTrophy } from './trophy.js';
import { crestUrl } from './member.js';
import { icon } from './icons.js';

export const historyView = () => '<h1>History</h1><div id="hi-root"><p class="quiet">Loading…</p></div>';

const single = c => /spoon|shield/i.test(c.name);   // one holder, no runner-up
const placesOf = c => (single(c) ? [['winner', /spoon/i.test(c.name) ? 'Last place' : 'Holder']] : [['winner', 'Winner'], ['runner_up', 'Runner-up']]);
const NEW_TEAM = 'new', NEW_LEAGUE = 'new';
let openId = null;   // the season whose form is open (kept across tab redraws)

export async function mountHistory(ctx) {
  const root = document.getElementById('hi-root');
  if (!root) return;
  const { esc, explain } = ctx;
  const client = await ctx.db();
  const need = r => { if (r.error) throw new Error(explain(r.error)); return r.data || []; };
  let comps, seasons, past, awards, leagues;
  try {
    [comps, seasons, past, awards, leagues] = await Promise.all([
      client.from('history_competitions').select('*').order('sort').order('id'),
      client.from('history_seasons').select('*').order('sort', { ascending: false }).order('id', { ascending: false }),
      client.from('history_past_teams').select('*').order('name'),
      client.from('history_awards').select('*'),
      client.from('history_leagues').select('*').order('sort').order('id'),
    ].map(p => p.then(need)));
  } catch (e) {
    root.innerHTML = `<p class="empty">History didn’t load. ${esc(e.message)}</p>`;
    return;
  }
  const clubs = [...ctx.clubs].sort((a, b) => a.name.localeCompare(b.name));
  let addingTeam = null;   // { season, comp, place }: the picker that asked for a new past team
  let addingLeague = null;   // the season whose league picker asked for a new name

  // ---------------------------------------------------------------- helpers
  const t = s => String(s || '').trim().replace(/\s+/g, ' ');
  const newest = () => leagues.at(-1);
  const leagueOf = s => leagues.find(l => l.id === s.league) || newest();
  const awardOf = (s, c, place) => awards.find(a => a.season === s && a.competition === c && a.place === place);
  const teamOf = a => (!a ? null : a.club ? clubs.find(c => c.code === a.club) : past.find(p => p.id === a.past_team));
  const badge = (team, size = 'm') => {
    if (!team) return `<span class="hi-badge ${size} none" aria-hidden="true"></span>`;
    const path = team.crest_path ? (past.includes(team) ? trophyUrl(team.crest_path) : crestUrl(team.crest_path)) : '';
    return path ? `<img class="hi-badge ${size}" src="${esc(path)}" alt="" loading="lazy">` : `<span class="hi-badge ${size}" aria-hidden="true">${esc(team.code || team.name.slice(0, 2).toUpperCase())}</span>`;
  };
  const pic = (path, cls = '') => (path ? `<img class="hi-pic ${cls}" src="${esc(trophyUrl(path))}" alt="">` : `<span class="hi-pic none ${cls}" aria-hidden="true">${icon('trophy')}</span>`);
  const say = (text, bad = false) => { const m = root.querySelector('.hi-msg'); if (m) { m.textContent = text; m.classList.toggle('bad', bad); } };
  const ok = r => { if (r.error) { say(explain(r.error), true); return false; } return true; };

  // ---------------------------------------------------------------- seasons card
  function summary(s) {
    const lines = comps.map(c => ({ c, a: awardOf(s.id, c.id, 'winner') })).filter(x => x.a);
    const first = lines[0], rest = lines.slice(1);
    const missing = comps.length - lines.length;
    return `<button type="button" class="hi-row" data-open aria-expanded="${openId === s.id}">
      ${badge(teamOf(first?.a))}
      <span class="hi-row-main"><b>${esc(s.name)}</b><span class="hi-row-sub">${esc(leagueOf(s)?.name || '')}${first ? ` · ${esc(first.c.name)}: ${esc(teamOf(first.a)?.name || '')}` : ''}</span></span>
      <span class="hi-row-more">${rest.map(x => `<span class="hi-mini" title="${esc(`${x.c.name}: ${teamOf(x.a)?.name || ''}`)}">${badge(teamOf(x.a), 's')}</span>`).join('')}${missing && comps.length ? `<span class="hi-todo">${missing} to fill in</span>` : ''}</span>
      <span class="hi-chev">${icon('chevron-down')}</span></button>`;
  }

  function teamPicker(s, c, place, label) {
    const a = awardOf(s.id, c.id, place);
    return `<select data-team aria-label="${esc(label)}"><option value="">Not set</option>
      <optgroup label="Clubs">${clubs.map(x => `<option value="c:${esc(x.code)}"${a?.club === x.code ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>
      <optgroup label="Teams that have left">${past.map(p => `<option value="p:${p.id}"${a?.past_team === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="${NEW_TEAM}">Add a team that’s left…</option></optgroup></select>`;
  }

  function award(s, c, place, label) {
    const a = awardOf(s.id, c.id, place), usual = place === 'winner' ? c.winner_art : c.runner_art;
    const adding = addingTeam && addingTeam.season === s.id && addingTeam.comp === c.id && addingTeam.place === place;
    return `<div class="hi-place" data-comp="${c.id}" data-place="${place}">
      <span class="hi-place-l">${label}</span>
      ${teamPicker(s, c, place, `${s.name}, ${c.name}, ${label}`)}
      ${a ? `<span class="hi-own"><label class="hi-pic-btn" title="Use a different picture this season">${pic(a.art_path || usual, 'sm')}<input type="file" accept="image/*" data-award-art hidden><span class="sr">Different picture this season</span></label>${a.art_path ? `<button type="button" class="link-btn" data-award-clear>Usual picture</button>` : ''}</span>` : '<span></span>'}
      ${adding ? `<form class="hi-newteam" data-add="past-here"><input name="name" maxlength="40" required placeholder="Team name" aria-label="Team name"><input name="code" maxlength="4" placeholder="Code" aria-label="Code" class="hi-code"><button class="btn small">Add and pick</button><button type="button" class="link-btn" data-cancel-team>Cancel</button></form>` : ''}
    </div>`;
  }

  function form(s, i) {
    const l = leagueOf(s);
    return `<div class="hi-form" data-season="${s.id}">
      <div class="hi-fields">
        <label class="hi-field"><span>Season</span><input data-season-name value="${esc(s.name)}" maxlength="40" required></label>
        <label class="hi-field"><span>League name that season</span><select data-season-league>${[...leagues].reverse().map(x => `<option value="${x.id}"${l?.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="${NEW_LEAGUE}">A different name…</option></select></label>
      </div>
      ${addingLeague === s.id ? `<form class="hi-newteam" data-add="league-here"><input name="name" maxlength="40" required placeholder="What was the league called?" aria-label="League name that season"><button class="btn small">Use this name</button><button type="button" class="link-btn" data-cancel-league>Cancel</button></form>` : ''}
      ${comps.length ? comps.map(c => `<div class="hi-trophy"><h3>${pic(c.winner_art, 'xs')}${esc(c.name)}</h3>${placesOf(c).map(([pl, lab]) => award(s, c, pl, lab)).join('')}</div>`).join('')
        : '<p class="empty">Add a trophy in Trophies &amp; past teams below, then come back to say who won it.</p>'}
      <p class="hi-hint">Tap a trophy picture to use a different one for this season only.</p>
      <label class="hi-field hi-notes"><span>Notes (optional, shown on the History page)</span><textarea data-season-notes maxlength="2000" rows="2">${esc(s.notes || '')}</textarea></label>
      <div class="hi-acts">
        <button type="button" class="link-btn" data-smove="1" ${i ? '' : 'disabled'}>Move newer</button>
        <button type="button" class="link-btn" data-smove="-1" ${i < seasons.length - 1 ? '' : 'disabled'}>Move older</button>
        <button type="button" class="link-btn danger" data-season-del>Delete season</button>
      </div></div>`;
  }

  const seasonItem = (s, i) => `<li class="hi-season-item${openId === s.id ? ' open' : ''}" data-season="${s.id}">${summary(s)}${openId === s.id ? form(s, i) : ''}</li>`;

  function seasonsCard() {
    return `<section class="hi-card lg-card" id="hi-seasons">
      <div class="hi-head"><h2>Seasons</h2></div>
      <form class="hi-add" data-add="season"><input name="name" maxlength="40" required placeholder="New season, e.g. Season 4" aria-label="New season name"><button class="btn small">${icon('plus')} Add season</button></form>
      ${seasons.length ? `<ul class="hi-seasons">${seasons.map(seasonItem).join('')}</ul>` : '<p class="empty hi-pad">No seasons yet. Add the first one above.</p>'}
    </section>`;
  }

  // ---------------------------------------------------------------- set-up card
  function setupCard() {
    const move = (i, n, attr) => `<button type="button" class="hi-icon" data-${attr}="-1" ${i ? '' : 'disabled'} aria-label="Move up">${icon('chevron-up')}</button><button type="button" class="hi-icon" data-${attr}="1" ${i < n - 1 ? '' : 'disabled'} aria-label="Move down">${icon('chevron-down')}</button>`;
    const art = (c, k, lab) => `<label class="hi-pic-btn" title="${c[k] ? 'Change' : 'Add'} the ${lab.toLowerCase()} picture">${pic(c[k])}<input type="file" accept="image/*" data-comp-art="${k}" hidden><span class="hi-pic-l">${lab}</span></label>`;
    return `<section class="hi-card lg-card" id="hi-setup">
      <div class="hi-head"><h2>Trophies &amp; past teams</h2></div>
      <p class="hi-strip">League name</p>
      <form class="hi-add" data-add="league-now"><label class="hi-field hi-grow"><span>The name the league uses now</span><input name="name" maxlength="40" required value="${esc(newest()?.name || '')}"></label><button class="btn small">Save</button></form>
      <p class="hi-hint hi-pad">After a rebrand, type the new name here. Seasons played under an earlier name keep it: set that in the season itself.</p>
      <p class="hi-strip">Trophies</p>
      <p class="hi-hint hi-pad">The trophies a season can have, in the order they show. Tap a picture to set it (a 400 × 400 PNG works best). Name one “Wooden spoon” or “Shield” and it has one holder, no runner-up.</p>
      <ul class="hi-rows">${comps.map((c, i) => `<li class="hi-setrow" data-comp="${c.id}">
        <input class="hi-name" data-comp-name value="${esc(c.name)}" maxlength="40" aria-label="Trophy name">
        <span class="hi-arts">${placesOf(c).map(([pl, lab]) => art(c, pl === 'winner' ? 'winner_art' : 'runner_art', lab)).join('')}</span>
        <span class="hi-tools">${move(i, comps.length, 'move')}<button type="button" class="hi-icon danger" data-comp-del aria-label="Delete ${esc(c.name)}">${icon('x')}</button></span></li>`).join('')}</ul>
      <form class="hi-add" data-add="comp"><input name="name" maxlength="40" required placeholder="New trophy, e.g. Grand Final" aria-label="New trophy name"><button class="btn small">${icon('plus')} Add trophy</button></form>
      <p class="hi-strip">Teams that have left</p>
      ${past.length ? `<ul class="hi-rows">${past.map(p => `<li class="hi-setrow" data-past="${p.id}">
        <label class="hi-pic-btn" title="${p.crest_path ? 'Change' : 'Add'} the logo">${badge(p)}<input type="file" accept="image/*" data-past-logo hidden><span class="sr">Logo</span></label>
        <input class="hi-name" data-past-f="name" value="${esc(p.name)}" maxlength="40" required aria-label="Team name">
        <input data-past-f="code" value="${esc(p.code || '')}" maxlength="4" aria-label="Code" placeholder="Code" class="hi-code">
        <input data-past-f="manager_name" value="${esc(p.manager_name || '')}" maxlength="40" aria-label="Manager" placeholder="Manager" class="hi-mgr">
        <span class="hi-tools">${p.crest_path ? `<button type="button" class="link-btn" data-past-logo-clear>Remove logo</button>` : ''}<button type="button" class="hi-icon danger" data-past-del aria-label="Delete ${esc(p.name)}">${icon('x')}</button></span></li>`).join('')}</ul>`
        : '<p class="hi-hint hi-pad">None yet. Add one from a season’s club picker (“Add a team that’s left…”) when you need it.</p>'}
    </section>`;
  }

  // ---------------------------------------------------------------- drawing
  // Draw one part again (or the lot), keeping the scroll position and the focused control.
  function draw(part = 'all') {
    const y = scrollY, f = document.activeElement, key = f && root.contains(f) ? keyOf(f) : null;
    const msg = root.querySelector('.hi-msg')?.outerHTML || '<p class="hi-msg" role="status"></p>';
    if (part === 'all' || !root.querySelector('#hi-seasons')) root.innerHTML = msg + seasonsCard() + setupCard();
    else root.querySelector(`#hi-${part}`).outerHTML = part === 'seasons' ? seasonsCard() : setupCard();
    if (key) root.querySelector(key)?.focus({ preventScroll: true });
    scrollTo(0, y);
  }
  // A selector that finds the same control after a redraw.
  function keyOf(el) {
    const attr = [...el.attributes].find(a => a.name.startsWith('data-'));
    if (!attr) return null;
    let sel = `[${attr.name}]`;
    for (let n = el.parentElement; n && n !== root; n = n.parentElement)
      for (const k of ['season', 'comp', 'place', 'past']) if (n.dataset[k] !== undefined && !n.matches('button')) sel = `[data-${k}="${n.dataset[k]}"] ${sel}`;
    return sel;
  }
  draw();

  async function reload(part = 'all') {
    const [a, b, c, d, e] = await Promise.all([
      client.from('history_competitions').select('*').order('sort').order('id'),
      client.from('history_seasons').select('*').order('sort', { ascending: false }).order('id', { ascending: false }),
      client.from('history_past_teams').select('*').order('name'),
      client.from('history_awards').select('*'),
      client.from('history_leagues').select('*').order('sort').order('id'),
    ]);
    if ([a, b, c, d, e].some(r => r.error)) { say('That saved, but the page didn’t refresh. Reload to see it.', true); return; }
    [comps, seasons, past, awards, leagues] = [a.data, b.data, c.data, d.data, e.data];
    draw(part);
  }

  // League names: a name no season uses any more goes, except the newest (the current season's name).
  async function tidyLeagues() {
    for (const l of leagues.slice(0, -1)) if (!seasons.some(s => leagueOf(s)?.id === l.id)) await client.from('history_leagues').delete().eq('id', l.id);
  }

  // A new league name for an older season, placed in time: just before the next newer season's name (or before the current name).
  // A rebrand (a new name for now) is set in the set-up card instead.
  async function addLeague(name, s) {
    const hit = leagues.find(l => l.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const i = seasons.indexOf(s), newer = i > 0 ? seasons[i - 1] : null;
    const r = await client.from('history_leagues').insert({ name, sort: 0 }).select('*').single();
    if (!ok(r)) return null;
    const order = [...leagues], before = newer ? leagueOf(newer) : newest();
    const at = order.findIndex(l => l.id === before?.id);
    order.splice(at < 0 ? order.length : at, 0, r.data);
    for (const [k, l] of order.entries()) await client.from('history_leagues').update({ sort: k + 1 }).eq('id', l.id);
    return r.data.id;
  }

  async function afterLeague() { await reload('seasons'); await tidyLeagues(); await reload(); say('Saved.'); }

  // ---------------------------------------------------------------- events
  root.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.add, v = n => t(f.elements[n]?.value);
    if (kind === 'season') {
      const r = await client.from('history_seasons').insert({ name: v('name'), sort: (seasons[0]?.sort ?? 0) + 1, league: newest()?.id ?? null }).select('id').single();
      if (!ok(r)) return;
      openId = r.data.id; say(`Added ${v('name')}. Fill it in below.`);
      await reload('seasons');
      root.querySelector(`[data-season="${openId}"] [data-season-name]`)?.focus();
    } else if (kind === 'comp') {
      if (!ok(await client.from('history_competitions').insert({ name: v('name'), sort: (comps.at(-1)?.sort ?? 0) + 1 }))) return;
      say(`Added ${v('name')}.`); await reload();
    } else if (kind === 'league-here') {
      const s = seasons.find(x => x.id === addingLeague), id = await addLeague(v('name'), s);
      if (!id) return;
      addingLeague = null;
      if (ok(await client.from('history_seasons').update({ league: id }).eq('id', s.id))) await afterLeague();
    } else if (kind === 'league-now') {
      const name = v('name'), hit = leagues.find(l => l.name.toLowerCase() === name.toLowerCase());
      if (hit === newest()) return;
      let r;
      if (hit) r = await client.from('history_leagues').update({ sort: (newest()?.sort ?? 0) + 1 }).eq('id', hit.id);
      else r = await client.from('history_leagues').insert({ name, sort: (newest()?.sort ?? 0) + 1 });
      if (!ok(r)) return;
      say(`The league is now called ${name}. Earlier seasons keep their own names.`); await reload();
    } else if (kind === 'past-here') {
      const code = v('code').toUpperCase();
      if (code && !/^[A-Z0-9]{2,4}$/.test(code)) return say('A code is 2 to 4 letters or numbers.', true);
      const r = await client.from('history_past_teams').insert({ name: v('name'), code: code || null }).select('id').single();
      if (!ok(r)) return;
      const { season, comp, place } = addingTeam, a = awardOf(season, comp, place), who = { club: null, past_team: r.data.id };
      addingTeam = null;
      if (!ok(await (a ? client.from('history_awards').update(who).eq('id', a.id) : client.from('history_awards').insert({ season, competition: comp, place, ...who })))) return;
      say(`Added ${v('name')}.`); await reload();
    }
  };

  root.onchange = async e => {
    const el = e.target, seas = el.closest('[data-season]'), comp = el.closest('[data-comp]'), pastRow = el.closest('[data-past]');
    const sid = seas && Number(seas.dataset.season), s = seasons.find(x => x.id === sid);
    try {
      if (el.matches('[data-season-name]')) {
        if (!t(el.value)) return say('A season needs a name.', true);
        if (ok(await client.from('history_seasons').update({ name: t(el.value) }).eq('id', sid))) { s.name = t(el.value); say('Saved.'); }
      } else if (el.matches('[data-season-notes]')) {
        if (ok(await client.from('history_seasons').update({ notes: el.value.trim() || null }).eq('id', sid))) { s.notes = el.value.trim() || null; say('Saved.'); }
      } else if (el.matches('[data-season-league]')) {
        if (el.value === NEW_LEAGUE) { addingLeague = sid; addingTeam = null; draw('seasons'); root.querySelector('[data-add="league-here"] input')?.focus(); return; }
        if (!ok(await client.from('history_seasons').update({ league: Number(el.value) }).eq('id', sid))) return;
        await afterLeague();
      } else if (el.matches('[data-team]')) {
        const c = Number(comp.dataset.comp), place = comp.dataset.place, a = awardOf(sid, c, place);
        if (el.value === NEW_TEAM) { addingTeam = { season: sid, comp: c, place }; draw('seasons'); root.querySelector('.hi-newteam input')?.focus(); return; }
        addingTeam = null;
        if (!el.value) { if (a && ok(await client.from('history_awards').delete().eq('id', a.id))) { say('Cleared.'); await reload('seasons'); } return; }
        const [kind, id] = [el.value.slice(0, 1), el.value.slice(2)];
        const who = kind === 'c' ? { club: id, past_team: null } : { club: null, past_team: Number(id) };
        if (ok(await (a ? client.from('history_awards').update(who).eq('id', a.id) : client.from('history_awards').insert({ season: sid, competition: c, place, ...who })))) { say('Saved.'); await reload('seasons'); }
      } else if (el.matches('[data-award-art]')) {
        const a = awardOf(sid, Number(comp.dataset.comp), comp.dataset.place);
        say('Uploading…');
        if (ok(await client.from('history_awards').update({ art_path: await uploadTrophy(el.files[0]) }).eq('id', a.id))) { say('Picture saved for this season.'); await reload('seasons'); }
      } else if (el.matches('[data-comp-name]')) {
        if (!t(el.value)) return say('A trophy needs a name.', true);
        if (ok(await client.from('history_competitions').update({ name: t(el.value) }).eq('id', comp.dataset.comp))) { say('Saved.'); await reload(); }
      } else if (el.matches('[data-comp-art]')) {
        say('Uploading…');
        if (ok(await client.from('history_competitions').update({ [el.dataset.compArt]: await uploadTrophy(el.files[0]) }).eq('id', comp.dataset.comp))) { say('Picture saved.'); await reload(); }
      } else if (el.matches('[data-past-logo]')) {
        say('Uploading…');
        if (ok(await client.from('history_past_teams').update({ crest_path: await uploadTrophy(el.files[0]) }).eq('id', pastRow.dataset.past))) { say('Logo saved.'); await reload(); }
      } else if (el.matches('[data-past-f]')) {
        const k = el.dataset.pastF, val = k === 'code' ? t(el.value).toUpperCase() : t(el.value);
        if (k === 'name' && !val) return say('A team needs a name.', true);
        if (k === 'code' && val && !/^[A-Z0-9]{2,4}$/.test(val)) return say('A code is 2 to 4 letters or numbers.', true);
        if (ok(await client.from('history_past_teams').update({ [k]: val || null }).eq('id', pastRow.dataset.past))) { say('Saved.'); await reload(); }
      }
    } catch (err) { say(err.message || 'That didn’t save. Try again.', true); }
  };

  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b || b.type === 'submit') return;
    const seas = b.closest('[data-season]'), comp = b.closest('[data-comp]'), pastRow = b.closest('[data-past]');
    const sid = seas && Number(seas.dataset.season);
    if (b.matches('[data-open]')) { openId = openId === sid ? null : sid; addingTeam = addingLeague = null; draw('seasons'); return; }
    if (b.matches('[data-cancel-team]')) { addingTeam = null; draw('seasons'); return; }
    if (b.matches('[data-cancel-league]')) { addingLeague = null; draw('seasons'); return; }
    if (b.matches('[data-award-clear]')) {
      const a = awardOf(sid, Number(comp.dataset.comp), comp.dataset.place);
      if (ok(await client.from('history_awards').update({ art_path: null }).eq('id', a.id))) { say('Back to the usual picture.'); await reload('seasons'); }
    } else if (b.matches('[data-season-del]')) {
      const s = seasons.find(x => x.id === sid);
      if (!confirm(`Delete ${s.name} and everything recorded for it?`)) return;
      if (ok(await client.from('history_seasons').delete().eq('id', sid))) { openId = null; say(`Deleted ${s.name}.`); seasons = seasons.filter(x => x.id !== sid); await tidyLeagues(); await reload('seasons'); }
    } else if (b.matches('[data-smove]')) await swap(seasons, seasons.findIndex(x => x.id === sid), -Number(b.dataset.smove), 'history_seasons', 'seasons');
    else if (b.matches('[data-move]')) await swap(comps, comps.findIndex(x => x.id === Number(comp.dataset.comp)), Number(b.dataset.move), 'history_competitions', 'all');
    else if (b.matches('[data-comp-del]')) {
      const c = comps.find(x => x.id === Number(comp.dataset.comp)), n = awards.filter(a => a.competition === c.id).length;
      if (confirm(`Delete ${c.name}?${n ? ` Its ${n} winner/runner-up record${n === 1 ? '' : 's'} will be deleted too.` : ''}`) && ok(await client.from('history_competitions').delete().eq('id', c.id))) { say(`Deleted ${c.name}.`); await reload(); }
    } else if (b.matches('[data-past-logo-clear]')) {
      if (ok(await client.from('history_past_teams').update({ crest_path: null }).eq('id', pastRow.dataset.past))) { say('Logo removed.'); await reload(); }
    } else if (b.matches('[data-past-del]')) {
      const p = past.find(x => x.id === Number(pastRow.dataset.past)), used = awards.filter(a => a.past_team === p.id).map(a => seasons.find(s => s.id === a.season)?.name).filter(Boolean);
      if (used.length) return say(`${p.name} is credited in ${[...new Set(used)].join(', ')}. Change those first.`, true);
      if (confirm(`Delete ${p.name}?`) && ok(await client.from('history_past_teams').delete().eq('id', p.id))) { say(`Deleted ${p.name}.`); await reload(); }
    }
  };

  // Swap two neighbours' sort values (renumbering first, so equal values still move).
  async function swap(list, i, dir, table, part) {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    const sortOf = k => (table === 'history_seasons' ? list.length - k : k);
    for (const [k, x] of list.entries()) {
      if (!ok(await client.from(table).update({ sort: sortOf(k === i ? j : k === j ? i : k) }).eq('id', x.id))) return;
    }
    say('Moved.'); await reload(part);
  }
}
