// The sign-in page: send an already signed-in visitor to their home (the league page, league.html),
// otherwise handle the form. index.html?reset opens "Forgot password?" straight away (from an expired email link).
import { signIn, currentUser, myProfile, landingPage, sendPasswordReset, ready } from './auth.js';
import { startPage } from './prefs.js';
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
  setup.textContent = 'Signing in isn’t working right now.';
  setup.hidden = false;
}

const goHome = async () => location.replace(await startPage(landingPage(await myProfile())));

currentUser().then(user => { if (user) goHome(); });

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

if (new URLSearchParams(location.search).has('reset')) showReset(true);
