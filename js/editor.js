// The league office's Editor (0.4): club requests to approve or send back, the clubs, and manager accounts
// (invite, link to a club, send a password link). Fixtures, results, Simulate and news move in later (docs/PLAN.md).
// The database checks everything again (supabase/migrations/0003_club_setup.sql); this page only asks.
import { enter, clubs, chrome, esc, safeColour, crestUrl } from './member.js';
import { db, sendPasswordReset } from './auth.js';
import { accentFor } from './club-colour.js';

chrome();
const me = await enter('editor.html');
const main = document.getElementById('main');
const TABS = { requests: 'Requests', clubs: 'Clubs', managers: 'Managers' };
let state = { clubs: [], requests: [], accounts: [] };

// The accent a club shows: the one saved with its colours, or worked out the same way the wizard does.
const accentOf = c => safeColour(c.accent || accentFor(c.colour, c.colour2));

const when = t => (t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const crest = (path, code, cls = '') => (path
  ? `<img class="${cls}" src="${esc(crestUrl(path))}" alt="">`
  : `<span class="no-crest ${cls}">${esc(code || '?')}</span>`);

async function load() {
  const c = await db();
  const [list, req, acc] = await Promise.all([
    clubs(),
    c.from('club_requests').select('*').order('created_at', { ascending: false }).limit(60),
    c.rpc('office_accounts'),
  ]);
  if (req.error || acc.error) throw new Error((req.error || acc.error).message);
  state = { clubs: list, requests: req.data || [], accounts: acc.data || [] };
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
    <section id="view">${{ requests: requestsView, clubs: clubsView, managers: managersView }[t]()}</section>`;
}

// ---------------------------------------------------------------- requests

function requestsView() {
  const pending = state.requests.filter(r => r.status === 'pending');
  const done = state.requests.filter(r => r.status !== 'pending').slice(0, 12);
  return `<h1>Requests</h1>
    ${pending.length ? pending.map(requestCard).join('') : '<p class="quiet">Nothing waiting. New clubs and changes to a name, code or crest show up here.</p>'}
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
    msg.textContent = error.message;
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return;
  }
  await refresh();
}

// ---------------------------------------------------------------- clubs

function clubsView() {
  // The office's own club counts too, so a manager account wins over the office if both are linked.
  const managers = new Map(state.accounts.filter(a => a.club).sort((a, b) => (a.role === 'manager') - (b.role === 'manager'))
    .map(a => [a.club, a]));
  const status = { active: 'Active', pending: 'Waiting for a manager', withdrawn: 'Withdrawn' };
  return `<h1>Clubs</h1>
    <p class="quiet">Every manager sets up their club once. “Set up again” shows them the wizard at their next sign-in and
      starts the process again.</p>
    <ul class="club-rows ed-clubs">${state.clubs.map(c => {
    const m = managers.get(c.code);
    return `<li style="--club:${esc(accentOf(c))}" data-code="${esc(c.code)}">
      ${crest(c.crest_path, c.code)}
      <span class="who"><b>${esc(c.name)}</b><small>${esc(c.code)}${c.manager_name ? `, ${esc(c.manager_name)}` : ''}</small></span>
      <span class="state status">${esc(status[c.status] || c.status)}</span>
      <span class="state ${m ? 'ok' : ''}">${m ? esc(m.email) : 'No manager account'}</span>
      <span class="ed-setup">${c.setup_at
        ? `<button class="btn ghost small" type="button" data-act="reopen">Set up again</button>`
        : '<span class="state">Set-up due</span>'}</span>
      <span class="ed-confirm" hidden>Show ${esc(c.name)} the wizard again?
        <button class="btn small" type="button" data-act="reopen-yes">Yes</button>
        <button class="btn ghost small" type="button" data-act="reopen-no">Cancel</button></span>
      <p class="ed-msg" role="status"></p>
    </li>`;
  }).join('')}</ul>`;
}

async function reopen(li) {
  li.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const { error } = await (await db()).rpc('reopen_club_setup', { p_code: li.dataset.code });
  if (error) {
    li.querySelector('.ed-msg').textContent = error.message;
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
  const clubOptions = (selected, forInvite) => `<option value="">${forInvite ? 'Pick a club' : 'No club'}</option>` +
    state.clubs.map(c => `<option value="${esc(c.code)}" ${c.code === selected ? 'selected' : ''}
      ${forInvite && taken.has(c.code) ? 'disabled' : ''}>${esc(c.name)}${forInvite && taken.has(c.code) ? ' (has a manager)' : ''}</option>`).join('');
  return `<h1>Managers</h1>
    <form class="ed-invite" id="invite">
      <h2>Invite a manager</h2>
      <p class="quiet">They get an email from vLeague, choose a password, and set up their club.</p>
      <div class="ed-fields">
        <label>Email<input name="email" type="email" required autocomplete="off"></label>
        <label>Name<input name="name" maxlength="40" autocomplete="off"></label>
        <label>Club<select name="club" required>${clubOptions('', true)}</select></label>
      </div>
      <div class="ed-actions"><button class="btn">Send invite</button></div>
      <p class="ed-msg" role="status"></p>
    </form>
    <ul class="ed-accounts">${state.accounts.map(a => `<li data-id="${esc(a.id)}" data-email="${esc(a.email)}">
      <span class="who"><b>${esc(a.display_name || a.email)}</b><small>${esc(a.email)}${a.role === 'office' ? ' · league office' : ''}</small>
        <small>${esc(accountState(a))}</small></span>
      <label class="sr-only" for="club-${esc(a.id)}">Club</label>
      <select id="club-${esc(a.id)}" data-act="link">${clubOptions(a.club, false)}</select>
      <button class="btn ghost small" data-act="reset" type="button">Send password link</button>
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
  if (problem) { msg.textContent = problem; return; }
  await refresh();
  const again = document.querySelector('#invite .ed-msg');
  if (again) again.textContent = `Invite sent to ${data.email}.`;
}

async function link(li, club) {
  const msg = li.querySelector('.ed-msg');
  const clash = club && state.accounts.find(a => a.club === club && a.role === 'manager' && a.id !== li.dataset.id);
  if (clash) msg.textContent = `Note: ${clash.email} is also linked to this club.`;
  const { error } = await (await db()).from('profiles').update({ club: club || null }).eq('id', li.dataset.id);
  if (error) { msg.textContent = error.message; return; }
  const a = state.accounts.find(x => x.id === li.dataset.id);
  if (a) a.club = club || null;
  if (!clash) msg.textContent = club ? 'Linked.' : 'Unlinked.';
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
  if (b.dataset.act === 'reset') {
    const li = b.closest('li');
    b.disabled = true;
    sendPasswordReset(li.dataset.email)
      .then(() => { li.querySelector('.ed-msg').textContent = 'Password link sent.'; })
      .catch(err => { li.querySelector('.ed-msg').textContent = err.message; b.disabled = false; });
  }
});
main.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'invite') return invite(e.target);
  if (e.target.classList.contains('ed-return')) review(e.target.closest('.ed-request'), false, e.target.note.value);
});
main.addEventListener('change', e => {
  if (e.target.dataset.act === 'link') link(e.target.closest('li'), e.target.value);
});
addEventListener('hashchange', () => { if (state.clubs.length) render(); });

async function refresh() {
  try {
    await load();
    render();
  } catch (e) {
    main.innerHTML = `<p class="quiet">${esc(e.message)} <a href="editor.html">Try again</a></p>`;
  }
  main.setAttribute('aria-busy', 'false');
}

if (me) {
  document.getElementById('to-home').hidden = !me.profile?.club;
  await refresh();
}
