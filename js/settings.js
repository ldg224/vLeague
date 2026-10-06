// Settings (0.7): a manager's account, email reminders, appearance, matches, accessibility. Every control saves on change.
// The office's own email choice lives in the Editor (Deadlines).
// Synced settings (data-pref) go to Supabase through prefs.js and get a "Saved" tick; per-device ones (data-dev)
// apply at once and stay in this browser.
import { enterPlace } from './shell.js';
import { esc, safeColour } from './member.js';
import { db, signOut } from './auth.js';
import { prefs, setPref, device, setDevice, setDisplayName, sendTestEmail } from './prefs.js';

const seg = (key, label, options, value, kind = 'pref') => `<div class="seg" role="radiogroup" aria-label="${esc(label)}" data-${kind}="${esc(key)}">${options.map(([v, text]) =>
  `<button type="button" role="radio" data-v="${esc(v)}" aria-checked="${String(v) === String(value)}">${esc(text)}</button>`).join('')}</div>`;
const toggle = (key, label, on) => `<button type="button" class="switch" role="switch" aria-label="${esc(label)}" aria-checked="${Boolean(on)}" data-pref="${esc(key)}"><span></span></button>`;
const row = (label, control, { id = '', tick = true } = {}) => `<div class="set-row"><span class="set-label"${id ? ` id="${id}"` : ''}>${label}</span>
  <div class="set-ctl">${control}${tick ? '<span class="tick" aria-live="polite"></span>' : ''}</div></div>`;

