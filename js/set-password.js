// Choose a password: the page that invite emails and "Forgot password?" emails link to.
// supabase-js turns the link into a session on load; without one, the link has expired (or was already used).
import { currentUser, myProfile, landingPage, setPassword, db } from './auth.js';
import { startPage } from './prefs.js';
import { VERSION } from './version.js';

const $ = s => document.querySelector(s);
$('#version').textContent = `v${VERSION}`;

const form = $('#choose'), err = $('#error'), btn = $('#go'), label = btn.querySelector('.label');
const password = $('#password'), confirm = $('#confirm');

// Supabase reports a used or expired link in the address (#error_code=otp_expired…) instead of making a session.
const link = new URLSearchParams(location.hash.slice(1) || location.search);
const linkError = link.get('error');
const invited = link.get('type') === 'invite';

function showExpired() {
  $('#checking').hidden = true;
  form.hidden = true;
  $('#expired').hidden = false;
  history.replaceState(null, '', location.pathname);   // drop the spent tokens / error from the address
}

function showError(text, field) {
  err.textContent = text;
  err.hidden = false;
  for (const el of [password, confirm]) el.removeAttribute('aria-invalid');
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

// An invite is the first page a new manager sees: welcome them by their club's name.
async function clubName() {
  const profile = await myProfile();
  if (!profile?.club) return '';
  const { data } = await (await db()).from('clubs').select('name').eq('code', profile.club).maybeSingle();
  return data?.name || '';
}

currentUser().then(async user => {
  if (!user || linkError) return showExpired();
  history.replaceState(null, '', location.pathname);
  const club = invited ? await clubName().catch(() => '') : '';
  if (invited) {
    document.title = 'Welcome | vLeague';
    $('#choose-title').textContent = 'Welcome to vLeague';
  }
  $('#checking').hidden = true;
  $('#for').textContent = club ? `${club} · ${user.email}` : user.email;
  $('#username').value = user.email;
  form.hidden = false;
  password.focus();
});

$('#show').addEventListener('click', e => {
  const on = password.type === 'password';
  password.type = confirm.type = on ? 'text' : 'password';
  e.currentTarget.textContent = on ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(on));
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.hidden = true;
  if (password.value.length < 8) return showError('Use at least 8 characters.', password);
  if (confirm.value !== password.value) return showError('The two passwords don’t match.', confirm);
  btn.disabled = true; label.textContent = 'Saving…';
  try {
    await setPassword(password.value);
    location.replace(await startPage(landingPage(await myProfile())));
  } catch (x) {
    if (/expired/i.test(x.message)) return showExpired();
    showError(x.message, password);
  } finally {
    btn.disabled = false; label.textContent = 'Save password';
  }
});
