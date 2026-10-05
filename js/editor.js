// The league office's Editor (0.4): club requests to approve or send back, the clubs, manager accounts (invite,
// link to a club, send a password link) and, from 0.6, each week's line-up deadline (with the office's "clubs
// without a team" email since 0.7.1, as Settings is for managers). Fixtures, results, Simulate and news move in later
// (docs/PLAN.md).
// The database checks everything again (supabase/migrations/0003_club_setup.sql); this page only asks.
import { enter, clubs, chrome, esc, safeColour, crestUrl } from './member.js';
import { db, sendPasswordReset } from './auth.js';
import { accentFor } from './club-colour.js';
import { loadSeason, kickoff } from './dashboard-data.js';
import { prefs, setPref } from './prefs.js';

chrome();
const me = await enter('editor.html');
const main = document.getElementById('main');
const TABS = { requests: 'Requests', clubs: 'Clubs', managers: 'Managers', deadlines: 'Deadlines' };
let state = { clubs: [], requests: [], accounts: [], deadlines: null, locked: [], season: null, digest: true };

// The accent a club shows: the one saved with its colours, or worked out the same way the wizard does.
const accentOf = c => safeColour(c.accent || accentFor(c.colour, c.colour2));

// Database messages, in plain words. Ours are already readable ('That code is taken.'); Postgres's aren't.
function explain(error) {
  const m = String(error?.message || error || '');
  if (/fetch|network|failed to load/i.test(m)) return 'Couldn’t reach vLeague. Check your connection and try again.';
  if (/jwt|session/i.test(m)) return 'You’ve been signed out. Sign in again and retry.';
  if (/duplicate key|unique/i.test(m)) return 'That already exists.';
  return m && m.length < 160 && !/violates|syntax|relation|column|null value|function|schema|permission/i.test(m) ? m : 'That didn’t work. Try again.';
}

const when = t => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const crest = (path, code, cls = '') => (path
  ? `<img class="${cls}" src="${esc(crestUrl(path))}" alt="">`
  : `<span class="no-crest ${cls}">${esc(code || '?')}</span>`);

async function load() {
  const c = await db();
  const [list, req, acc, dl, ws, season, mine] = await Promise.all([
    clubs(),
    c.from('club_requests').select('*').order('created_at', { ascending: false }).limit(60),
    c.rpc('office_accounts'),
    c.from('deadlines').select('*').order('week'),
    c.from('week_sheets').select('week, club'),
    loadSeason().catch(() => null),
    prefs(),
  ]);
  if (req.error || acc.error) throw new Error(explain(req.error || acc.error));
  state = {
    clubs: list, requests: req.data || [], accounts: acc.data || [],
    deadlines: dl.error ? null : dl.data || [], locked: ws.data || [], season, digest: mine.email.office_digest,
  };
}

function tab() {
  const t = location.hash.slice(1);
  return TABS[t] ? t : 'requests';
}

function render() {
  const t = tab();
  const pending = state.requests.filter(r => r.status === 'pending').length;
  main.innerHTML = `<nav class="ed-tabs" aria-label="Editor">${Object.entries(TABS).map(([k, label]) =>
    `<a href="#${k}" ${k === t ? 'aria-current="page"' : ''}>${label}${k === 'requests' && pending ? ` <span class="ed-count">${pending}</span>` : ''}</a>`).join('')}</nav>
    <section id="view">${{ requests: requestsView, clubs: clubsView, managers: managersView, deadlines: deadlinesView }[t]()}</section>`;
}

// ---------------------------------------------------------------- requests

function requestsView() {
  const pending = state.requests.filter(r => r.status === 'pending');
  const done = state.requests.filter(r => r.status !== 'pending').slice(0, 12);
  return `<h1>Requests</h1>
    ${pending.length ? pending.map(requestCard).join('') : '<p class="quiet">Nothing waiting.</p>'}
    ${done.length ? `<h2>Recently dealt with</h2><ul class="ed-history">${done.map(r => {
      const c = state.clubs.find(x => x.code === r.club) || { code: r.club };
      return `<li><b>${esc(c.name || r.club)}</b> ${r.kind === 'setup' ? 'set-up' : 'change'}
        <span class="ed-pill ${r.status}">${r.status === 'approved' ? 'Approved' : 'Sent back'}</span>
        <small>${esc(when(r.reviewed_at))}${r.office_note ? `: “${esc(r.office_note)}”` : ''}</small></li>`;
    }).join('')}</ul>` : ''}`;
}

