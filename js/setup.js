// "Set up your club" (0.4). First time: a four-step wizard (name, colours, crest, details), then a review and submit.
// With ?edit (or once the club is set up): one page with every section. Colours, motto, manager name and stadium
// save straight away (rpc update_club_style); name, short name, code and crest go to the league office for approval
// (rpc submit_club_request). Submit order: upload the crest (if new) -> update_club_style -> submit_club_request.
import { enter, chrome, esc, crestUrl } from './member.js';
import { db } from './auth.js';
import { accentInfo, contrast, isHex, NAVY } from './club-colour.js';
import { prepareCrest, uploadCrest } from './crest.js';

const $ = id => document.getElementById(id);
const form = $('form');
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
  if (/could not find the function|schema cache|does not exist/i.test(m)) return 'Club setup isn’t switched on yet. Try again a little later.';
  if (/fetch|network|failed to load/i.test(m)) return 'Couldn’t reach vLeague. Check your connection and try again.';
  if (/jwt|session/i.test(m)) return 'You’ve been signed out. Sign in again and retry.';
  return m && m.length < 160 && !/violates|syntax|relation|column|null value/i.test(m) ? m : fallback;
}

const val = k => form.elements[k].value.trim();
const hex = k => { const v = val(k).toLowerCase(); return /^#?[0-9a-f]{6}$/.test(v) ? (v[0] === '#' ? v : '#' + v) : ''; };
const values = () => ({
  name: val('name'), short_name: val('short_name'), code: val('code').toUpperCase(),
  colour: hex('colour'), colour2: hex('colour2'),
  manager_name: val('manager_name'), stadium: val('stadium'), motto: val('motto'), notes: val('notes'),
});
const accent = () => { const v = values(); return accentInfo(v.colour, v.colour2); };
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

// ---------------------------------------------------------------- live bits: counters, code check, colours, previews
function counters() {
  form.querySelectorAll('.count').forEach(el => {
    const input = form.elements[el.dataset.for];
    const n = input.value.length, max = input.maxLength;
    el.textContent = n > max * 0.7 ? `${n}/${max}` : '';
  });
}

function showCode() {
  const el = $('code-state');
  const msg = {
    ok: val('code').toUpperCase() === club.code ? `${club.code} is your current code.` : `${val('code').toUpperCase()} is free.`,
    checking: 'Checking…', taken: 'That code is taken. Pick another.', bad: 'Use three letters, A to Z.',
    unknown: 'Three letters, like TUR. No two clubs share one.',
  }[codeState];
  el.textContent = msg;
  el.className = codeState === 'taken' || codeState === 'bad' ? 'bad' : codeState === 'ok' ? 'good' : '';
}

function checkCode() {
  const input = form.elements.code;
  const caret = input.selectionStart;
  input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
  try { input.setSelectionRange(caret, caret); } catch { /* not focused */ }
  const code = input.value;
  clearTimeout(codeTimer);
  const seq = ++codeSeq;
  if (!code) { codeState = 'unknown'; return showCode(); }
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

const ratio = r => `${r.toFixed(1)}:1`;

function paintColours() {
  const v = values();
  const info = accent();
  document.body.style.setProperty('--club', info.accent);
  for (const k of ['colour', 'colour2']) {
    const pick = $(`${k}-pick`);
    if (v[k]) pick.value = v[k];
    form.elements[k].setAttribute('aria-invalid', v[k] ? 'false' : 'true');
  }
  const checks = [];
  if (!v.colour) checks.push(['bad', 'Enter the main colour as a hex code, like #1e88e5.']);
  else if (info.from === 'colour') {
    const r = contrast(v.colour, NAVY);
    checks.push(info.lifted
      ? ['warn', `Your main colour is dark on the navy (${ratio(r)}), so vLeague lifts it to <code>${info.accent}</code>.`]
      : ['good', `Your main colour reads well on the navy (${ratio(r)}).`]);
  } else {
    checks.push(['warn', info.from === 'colour2'
      ? `White, grey and black don't show as an accent, so vLeague uses your second colour${info.lifted ? `, lifted to <code>${info.accent}</code>` : ''}.`
      : `White, grey and black don't show as an accent, so vLeague uses its own blue for your club.`]);
  }
  if (v.colour && v.colour2) {
    const r = contrast(v.colour, v.colour2);
    checks.push(r < 1.5
      ? ['warn', `Your two colours are hard to tell apart (${ratio(r)}). A second colour that stands out works better on badges and kits.`]
      : ['good', `Your two colours stand apart (${ratio(r)}).`]);
  } else if (!v.colour2) checks.push(['bad', 'Enter the second colour as a hex code.']);
  $('checks').innerHTML = checks.map(([k, t]) => `<li class="${k}"><span>${t}</span></li>`).join('');
  $('accent-preview').innerHTML = accentPreview(v, info);
  paintCrests();
}

function accentPreview(v, info) {
  const name = v.name || club.name;
  return `<div class="su-phone" style="--club:${info.accent}">
      <div class="su-phone-band"></div>
      <div class="su-phone-top"><img src="assets/brand/crest.svg" alt=""><span>v<b>LEAGUE</b></span></div>
      <div class="su-phone-body">
        ${crestSrc() ? `<img class="su-phone-crest" src="${esc(crestSrc())}" alt="">` : `<span class="su-phone-crest su-nocrest">${esc(v.code || club.code)}</span>`}
        <b class="su-phone-name">${esc(name)}</b>
        <span class="su-phone-chip">Next match · Sat 3:00 pm</span>
        <span class="su-phone-link">Pick your team →</span>
      </div>
    </div>
    <div class="su-accent-key">
      <span class="su-chip" style="background:${esc(v.colour || '#000')}"></span><span>Main</span>
      <span class="su-chip" style="background:${esc(v.colour2 || '#000')}"></span><span>Second</span>
      <span class="su-chip" style="background:${info.accent}"></span><span>Accent <code>${info.accent}</code></span>
    </div>`;
}

function paintCrests() {
  const v = values(), src = crestSrc(), info = accent();
  const img = (cls = '') => src ? `<img class="${cls}" src="${esc(src)}" alt="">` : `<span class="no-crest ${cls}">${esc(v.code || club.code)}</span>`;
  const short = v.short_name || v.name || club.name;
  $('crest-img').hidden = !src;
  if (src) $('crest-img').src = src;
  $('drop-title').textContent = src ? 'Choose a different picture' : 'Choose a picture';
  $('crest-previews').innerHTML = `
    <figure style="--club:${info.accent}"><div class="su-pv su-pv-band"><div class="club-band on"></div><div class="su-pv-bar">${img('su-pv-26')}<b>${esc(v.name || club.name)}</b></div></div><figcaption>Top of your Home</figcaption></figure>
    <figure style="--club:${info.accent}"><div class="su-pv su-pv-card"><div class="club-card">${img('club-crest')}<b class="su-pv-title">${esc(v.name || club.name)}</b></div></div><figcaption>Home card</figcaption></figure>
    <figure style="--club:${info.accent}"><div class="su-pv"><ul class="club-rows"><li>${img()}<span class="who"><b>${esc(short)}</b><small>${esc(v.code || club.code)}</small></span></li></ul></div><figcaption>League table</figcaption></figure>
    <figure><div class="su-pv su-pv-icon">${img('su-pv-20')}<b>${esc(v.code || club.code)}</b><span>2 – 1</span><b>OPP</b></div><figcaption>Small icon</figcaption></figure>`;
}

// ---------------------------------------------------------------- steps
function validate(n) {
  const v = values();
  const bad = (field, msg) => { form.elements[field]?.focus(); return msg; };
  if (n === 1 || n === 0) {
    if (v.name.length < 2) return bad('name', 'Give your club a name (2 to 25 characters).');
    if (!/^[A-Z]{3}$/.test(v.code)) return bad('code', 'The code is three letters, like TUR.');
    if (codeState === 'taken') return bad('code', 'That code is taken. Pick another.');
  }
  if (n === 2 || n === 0) {
    if (!v.colour) return bad('colour', 'Enter the main colour as a hex code, like #1e88e5.');
    if (!v.colour2) return bad('colour2', 'Enter the second colour as a hex code, like #ffffff.');
  }
  if ((n === 3 || n === 0) && !crestSrc()) return 'Add your club’s crest.';
  return '';
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function go(n) {
  step = n;
  showError('');
  form.querySelectorAll('.su-step').forEach(s => { const i = Number(s.dataset.step); s.hidden = editMode ? i === 5 : i !== n; });
  if (editMode) return;
  form.querySelectorAll('.su-steps li').forEach(li => {
    const i = Number(li.dataset.go);
    li.classList.toggle('on', i === n);
    li.classList.toggle('done', i < n);
    li.toggleAttribute('aria-current', i === n);
  });
  $('kicker').textContent = n < 5 ? `Step ${n} of 4` : 'Last step';
  $('back').hidden = n === 1;
  $('next-label').textContent = n < 4 ? 'Continue' : n === 4 ? 'Review' : 'Send to the league office';
  if (n === 5) $('review').innerHTML = review();
  saveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function review() {
  const v = values(), info = accent();
  const row = (label, value, s) => `<div class="su-rev-row"><dt>${label}</dt><dd>${value || '<span class="quiet">None</span>'}</dd><button type="button" class="quiet" data-go="${s}">Change</button></div>`;
  return `<dl class="su-rev">
      ${row('Club name', esc(v.name), 1)}
      ${row('Short name', esc(v.short_name), 1)}
      ${row('Code', esc(v.code), 1)}
      ${row('Colours', `<span class="su-chip" style="background:${esc(v.colour)}"></span><span class="su-chip" style="background:${esc(v.colour2)}"></span> accent <code>${info.accent}</code>`, 2)}
      ${row('Crest', crestSrc() ? `<img class="su-rev-crest" src="${esc(crestSrc())}" alt="">` : '', 3)}
      ${row('Manager', esc(v.manager_name), 4)}
      ${row('Stadium', esc(v.stadium), 4)}
      ${row('Motto', esc(v.motto), 4)}
      ${row('Notes', esc(v.notes), 4)}
    </dl>
    <div class="su-preview">${accentPreview(v, info)}</div>`;
}

// ---------------------------------------------------------------- saving
const identityChanged = v => Boolean(crest) || IDENTITY.some(k => (v[k] || '') !== (base[k] || '')) || (v.notes || '') !== (base.notes || '');
const styleChanged = (v, info) => STYLE.some(k => (v[k] || '') !== (club[k] || '')) || info.accent !== (club.accent || '');

async function save() {
  const v = values(), info = accent();
  const c = await db();
  let crestPath = null;
  if (crest) crestPath = await uploadCrest(crest.blob, club.code).catch(e => { throw new Error(e.message); });

  const style = { colour: v.colour, colour2: v.colour2, accent: info.accent, motto: v.motto, manager_name: v.manager_name, stadium: v.stadium };
  let styled = false, sent = null;
  if (!editMode || styleChanged(v, info)) {
    const { error } = await c.rpc('update_club_style', { p: style });
    if (error) throw new Error(explain(error, 'Your colours and details didn’t save. Try again.'));
    styled = true;
  }
  if (!editMode || identityChanged(v)) {
    const p = { name: v.name, short_name: v.short_name, code: v.code, notes: v.notes };
    if (crestPath) p.crest_path = crestPath;
    const { data, error } = await c.rpc('submit_club_request', { p });
    if (error) throw new Error(explain(error, 'Your request didn’t reach the league office. Try again.'));
    sent = data ?? 'none';
  }
  return { styled, sent };
}

async function submit(e) {
  e.preventDefault();
  if (!editMode && step < 5) {
    const msg = validate(step);
    if (msg) return showError(msg);
    return go(step + 1);
  }
  const msg = validate(0);
  if (msg) {
    showError(msg);
    if (!editMode) {
      const v = values();
      go(v.name.length < 2 || !/^[A-Z]{3}$/.test(v.code) || codeState === 'taken' ? 1 : !v.colour || !v.colour2 ? 2 : 3);
      showError(msg);
    }
    return;
  }
  const btn = $('next');
  btn.disabled = true; showError('');
  try {
    const { styled, sent } = await save();
    if (!editMode) {
      clearDraft();
      $('done-crest').src = crestSrc() || 'assets/brand/crest.svg';
      $('done-title').textContent = 'Sent to the league office';
      $('done-text').textContent = 'Your colours and details are live. The league office will check your name, code and crest, and reveal your crest to the league. You’ll see how it went on your Home.';
      form.hidden = true;
      $('done').hidden = false;
      window.scrollTo({ top: 0 });
      return;
    }
    const parts = [];
    if (styled) parts.push('Saved.');
    if (sent === 'none') parts.push('Your name, code and crest match what’s live, so there’s nothing for the office to approve.');
    else if (sent) parts.push('Your name, code and crest changes went to the league office for approval.');
    await load();
    note(parts.join(' ') || 'Nothing had changed.', 'info');
  } catch (err) {
    showError(explain(err, 'That didn’t save. Try again.'));
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
async function load() {
  const c = await db();
  const [{ data: row, error }, req] = await Promise.all([
    c.from('clubs').select('*').eq('code', me.profile.club).maybeSingle(),
    c.from('club_requests').select('*').eq('club', me.profile.club).order('created_at', { ascending: false }).limit(1),
  ]);
  if (error || !row) throw new Error('Your club didn’t load.');
  club = row;
  request = req.error ? null : req.data?.[0] || null;
  const open = request && request.status !== 'approved' ? request : null;
  base = {
    name: open?.name ?? club.name, short_name: open?.short_name ?? club.short_name ?? '', code: open?.code ?? club.code,
    crest_path: open?.crest_path ?? club.crest_path, notes: open?.notes ?? '',
  };
  crest = null;
  $('crest').value = '';
  const fill = { ...base, colour: club.colour || '', colour2: club.colour2 || '#ffffff', manager_name: club.manager_name ?? me.profile.display_name ?? '', stadium: club.stadium ?? '', motto: club.motto ?? '' };
  const draft = editMode ? null : loadDraft();
  for (const k of TEXT) form.elements[k].value = (draft && k in draft ? draft[k] : fill[k]) ?? '';
  if (!editMode && request?.status === 'returned' && request.office_note) note(`<b>The league office sent this back:</b> ${esc(request.office_note)}`);
  else if (editMode && open?.status === 'pending') note('<b>Waiting for the league office.</b> Your name, code and crest changes below are waiting for approval. Changing them again replaces the request.');
  else if (editMode && open?.status === 'returned') note(`<b>The league office sent this back:</b> ${esc(open.office_note || 'No note.')} Fix it below and save to resend.`);
  else note('');
  codeState = 'ok';
  checkCode(); counters(); paintColours();
  return draft;
}

// ---------------------------------------------------------------- start
chrome();
const me = await enter('setup.html');
if (me) {
  const main = $('main');
  try {
    // The wizard shows once per round: only while the club's setup_at is null (the office can reopen it). After that,
    // setup.html sends people Home; ?edit (from Home's "Edit club" and "Fix and resend") is the later-changes form.
    editMode = new URLSearchParams(location.search).has('edit');
    if (!editMode && !me.profile.needs_setup) { location.replace('home.html'); throw 'redirect'; }
    document.body.classList.toggle('su-edit', editMode);
    const draft = await load();

    $('to-home').hidden = !editMode;   // in the wizard there's no Home to go back to yet
    if (editMode) {
      document.title = `Edit ${club.name} | vLeague`;
      $('page-label').textContent = 'Edit club';
      $('title').textContent = 'Edit your club';
      $('kicker').textContent = club.name;
      $('lead').textContent = 'Colours, motto, manager name and stadium change straight away. A new name, code or crest goes to the league office first.';
      $('steps').hidden = true;
      $('back').hidden = true;
      $('next-label').textContent = 'Save';
    } else {
      $('lead').textContent = 'Four quick steps to make your club yours. The league office checks your name, code and crest before they go live.';
      form.querySelectorAll('[data-edit-only]').forEach(el => { el.hidden = true; });
    }

    form.addEventListener('input', e => {
      const k = e.target.name || e.target.id;
      if (k === 'code') checkCode();
      if (k === 'colour-pick' || k === 'colour2-pick') form.elements[k.replace('-pick', '')].value = e.target.value;
      if (/colour|name|code/.test(k)) paintColours();
      counters(); saveDraft();
    });
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
    form.addEventListener('click', e => {
      const target = e.target.closest('[data-go]');
      if (!target || editMode) return;
      const n = Number(target.dataset.go);
      if (target.tagName === 'LI' && n > step) {
        // Moving forward from the step list only past steps that are complete.
        for (let i = step; i < n; i++) { const msg = validate(i); if (msg) { go(i); return showError(msg); } }
      }
      go(n);
    });
    form.addEventListener('submit', submit);

    $('loading').remove();
    form.hidden = false;
    go(editMode ? 0 : Math.min(Math.max(Number(draft?.step) || 1, 1), 5));
  } catch (e) {
    if (e !== 'redirect') main.innerHTML = `<p class="quiet">${esc(explain(e, 'Your club didn’t load.'))} <a href="setup.html${location.search}">Try again</a></p>`;
  }
  main.setAttribute('aria-busy', 'false');
}
