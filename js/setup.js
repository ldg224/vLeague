// "Set up your club" (0.4, three steps since 0.8). First time: a wizard (club, colours, details) that ends by sending
// the club to the league office. With ?edit (or once the club is set up): one page of cards, each with its own button.
// Colours, motto, manager name and stadium save straight away (rpc update_club_style); name, short name, code and
// crest go to the league office for approval (rpc submit_club_request). The crest is optional: the code badge stands in.
import { enter, chrome, esc, crestUrl } from './member.js';
import { db } from './auth.js';
import { contrast, onColour } from './club-colour.js';
import { prepareCrest, uploadCrest } from './crest.js';

const $ = id => document.getElementById(id);
const form = $('form');
const STEPS = 3;
const STYLE = ['colour', 'colour2', 'motto', 'manager_name', 'stadium'];
const IDENTITY = ['name', 'short_name', 'code'];
const TEXT = ['name', 'short_name', 'code', 'colour', 'colour2', 'manager_name', 'stadium', 'motto', 'notes'];

let club = null;          // the club's row
let request = null;       // its latest request, if any
let base = {};            // identity values the form started from (a pending or returned request's, else the club's)
let editMode = false;
let step = 1;
let crest = null;         // { blob, url } for a newly chosen crest
let codeState = 'ok';     // 'ok' | 'checking' | 'taken' | 'bad' | 'unknown'
let codeTimer = 0, codeSeq = 0;

// Supabase's messages, in plain words. The database raises readable ones itself ('That code is taken.').
function explain(error, fallback) {
  const m = String(error?.message || error || '');
  if (/fetch|network|failed to load/i.test(m)) return 'Couldn’t reach vLeague. Check your connection and try again.';
  if (/jwt|session/i.test(m)) return 'You’ve been signed out. Sign in again and retry.';
  return m && m.length < 160 && !/violates|syntax|relation|column|null value|function|schema/i.test(m) ? m : fallback;
}

