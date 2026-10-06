// The league office's Editor. Clubs (0.15) is one place per club: its manager account and phone, its details, requests
// to approve or send back, and a full copy of every registration it sent. Then Players (0.11), Fixtures with Simulate
// (0.12 to 0.14) and each week's line-up deadline (0.6, with the office's "clubs without a team" email since 0.7.1).
// The database checks everything again (supabase/migrations/0003_club_setup.sql); this page only asks.
import { enter, clubs, chrome, esc, safeColour, crestUrl } from './member.js';
import { db, sendPasswordReset } from './auth.js';
import { loadSeason, kickoff } from './dashboard-data.js';
import { prefs, setPref } from './prefs.js';
import { playersView, mountPlayers } from './editor-players.js';
import { fixturesView, mountFixtures } from './editor-fixtures.js';

chrome();
const me = await enter('editor.html');
const main = document.getElementById('main');
const TABS = { clubs: 'Clubs', players: 'Players', fixtures: 'Fixtures', deadlines: 'Deadlines' };
// `open` is which club panels and submissions are expanded, kept across redraws so nothing snaps shut after an action.
let state = { clubs: [], requests: [], accounts: [], phones: null, deadlines: null, locked: [], season: null, digest: true, open: new Set() };
let firstLoad = true;

// The colour a club shows: its primary colour.
const colourOf = c => safeColour(c.colour);

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
  const [list, req, acc, dl, ws, season, mine, ph] = await Promise.all([
    clubs(),
    c.from('club_requests').select('*').order('created_at', { ascending: false }).limit(500),
    c.rpc('office_accounts'),
    c.from('deadlines').select('*').order('week'),
    c.from('week_sheets').select('week, club'),
    loadSeason().catch(() => null),
    prefs(),
    c.from('manager_phones').select('club, phone, updated_at'),
  ]);
  if (req.error || acc.error) throw new Error(explain(req.error || acc.error));
  state = {
    clubs: list, requests: req.data || [], accounts: acc.data || [], phones: ph.error ? null : ph.data || [],
    deadlines: dl.error ? null : dl.data || [], locked: ws.data || [], season, digest: mine.email.office_digest, open: state.open,
  };
  if (firstLoad) {   // clubs waiting on the office start open
    firstLoad = false;
    for (const r of state.requests) if (r.status === 'pending') state.open.add(`club:${r.club}`);
  }
}

function tab() {
  const t = location.hash.slice(1);
  return TABS[t] ? t : 'clubs';   // the old Requests, Managers and Phones tabs are part of Clubs now
}

function render() {
  const t = tab();
  const pending = state.requests.filter(r => r.status === 'pending').length;
  const y = scrollY;
  main.innerHTML = `<nav class="ed-tabs" aria-label="Editor">${Object.entries(TABS).map(([k, label]) =>
    `<a href="#${k}" ${k === t ? 'aria-current="page"' : ''}>${label}${k === 'clubs' && pending ? ` <span class="ed-count">${pending}</span>` : ''}</a>`).join('')}</nav>
    <section id="view">${{ clubs: clubsView, players: playersView, fixtures: fixturesView, deadlines: deadlinesView }[t]()}</section>`;
  if (y) scrollTo(0, y);   // a redraw after an action keeps your place
  if (t === 'players') mountPlayers({ db, esc, explain, clubs: state.clubs });
  if (t === 'fixtures') mountFixtures({ db, esc, explain, clubs: state.clubs });
}


// ---------------------------------------------------------------- clubs
// One place per club (0.15): its manager account and phone, its details, what's waiting for approval, and a full copy of
// every registration it has sent. Each club is a row that opens into a panel; clubs waiting on the office come first
// and start open. What was Requests, Managers and Phones lives here.

// One state per club, in the order a club moves through them.
function clubState(c, m) {
  if (c.status === 'withdrawn') return ['Withdrawn', ''];
  if (!m) return ['No manager', 'warn'];
  if (!m.last_sign_in_at) return ['Invited', ''];
  if (!c.setup_at) return ['Setting up', ''];
  if (state.requests.some(r => r.club === c.code && r.status === 'pending')) return ['Waiting for approval', 'warn'];
  return ['Active', 'approved'];
}

const pendingOf = code => state.requests.find(r => r.club === code && r.status === 'pending');
const phoneOf = code => (state.phones || []).find(p => p.club === code)?.phone || '';

