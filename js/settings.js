// Settings (WR-43, after My club's redesign in WR-45): one card with the account at the top, the site toggle for Account / Emails /
// Display, and a form of rows below it, each opening its own menu (css/menus.css, shared with My club) or flipping a switch.
// Beside it (under it on phones) "Your vLeague": an example match, table row and email line drawn with the choices made here, so
// every change shows what it does. Synced settings go to Supabase through prefs.js; device ones (theme, text size, motion) stay in
// this browser and apply at once.
import { enterPlace, styleCards } from './shell.js';
import { esc, crestUrl } from './member.js';
import { db, signOut } from './auth.js';
import { prefs, setPref, device, setDevice, setDisplayName, sendTestEmail } from './prefs.js';

const $ = (s, r = document) => r.querySelector(s);
const TABS = [['account', 'Account'], ['emails', 'Emails'], ['display', 'Display']];
const CHOICES = {
  'email.deadline': [['24h', '24 h before'], ['3h', '3 h before'], ['both', '24 h and 3 h before'], ['off', 'Off']],
  'email.draft': [['both', 'On the clock and a warning'], ['turn', 'On the clock only'], ['off', 'Off']],
  theme: [['dark', 'Dark'], ['light', 'Light'], ['system', 'Same as this device']],
  text: [['100', 'Default'], ['112', 'Large'], ['125', 'Larger'], ['140', 'Largest']],
  motion: [['system', 'Same as this device'], ['reduce', 'Reduce']],
  clock: [['12', '12-hour (5:30 pm)'], ['24', '24-hour (17:30)']],
};
const DEVICE_KEYS = new Set(['theme', 'text', 'motion']);
const labelOf = (key, v) => (CHOICES[key].find(([k]) => k === String(v)) || CHOICES[key][0])[1];

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
  const crest = club?.crest_path ? crestUrl(club.crest_path) : '';
  const other = season?.teams?.find(t => t.code !== club?.code);
  const mine = club?.short_name || club?.name || 'Your club';

  main.innerHTML = `<div class="set">
    <section class="lg-card set-card" aria-label="Settings">
      <div class="set-me">
        <span class="set-av" aria-hidden="true">${crest ? `<img src="${esc(crest)}" alt="" onerror="this.parentNode.textContent='${esc(initials(name))}'">` : esc(initials(name))}</span>
        <div class="set-who"><h1 id="me-name">${esc(name || 'Your account')}</h1><p id="me-mail">${[email, club?.name].filter(Boolean).map(esc).join(' · ')}</p></div>
      </div>
      <nav class="sc-toggle set-tabs" aria-label="Settings">${TABS.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav>
      <ul class="fm-rows set-rows" id="rows"></ul>
      <p class="ts-save set-save" id="save" aria-live="polite"><span></span></p>
    </section>
    <section class="lg-card set-view" aria-label="Your vLeague">
      <div class="lg-card-head"><h2>Your vLeague</h2></div>
      <div id="view"></div>
    </section>
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

  // ----- the rows for the open tab -----
  // kinds: menu (opens the choice menu), switch (flips on the spot), text (opens the field menu), act (does something now)
  const rowsFor = () => ({
    account: [
      { kind: 'text', id: 'name', label: 'Name', value: name || 'Not set' },
      { kind: 'text', id: 'email', label: 'Email', value: email },
      { kind: 'text', id: 'password', label: 'Password', value: 'Change' },
      { kind: 'act', id: 'signout', label: 'Sign out', value: 'On this device' },
      { kind: 'act', id: 'signout-all', label: 'Sign out everywhere', value: 'Every device', warn: true },
    ],
    emails: [
      { kind: 'menu', id: 'email.deadline', label: 'Deadline reminder', value: labelOf('email.deadline', p.email.deadline) },
      club && { kind: 'menu', id: 'email.draft', label: 'Draft picks', value: labelOf('email.draft', p.email.draft) },
      club && { kind: 'switch', id: 'email.sent_back', label: 'Club changes sent back', on: p.email.sent_back },
      { kind: 'switch', id: 'email.lineups_out', label: 'Line-ups out', on: p.email.lineups_out },
      { kind: 'switch', id: 'email.weekly', label: 'Weekly round-up', on: p.email.weekly },
      club && { kind: 'switch', id: 'email.news', label: 'League news', on: p.email.news },
      { kind: 'act', id: 'test', label: 'Test email', value: `Send to ${email || 'me'}` },
    ],
    display: [
      { kind: 'menu', id: 'theme', label: 'Theme', value: labelOf('theme', dev.theme) },
      { kind: 'menu', id: 'text', label: 'Text size', value: labelOf('text', dev.text) },
      { kind: 'menu', id: 'clock', label: 'Clock', value: labelOf('clock', p.clock) },
      { kind: 'switch', id: 'spoilers', label: 'Hide results', on: p.spoilers },
      { kind: 'menu', id: 'motion', label: 'Motion', value: labelOf('motion', dev.motion) },
    ],
  })[tab].filter(Boolean);

  function drawRows() {
    $('#rows', main).innerHTML = rowsFor().map(r => r.kind === 'switch'
      ? `<li><button type="button" class="fm-row set-sw" role="switch" aria-checked="${Boolean(r.on)}" data-sw="${esc(r.id)}"><span class="fm-k">${esc(r.label)}</span><span class="fm-v">${r.on ? 'On' : 'Off'}</span><i class="set-switch" aria-hidden="true"></i></button></li>`
      : `<li><button type="button" class="fm-row${r.kind === 'act' ? ' set-act' : ''}${r.warn ? ' set-warn' : ''}" data-${r.kind}="${esc(r.id)}"><span class="fm-k">${esc(r.label)}</span><span class="fm-v">${esc(r.value)}</span></button></li>`).join('');
  }
  function drawTabs() {
    main.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab));
    drawRows();
  }

  // ----- "Your vLeague": what the choices mean, on an example -----
  function drawView() {
    const at = new Date(); at.setDate(at.getDate() + ((6 - at.getDay() + 7) % 7 || 7)); at.setHours(17, 30, 0, 0);
    const time = at.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: p.clock !== '24' }).replace(/\s+/g, ' ');
    const day = at.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const them = other?.short_name || other?.name || 'Lads United';
    const dl = p.email.deadline;
    const mail = dl === 'off' ? 'No deadline emails' : `Reminder email ${dl === 'both' ? '24 h and 3 h' : dl === '3h' ? '3 h' : '24 h'} before line-ups lock`;
    $('#view', main).innerHTML = `
      <div class="sv-match">
        <span class="sv-when">${esc(day)}<b>${esc(time)}</b></span>
        <span class="sv-team">${esc(mine)}</span>
        ${p.spoilers ? '<span class="sv-hid">Result hidden</span>' : '<span class="sv-score">2 – 1</span>'}
        <span class="sv-team">${esc(them)}</span>
      </div>
      <div class="sv-line"><span>${p.spoilers ? 'Scores stay hidden until you tap Show' : 'Scores show as soon as a match ends'}</span></div>
      <div class="sv-line"><span>${esc(mail)}</span></div>
      <div class="sv-line"><span>${dev.theme === 'system' ? 'Light or dark, as this device' : dev.theme === 'light' ? 'Light theme' : 'Dark theme'} · ${esc(labelOf('text', dev.text).toLowerCase())} text</span></div>`;
  }

  // ----- the save line at the foot of the card -----
  const saveEl = $('#save', main);
  let saveTimer;
  function saved(state, text) {
    clearTimeout(saveTimer);
    saveEl.className = `ts-save set-save is-${state}`;
    saveEl.firstElementChild.textContent = text;
    if (state === 'saved') saveTimer = setTimeout(() => { saveEl.className = 'ts-save set-save'; saveEl.firstElementChild.textContent = ''; }, 2500);
  }
  async function savePref(path, value) {
    const keys = path.split('.'), holder = keys.length > 1 ? p[keys[0]] : p, k = keys[keys.length - 1], was = holder[k];
    holder[k] = value; drawRows(); drawView();
    saved('saving', 'Saving…');
    try { await setPref(path, value); saved('saved', 'Saved'); }
    catch (e) { holder[k] = was; drawRows(); drawView(); saved('error', e.message || 'That didn’t save. Try again.'); }
  }

  // ----- menus -----
  const openDlg = d => { if (!d.open) { d.showModal(); d.focus({ preventScroll: true }); } };
  let pickKey = null;
  function openPick(key) {
    pickKey = key;
    const row = rowsFor().find(r => r.id === key);
    const now = DEVICE_KEYS.has(key) ? dev[key] : key.startsWith('email.') ? p.email[key.slice(6)] : p[key];
    $('#dlg-pick-t', main).textContent = row.label;
    $('#pick-list', main).innerHTML = CHOICES[key].map(([v, l]) => `<li><button type="button" class="pk-row" data-v="${esc(v)}" aria-pressed="${String(now) === v}"><span class="pk-name">${esc(l)}</span></button></li>`).join('');
    openDlg($('#dlg-pick', main));
    $('#pick-list [aria-pressed="true"]', main)?.focus();
  }
  $('#pick-list', main).addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    $('#dlg-pick', main).close();
    if (DEVICE_KEYS.has(pickKey)) {
      dev = setDevice(pickKey, b.dataset.v); drawRows(); drawView(); saved('saved', 'Saved on this device');
    } else savePref(pickKey, b.dataset.v);
  });

  const TEXT = {
    name: { title: 'Name', label: 'Your name, as other managers see it', type: 'text', auto: 'name', max: 40, go: 'Save name' },
    email: { title: 'Email', label: 'Email address', type: 'email', auto: 'email', go: 'Change email', note: 'We email both addresses. The change happens once you confirm from the new one.' },
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
    if (textKey === 'email' && !/^\S+@\S+\.\S+$/.test(v)) return fail('That doesn’t look like an email address.');
    if (textKey === 'name' && !v) return fail('Type a name.');
    go.disabled = true;
    try {
      if (textKey === 'name') {
        if (v !== name) { await setDisplayName(v); name = v; $('#me-name', main).textContent = v; }
        $('#dlg-text', main).close(); saved('saved', 'Name saved');
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
      drawRows();
    } catch (err) {
      const m = err.message || '';
      fail(/rate|too many/i.test(m) ? 'Too many tries. Wait a minute.' : /different/i.test(m) ? 'Choose a password you haven’t used here before.'
        : textKey === 'name' ? m || 'Your name didn’t save. Try again.' : 'That didn’t work. Check it and try again.');
    } finally { go.disabled = false; }
  });

  main.querySelectorAll('dialog').forEach(d => {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  });

  // ----- taps on the card -----
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
    const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    next.focus(); next.click(); e.preventDefault();
  });
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.some(([k]) => k === h) && h !== tab) { tab = h; drawTabs(); } });

  drawTabs(); drawView();
  styleCards();
  main.setAttribute('aria-busy', 'false');
}
