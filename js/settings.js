// Settings (WR-43), built from the league page's own pieces: the Stats tab's heading with the site toggle (Account / Emails / Display, kept in
// the address), cards whose rows are split by grey strips like the Fixtures day strips, rows that open a menu or flip a switch (css/menus.css,
// shared with My club), and beside them "Your vLeague": your last and next match drawn by the Fixtures tab's own row, so hiding results or
// changing the clock shows straight away what it does. Synced settings go to Supabase through prefs.js; the device ones (theme, text size,
// motion) stay in this browser and apply at once.
import { enterPlace, styleCards } from './shell.js';
import { esc, crestUrl } from './member.js';
import { db, signOut } from './auth.js';
import { prefs, setPref, device, setDevice, setDisplayName, sendTestEmail } from './prefs.js';
import { rowHtml, dayLabel } from './league-fixtures.js';
import { status, kickoff, byKickoff, logoUrl } from './dashboard-data.js';
import { crest as crestHtml } from './places.js';
import { initialsCrest } from './stat-card.js';

const $ = (s, r = document) => r.querySelector(s);
const TABS = [['account', 'Account'], ['emails', 'Emails'], ['display', 'Display']];
const CHOICES = {
  'email.deadline': [['24h', '24 h before'], ['3h', '3 h before'], ['both', '24 h and 3 h before'], ['off', 'Off']],
  'email.draft': [['both', 'Your turn, and a warning'], ['turn', 'Your turn only'], ['off', 'Off']],
  theme: [['dark', 'Dark'], ['light', 'Light'], ['system', 'Same as this device']],
  text: [['100', 'Default'], ['112', 'Large'], ['125', 'Larger'], ['140', 'Largest']],
  motion: [['system', 'Same as this device'], ['reduce', 'Reduced']],
  clock: [['12', '12-hour'], ['24', '24-hour']],
};
const DEVICE_KEYS = new Set(['theme', 'text', 'motion']);
const labelOf = (key, v) => (CHOICES[key].find(([k]) => k === String(v)) || CHOICES[key][0])[1];
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ctx = await enterPlace('settings');
if (ctx) {
  const { main, club, me, season } = ctx;
  const p = await prefs();
  let dev = device();
  let email = me.user.email || '';
  let name = me.profile?.display_name || '';
  let tab = TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'account';
  main.classList.add('settings-main');

  const initials = n => (n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  const teamOf = code => season?.teams.find(t => t.code === code) || { code, name: code, colour: '#64748b' };
  const crestOf = (code, px) => (teamOf(code).crest_path || !logoUrl(code).startsWith('data:') ? crestHtml(teamOf(code), px) : initialsCrest(teamOf(code), code, px));
  const myCrest = club?.crest_path ? crestUrl(club.crest_path) : club?.code ? logoUrl(club.code) : '';

  main.innerHTML = `<div class="set">
    <header class="sc-head set-head"><h1 class="sc-title">Settings</h1>
      <nav class="sc-toggle set-tabs" aria-label="Settings">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav></header>
    <div class="set-cols">
      <div class="set-main" id="panel"></div>
      <section class="lg-card set-view" aria-labelledby="view-t">
        <div class="lg-card-head"><h2 id="view-t">Your vLeague</h2></div>
        <div class="fx-card set-fx" id="view"></div>
      </section>
    </div>
  </div>
  <dialog tabindex="-1" class="dlg" id="dlg-pick" aria-labelledby="dlg-pick-t">
    <div class="dlg-head"><h2 id="dlg-pick-t"></h2><button type="button" class="dlg-done dlg-quiet" data-close>Cancel</button></div>
    <div class="dlg-body"><ul class="pk" id="pick-list"></ul></div>
  </dialog>
  <dialog tabindex="-1" class="dlg" id="dlg-text" aria-labelledby="dlg-text-t">
    <form class="set-form" id="text-form" novalidate>
      <div class="dlg-head"><h2 id="dlg-text-t"></h2><button type="button" class="dlg-done dlg-quiet" data-close>Cancel</button></div>
      <div class="dlg-body"><label class="set-flabel" for="text-in" id="text-label"></label><input class="set-field" id="text-in">
        <p class="set-note" id="text-note"></p><button type="submit" class="dlg-done set-go" id="text-go"></button></div>
    </form>
  </dialog>`;

  // ----- the open tab: cards of rows, grouped under strips -----
  // row kinds: menu (opens the choice menu), switch (flips on the spot), text (opens the field menu), act (does something now)
  const strip = (title, note = '') => ({ strip: title, note });
  const groupsFor = () => ({
    account: [
      { title: 'Sign-in', rows: [
        { kind: 'text', id: 'name', label: 'Name', value: name || 'Not set' },
        { kind: 'text', id: 'email', label: 'Email', value: email || 'Not set' },
        { kind: 'text', id: 'password', label: 'Password', value: 'Change' },
        strip('Sessions'),
        { kind: 'act', id: 'signout', label: 'Sign out', value: 'This device' },
        { kind: 'act', id: 'signout-all', label: 'Sign out everywhere', value: 'Every device', warn: true },
      ] },
    ],
    emails: [
      { title: 'Emails', note: email, rows: [
        strip('Matches'),
        { kind: 'menu', id: 'email.deadline', label: 'Line-up reminder', value: labelOf('email.deadline', p.email.deadline) },
        { kind: 'switch', id: 'email.lineups_out', label: 'Line-ups are out', on: p.email.lineups_out },
        ...(club ? [strip('Draft'), { kind: 'menu', id: 'email.draft', label: 'Draft picks', value: labelOf('email.draft', p.email.draft) }] : []),
        strip('League'),
        { kind: 'switch', id: 'email.weekly', label: 'Weekly round-up', on: p.email.weekly },
        club && { kind: 'switch', id: 'email.news', label: 'League news', on: p.email.news },
        club && { kind: 'switch', id: 'email.sent_back', label: 'Club changes sent back', on: p.email.sent_back },
        { kind: 'act', id: 'test', label: 'Send a test email', value: 'Send' },
      ] },
    ],
    display: [
      { title: 'Display', rows: [
        strip('This device', 'Only here'),
        { kind: 'menu', id: 'theme', label: 'Theme', value: labelOf('theme', dev.theme) },
        { kind: 'menu', id: 'text', label: 'Text size', value: labelOf('text', dev.text) },
        { kind: 'menu', id: 'motion', label: 'Motion', value: labelOf('motion', dev.motion) },
        strip('Every device', 'Follows your account'),
        { kind: 'menu', id: 'clock', label: 'Clock', value: labelOf('clock', p.clock) },
        { kind: 'switch', id: 'spoilers', label: 'Hide results', on: p.spoilers },
      ] },
    ],
  })[tab];
  const rowsFor = () => groupsFor().flatMap(g => g.rows).filter(r => r && !r.strip);

  const rowHtmlOf = r => {
    if (r.strip) return `<li class="set-strip"><h3>${esc(r.strip)}</h3>${r.note ? `<span>${esc(r.note)}</span>` : ''}</li>`;
    if (r.kind === 'switch') return `<li><button type="button" class="fm-row set-sw" role="switch" aria-checked="${Boolean(r.on)}" data-sw="${esc(r.id)}"><span class="fm-k">${esc(r.label)}</span><i class="set-switch" aria-hidden="true"></i></button></li>`;
    return `<li><button type="button" class="fm-row${r.kind === 'act' ? ' set-act' : ''}${r.warn ? ' set-warn' : ''}" data-${r.kind}="${esc(r.id)}"><span class="fm-k">${esc(r.label)}</span><span class="fm-v">${esc(r.value)}</span></button></li>`;
  };
  const idCard = () => `<section class="lg-card set-id" aria-label="Your account">
      ${club ? `<span class="set-ghost" aria-hidden="true">${esc(club.short_name || club.name)}</span>` : ''}
      <span class="set-av" aria-hidden="true"><b>${esc(initials(name))}</b>${myCrest ? `<img src="${esc(myCrest)}" alt="" onerror="this.remove()">` : ''}</span>
      <div class="set-who"><p class="set-name" id="me-name">${esc(name || 'Your account')}</p><p class="set-sub">${club ? `Manager, ${esc(club.name)}` : 'No club yet'}</p></div>
    </section>`;

  function drawPanel() {
    const panel = $('#panel', main);
    panel.innerHTML = (tab === 'account' ? idCard() : '') + groupsFor().map(g => `<section class="lg-card set-card" aria-labelledby="g-${tab}">
        <div class="lg-card-head"><h2 id="g-${tab}">${esc(g.title)}</h2>${g.note ? `<span class="set-cnote">${esc(g.note)}</span>` : ''}</div>
        <ul class="fm-rows set-rows">${g.rows.filter(Boolean).map(rowHtmlOf).join('')}</ul>
        <p class="ts-save set-save" aria-live="polite"><span></span></p>
      </section>`).join('');
    styleCards();
  }
  function drawTabs() {
    main.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab));
    drawPanel();
  }

  // ----- Your vLeague: your last result and your next match, as the Fixtures tab draws them, then what reaches you -----
  const now = new Date();
  const mineFx = club && season ? season.fixtures.filter(f => f.home === club.code || f.away === club.code).sort(byKickoff) : [];
  const last = [...mineFx].reverse().find(f => status(f, season, now) === 'ft');
  const next = mineFx.find(f => status(f, season, now) === 'upcoming');
  function drawView() {
    const time = d => new Date(d).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: p.clock !== '24' }).replace(/\s+/g, ' ');
    const fctx = { now, mine: club?.code, club: teamOf, crest: crestOf, time, hidden: new Set(p.spoilers && last ? [last.id] : []) };
    const day = f => { const k = kickoff(f); return k ? dayLabel(ymd(new Date(k)), ymd(now)) : 'Date to be confirmed'; };
    const fx = [[last, 'Last result'], [next, 'Next match']].filter(([f]) => f)
      .map(([f, what]) => `<li class="fx-day"><h3>${esc(what)}</h3><span>${esc(day(f))}</span></li>${rowHtml(f, season, fctx)}`).join('');
    const dl = p.email.deadline;
    const facts = [
      ['Results', p.spoilers ? 'Hidden until you show them' : 'Shown at full time'],
      ['Kick-off times', p.clock === '24' ? '24-hour clock' : '12-hour clock'],
      ['Line-up reminder', dl === 'off' ? 'Off' : `${dl === 'both' ? '24 h and 3 h' : dl === '3h' ? '3 h' : '24 h'} before the lock`],
      ['Theme here', `${labelOf('theme', dev.theme)}, ${labelOf('text', dev.text).toLowerCase()} text`],
    ];
    $('#view', main).innerHTML = `<ul class="fx-list">${fx || '<li class="fx-day"><h3>Your matches</h3><span>None yet</span></li>'}
      <li class="fx-day"><h3>What you get</h3></li>
      ${facts.map(([k, v]) => `<li class="set-fact"><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}</ul>`;
  }

  // ----- the save line at the foot of the open card -----
  let saveTimer;
  function saved(state, text) {
    const el = main.querySelector('.set-card .set-save');
    if (!el) return;
    clearTimeout(saveTimer);
    el.className = `ts-save set-save is-${state}`;
    el.firstElementChild.textContent = text;
    if (state === 'saved') saveTimer = setTimeout(() => { el.className = 'ts-save set-save'; el.firstElementChild.textContent = ''; }, 2500);
  }
  async function savePref(path, value) {
    const keys = path.split('.'), holder = keys.length > 1 ? p[keys[0]] : p, k = keys[keys.length - 1], was = holder[k];
    holder[k] = value; drawPanel(); drawView();
    saved('saving', 'Saving…');
    try { await setPref(path, value); saved('saved', 'Saved'); }
    catch (e) { holder[k] = was; drawPanel(); drawView(); saved('error', e.message || 'That didn’t save. Try again.'); }
  }

  // ----- menus -----
  const openDlg = d => { if (!d.open) { d.showModal(); d.focus({ preventScroll: true }); } };
  const SWATCH = { dark: ['#161616', '#222222'], light: ['#f5f5f5', '#ffffff'], system: ['#161616', '#ffffff'] };
  let pickKey = null;
  function openPick(key) {
    pickKey = key;
    const row = rowsFor().find(r => r.id === key);
    const now = DEVICE_KEYS.has(key) ? dev[key] : key.startsWith('email.') ? p.email[key.slice(6)] : p[key];
    $('#dlg-pick-t', main).textContent = row.label;
    $('#pick-list', main).innerHTML = CHOICES[key].map(([v, l]) => `<li><button type="button" class="pk-row" data-v="${esc(v)}" aria-pressed="${String(now) === v}">${key === 'theme' ? `<i class="set-swatch" style="--a:${SWATCH[v][0]};--b:${SWATCH[v][1]}" aria-hidden="true"></i>` : ''}<span class="pk-name">${esc(l)}</span></button></li>`).join('');
    openDlg($('#dlg-pick', main));
    $('#pick-list [aria-pressed="true"]', main)?.focus();
  }
  $('#pick-list', main).addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    $('#dlg-pick', main).close();
    if (DEVICE_KEYS.has(pickKey)) {
      dev = setDevice(pickKey, b.dataset.v); drawPanel(); drawView(); saved('saved', 'Saved on this device');
    } else savePref(pickKey, b.dataset.v);
  });

  const TEXT = {
    name: { title: 'Name', label: 'Your name, as other managers see it', type: 'text', auto: 'name', max: 40, go: 'Save name' },
    email: { title: 'Email', label: 'Email address', type: 'email', auto: 'email', go: 'Change email', note: 'We email both addresses. It changes once you confirm from the new one.' },
    password: { title: 'Password', label: 'New password', type: 'password', auto: 'new-password', go: 'Change password', note: 'At least 8 characters.' },
  };
  let textKey = null;
  function openText(key) {
    const t = TEXT[key], input = $('#text-in', main);
    textKey = key;
    $('#dlg-text-t', main).textContent = t.title;
    $('#text-label', main).textContent = t.label;
    Object.assign(input, { type: t.type, autocomplete: t.auto, value: key === 'name' ? name : key === 'email' ? email : '' });
    if (t.max) input.maxLength = t.max; else input.removeAttribute('maxlength');
    const note = $('#text-note', main); note.className = 'set-note'; note.textContent = t.note || '';
    $('#text-go', main).textContent = t.go;
    openDlg($('#dlg-text', main));
    input.focus(); input.select?.();
  }
  $('#text-form', main).addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#text-in', main), go = $('#text-go', main), note = $('#text-note', main), v = input.value.trim();
    const fail = msg => { note.className = 'set-note err'; note.textContent = msg; };
    if (textKey === 'password' && input.value.length < 8) return fail('Use at least 8 characters.');
    if (textKey === 'email' && !/^\S+@\S+\.\S+$/.test(v)) return fail('That isn’t an email address. Check it and try again.');
    if (textKey === 'name' && !v) return fail('Type a name.');
    go.disabled = true;
    try {
      if (textKey === 'name') {
        if (v !== name) { await setDisplayName(v); name = v; }
        $('#dlg-text', main).close(); drawPanel(); saved('saved', 'Name saved');
      } else if (textKey === 'email') {
        if (v === email) { $('#dlg-text', main).close(); return; }
        const { error } = await (await db()).auth.updateUser({ email: v });
        if (error) throw error;
        $('#dlg-text', main).close(); saved('saved', `Check ${v} to confirm the change`);
      } else {
        const { error } = await (await db()).auth.updateUser({ password: input.value });
        if (error) throw error;
        input.value = ''; $('#dlg-text', main).close(); saved('saved', 'Password changed');
      }
    } catch (err) {
      const m = err.message || '';
      fail(/rate|too many/i.test(m) ? 'Too many tries. Wait a minute.' : /different/i.test(m) ? 'Choose a password you haven’t used here before.'
        : textKey === 'name' ? m || 'Your name didn’t save. Try again.' : 'That didn’t work. Check it and try again.');
    } finally { go.disabled = false; }
  });

  main.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  });

  // ----- taps -----
  main.addEventListener('click', async e => {
    const t = e.target.closest('[data-tab]');
    if (t && t.dataset.tab !== tab) { tab = t.dataset.tab; history.replaceState(null, '', `#${tab}`); drawTabs(); return; }
    const r = e.target.closest('.set-rows .fm-row');
    if (!r) return;
    if (r.dataset.menu) openPick(r.dataset.menu);
    else if (r.dataset.text) openText(r.dataset.text);
    else if (r.dataset.sw) {
      const key = r.dataset.sw, on = r.getAttribute('aria-checked') !== 'true';
      await savePref(key, on);
      main.querySelector(`[data-sw="${key}"]`)?.focus();
    } else if (r.dataset.act === 'signout') { await signOut(); location.replace('index.html?signin'); }
    else if (r.dataset.act === 'signout-all') {
      r.disabled = true;
      try { await (await db()).auth.signOut({ scope: 'global' }); } catch { /* signed out here anyway */ }
      await signOut(); location.replace('index.html?signin');
    } else if (r.dataset.act === 'test') {
      r.disabled = true; saved('saving', 'Sending…');
      try { const res = await sendTestEmail(); saved('saved', `Test email sent to ${res?.to || email}`); }
      catch (err) { saved('error', err.message || 'The test email didn’t send. Try again later.'); }
      finally { r.disabled = false; }
    }
  });
  // Arrow keys move along the toggle, like tabs.
  $('.set-tabs', main).addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const all = [...main.querySelectorAll('[data-tab]')], i = all.findIndex(b => b.dataset.tab === tab);
    const n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    n.focus(); n.click(); e.preventDefault();
  });
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.some(([k]) => k === h) && h !== tab) { tab = h; drawTabs(); } });

  drawTabs(); drawView();
  styleCards();
  main.setAttribute('aria-busy', 'false');
}
