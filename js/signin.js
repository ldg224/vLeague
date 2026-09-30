// The sign-in page: send an already signed-in visitor straight in, otherwise handle the form.
import { signIn, currentUser, ready } from './auth.js';
import { startPhotos } from './photos.js';

const $ = s => document.querySelector(s);
startPhotos();

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
  setup.textContent = 'The sign-in service is being set up. Signing in will work once the league office connects it.';
  setup.hidden = false;
}

currentUser().then(user => { if (user) location.replace('hello.html'); });

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