const ctx = await enterPlace('settings');
if (ctx) {
  const { main, club, me } = ctx;
  const p = await prefs(), dev = device();
  const email = me.user.email || '';
  main.classList.add('settings-main');

  main.innerHTML = `<h1 class="page-title">Settings</h1>
  <section class="sect" aria-labelledby="h-account"><div class="sect-head"><h2 id="h-account">Account</h2></div>
    ${row('Name', `<input class="field" id="name" type="text" maxlength="40" autocomplete="name" value="${esc(me.profile?.display_name || '')}" aria-label="Name">`)}
    ${row('Email', `<form class="inline" id="email-form"><input class="field" id="email" type="email" autocomplete="email" value="${esc(email)}" aria-label="Email" required><button class="small-btn" type="submit" hidden>Change</button></form>`)}
    ${row('Password', `<form class="inline" id="pw-form"><input type="email" autocomplete="username" value="${esc(email)}" hidden><input class="field" id="pw" type="password" autocomplete="new-password" minlength="8" placeholder="New password" aria-label="New password"><button class="small-btn" type="submit" disabled>Change</button></form>`)}
    <div class="set-actions"><button type="button" class="ghost-btn" id="signout-here">Sign out</button><button type="button" class="ghost-btn" id="signout-all">Sign out on all devices</button></div>
  </section>

  <section class="sect" aria-labelledby="h-email"><div class="sect-head"><h2 id="h-email">Email reminders</h2><span class="sect-note">${esc(email)}</span></div>
    ${row('Deadline reminder', seg('email.deadline', 'Deadline reminder', [['24h', '24 h before'], ['3h', '3 h before'], ['both', 'Both'], ['off', 'Off']], p.email.deadline))}
    ${club ? row('Club changes sent back', toggle('email.sent_back', 'Club changes sent back', p.email.sent_back)) : ''}
    ${row('Line-ups out', toggle('email.lineups_out', 'Line-ups out', p.email.lineups_out))}
    ${row('Weekly round-up', toggle('email.weekly', 'Weekly round-up', p.email.weekly))}
    ${club ? row('League news', toggle('email.news', 'League news', p.email.news)) : ''}
    <div class="set-actions"><button type="button" class="ghost-btn" id="test-email">Send me a test email</button><span class="test-result" id="test-result" aria-live="polite"></span></div>
  </section>

  <section class="sect" aria-labelledby="h-look"><div class="sect-head"><h2 id="h-look">Appearance</h2></div>
    ${row('Theme', seg('theme', 'Theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], dev.theme, 'dev'), { tick: false })}
    ${row('Text size', seg('text', 'Text size', [['100', 'Default'], ['112', 'Large'], ['125', 'Larger'], ['140', 'Largest']], dev.text, 'dev'), { tick: false })}
    <p class="sample" aria-hidden="true">Week 3 · ${esc(club?.short_name || club?.name || 'FC Turtle')} 2–1 Lads United</p>
  </section>

  <section class="sect" aria-labelledby="h-matches"><div class="sect-head"><h2 id="h-matches">Matches</h2></div>
    ${row('Spoiler-free results', toggle('spoilers', 'Spoiler-free results', p.spoilers))}
    ${row('Clock', seg('clock', 'Clock', [['12', '1:30 pm'], ['24', '13:30']], p.clock))}
  </section>

  <section class="sect" aria-labelledby="h-a11y"><div class="sect-head"><h2 id="h-a11y">Accessibility</h2></div>
    ${row('Reduce motion', seg('motion', 'Reduce motion', [['system', 'Follow system'], ['reduce', 'On']], dev.motion, 'dev'), { tick: false })}
  </section>`;

  // A row's tick: "Saved" for a moment, or what went wrong (kept until the next change).
  const tickOf = el => el.closest('.set-row')?.querySelector('.tick');
  function tick(el, error) {
    const t = tickOf(el);
    if (!t) return;
    clearTimeout(t._timer);
    t.className = `tick ${error ? 'err' : 'ok'}`;
    t.textContent = error ? error : 'Saved';
    if (!error) t._timer = setTimeout(() => { t.className = 'tick'; t.textContent = ''; }, 2000);
  }
  const busy = (el, on) => el.closest('.set-row')?.querySelector('.tick')?.classList.toggle('busy', on);


  async function savePref(el, path, value, undo) {
    busy(el, true);
    try { await setPref(path, value); tick(el); }
    catch (e) { undo(); tick(el, e.message || 'Couldn’t save'); }
    finally { busy(el, false); }
  }

  main.addEventListener('click', async e => {
    const b = e.target.closest('.seg [data-v]'), sw = e.target.closest('.switch');
    if (b) {
      const group = b.closest('.seg'), was = group.querySelector('[aria-checked="true"]');
      if (b === was) return;
      const pick = x => group.querySelectorAll('[data-v]').forEach(y => y.setAttribute('aria-checked', y === x));
      pick(b);
      if (group.dataset.dev) { setDevice(group.dataset.dev, b.dataset.v); return; }
      await savePref(group, group.dataset.pref, b.dataset.v, () => { pick(was); });
    } else if (sw) {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', on);
      await savePref(sw, sw.dataset.pref, on, () => sw.setAttribute('aria-checked', !on));
    }
  });
  // Arrow keys move along a segmented control, like radio buttons.
  main.addEventListener('keydown', e => {
    const b = e.target.closest('.seg [data-v]');
    if (!b || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const all = [...b.closest('.seg').querySelectorAll('[data-v]')];
    const next = all[(all.indexOf(b) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    next.focus(); next.click(); e.preventDefault();
  });

  // ----- account -----
  const nameEl = main.querySelector('#name');
  let savedName = nameEl.value;
  nameEl.addEventListener('change', async () => {
    const v = nameEl.value.trim();
    if (v === savedName) return;
    busy(nameEl, true);
    try { await setDisplayName(v); savedName = v; tick(nameEl); }
    catch (e) { tick(nameEl, e.message || 'Couldn’t save'); }
    finally { busy(nameEl, false); }
  });

  const emailForm = main.querySelector('#email-form'), emailEl = main.querySelector('#email');
  emailEl.addEventListener('input', () => { emailForm.querySelector('button').hidden = emailEl.value.trim() === email; });
  emailForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = emailForm.querySelector('button');
    btn.disabled = true;
    try {
      const { error } = await (await db()).auth.updateUser({ email: emailEl.value.trim() });
      if (error) throw error;
      btn.hidden = true;
      tick(emailEl, 'Check both inboxes to confirm');
      tickOf(emailEl).className = 'tick ok';
    } catch (err) { tick(emailEl, /rate|too many/i.test(err.message || '') ? 'Too many tries. Wait a minute.' : 'Couldn’t change it. Check the address.'); }
    finally { btn.disabled = false; }
  });

  const pwForm = main.querySelector('#pw-form'), pwEl = main.querySelector('#pw');
  pwEl.addEventListener('input', () => { pwForm.querySelector('button').disabled = pwEl.value.length < 8; });
  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (pwEl.value.length < 8) return;
    const btn = pwForm.querySelector('button');
    btn.disabled = true;
    try {
      const { error } = await (await db()).auth.updateUser({ password: pwEl.value });
      if (error) throw error;
      pwEl.value = '';
      tick(pwEl, 'Password changed');
      tickOf(pwEl).className = 'tick ok';
    } catch (err) {
      tick(pwEl, /different/i.test(err.message || '') ? 'Choose a password you haven’t used here before.' : 'Couldn’t change it. Try again.');
      btn.disabled = false;
    }
  });

  main.querySelector('#signout-here').addEventListener('click', async () => {
    await signOut();
    location.replace('index.html?signin');
  });
  main.querySelector('#signout-all').addEventListener('click', async e => {
    e.target.disabled = true;
    try { await (await db()).auth.signOut({ scope: 'global' }); } catch { /* signed out here anyway */ }
    await signOut();
    location.replace('index.html?signin');
  });

  // ----- test email -----
  main.querySelector('#test-email').addEventListener('click', async e => {
    const out = main.querySelector('#test-result');
    e.target.disabled = true;
    out.className = 'test-result';
    out.textContent = 'Sending…';
    try { const r = await sendTestEmail(); out.textContent = `Sent to ${r?.to || email}.`; out.classList.add('ok'); }
    catch (err) { out.textContent = err.message || 'Couldn’t send it.'; out.classList.add('err'); }
    finally { e.target.disabled = false; }
  });

  main.setAttribute('aria-busy', 'false');
}
