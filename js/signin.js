// The sign-in page: send an already signed-in visitor to their home (editor.html for the league office, home.html for managers), a returning guest to the dashboard
// (unless they came via index.html?signin to sign in), otherwise handle the form.
import { signIn, currentUser, myProfile, landingPage, sendPasswordReset, ready, setGuest, isGuest } from './auth.js';
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
const goHome = async () => location.replace(landingPage(await myProfile()));

currentUser().then(user => {
  if (user) goHome();
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
    await goHome();
  } catch (x) {
    showError(x.message, password);
    password.select();
  } finally {
    btn.disabled = false; label.textContent = 'Sign in';
  }
});

// Forgot password: swap the sign-in form for a one-field form. The reply is the same whether or not the
// email has an account, so the page never reveals who is signed up.
const reset = $('#reset'), resetEmail = $('#reset-email'), resetErr = $('#reset-error'), resetSent = $('#reset-sent');
const resetBtn = $('#reset-go'), resetLabel = resetBtn.querySelector('.label');

function showReset(on) {
  form.hidden = on; reset.hidden = !on;
  if (on) {
    resetErr.hidden = resetSent.hidden = true;
    resetEmail.value = email.value.trim();
    resetEmail.focus();
  } else {
    $('#forgot').focus();
  }
}
$('#forgot').addEventListener('click', () => showReset(true));
$('#reset-back').addEventListener('click', () => showReset(false));

reset.addEventListener('submit', async e => {
  e.preventDefault();
  resetErr.hidden = resetSent.hidden = true;
  resetEmail.removeAttribute('aria-invalid');
  if (!/^\S+@\S+\.\S+$/.test(resetEmail.value.trim())) {
    resetErr.textContent = 'Enter your email address.'; resetErr.hidden = false;
    resetEmail.setAttribute('aria-invalid', 'true'); resetEmail.focus();
    return;
  }
  resetBtn.disabled = true; resetLabel.textContent = 'Sending…';
  try {
    await sendPasswordReset(resetEmail.value);
    resetSent.hidden = false;
  } catch (x) {
    resetErr.textContent = x.message; resetErr.hidden = false;
  } finally {
    resetBtn.disabled = false; resetLabel.textContent = 'Send link';
  }
});