// The accounts linked to each club, the manager first (the office's own club can have both).
function accountsByClub() {
  const by = new Map();
  for (const a of [...state.accounts].sort((x, y) => (x.role === 'manager' ? 0 : 1) - (y.role === 'manager' ? 0 : 1))) {
    if (!a.club) continue;
    if (!by.has(a.club)) by.set(a.club, []);
    by.get(a.club).push(a);
  }
  return by;
}

const swatch = (label, v) => (v ? `<span><i style="background:${esc(safeColour(v))}"></i>${label} ${esc(v)}</span>` : '');

function accountState(a) {
  if (a.last_sign_in_at) return `Last signed in ${when(a.last_sign_in_at)}`;
  if (a.invited_at && !a.confirmed_at) return `Invited ${when(a.invited_at)}, not accepted yet`;
  return 'Never signed in';
}

function clubsView() {
  const by = accountsByClub();
  const rank = c => (pendingOf(c.code) ? 0 : c.status === 'withdrawn' ? 2 : 1);
  const list = [...state.clubs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const live = state.clubs.filter(c => c.status !== 'withdrawn');
  const phones = live.filter(c => phoneOf(c.code)).length;
  const waiting = state.requests.filter(r => r.status === 'pending').length;
  const loose = state.accounts.filter(a => !a.club);
  return `<h1>Clubs</h1>
    <div class="ed-bar">
      <p class="ed-hint"><b>${live.length}</b> club${live.length === 1 ? '' : 's'}${waiting ? ` · <b>${waiting}</b> waiting for you` : ''}${state.phones ? ` · <b>${phones}</b> of ${live.length} phone numbers` : ''}</p>
      <div class="ed-actions">
        <button class="btn ghost small" type="button" data-act="phones-copy"${phones ? '' : ' disabled'}>Copy phone numbers</button>
        <button class="btn ghost small" type="button" data-act="phones-csv"${phones ? '' : ' disabled'}>Phones CSV</button>
        <button class="btn ghost small" type="button" data-act="regs-csv"${state.requests.length ? '' : ' disabled'}>Registrations CSV</button>
      </div>
    </div>
    <p class="ed-msg" id="bar-msg" role="status"></p>
    <input class="ed-find" type="search" placeholder="Find a club or manager" aria-label="Find a club or manager" autocomplete="off">
    <ul class="ed-club-list">${list.map(c => clubItem(c, by.get(c.code) || [])).join('')}</ul>
    <p class="quiet ed-none" hidden>No club matches that.</p>
    <details class="ed-more"${state.open.has('add') ? ' open' : ''} data-key="add"><summary>Add clubs</summary>
      <form class="ed-invite" id="add-clubs">
        <label>One club per line <i>Name, or CODE, Name, or CODE, Name, Manager</i>
          <textarea name="lines" rows="5" required placeholder="Northside FC&#10;WST, Westgate United&#10;HRB, Harbour Town, Sam"></textarea></label>
        <p class="ed-hint">Codes (2 to 4 letters or numbers) and colours are picked for you if left out. Open the club afterwards to invite its manager; it sets itself up.</p>
        <div class="ed-actions"><button class="btn">Add clubs</button></div>
        <p class="ed-msg" role="status"></p>
      </form></details>
    ${loose.length ? `<details class="ed-more"${state.open.has('loose') ? ' open' : ''} data-key="loose"><summary>Accounts without a club (${loose.length})</summary>
      <ul class="ed-accts">${loose.map(a => accountRow(a, true)).join('')}</ul></details>` : ''}`;
}

function clubItem(c, accts) {
  const m = accts[0];
  const [label, kind] = clubState(c, m);
  const key = `club:${c.code}`, req = pendingOf(c.code);
  const subs = state.requests.filter(r => r.club === c.code);
  const phone = phoneOf(c.code);
  return `<li class="ed-club" style="--club:${esc(colourOf(c))}" data-code="${esc(c.code)}" data-find="${esc(`${c.name} ${c.code} ${c.manager_name || ''} ${m?.email || ''}`.toLowerCase())}">
    <details${state.open.has(key) ? ' open' : ''} data-key="${esc(key)}">
      <summary>${crest(c.crest_path, c.code)}
        <span class="who"><b>${esc(c.name)}</b><small>${esc(c.code)}${c.manager_name ? ` · ${esc(c.manager_name)}` : ''}${m ? ` · ${esc(m.email)}` : ''}</small></span>
        <span class="ed-pill ${kind}">${esc(label)}</span></summary>
      <div class="ed-panel">
        ${req ? `<section class="ed-sec">${requestCard(req)}</section>` : ''}
        <section class="ed-sec"><h3>Manager</h3>
          ${accts.length ? `<ul class="ed-accts">${accts.map(a => accountRow(a, false)).join('')}</ul>` : inviteForm(c)}
          <div class="ed-line" data-field="phone"><span>Phone</span><span class="ed-val">${phone ? `<a href="tel:${esc(phone.replace(/[^+\d]/g, ''))}">${esc(phone)}</a>` : '<span class="ed-pill warn">Not added yet</span>'}</span>${pen('phone', 'phone number')}<span class="ed-editor" hidden></span></div>
        </section>
        <section class="ed-sec"><h3>Club details</h3>
          <table class="ed-diff">
            ${FIELDS.map(f => `<tr data-field="${f.key}"><th>${f.label}</th><td><span class="ed-val">${f.show(c)}</span>${pen(f.key, f.label.toLowerCase())}<span class="ed-editor" hidden></span></td></tr>`).join('')}
            <tr><th>Set-up</th><td>${c.setup_at ? `Sent ${esc(when(c.setup_at))}` : 'Not sent yet'}</td></tr>
          </table>
          ${c.setup_at ? `<div class="ed-actions"><button class="btn ghost small" type="button" data-act="reopen">Set up again</button></div>
          <p class="ed-confirm" hidden>Show ${esc(c.name)} the setup wizard again?
            <button class="btn small" type="button" data-act="reopen-yes">Yes</button>
            <button class="btn ghost small" type="button" data-act="reopen-no">Cancel</button></p>` : ''}
          <p class="ed-msg" role="status"></p>
        </section>
        <section class="ed-sec"><h3>Registrations <span class="ed-count-dim">${subs.length}</span></h3>
          ${subs.length ? subs.map(r => submission(r, c)).join('') : '<p class="quiet">Nothing sent yet.</p>'}
        </section>
      </div>
    </details></li>`;
}

// ---------------------------------------------------------------- editing (0.16)
// A little pen next to everything in a club. It swaps the value for a small form; Save writes it, Cancel puts it back.
// The office can change anything directly (no approval step). The database checks everything again.

const pen = (key, label) => `<button class="ed-pen" type="button" data-edit="${key}" aria-label="Edit ${esc(label)}" title="Edit ${esc(label)}">✎</button>`;
const dash = '<span class="quiet">—</span>';
const crestPic = c => (c.crest_path ? `<img src="${esc(crestUrl(c.crest_path))}" alt="" class="ed-crest-pic">` : '<span class="quiet">None</span>');
const STATUS = { active: 'Active', pending: 'Pending', withdrawn: 'Withdrawn' };

// type: how it's edited. max/min: text length; optional: may be cleared.
const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', min: 2, max: 40, show: c => esc(c.name) },
  { key: 'short_name', label: 'Short name', type: 'text', max: 12, optional: true, show: c => (c.short_name ? esc(c.short_name) : dash) },
  { key: 'code', label: 'Code', type: 'code', show: c => esc(c.code) },
  { key: 'colour', label: 'Primary colour', type: 'colour', show: c => swatch('', c.colour) || dash },
  { key: 'colour2', label: 'Secondary colour', type: 'colour', optional: true, show: c => swatch('', c.colour2) || dash },
  { key: 'manager_name', label: 'Manager name', type: 'text', max: 40, optional: true, show: c => (c.manager_name ? esc(c.manager_name) : dash) },
  { key: 'stadium', label: 'Stadium', type: 'text', max: 40, optional: true, show: c => (c.stadium ? esc(c.stadium) : dash) },
  { key: 'motto', label: 'Motto', type: 'text', max: 80, optional: true, show: c => (c.motto ? esc(c.motto) : dash) },
  { key: 'crest_path', label: 'Crest', type: 'crest', show: crestPic },
  { key: 'status', label: 'Status', type: 'status', show: c => esc(STATUS[c.status] || c.status) },
];