function requestCard(r) {
  const c = state.clubs.find(x => x.code === r.club) || { code: r.club };
  const accent = accentOf(c);
  const next = { name: r.name ?? c.name, short_name: r.short_name ?? c.short_name, code: r.code ?? c.code, crest_path: r.crest_path ?? c.crest_path };
  const row = (label, from, to, changed) => `<tr class="${changed ? 'changed' : ''}"><th>${label}</th>
    <td>${changed && from ? `<s>${esc(from)}</s> ` : ''}${esc(to || '—')}</td></tr>`;
  return `<article class="ed-request" style="--club:${esc(accent)}" data-id="${r.id}">
    <header>
      ${crest(next.crest_path, next.code, 'big')}
      <div><h3>${esc(next.name || c.name)}</h3>
        <small>${r.kind === 'setup' ? 'Setting up the club' : 'Asking for a change'} · ${esc(when(r.created_at))}</small></div>
    </header>
    <table class="ed-diff">
      ${row('Name', c.name, next.name, r.name != null && r.name !== c.name)}
      ${row('Short name', c.short_name, next.short_name, r.short_name != null && r.short_name !== c.short_name)}
      ${row('Code', c.code, next.code, r.code != null && r.code !== c.code)}
      <tr class="${r.crest_path ? 'changed' : ''}"><th>Crest</th><td class="ed-crests">
        ${r.crest_path && c.crest_path ? `${crest(c.crest_path, c.code, 'was')} <span aria-hidden="true">→</span>` : ''}
        ${crest(next.crest_path, next.code)} ${r.crest_path ? '' : '<small>no change</small>'}</td></tr>
      <tr><th>Colours</th><td class="ed-swatches">${[['Primary', c.colour], ['Secondary', c.colour2], ['Accent', accent]]
        .filter(([, v]) => v).map(([l, v]) => `<span><i style="background:${esc(safeColour(v))}"></i>${l}</span>`).join('')}</td></tr>
      ${c.manager_name ? `<tr><th>Manager</th><td>${esc(c.manager_name)}</td></tr>` : ''}
      ${c.stadium ? `<tr><th>Stadium</th><td>${esc(c.stadium)}</td></tr>` : ''}
      ${c.motto ? `<tr><th>Motto</th><td>${esc(c.motto)}</td></tr>` : ''}
    </table>
    ${r.notes ? `<blockquote>${esc(r.notes)}</blockquote>` : ''}
    <div class="ed-preview" aria-label="How it will look">
      <div class="band"></div>
      <div class="row">${crest(next.crest_path, next.code)}<b>${esc(next.short_name || next.name)}</b><span>${esc(next.code)}</span></div>
    </div>
    <div class="ed-actions">
      <button class="btn" data-act="approve">Approve</button>
      <button class="btn ghost" data-act="return">Send back…</button>
    </div>
    <form class="ed-return" hidden>
      <label>What needs changing? The manager sees this.<textarea name="note" maxlength="500" rows="3" required></textarea></label>
      <div class="ed-actions"><button class="btn">Send back</button><button class="btn ghost" type="button" data-act="cancel">Cancel</button></div>
    </form>
    <p class="ed-msg" role="status"></p>
  </article>`;
}

async function review(card, approve, note) {
  const msg = card.querySelector('.ed-msg');
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  msg.textContent = approve ? 'Approving…' : 'Sending back…';
  const { error } = await (await db()).rpc('review_club_request', { p_id: Number(card.dataset.id), p_approve: approve, p_note: note || null });
  if (error) {
    msg.textContent = explain(error);
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return;
  }
  await refresh();
}

// ---------------------------------------------------------------- clubs

// One state per club, in the order a club moves through them.
function clubState(c, m) {
  if (c.status === 'withdrawn') return ['Withdrawn', ''];
  if (!m) return ['No manager', 'warn'];
  if (!m.last_sign_in_at) return ['Invited', ''];
  if (!c.setup_at) return ['Setting up', ''];
  if (state.requests.some(r => r.club === c.code && r.status === 'pending')) return ['Waiting for approval', 'warn'];
  return ['Active', 'approved'];
}

