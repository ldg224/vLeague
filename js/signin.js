// The sign-in page: send an already signed-in visitor straight in, a returning guest to the dashboard
// (unless they came via index.html?signin to sign in), otherwise handle the form.
import { signIn, currentUser, ready, setGuest, isGuest } from './auth.js';
import { VERSION } from './version.js';

const $ = s => document.querySelector(s);
$('#version').textContent = `v${VERSION}`;

const form = $('#signin'), err = $('#error'), btn = $('#go'), label = btn.querySelector('.label');
const email = $('#email'), password = $('#password');

function showError(text, field) {
  err.textContent = text;
  err.hidden = false;
  for (const el of [email, password]) el.removeAttribute('aria-invalid');
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
}

if (!ready) {
  const setup = $('#setup');
  setup.textContent = 'Signing in isn’t available yet. You can still view as a guest.';
  setup.hidden = false;
}

// Guests need no Supabase, so this works even before the sign-in service is connected.
$('#guest').addEventListener('click', () => setGuest(true));

const wantsSignIn = new URLSearchParams(location.search).has('signin');
currentUser().then(user => {
  if (user) location.replace('hello.html');
  else if (isGuest() && !wantsSignIn) location.replace('dashboard.html');
});

$('#show').addEventListener('click', e => {
  const on = password.type === 'password';
  password.type = on ? 'text' : 'password';
  e.currentTarget.textContent = on ? 'Hide' : 'Show';
  e.currentTarget.setAttribute('aria-pressed', String(on));
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.hidden = true;
  if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return showError('Enter your email address.', email);
  if (!password.value) return showError('Enter your password.', password);
  btn.disabled = true; label.textContent = 'Signing in…';
  try {
    await signIn(email.value, password.value, $('#remember').checked);
    location.replace('hello.html');
  } catch (x) {
    showError(x.message, password);
    password.select();
  } finally {
    btn.disabled = false; label.textContent = 'Sign in';
  }
});