const val = k => form.elements[k].value.trim();
const hex = k => { const v = val(k).toLowerCase(); return /^#?[0-9a-f]{6}$/.test(v) ? (v[0] === '#' ? v : '#' + v) : ''; };
const values = () => ({
  name: val('name'), short_name: val('short_name'), code: val('code').toUpperCase(),
  colour: hex('colour'), colour2: hex('colour2'),
  manager_name: val('manager_name'), stadium: val('stadium'), motto: val('motto'), notes: val('notes'),
});
const crestSrc = () => crest?.url || (base.crest_path ? crestUrl(base.crest_path) : '');

// ---------------------------------------------------------------- drafts (wizard only, this device)
const draftKey = () => `vleague-setup-${club.code}`;
function saveDraft() {
  if (editMode) return;
  try { localStorage.setItem(draftKey(), JSON.stringify({ ...values(), step })); } catch { /* storage blocked */ }
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch { return null; }
}
function clearDraft() { try { localStorage.removeItem(draftKey()); } catch { /* storage blocked */ } }

// ---------------------------------------------------------------- live bits: counters, code check, colours, preview
function counters() {
  form.querySelectorAll('.count').forEach(el => {
    const input = form.elements[el.dataset.for];
    const n = input.value.length, max = input.maxLength;
    el.textContent = n > max * 0.7 ? `${n}/${max}` : '';
  });
}

// The code is fixed until the manager taps Change; only then does it say anything.
function showCode() {
  const el = $('code-state');
  const quiet = form.elements.code.readOnly;
  const msg = quiet ? '' : { ok: val('code') === club.code ? '' : 'Available', checking: 'Checking…', taken: 'Taken', bad: 'Letters only', unknown: '' }[codeState];
  el.textContent = msg;
  el.className = codeState === 'taken' || codeState === 'bad' ? 'bad' : msg && codeState === 'ok' ? 'good' : '';
}

function checkCode() {
  const input = form.elements.code;
  const caret = input.selectionStart;
  input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
  try { input.setSelectionRange(caret, caret); } catch { /* not focused */ }
  const code = input.value;
  clearTimeout(codeTimer);
  const seq = ++codeSeq;
  if (!/^[A-Z]{3}$/.test(code)) { codeState = code.length < 3 ? 'unknown' : 'bad'; return showCode(); }
  if (code === club.code || code === base.code) { codeState = 'ok'; return showCode(); }
  codeState = 'checking'; showCode();
  codeTimer = setTimeout(async () => {
    try {
      const { data, error } = await (await db()).rpc('code_available', { p_code: code });
      if (seq !== codeSeq) return;
      codeState = error ? 'unknown' : data ? 'ok' : 'taken';
    } catch { if (seq === codeSeq) codeState = 'unknown'; }
    showCode();
  }, 300);
}

function paintColours() {
  const v = values();
  const club1 = /^#[0-9a-f]{6}$/i.test(v.colour) ? v.colour : '#64b5f6';
  document.body.style.setProperty('--club', club1);
  document.body.style.setProperty('--on-club', onColour(club1));
  document.body.classList.add('themed');
  for (const k of ['colour', 'colour2']) {
    if (v[k]) $(`${k}-pick`).value = v[k];
    form.elements[k].setAttribute('aria-invalid', v[k] ? 'false' : 'true');
  }
  // One short line, only when what shows differs from what was picked.
  let check = '';
  if (!v.colour || !v.colour2) check = 'Use a colour code like #1e88e5.';
  else if (contrast(v.colour, v.colour2) < 1.5) check = 'These two are hard to tell apart.';
  $('check').innerHTML = check;
  $('club-preview').innerHTML = preview(v, club1);
  paintCrest();
}

function preview(v, colour) {
  return `<div class="su-phone" style="--club:${colour}">
      <div class="su-phone-band"></div>
      <div class="su-phone-top"><img src="assets/brand/crest.svg" alt=""><span>v<b>LEAGUE</b></span></div>
      <div class="su-phone-body">
        ${crestSrc() ? `<img class="su-phone-crest" src="${esc(crestSrc())}" alt="">` : `<span class="su-phone-crest su-nocrest">${esc(v.code || club.code)}</span>`}
        <b class="su-phone-name">${esc(v.name || club.name)}</b>
        <span class="su-phone-chip">Next match · Sat 3:00 pm</span>
      </div>
    </div>`;
}

function paintCrest() {
  const src = crestSrc();
  $('crest-img').hidden = !src;
  if (src) $('crest-img').src = src;
  $('crest-badge').hidden = Boolean(src);
  $('crest-badge').textContent = values().code || club.code;
  $('drop-title').textContent = src ? 'Replace crest' : 'Upload a crest';
}

// ---------------------------------------------------------------- steps
function validate(n) {
  const v = values();
  const bad = (field, msg) => { form.elements[field]?.focus(); return msg; };
  if (n === 1 || n === 0) {
    if (v.name.length < 2) return bad('name', 'Enter a club name.');
    if (!/^[A-Z]{3}$/.test(v.code)) return bad('code', 'The code needs three letters.');
    if (codeState === 'taken') return bad('code', 'That code is taken.');
  }
  if (n === 2 || n === 0) {
    if (!v.colour) return bad('colour', 'Pick a main colour.');
    if (!v.colour2) return bad('colour2', 'Pick a second colour.');
  }
  return '';
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function go(n) {
  step = n;
  showError('');
  form.querySelectorAll('.su-step').forEach(s => { s.hidden = !editMode && Number(s.dataset.step) !== n; });
  if (editMode) return;
  form.querySelectorAll('.su-steps li').forEach(li => {
    const i = Number(li.dataset.go);
    li.classList.toggle('on', i === n);
    li.classList.toggle('done', i < n);
    li.toggleAttribute('aria-current', i === n);
  });
  $('back').hidden = n === 1;
  $('next-label').textContent = n < STEPS ? 'Continue' : 'Send to the league office';
  saveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------- saving
const identityChanged = v => Boolean(crest) || IDENTITY.some(k => (v[k] || '') !== (base[k] || ''));

async function saveStyle() {
  const v = values();
  const style = { colour: v.colour, colour2: v.colour2, motto: v.motto, manager_name: v.manager_name, stadium: v.stadium };
  const { error } = await (await db()).rpc('update_club_style', { p: style });
  if (error) throw new Error(explain(error, 'Your colours and details didn’t save. Try again.'));
  Object.assign(club, style);
}

// Returns the new request's id, or null when nothing differs from the club as it is.
async function sendIdentity() {
  const v = values();
  const p = { name: v.name, short_name: v.short_name, code: v.code, notes: v.notes };
  if (crest) p.crest_path = await uploadCrest(crest.blob, club.code);
  const { data, error } = await (await db()).rpc('submit_club_request', { p });
  if (error) throw new Error(explain(error, 'That didn’t reach the league office. Try again.'));
  return data;
}

async function submitWizard() {
  if (step < STEPS) {
    const msg = validate(step);
    return msg ? showError(msg) : go(step + 1);
  }
  const msg = validate(0);
  if (msg) {
    const v = values();
    go(v.name.length < 2 || !/^[A-Z]{3}$/.test(v.code) || codeState === 'taken' ? 1 : 2);
    return showError(msg);
  }
  const btn = $('next');
  btn.disabled = true; showError('');
  try {
    await saveStyle();
    await sendIdentity();
    clearDraft();
    $('done-crest').src = crestSrc() || 'assets/brand/crest.svg';
    form.hidden = true;
    $('done').hidden = false;
    window.scrollTo({ top: 0 });
  } catch (err) {
    showError(explain(err, 'That didn’t save. Try again.'));
  } finally {
    btn.disabled = false;
  }
}

// The edit view: each card's button saves only that card.
async function submitCard(btn) {
  const card = btn.closest('.su-step'), msg = card.querySelector('.su-msg');
  const say = text => { msg.textContent = text; };
  const identity = btn.value === 'identity';
  const problem = validate(identity ? 1 : 2);
  if (problem) return say(problem);
  const v = values();
  const open = request && request.status !== 'approved';
  if (identity && !identityChanged(v) && (!open || (v.notes || '') === (base.notes || ''))) return say('No changes.');
  btn.disabled = true; say(identity ? 'Sending…' : 'Saving…');
  try {
    if (!identity) {
      await saveStyle();
      return say('Saved.');
    }
    const hadRequest = request && request.status === 'pending';
    const id = await sendIdentity();
    await loadRequest();
    crest = null; $('crest').value = '';
    say(id ? 'Sent. It goes live once the office approves it.' : hadRequest ? 'Request cancelled.' : 'No changes.');
  } catch (err) {
    say(explain(err, 'That didn’t save. Try again.'));
  } finally {
    btn.disabled = false;
  }
}

function note(text, kind = 'info') {
  const el = $('request-note');
  el.className = `msg ${kind}`;
  el.innerHTML = text;
  el.hidden = !text;
}

// ---------------------------------------------------------------- load
async function loadRequest() {
  const { data, error } = await (await db()).from('club_requests').select('*').eq('club', club.code)
    .order('created_at', { ascending: false }).limit(1);
  request = error ? null : data?.[0] || null;
  const open = request && request.status !== 'approved' ? request : null;
  base = {
    name: open?.name ?? club.name, short_name: open?.short_name ?? club.short_name ?? '', code: open?.code ?? club.code,
    crest_path: open?.crest_path ?? club.crest_path, notes: open?.notes ?? '',
  };
  if (request?.status === 'returned') note(`<b>Sent back:</b> ${esc(request.office_note || 'No note.')}`);
  else if (editMode && open?.status === 'pending') note('Waiting for the office to approve.');
  else note('');
  return open;
}

async function load() {
  const { data: row, error } = await (await db()).from('clubs').select('*').eq('code', me.profile.club).maybeSingle();
  if (error || !row) throw new Error('Your club didn’t load.');
  club = row;
  await loadRequest();
  crest = null;
  $('crest').value = '';
  const fill = {
    ...base, colour: club.colour || '#1e88e5', colour2: club.colour2 || '#ffffff',
    manager_name: club.manager_name ?? me.profile.display_name ?? '', stadium: club.stadium ?? '', motto: club.motto ?? '',
  };
  const draft = editMode ? null : loadDraft();
  for (const k of TEXT) form.elements[k].value = (draft && k in draft ? draft[k] : fill[k]) ?? '';
  if (form.elements.code.value !== club.code) unlockCode(false);
  codeState = 'ok';
  checkCode(); counters(); paintColours();
  return draft;
}

function unlockCode(focus = true) {
  const input = form.elements.code;
  input.readOnly = false;
  $('code-change').hidden = true;
  if (focus) { input.focus(); input.select(); }
  showCode();
}

// ---------------------------------------------------------------- start
chrome();
const me = await enter('setup.html');
if (me) {
  const main = $('main');
  try {
    // The wizard shows once per round: only while the club's setup_at is null (the office can reopen it). After that,
    // setup.html sends people Home; ?edit (from Home's "Edit club" and "Fix and resend") is the later-changes page.
    editMode = new URLSearchParams(location.search).has('edit');
    if (!editMode && !me.profile.needs_setup) { location.replace('home.html'); throw 'redirect'; }
    document.body.classList.toggle('su-edit', editMode);
    const draft = await load();

    $('to-home').hidden = !editMode;
    if (editMode) {
      document.title = `Edit ${club.name} | vLeague`;
      $('page-label').textContent = 'Edit club';
      $('title').textContent = 'Edit your club';
      $('kicker').textContent = club.name;
      $('steps').hidden = true;
      $('nav').hidden = true;
    } else {
      $('brand').removeAttribute('href');   // no Home to go to until the club is sent
      form.querySelectorAll('[data-edit-only]').forEach(el => { el.hidden = true; });
    }

    form.addEventListener('input', e => {
      const k = e.target.name || e.target.id;
      if (k === 'code') checkCode();
      if (k === 'colour-pick' || k === 'colour2-pick') form.elements[k.replace('-pick', '')].value = e.target.value;
      if (/colour|name|code/.test(k)) paintColours();
      counters(); saveDraft();
    });
    $('code-change').addEventListener('click', () => unlockCode());
    $('crest').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      $('crest-error').hidden = true;
      if (!file) return;
      try {
        const made = await prepareCrest(file);
        if (crest) URL.revokeObjectURL(crest.url);
        crest = made;
        paintColours();
      } catch (err) {
        $('crest-error').textContent = err.message;
        $('crest-error').hidden = false;
      }
    });
    const drop = $('drop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const dt = new DataTransfer(); dt.items.add(file);
      $('crest').files = dt.files;
      $('crest').dispatchEvent(new Event('change'));
    });
    $('back').addEventListener('click', () => go(Math.max(1, step - 1)));
    $('steps').addEventListener('click', e => {
      const li = e.target.closest('[data-go]');
      if (!li || editMode) return;
      const n = Number(li.dataset.go);
      // Forward from the step list only past steps that are complete.
      for (let i = step; i < n; i++) { const msg = validate(i); if (msg) { go(i); return showError(msg); } }
      go(n);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!editMode) return submitWizard();
      // Enter in a field saves the card it's in, not whichever button comes first.
      const card = document.activeElement?.closest('.su-step');
      const btn = card && !card.contains(e.submitter) ? card.querySelector('.su-card-act button') : e.submitter;
      if (btn?.value) submitCard(btn);
    });

    $('loading').remove();
    form.hidden = false;
    go(editMode ? 0 : Math.min(Math.max(Number(draft?.step) || 1, 1), STEPS));
  } catch (e) {
    if (e !== 'redirect') main.innerHTML = `<p class="quiet">${esc(explain(e, 'Your club didn’t load.'))} <a href="setup.html${location.search}">Try again</a></p>`;
  }
  main.setAttribute('aria-busy', 'false');
}