// The form that replaces a value. `host` is the row (or account) holding .ed-val and .ed-editor.
function openEditor(host, spec) {
  const box = host.querySelector('.ed-editor'), val = host.querySelector('.ed-val'), penBtn = host.querySelector('.ed-pen');
  if (!box) return;
  document.querySelectorAll('.ed-editor:not([hidden]) [data-act="edit-cancel"]').forEach(b => b.click());   // one at a time
  const { type, value = '', max, optional, hint } = spec;
  let input;
  if (type === 'colour') {
    const set = /^#[0-9a-f]{6}$/i.test(value);
    input = `<input type="color" name="v" value="${set ? esc(value) : '#64b5f6'}" aria-label="${esc(spec.label)}">`
      + (optional ? `<label class="ed-none-opt"><input type="checkbox" name="none"${set ? '' : ' checked'}> None</label>` : '');
  } else if (type === 'crest') {
    input = '<input type="file" name="v" accept="image/*" required aria-label="Crest picture"><img class="ed-crest-pic ed-preview-pic" alt="" hidden>';
  } else if (type === 'status') {
    input = `<select name="v" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${k === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  } else {
    input = `<input name="v" value="${esc(value)}" ${max ? `maxlength="${max}"` : ''} ${optional ? '' : 'required'} autocomplete="off" aria-label="${esc(spec.label)}"${type === 'code' ? ' style="text-transform:uppercase;width:6em"' : ''}>`;
  }
  box.innerHTML = `<form class="ed-inline" data-kind="${esc(spec.kind)}" data-fk="${esc(spec.field)}">${input}
    <button class="btn small">Save</button>
    <button class="btn ghost small" type="button" data-act="edit-cancel">Cancel</button>
    ${hint ? `<small class="ed-hint-inline">${esc(hint)}</small>` : ''}<span class="ed-msg" role="status"></span></form>`;
  box.hidden = false; if (val) val.hidden = true; if (penBtn) penBtn.hidden = true;
  box.querySelector('input:not([type=checkbox]), select')?.focus();
}
function closeEditor(host) {
  const box = host.querySelector('.ed-editor');
  box.hidden = true; box.innerHTML = '';
  const val = host.querySelector('.ed-val'); if (val) val.hidden = false;
  const penBtn = host.querySelector('.ed-pen'); if (penBtn) penBtn.hidden = false;
}

const clubOf = el => state.clubs.find(c => c.code === el.closest('.ed-club').dataset.code);

function startClubEdit(btn) {
  const host = btn.closest('[data-field]'), c = clubOf(btn), key = btn.dataset.edit;
  if (key === 'phone') return openEditor(host, { kind: 'phone', field: 'phone', type: 'text', max: 20, optional: true, label: 'Phone number', value: phoneOf(c.code), hint: 'Leave empty to remove it.' });
  const f = FIELDS.find(x => x.key === key);
  openEditor(host, {
    kind: 'club', field: key, type: f.type, max: f.max, optional: f.optional, label: f.label,
    value: c[key] || '',
    hint: key === 'code' ? 'Changes everywhere (fixtures, players, line-ups). Not possible once the club has results.'
      : key === 'colour' ? 'The whole page of this club is this colour.' : '',
  });
}

function startAcctEdit(btn) {
  const li = btn.closest('.ed-acct'), a = state.accounts.find(x => x.id === li.dataset.id), key = btn.dataset.editAcct;
  openEditor(li.querySelector(`[data-acct-field="${key}"]`), key === 'email'
    ? { kind: 'acct', field: 'email', type: 'text', max: 120, label: 'Email', value: a.email, hint: 'They sign in with the new address straight away.' }
    : { kind: 'acct', field: 'name', type: 'text', max: 40, optional: true, label: 'Name', value: a.display_name || '' });
}

const HEX = /^#[0-9a-f]{6}$/i;

// Works out the change a club form asks for, or throws a readable message.
async function clubPatch(c, key, form, submitter) {
  const f = FIELDS.find(x => x.key === key), v = form.elements.v;
  const text = () => String(v.value || '').trim().replace(/\s+/g, ' ');
  if (f.type === 'text') {
    const t = text();
    if (!t && !f.optional) throw new Error(`${f.label} can't be empty.`);
    if (t && f.min && t.length < f.min) throw new Error(`${f.label} needs at least ${f.min} characters.`);
    return { [key]: t || null };
  }
  if (f.type === 'code') {
    const t = text().toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(t)) throw new Error('A code is 2 to 4 letters or numbers.');
    if (t === c.code) return {};
    if (state.clubs.some(x => x.code === t)) throw new Error('That code is taken.');
    const used = (await (await db()).from('fixtures').select('id').or(`home.eq.${c.code},away.eq.${c.code}`).limit(2000)).data || [];
    const played = used.length ? (await (await db()).from('results').select('fixture').in('fixture', used.map(x => x.id)).limit(1)).data || [] : [];
    if (played.length) throw new Error('This club has results, and they record its code, so it can’t change now.');
    return { code: t };
  }
  if (f.type === 'colour') {
    const none = form.elements.none?.checked, hex = none ? null : String(v.value).toLowerCase();
    if (!none && !HEX.test(hex)) throw new Error('Pick a colour.');
    return { [key]: hex };
  }
  if (f.type === 'status') return { status: v.value };
  if (f.type === 'crest') {
    const { prepareCrest, uploadCrest } = await import('./crest.js');
    const { blob } = await prepareCrest(v.files[0]);
    return { crest_path: await uploadCrest(blob, c.code) };
  }
  throw new Error('That can’t be changed here.');
}