function clubsView() {
  // The office's own club counts too, so a manager account wins over the office if both are linked.
  const managers = new Map(state.accounts.filter(a => a.club).sort((a, b) => (a.role === 'manager') - (b.role === 'manager'))
    .map(a => [a.club, a]));
  return `<h1>Clubs</h1>
    <form class="ed-invite" id="add-clubs">
      <h2>Add clubs</h2>
      <label>One club per line <i>Name, or CODE, Name, or CODE, Name, Manager</i>
        <textarea name="lines" rows="5" required placeholder="Northside FC&#10;WST, Westgate United&#10;HRB, Harbour Town, Sam"></textarea></label>
      <p class="ed-hint">Codes (2 to 4 letters or numbers) and colours are picked for you if left out. Each club then gets a manager from the Managers tab and sets itself up.</p>
      <div class="ed-actions"><button class="btn">Add clubs</button></div>
      <p class="ed-msg" role="status"></p>
    </form>
    <ul class="club-rows ed-clubs">${state.clubs.map(c => {
    const m = managers.get(c.code);
    const [label, kind] = clubState(c, m);
    return `<li style="--club:${esc(accentOf(c))}" data-code="${esc(c.code)}">
      ${crest(c.crest_path, c.code)}
      <span class="who"><b>${esc(c.name)}</b><small>${esc(c.code)}${m ? ` · ${esc(m.email)}` : ''}</small></span>
      <span class="ed-pill ${kind}">${esc(label)}</span>
      <span class="ed-setup">${c.setup_at ? `<button class="btn ghost small" type="button" data-act="reopen">Set up again</button>` : ''}</span>
      <span class="ed-confirm" hidden>Show ${esc(c.name)} the setup wizard again?
        <button class="btn small" type="button" data-act="reopen-yes">Yes</button>
        <button class="btn ghost small" type="button" data-act="reopen-no">Cancel</button></span>
      <p class="ed-msg" role="status"></p>
    </li>`;
  }).join('')}</ul>`;
}

