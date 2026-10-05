// Editor → Players (0.11). The league's players: generate a pool in one press, paste a list, edit in place.
// Generated players are free agents (no club); the office deals them to clubs later (a draft).
// The database checks everything again (supabase/migrations/0008_players.sql); this page only asks.
import { generate, reroll, namer, rate, playerValue, numbersFor, POSITIONS, MAX_TOTAL } from './names.js';
import { forgetPlayers } from './players-data.js';

const POS_NAME = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
const QUALITY = { weak: ['Weaker', 4.5], typical: ['Typical', 5.5], strong: ['Stronger', 6.5] };
const MIX = { even: ['Even', 1.0], varied: ['Varied', 1.6] };
const chip = n => `<span class="rt rt-${n}">${n}</span>`;
const money = n => `$${Number(n).toLocaleString('en-AU')}`;

export function playersView() {
  return '<h1>Players</h1><div id="pl-root"><p class="quiet">Loading players…</p></div>';
}

// ctx: { db, esc, clubs (the Editor's clubs), explain }
export async function mountPlayers(ctx) {
  const root = document.getElementById('pl-root');
  if (!root) return;
  const { esc, explain } = ctx;
  let players = [], preview = null, filter = { club: '', pos: '', q: '' };
  const active = () => ctx.clubs.filter(c => c.status !== 'withdrawn');
  const clubName = code => ctx.clubs.find(c => c.code === code)?.name || code;
  const names = () => players.map(p => p.name);

  async function fetchAll() {
    const { data, error } = await (await ctx.db()).from('players')
      .select('id, name, position, number, offense, defense, club, value').order('id').range(0, 1999);
    if (error) throw new Error(explain(error));
    players = data;
    forgetPlayers();
  }

  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const clubOpts = sel => opts([['', 'Free agent'], ...active().map(c => [c.code, c.name])], sel || '');
  const posOpts = sel => opts(POSITIONS.map(p => [p, POS_NAME[p]]), sel);
  const ratingOpts = sel => opts(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1]), sel);

  function summary() {
    const free = players.filter(p => !p.club).length;
    const by = Object.fromEntries(POSITIONS.map(p => [p, players.filter(x => x.position === p).length]));
    return `<p class="pl-sum"><b>${players.length}</b> player${players.length === 1 ? '' : 's'}: ${free} free agent${free === 1 ? '' : 's'}, ${players.length - free} at clubs.
      <span>${POSITIONS.map(p => `${by[p]} ${p}`).join(' · ')}</span></p>`;
  }

  function generatePanel() {
    const clubsN = active().length;
    const def = Math.max(24, clubsN * 16 + 24);
    return `<form class="ed-invite pl-gen" id="pl-gen">
      <h2>Generate players</h2>
      <p class="ed-hint">Makes new players with mostly Australian names (no first or last name is repeated anywhere in the league), a singlet number and
        offense and defense ratings that suit their position (nobody is a perfect 10/10). They all start as free agents, so there are no teams yet.</p>
      <label>How many <i>${clubsN} club${clubsN === 1 ? '' : 's'} × 16 plus 24 spare = ${clubsN * 16 + 24}</i>
        <input type="number" name="count" min="1" max="400" value="${def}" required></label>
      <details><summary>Options</summary>
        <label>Quality <select name="quality">${opts(Object.entries(QUALITY).map(([k, v]) => [k, v[0]]), 'typical')}</select></label>
        <label>Names <select name="names">${opts([['local', 'Mostly Australian'], ['mixed', 'Mixed cultures']], 'local')}</select></label>
        <label>Mix <select name="mix">${opts(Object.entries(MIX).map(([k, v]) => [k, v[0]]), 'even')}</select></label>
      </details>
      <div class="ed-actions"><button class="btn">Generate</button></div>
      <p class="ed-msg" role="status"></p>
    </form>`;
  }

  function previewPanel() {
    if (!preview) return '';
    const rows = preview.list.map((p, i) => `<tr data-i="${i}">
      <td>${esc(p.name)}</td><td>${esc(p.position)}</td><td>${p.number}</td><td>${chip(p.offense)}</td><td>${chip(p.defense)}</td><td>${money(playerValue(p))}</td>
      <td class="pl-row-act"><button class="btn ghost small" type="button" data-act="reroll" aria-label="New name and ratings for ${esc(p.name)}">↻</button>
      <button class="btn ghost small" type="button" data-act="drop" aria-label="Leave out ${esc(p.name)}">✕</button></td></tr>`).join('');
    return `<section class="pl-preview" aria-label="Preview">
      <h2>Preview: ${preview.list.length} new free agents</h2>
      <p class="ed-hint">Nothing is saved yet. Re-roll or leave out any player, then add them.</p>
      <div class="pl-scroll"><table class="pl-table"><thead><tr><th>Name</th><th>Pos</th><th>No.</th><th>Off</th><th>Def</th><th>Value</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="ed-actions"><button class="btn" type="button" data-act="accept" ${preview.list.length ? '' : 'disabled'}>Add ${preview.list.length} players</button>
        <button class="btn ghost" type="button" data-act="discard">Discard</button></div>
      <p class="ed-msg" role="status"></p></section>`;
  }

  function pastePanel() {
    return `<details class="pl-paste"><summary>Paste a list</summary>
      <form class="ed-invite" id="pl-paste">
        <label>One player per line <i>Name, FWD, 8, 3 (position, offense, defense)</i>
          <textarea name="lines" rows="5" required placeholder="Jace Callister, FWD, 8, 3&#10;Nate Sterling, GK&#10;MID"></textarea></label>
        <p class="ed-hint">Anything left out is made up for you: a line with just a position (like <b>MID</b>) is a brand-new player, a name alone gets a position and ratings.</p>
        <div class="ed-actions"><button class="btn">Add players</button></div>
        <p class="ed-msg" role="status"></p>
      </form></details>`;
  }

  function listPanel() {
    const q = filter.q.trim().toLowerCase();
    const shown = players.filter(p => (filter.club === '' || (filter.club === '-' ? !p.club : p.club === filter.club))
      && (!filter.pos || p.position === filter.pos) && (!q || p.name.toLowerCase().includes(q) || p.id.includes(q) || String(p.number) === q));
    const rows = shown.map(p => `<tr data-id="${esc(p.id)}">
      <td class="pl-id" title="Player ID">${esc(p.id)}</td>
      <td><input class="pl-name" value="${esc(p.name)}" maxlength="40" aria-label="Name"></td>
      <td><select data-f="position" aria-label="Position">${opts(POSITIONS.map(x => [x, x]), p.position)}</select></td>
      <td><input class="pl-num" type="number" min="1" max="99" value="${p.number}" data-f="number" aria-label="Singlet number"></td>
      <td><select data-f="offense" class="rt rt-${p.offense}" aria-label="Offense">${ratingOpts(p.offense)}</select></td>
      <td><select data-f="defense" class="rt rt-${p.defense}" aria-label="Defense">${ratingOpts(p.defense)}</select></td>
      <td class="pl-value">${money(p.value)}</td>
      <td><select data-f="club" aria-label="Club">${clubOpts(p.club)}</select></td>
      <td class="pl-row-act"><button class="btn ghost small" type="button" data-act="remove">Remove</button>
        <span class="ed-confirm" hidden><button class="btn small" type="button" data-act="remove-yes">Remove ${esc(p.name)}</button>
        <button class="btn ghost small" type="button" data-act="remove-no">Keep</button></span></td></tr>`).join('');
    return `<section class="pl-list">
      <h2>All players</h2>
      <div class="pl-filters">
        <input type="search" id="pl-q" placeholder="Search by name, ID or number" value="${esc(filter.q)}" aria-label="Search by name, ID or number">
        <select id="pl-fclub" aria-label="Club"><option value="">All players</option><option value="-" ${filter.club === '-' ? 'selected' : ''}>Free agents</option>${active().map(c => `<option value="${esc(c.code)}" ${filter.club === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select id="pl-fpos" aria-label="Position"><option value="">Any position</option>${posOpts(filter.pos)}</select>
      </div>
      ${players.length ? `<div class="pl-scroll"><table class="pl-table pl-edit"><thead><tr><th>ID</th><th>Name</th><th>Pos</th><th>No.</th><th>Off</th><th>Def</th><th>Value</th><th>Club</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        ${shown.length ? '' : '<p class="quiet">No players match.</p>'}`
        : '<p class="quiet">No players yet. Press Generate above.</p>'}
      <p class="ed-msg" role="status" id="pl-msg"></p>
      ${players.length ? `<div class="pl-danger"><button class="btn ghost small" type="button" data-act="wipe">Remove all players…</button>
        <span class="ed-confirm" hidden>Remove all ${players.length} players? Team sheets that use them will need picking again.
          <button class="btn small" type="button" data-act="wipe-yes">Yes, remove all</button>
          <button class="btn ghost small" type="button" data-act="wipe-no">Cancel</button></span></div>` : ''}
    </section>`;
  }

  // Only the list is redrawn while typing in the filters, so the cursor stays put.
  function drawList() {
    const el = root.querySelector('.pl-list');
    if (el) el.outerHTML = listPanel(); else root.insertAdjacentHTML('beforeend', listPanel());
  }
  function draw() {
    root.innerHTML = `${summary()}${generatePanel()}${previewPanel()}${pastePanel()}${listPanel()}`;
  }

  const say = (el, text) => { if (el) el.textContent = text; };

  async function insert(rows, msgEl) {
    const c = await ctx.db();
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await c.from('players').insert(rows.slice(i, i + 100).map(({ name, position, number, offense, defense }) => ({ name, position, number, offense, defense })));
      if (error) throw new Error(/players_name_unique|duplicate/i.test(error.message) ? 'One of those names is already a player. Try again.' : explain(error));
    }
    await fetchAll();
    say(msgEl, '');
  }

  root.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target, msg = form.querySelector('.ed-msg'), btn = form.querySelector('button');
    if (form.id === 'pl-gen') {
      const n = Math.max(1, Math.min(400, Number(form.elements.count.value) || 0));
      const opt = { mean: QUALITY[form.elements.quality.value][1], spread: MIX[form.elements.mix.value][1], names: form.elements.names.value };
      try {
        preview = { opt, list: generate(n, names(), opt) };
        draw();
        root.querySelector('.pl-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { say(msg, err.message); }
    } else if (form.id === 'pl-paste') {
      btn.disabled = true; say(msg, 'Adding…');
      try {
        const rows = parseList(form.elements.lines.value);
        if (!rows.length) throw new Error('Nothing to add.');
        await insert(rows, msg);
        draw();
      } catch (err) { say(msg, err.message); btn.disabled = false; }
    }
  });

  // "Name, FWD, 8, 3": any part can be left out; a lone position makes a new player.
  function parseList(text) {
    const n = namer(names());
    const out = [];
    for (const line of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      const parts = line.split(/[,\t]/).map(x => x.trim()).filter(Boolean);
      let name = '', position = '';
      const nums = [];
      for (const part of parts) {
        if (/^(GK|DEF|MID|FWD)$/i.test(part)) position = part.toUpperCase();
        else if (/^\d+$/.test(part)) nums.push(Number(part));
        else if (!name) name = part;
      }
      if (nums.some(x => x < 1 || x > 10)) throw new Error(`“${line}”: ratings are 1 to 10.`);
      if (nums.length >= 2 && nums[0] + nums[1] > MAX_TOTAL) throw new Error(`“${line}”: offense and defense can add up to ${MAX_TOTAL} at most (nobody is a 10/10).`);
      if (!position) position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];
      if (name) { const f = name.split(/\s+/); if (f.length < 2) throw new Error(`“${line}” needs a first and last name.`); }
      else { name = n.next(); if (!name) throw new Error('Ran out of unused names.'); }
      const r = rate(position);
      out.push({ name, position, number: numbersFor(position, 1)[0], offense: nums[0] ?? r.offense, defense: nums[1] ?? r.defense });
    }
    return out;
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, row = b.closest('tr');
    if (act === 'reroll') {
      const i = Number(row.dataset.i);
      try {
        preview.list[i] = reroll(preview.list[i], [...names(), ...preview.list.filter((_, k) => k !== i).map(p => p.name)], preview.opt);
        draw();
      } catch (err) { say(root.querySelector('.pl-preview .ed-msg'), err.message); }
    } else if (act === 'drop') { preview.list.splice(Number(row.dataset.i), 1); draw(); }
    else if (act === 'discard') { preview = null; draw(); }
    else if (act === 'accept') {
      const msg = root.querySelector('.pl-preview .ed-msg');
      root.querySelectorAll('.pl-preview button').forEach(x => { x.disabled = true; });
      say(msg, 'Adding…');
      try { await insert(preview.list, msg); preview = null; draw(); }
      catch (err) { say(msg, err.message); root.querySelectorAll('.pl-preview button').forEach(x => { x.disabled = false; }); }
    } else if (act === 'remove' || act === 'remove-no') {
      const td = row.querySelector('.pl-row-act');
      td.querySelector('[data-act="remove"]').hidden = act === 'remove';
      td.querySelector('.ed-confirm').hidden = act === 'remove-no';
    } else if (act === 'remove-yes') {
      const id = row.dataset.id;
      const { error } = await (await ctx.db()).from('players').delete().eq('id', id);
      if (error) return say(document.getElementById('pl-msg'), explain(error));
      players = players.filter(p => p.id !== id); forgetPlayers();
      root.querySelector('.pl-sum').outerHTML = summary(); drawList();
    } else if (act === 'wipe' || act === 'wipe-no') {
      const box = b.closest('.pl-danger');
      box.querySelector('[data-act="wipe"]').hidden = act === 'wipe';
      box.querySelector('.ed-confirm').hidden = act === 'wipe-no';
    } else if (act === 'wipe-yes') {
      const { error } = await (await ctx.db()).from('players').delete().neq('id', '');
      if (error) return say(document.getElementById('pl-msg'), explain(error));
      players = []; forgetPlayers(); draw();
    }
  });

  root.addEventListener('change', async e => {
    const el = e.target, row = el.closest('tr[data-id]');
    if (el.id === 'pl-fclub') { filter.club = el.value; return drawList(); }
    if (el.id === 'pl-fpos') { filter.pos = el.value; return drawList(); }
    if (!row) return;
    const p = players.find(x => x.id === row.dataset.id);
    const field = el.dataset.f || (el.classList.contains('pl-name') ? 'name' : '');
    if (!p || !field) return;
    let v = el.value;
    if (field === 'offense' || field === 'defense') {
      v = Number(v);
      const other = field === 'offense' ? p.defense : p.offense;
      if (v + other > MAX_TOTAL) { say(document.getElementById('pl-msg'), `Offense and defense can add up to ${MAX_TOTAL} at most: nobody is a 10/10.`); el.value = p[field]; return; }
    }
    if (field === 'club') v = v || null;
    if (field === 'number') {
      v = Math.round(Number(v));
      if (!(v >= 1 && v <= 99)) { say(document.getElementById('pl-msg'), 'Singlet numbers are 1 to 99.'); el.value = p.number; return; }
    }
    if (field === 'name') v = v.trim().replace(/\s+/g, ' ');
    const msg = document.getElementById('pl-msg');
    const { data, error } = await (await ctx.db()).from('players').update({ [field]: v }).eq('id', p.id).select('id, name, position, number, offense, defense, club, value').single();
    if (error) {
      say(msg, /players_club_number/i.test(error.message) ? 'Another player at that club already wears that number.'
        : /players_name_unique|duplicate/i.test(error.message) ? 'Another player already has that name.' : explain(error));
      el.value = field === 'club' ? p.club || '' : p[field];
      if (field === 'offense' || field === 'defense') el.className = `rt rt-${p[field]}`;
      return;
    }
    Object.assign(p, data); forgetPlayers(); say(msg, '');
    if (field === 'club') row.querySelector('[data-f="number"]').value = p.number;   // a clash is moved to the next free number
    for (const f of ['offense', 'defense']) { const sel = row.querySelector(`[data-f="${f}"]`); sel.className = `rt rt-${p[f]}`; }
    row.querySelector('.pl-value').textContent = money(p.value);
    root.querySelector('.pl-sum').outerHTML = summary();
  });

  root.addEventListener('input', e => {
    if (e.target.id !== 'pl-q') return;
    filter.q = e.target.value;
    const pos = e.target.selectionStart;
    drawList();
    const q = document.getElementById('pl-q'); q.focus(); q.setSelectionRange(pos, pos);
  });

  try { await fetchAll(); draw(); } catch (err) { root.innerHTML = `<p class="quiet">${esc(err.message)} <a href="#players">Try again</a></p>`; }
}