async function saveInline(form, submitter) {
  const msg = form.querySelector('.ed-msg'), host = form.closest('[data-field], [data-acct-field]');
  const buttons = form.querySelectorAll('button');
  const say = t => { msg.textContent = t; };
  buttons.forEach(b => { b.disabled = true; }); say('Saving…');
  try {
    const c = db(), kind = form.dataset.kind, key = form.dataset.fk;
    if (kind === 'club' || kind === 'phone') {
      const club = clubOf(form);
      if (kind === 'phone') {
        const { error } = await (await c).rpc('office_set_phone', { p_club: club.code, p_phone: form.elements.v.value });
        if (error) throw error;
      } else {
        const oldCode = club.code, patch = await clubPatch(club, key, form, submitter);
        if (Object.keys(patch).length) {
          const { data, error } = await (await c).from('clubs').update(patch).eq('code', oldCode).select('code');
          if (error) throw error;
          if (!data?.length) throw new Error('That didn’t save. Try again.');
          if (patch.code && patch.code !== oldCode) {   // keep this club's panel open under its new code
            if (state.open.delete(`club:${oldCode}`)) state.open.add(`club:${patch.code}`);
          }
        }
      }
    } else {
      const li = form.closest('.ed-acct'), id = li.dataset.id;
      if (key === 'name') {
        const t = String(form.elements.v.value || '').trim().replace(/\s+/g, ' ') || null;
        const { error } = await (await c).from('profiles').update({ display_name: t }).eq('id', id);
        if (error) throw error;
      } else {
        const email = String(form.elements.v.value || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email doesn’t look right.');
        const { data, error } = await (await c).functions.invoke('change-email', { body: { id, email } });
        let problem = data?.error;
        if (error) problem = (await error.context?.json?.().catch(() => null))?.error || 'The email didn’t change. Try again.';
        if (problem) throw new Error(problem);
      }
    }
    await refresh();
  } catch (e) {
    say(e.message && e.message.length < 200 && !/violates|syntax|relation|column|permission denied/i.test(e.message) ? explain(e) : 'That didn’t save. Try again.');
    buttons.forEach(b => { b.disabled = false; });
  }
}

// One account in a club's Manager section, or in "Accounts without a club" (loose), where it can be given a club.
function accountRow(a, loose) {
  const taken = new Set(state.accounts.filter(x => x.club && x.role === 'manager').map(x => x.club));
  const options = `<option value="">Pick a club</option>` + state.clubs.map(c => {
    const off = a.role === 'manager' && taken.has(c.code);
    return `<option value="${esc(c.code)}" ${off ? 'disabled' : ''}>${esc(c.name)}${off ? ' (has a manager)' : ''}</option>`;
  }).join('');
  return `<li class="ed-acct" data-id="${esc(a.id)}" data-email="${esc(a.email)}">
    <span class="who">
      <span class="ed-row2" data-acct-field="name"><b class="ed-val">${esc(a.display_name || a.email)}</b><button class="ed-pen" type="button" data-edit-acct="name" aria-label="Edit name" title="Edit name">✎</button><span class="ed-editor" hidden></span></span>
      <span class="ed-row2" data-acct-field="email"><small class="ed-val">${esc(a.email)}${a.role === 'office' ? ' · league office' : ''}</small><button class="ed-pen" type="button" data-edit-acct="email" aria-label="Edit email" title="Edit email">✎</button><span class="ed-editor" hidden></span></span>
      <small>${esc(accountState(a))}</small></span>
    ${loose ? `<label class="sr-only" for="club-${esc(a.id)}">Club</label><select id="club-${esc(a.id)}" data-act="link">${options}</select>` : ''}
    <span class="ed-actions"><button class="btn ghost small" data-act="reset" type="button">Send password link</button>
      ${loose ? '' : '<button class="btn ghost small" data-act="unlink" type="button">Take off club</button>'}</span>
    <p class="ed-confirm" hidden><span></span>
      <button class="btn small" type="button" data-act="link-yes">Yes</button>
      <button class="btn ghost small" type="button" data-act="link-no">Cancel</button></p>
    <p class="ed-msg" role="status"></p></li>`;
}

function inviteForm(c) {
  return `<form class="ed-invite ed-invite-club" data-club="${esc(c.code)}">
    <p class="ed-hint">No manager yet. They get an email to set a password, then set the club up themselves.</p>
    <div class="ed-fields">
      <label>Email<input name="email" type="email" required autocomplete="off"></label>
      <label>Name <i>Optional</i><input name="name" maxlength="40" autocomplete="off"></label>
    </div>
    <div class="ed-actions"><button class="btn small">Send invite</button></div>
    <p class="ed-msg" role="status"></p></form>`;
}

// ---------------------------------------------------------------- registrations

// Everything one submission held. Newer ones carry a full snapshot (what was typed, and the club's colours and details
// at that moment); older ones only the columns, so those say what wasn't kept.
function submissionFields(r) {
  const s = r.snapshot || {};
  const v = k => s[k] ?? r[k] ?? '';
  return {
    name: v('name'), short_name: v('short_name'), code: v('code'), crest_path: v('crest_path'), colour: s.colour || '', colour2: s.colour2 || '',
    manager_name: s.manager_name || '', stadium: s.stadium || '', motto: s.motto || '', notes: r.notes || '',
    email: s.email || '', full: Boolean(r.snapshot),
  };
}
const OUTCOME = { pending: 'Waiting', approved: 'Approved', returned: 'Sent back' };

function submission(r, c) {
  const f = submissionFields(r), key = `sub:${r.id}`;
  const row = (label, value) => (value ? `<tr><th>${label}</th><td>${value}</td></tr>` : '');
  return `<details class="ed-sub"${state.open.has(key) ? ' open' : ''} data-key="${key}">
    <summary><b>${r.kind === 'setup' ? 'Set-up' : 'Change'}</b> <small>${esc(when(r.created_at))}</small>
      <span class="ed-pill ${r.status === 'approved' ? 'approved' : r.status === 'pending' ? 'warn' : ''}">${OUTCOME[r.status] || esc(r.status)}</span></summary>
    <table class="ed-diff">
      ${row('Name', esc(f.name))}${row('Short name', esc(f.short_name))}${row('Code', esc(f.code))}
      ${f.crest_path ? `<tr><th>Crest</th><td>${crest(f.crest_path, f.code)}</td></tr>` : ''}
      ${f.colour || f.colour2 ? `<tr><th>Colours</th><td class="ed-swatches">${swatch('Primary', f.colour)}${swatch('Secondary', f.colour2)}</td></tr>` : ''}
      ${row('Manager', esc(f.manager_name))}${row('Stadium', esc(f.stadium))}${row('Motto', esc(f.motto))}
      ${row('Account', esc(f.email))}
      ${f.notes ? `<tr><th>Notes</th><td><blockquote>${esc(f.notes)}</blockquote></td></tr>` : ''}
      ${r.reviewed_at ? row('Answered', `${esc(when(r.reviewed_at))}${r.office_note ? `: “${esc(r.office_note)}”` : ''}`) : ''}
    </table>
    ${f.full ? '' : '<p class="ed-hint">Colours, manager, stadium and motto weren’t kept for submissions sent before 0.15.</p>'}
  </details>`;
}

// ---------------------------------------------------------------- approving

function requestCard(r) {
  const c = state.clubs.find(x => x.code === r.club) || { code: r.club };
  const next = { name: r.name ?? c.name, short_name: r.short_name ?? c.short_name, code: r.code ?? c.code, crest_path: r.crest_path ?? c.crest_path };
  const row = (label, from, to, changed) => `<tr class="${changed ? 'changed' : ''}"><th>${label}</th>
    <td>${changed && from ? `<s>${esc(from)}</s> ` : ''}${esc(to || '—')}</td></tr>`;
  return `<article class="ed-request" data-id="${r.id}">
    <h3>${r.kind === 'setup' ? 'Waiting for approval: setting up the club' : 'Waiting for approval: a change'} <small>${esc(when(r.created_at))}</small></h3>
    <table class="ed-diff">
      ${row('Name', c.name, next.name, r.name != null && r.name !== c.name)}
      ${row('Short name', c.short_name, next.short_name, r.short_name != null && r.short_name !== c.short_name)}
      ${row('Code', c.code, next.code, r.code != null && r.code !== c.code)}
      <tr class="${r.crest_path ? 'changed' : ''}"><th>Crest</th><td class="ed-crests">
        ${r.crest_path && c.crest_path ? `${crest(c.crest_path, c.code, 'was')} <span aria-hidden="true">→</span>` : ''}
        ${crest(next.crest_path, next.code)} ${r.crest_path ? '' : '<small>no change</small>'}</td></tr>
    </table>
    ${r.notes ? `<blockquote>${esc(r.notes)}</blockquote>` : ''}
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

// ---------------------------------------------------------------- adding clubs

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

async function reopen(sec) {
  const li = sec.closest('.ed-club');
  sec.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const { error } = await (await db()).rpc('reopen_club_setup', { p_code: li.dataset.code });
  if (error) {
    sec.querySelector('.ed-msg').textContent = explain(error);
    sec.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return;
  }
  await refresh();
}

// ---------------------------------------------------------------- exports

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Phones: one row per club still in the league, with who to call.
function phoneRows() {
  const email = new Map(state.accounts.filter(a => a.club && a.role === 'manager').map(a => [a.club, a.email]));
  return state.clubs.filter(c => c.status !== 'withdrawn' && phoneOf(c.code))
    .map(c => ({ name: c.name, code: c.code, manager: c.manager_name || '', email: email.get(c.code) || '', phone: phoneOf(c.code) }));
}

async function exportData(kind) {
  const msg = document.getElementById('bar-msg');
  if (kind === 'phones-copy') {
    const rows = phoneRows();
    const text = rows.map(r => `${r.name}${r.manager ? ` (${r.manager})` : ''}: ${r.phone}`).join('\n');
    try { await navigator.clipboard.writeText(text); msg.textContent = `Copied ${rows.length} number${rows.length === 1 ? '' : 's'}.`; }
    catch { msg.textContent = 'Couldn’t copy here. Use Phones CSV instead.'; }
  } else if (kind === 'phones-csv') {
    const rows = phoneRows();
    download('vleague-manager-phones.csv', ['Club,Code,Manager,Email,Phone', ...rows.map(r => [r.name, r.code, r.manager, r.email, r.phone].map(cell).join(','))].join('\r\n'), 'text/csv');
    msg.textContent = `Downloaded ${rows.length} number${rows.length === 1 ? '' : 's'}.`;
  } else {
    const head = ['Club', 'Code now', 'Kind', 'Sent', 'Outcome', 'Answered', 'Office note', 'Name', 'Short name', 'Code', 'Primary', 'Secondary', 'Manager', 'Stadium', 'Motto', 'Notes', 'Account'];
    const rows = state.requests.map(r => {
      const f = submissionFields(r), c = state.clubs.find(x => x.code === r.club);
      return [c?.name || r.club, r.club, r.kind, r.created_at, r.status, r.reviewed_at || '', r.office_note || '', f.name, f.short_name, f.code, f.colour, f.colour2, f.manager_name, f.stadium, f.motto, f.notes, f.email].map(cell).join(',');
    });
    download('vleague-registrations.csv', [head.join(','), ...rows].join('\r\n'), 'text/csv');
    msg.textContent = `Downloaded ${rows.length} submission${rows.length === 1 ? '' : 's'}.`;
  }
}

// ---------------------------------------------------------------- managers

async function invite(form) {
  const msg = form.querySelector('.ed-msg');
  const data = { ...Object.fromEntries(new FormData(form)), club: form.dataset.club };
  form.querySelector('button').disabled = true;
  msg.textContent = 'Sending…';
  const { data: res, error } = await (await db()).functions.invoke('invite-manager', { body: data });
  let problem = res?.error;
  if (error) problem = (await error.context?.json?.().catch(() => null))?.error || 'The invite didn’t send. Try again.';
  form.querySelector('button').disabled = false;
  if (problem) { msg.textContent = explain(problem); return; }
  await refresh();
  // The page redraws after an invite; say it went, on the club's own panel.
  const again = document.querySelector(`.ed-club[data-code="${CSS.escape(data.club)}"] .ed-accts .ed-msg`);
  if (again) again.textContent = `Invite sent to ${data.email}.`;
}

// Moving an account to a club, or taking it off its club, asks first: one mis-tap would otherwise cut a manager off.
function askLink(li, to) {
  const club = state.clubs.find(c => c.code === to);
  const who = li.querySelector('.who b').textContent;
  const box = li.querySelector('.ed-confirm');
  box.dataset.to = to || '';
  box.querySelector('span').textContent = club ? `Move ${who} to ${club.name}?` : `Take ${who} off their club?`;
  box.hidden = false;
  li.querySelector('.ed-msg').textContent = '';
}

async function link(li, yes) {
  const box = li.querySelector('.ed-confirm'), msg = li.querySelector('.ed-msg'), select = li.querySelector('select');
  box.hidden = true;
  if (!yes) { if (select) select.value = ''; return; }
  const { error } = await (await db()).from('profiles').update({ club: box.dataset.to || null }).eq('id', li.dataset.id);
  if (error) { msg.textContent = explain(error); return; }
  await refresh();
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
  const penBtn = e.target.closest('button[data-edit], button[data-edit-acct]');
  if (penBtn) return penBtn.dataset.edit ? startClubEdit(penBtn) : startAcctEdit(penBtn);
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const card = b.closest('.ed-request');
  if (act === 'approve') review(card, true);
  if (act === 'return') { card.querySelector('.ed-return').hidden = false; card.querySelector('textarea').focus(); }
  if (act === 'cancel') card.querySelector('.ed-return').hidden = true;
  if (act === 'reopen') b.closest('.ed-sec').querySelector('.ed-confirm').hidden = false;
  if (act === 'reopen-no') b.closest('.ed-confirm').hidden = true;
  if (act === 'reopen-yes') reopen(b.closest('.ed-sec'));
  if (act === 'dl-save') {
    const li = b.closest('li');
    saveDeadline(Number(li.dataset.week), li.querySelector('input').value, li.querySelector('.ed-msg'));
  }
  if (act === 'phones-copy' || act === 'phones-csv' || act === 'regs-csv') exportData(act);
  if (act === 'dl-remove') removeDeadline(b.closest('li'));
  if (act === 'dl-all') setAllDeadlines(b);
  if (act === 'edit-cancel') closeEditor(b.closest('[data-field], [data-acct-field]'));
  if (act === 'unlink') askLink(b.closest('.ed-acct'), '');
  if (act === 'link-yes') link(b.closest('.ed-acct'), true);
  if (act === 'link-no') link(b.closest('.ed-acct'), false);
  if (act === 'reset') {
    const li = b.closest('.ed-acct');
    b.disabled = true;
    sendPasswordReset(li.dataset.email)
      .then(() => { li.querySelector('.ed-msg').textContent = 'Password link sent.'; })
      .catch(err => { li.querySelector('.ed-msg').textContent = explain(err); b.disabled = false; });
  }
});
main.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.classList.contains('ed-invite-club')) return invite(e.target);
  if (e.target.classList.contains('ed-inline')) return saveInline(e.target, e.submitter);
  if (e.target.id === 'add-clubs') return addClubs(e.target);
  if (e.target.id === 'dl-add') return saveDeadline(Number(e.target.week.value), e.target.at.value, e.target.querySelector('.ed-msg'));
  if (e.target.classList.contains('ed-return')) review(e.target.closest('.ed-request'), false, e.target.note.value);
});
main.addEventListener('change', e => {
  if (e.target.dataset.act === 'link' && e.target.value) askLink(e.target.closest('.ed-acct'), e.target.value);
  if (e.target.dataset.act === 'digest') saveDigest(e.target);
});
// Remember what's open, so a redraw (after approving, inviting...) leaves the panels as they were. `toggle` doesn't bubble.
main.addEventListener('toggle', e => {
  const k = e.target.dataset?.key;
  if (k) e.target.open ? state.open.add(k) : state.open.delete(k);
}, true);
// Find a club: hides the rows that don't match; nothing is redrawn.
main.addEventListener('input', e => {
  if (!e.target.classList.contains('ed-find')) return;
  const q = e.target.value.trim().toLowerCase();
  let shown = 0;
  main.querySelectorAll('.ed-club').forEach(li => { const hit = !q || li.dataset.find.includes(q); li.hidden = !hit; shown += hit; });
  main.querySelector('.ed-none').hidden = shown > 0;
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