// A code from a name: initials of long names, else the first letters, else a number on the end.
function suggestCode(name, taken) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const letters = words.join('');
  const tries = [words.length >= 3 ? words.map(w => w[0]).join('').slice(0, 4) : '', letters.slice(0, 3), letters.slice(0, 4)].filter(c => c.length >= 2);
  for (const c of tries) if (!taken.has(c)) return c;
  const base = (tries[1] || 'CL').slice(0, 2);
  for (let n = 1; n < 100; n++) if (!taken.has(base + n)) return base + n;
  return '';
}
const CLUB_COLOURS = ['#1e88e5', '#e53935', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#fdd835', '#6d4c41', '#d81b60', '#546e7a'];

async function addClubs(form) {
  const msg = form.querySelector('.ed-msg'), btn = form.querySelector('button');
  const taken = new Set(state.clubs.map(c => c.code)), rows = [], problems = [];
  for (const line of form.elements.lines.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const parts = line.split(/[,\t]/).map(x => x.trim());
    let code, name, manager = '';
    if (parts.length >= 2 && /^[A-Za-z0-9]{2,4}$/.test(parts[0])) [code, name, manager = ''] = parts; else [name, manager = ''] = parts;
    code = (code || suggestCode(name, taken)).toUpperCase();
    if (!name || name.length < 2 || name.length > 40) problems.push(`“${line}” needs a name of 2 to 40 characters.`);
    else if (!/^[A-Z0-9]{2,4}$/.test(code)) problems.push(`“${line}” has no usable code.`);
    else if (taken.has(code)) problems.push(`The code ${code} is already used (“${line}”).`);
    else { taken.add(code); rows.push({ code, name, manager_name: manager || null, colour: CLUB_COLOURS[(state.clubs.length + rows.length) % CLUB_COLOURS.length], status: 'active' }); }
  }
  // All or nothing: fix the list, then add it.
  if (problems.length || !rows.length) { msg.textContent = problems[0] || 'Add at least one club.'; return; }
  btn.disabled = true; msg.textContent = 'Adding…';
  const { error } = await (await db()).from('clubs').insert(rows);
  btn.disabled = false;
  if (error) { msg.textContent = explain(error); return; }
  await refresh();
  const again = document.querySelector('#add-clubs .ed-msg');
  if (again) again.textContent = `Added ${rows.length} club${rows.length > 1 ? 's' : ''}: ${rows.map(r => r.code).join(', ')}.`;
}

async function reopen(li) {
  li.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const { error } = await (await db()).rpc('reopen_club_setup', { p_code: li.dataset.code });
  if (error) {
    li.querySelector('.ed-msg').textContent = explain(error);
    li.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return;
  }
  await refresh();
}

// ---------------------------------------------------------------- managers

function accountState(a) {
  if (a.last_sign_in_at) return `Last signed in ${when(a.last_sign_in_at)}`;
  if (a.invited_at && !a.confirmed_at) return `Invited ${when(a.invited_at)}, not accepted yet`;
  return 'Never signed in';
}

function managersView() {
  const taken = new Set(state.accounts.filter(a => a.club && a.role === 'manager').map(a => a.club));
  // A club has one manager: clubs with one are greyed out for invites and for other managers (the office can share).
  const clubOptions = (selected, block) => `<option value="">${block === 'invite' ? 'Pick a club' : 'No club'}</option>` +
    state.clubs.map(c => {
      const off = block && c.code !== selected && taken.has(c.code);
      return `<option value="${esc(c.code)}" ${c.code === selected ? 'selected' : ''} ${off ? 'disabled' : ''}>${esc(c.name)}${off ? ' (has a manager)' : ''}</option>`;
    }).join('');
  return `<h1>Managers</h1>
    <form class="ed-invite" id="invite">
      <h2>Invite a manager</h2>
      <div class="ed-fields">
        <label>Email<input name="email" type="email" required autocomplete="off"></label>
        <label>Name <i>Optional</i><input name="name" maxlength="40" autocomplete="off"></label>
        <label>Club<select name="club" required>${clubOptions('', 'invite')}</select></label>
      </div>
      <div class="ed-actions"><button class="btn">Send invite</button></div>
      <p class="ed-msg" role="status"></p>
    </form>
    <ul class="ed-accounts">${state.accounts.map(a => `<li data-id="${esc(a.id)}" data-email="${esc(a.email)}">
      <span class="who"><b>${esc(a.display_name || a.email)}</b><small>${esc(a.email)}${a.role === 'office' ? ' · league office' : ''}</small>
        <small>${esc(accountState(a))}</small></span>
      <label class="sr-only" for="club-${esc(a.id)}">Club</label>
      <select id="club-${esc(a.id)}" data-act="link" data-was="${esc(a.club || '')}">${clubOptions(a.club, a.role === 'manager')}</select>
      <button class="btn ghost small" data-act="reset" type="button">Send password link</button>
      <span class="ed-confirm" hidden><span></span>
        <button class="btn small" type="button" data-act="link-yes">Yes</button>
        <button class="btn ghost small" type="button" data-act="link-no">Cancel</button></span>
      <p class="ed-msg" role="status"></p>
    </li>`).join('')}</ul>`;
}

async function invite(form) {
  const msg = form.querySelector('.ed-msg');
  const data = Object.fromEntries(new FormData(form));
  form.querySelector('button').disabled = true;
  msg.textContent = 'Sending…';
  const { data: res, error } = await (await db()).functions.invoke('invite-manager', { body: data });
  let problem = res?.error;
  if (error) problem = (await error.context?.json?.().catch(() => null))?.error || 'The invite didn’t send. Try again.';
  form.querySelector('button').disabled = false;
  if (problem) { msg.textContent = explain(problem); return; }
  await refresh();
  const again = document.querySelector('#invite .ed-msg');
  if (again) again.textContent = `Invite sent to ${data.email}.`;
}

// Changing an account's club asks first: one mis-tap would otherwise take a manager off their club.
function askLink(li, select) {
  const to = state.clubs.find(c => c.code === select.value);
  const who = li.querySelector('.who b').textContent;
  const box = li.querySelector('.ed-confirm');
  box.querySelector('span').textContent = to ? `Move ${who} to ${to.name}?` : `Take ${who} off their club?`;
  box.hidden = false;
  li.querySelector('.ed-msg').textContent = '';
}

async function link(li, yes) {
  const select = li.querySelector('select'), msg = li.querySelector('.ed-msg');
  li.querySelector('.ed-confirm').hidden = true;
  if (!yes) { select.value = select.dataset.was; return; }
  const club = select.value;
  const { error } = await (await db()).from('profiles').update({ club: club || null }).eq('id', li.dataset.id);
  if (error) { select.value = select.dataset.was; msg.textContent = explain(error); return; }
  select.dataset.was = club;
  const a = state.accounts.find(x => x.id === li.dataset.id);
  if (a) a.club = club || null;
  msg.textContent = club ? 'Moved.' : 'Taken off the club.';
}

// ---------------------------------------------------------------- line-up deadlines (0.6)
// At a week's deadline the database copies every club's team sheet: that copy is what Simulate uses for the week
// and what everyone sees from then on. A locked week can't be moved (supabase/migrations/0005_lineup_deadlines.sql).

const pad = n => String(n).padStart(2, '0');
const localInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const full = t => new Date(t).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Each week in the season with its first kick-off, plus any week that only has a deadline.
function weeks() {
  const first = new Map();
  for (const f of state.season?.fixtures || []) {
    const k = kickoff(f);
    if (f.week == null) continue;
    const had = first.get(f.week);
    if (!first.has(f.week) || (k && (!had || k < had))) first.set(f.week, k);
  }
  for (const d of state.deadlines || []) if (!first.has(d.week)) first.set(d.week, null);
  return [...first.entries()].sort((a, b) => a[0] - b[0]);
}

function deadlinesView() {
  if (!state.deadlines) return '<h1>Deadlines</h1><p class="quiet">The deadlines didn’t load. <a href="editor.html#deadlines">Try again</a></p>';
  const list = weeks();
  const byWeek = new Map(state.deadlines.map(d => [d.week, d]));
  const sheets = w => state.locked.filter(s => s.week === w).length;
  const rows = list.map(([w, first]) => {
    const d = byWeek.get(w);
    const kick = first ? `First kick-off ${full(first)}` : 'No fixtures';
    if (d?.locked_at) {
      return `<li class="ed-dl locked"><b>Week ${w}</b><small>${esc(kick)}</small><span class="ed-pill approved">Locked</span>
        <span class="state">${esc(full(d.locks_at))} · ${sheets(w)} of ${state.clubs.length} team sheets</span></li>`;
    }
    const value = d ? localInput(new Date(d.locks_at)) : first ? localInput(new Date(first - 3600e3)) : '';
    const late = d && first && new Date(d.locks_at) > first;
    return `<li class="ed-dl" data-week="${w}"><b>Week ${w}</b><small>${esc(kick)}</small>
      <label class="sr-only" for="dl-${w}">Week ${w} deadline</label>
      <input id="dl-${w}" type="datetime-local" value="${value}"${d ? '' : ' class="suggested"'}>
      <span class="ed-actions"><button class="btn small" data-act="dl-save" type="button">${d ? 'Save' : 'Set'}</button>
        ${d ? '<button class="btn ghost small" data-act="dl-remove" type="button">Remove</button>' : ''}</span>
      ${d ? '' : '<span class="ed-pill warn">Not set</span>'}
      <p class="ed-msg" role="status">${late ? 'After the first kick-off' : ''}</p></li>`;
  }).join('');
  const unset = list.filter(([w, first]) => first && !byWeek.has(w)).length;
  return `<h1>Deadlines</h1>
    ${unset ? `<div class="ed-bulk"><button class="btn small" data-act="dl-all" type="button">Set ${unset === 1 ? 'the empty week' : `all ${unset} empty weeks`} to 1 h before kick-off</button><p class="ed-msg" role="status"></p></div>` : ''}
    <label class="ed-digest"><input type="checkbox" data-act="digest"${state.digest ? ' checked' : ''}> Email me about clubs without a team<span class="ed-msg" role="status"></span></label>
    ${list.length ? `<ul class="ed-dls">${rows}</ul>` : '<p class="quiet">No fixtures.</p>'}
    <form class="ed-dl-add" id="dl-add"><h2>Another week</h2><div class="ed-fields">
      <label>Week<input name="week" type="number" min="1" max="99" required></label>
      <label>Deadline<input name="at" type="datetime-local" required></label></div>
      <div class="ed-actions"><button class="btn">Set</button></div><p class="ed-msg" role="status"></p></form>`;
}

async function saveDeadline(week, value, msg) {
  if (!value) { msg.textContent = 'Pick a date and time.'; return; }
  const { error } = await (await db()).from('deadlines').upsert({ week, locks_at: new Date(value).toISOString() });
  if (error) { msg.textContent = explain(error); return; }
  await refresh();
}

// Every week with fixtures but no deadline gets one an hour before its first kick-off.
async function setAllDeadlines(btn) {
  const msg = btn.parentNode.querySelector('.ed-msg');
  const set = new Set((state.deadlines || []).map(d => d.week));
  const rows = weeks().filter(([w, first]) => first && !set.has(w)).map(([week, first]) => ({ week, locks_at: new Date(first - 3600e3).toISOString() }));
  btn.disabled = true;
  const { error } = await (await db()).from('deadlines').upsert(rows);
  if (error) { msg.textContent = explain(error); btn.disabled = false; return; }
  await refresh();
}

async function removeDeadline(li) {
  const { error } = await (await db()).from('deadlines').delete().eq('week', Number(li.dataset.week));
  if (error) { li.querySelector('.ed-msg').textContent = explain(error); return; }
  await refresh();
}

async function saveDigest(box) {
  const msg = box.parentNode.querySelector('.ed-msg');
  try { await setPref('email.office_digest', box.checked); state.digest = box.checked; msg.textContent = 'Saved'; }
  catch (e) { box.checked = !box.checked; msg.textContent = explain(e); }
}

// ---------------------------------------------------------------- events

main.addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const card = b.closest('.ed-request');
  if (b.dataset.act === 'approve') review(card, true);
  if (b.dataset.act === 'return') { card.querySelector('.ed-return').hidden = false; card.querySelector('textarea').focus(); }
  if (b.dataset.act === 'cancel') card.querySelector('.ed-return').hidden = true;
  if (b.dataset.act === 'reopen') b.closest('li').querySelector('.ed-confirm').hidden = false;
  if (b.dataset.act === 'reopen-no') b.closest('.ed-confirm').hidden = true;
  if (b.dataset.act === 'reopen-yes') reopen(b.closest('li'));
  if (b.dataset.act === 'dl-save') {
    const li = b.closest('li');
    saveDeadline(Number(li.dataset.week), li.querySelector('input').value, li.querySelector('.ed-msg'));
  }
  if (b.dataset.act === 'dl-remove') removeDeadline(b.closest('li'));
  if (b.dataset.act === 'dl-all') setAllDeadlines(b);
  if (b.dataset.act === 'link-yes') link(b.closest('li'), true);
  if (b.dataset.act === 'link-no') link(b.closest('li'), false);
  if (b.dataset.act === 'reset') {
    const li = b.closest('li');
    b.disabled = true;
    sendPasswordReset(li.dataset.email)
      .then(() => { li.querySelector('.ed-msg').textContent = 'Password link sent.'; })
      .catch(err => { li.querySelector('.ed-msg').textContent = explain(err); b.disabled = false; });
  }
});
main.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'invite') return invite(e.target);
  if (e.target.id === 'add-clubs') return addClubs(e.target);
  if (e.target.id === 'dl-add') return saveDeadline(Number(e.target.week.value), e.target.at.value, e.target.querySelector('.ed-msg'));
  if (e.target.classList.contains('ed-return')) review(e.target.closest('.ed-request'), false, e.target.note.value);
});
main.addEventListener('change', e => {
  if (e.target.dataset.act === 'link') askLink(e.target.closest('li'), e.target);
  if (e.target.dataset.act === 'digest') saveDigest(e.target);
});
addEventListener('hashchange', () => { if (state.clubs.length) render(); });

async function refresh() {
  try {
    await load();
    render();
  } catch (e) {
    main.innerHTML = `<p class="quiet">${esc(explain(e))} <a href="editor.html">Try again</a></p>`;
  }
  main.setAttribute('aria-busy', 'false');
}

if (me) {
  document.getElementById('to-home').hidden = !me.profile?.club;
  await refresh();
}
