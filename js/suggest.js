// "Suggest changes" (0.46.0): a footer link for signed-in managers that opens a small form. It sends an issue or a suggestion
// to the `suggest` Edge Function, which makes a card on the league's Trello board. Guests never see the link, and the function
// refuses anyone who isn't a manager or the office. Called by chrome() in member.js on every signed-in page.
import { myProfile, db } from './auth.js';

const FORM = `<form method="dialog" class="sg-form" novalidate>
  <h2>Suggest changes</h2>
  <p class="sg-sub">Found something wrong, or have an idea? It goes straight to the league's to-do board.</p>
  <fieldset class="sg-kind"><legend class="sg-lbl">What is it?</legend>
    <label><input type="radio" name="kind" value="issue" checked><span>Issue</span></label>
    <label><input type="radio" name="kind" value="suggestion"><span>Suggestion</span></label>
  </fieldset>
  <label class="sg-lbl" for="sg-title">Title</label>
  <input id="sg-title" name="title" maxlength="80" autocomplete="off" placeholder="A few words">
  <label class="sg-lbl" for="sg-details">Details <small>(optional)</small></label>
  <textarea id="sg-details" name="details" rows="5" maxlength="1500" placeholder="What happened, or what would you like?"></textarea>
  <p class="sg-msg" role="status"></p>
  <div class="sg-btns"><button type="button" class="sg-b" data-close>Cancel</button><button type="submit" class="sg-b go">Send</button></div>
</form>`;

function open() {
  const dlg = document.createElement('dialog');
  dlg.className = 'sg-dialog';
  dlg.innerHTML = FORM;
  const form = dlg.querySelector('form'), msg = dlg.querySelector('.sg-msg'), send = dlg.querySelector('.go');
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if ((body.title || '').trim().length < 3) { msg.textContent = 'Give it a short title.'; return; }
    send.disabled = true;
    msg.textContent = 'Sending…';
    try {
      const { data, error } = await (await db()).functions.invoke('suggest', { body });
      let problem = data?.error;
      if (error) problem = (await error.context?.json?.().catch(() => null))?.error || 'It didn’t send. Try again.';
      if (problem) { msg.textContent = problem; send.disabled = false; return; }
    } catch { msg.textContent = 'It didn’t send. Try again.'; send.disabled = false; return; }
    form.innerHTML = '<h2>Thank you</h2><p class="sg-sub">Sent to the league’s board.</p><div class="sg-btns"><button type="button" class="sg-b go" data-close>Close</button></div>';
  });
  document.body.append(dlg);
  dlg.showModal();
  dlg.querySelector('#sg-title').focus();
}

// Add the link to the page's footer, for a signed-in manager or the office only.
export async function mountSuggest() {
  const foot = document.querySelector('.member-foot');
  if (!foot || foot.querySelector('.sg-link')) return;
  const profile = await myProfile().catch(() => null);
  if (!profile || !['manager', 'office'].includes(profile.role)) return;
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'sg-link';
  link.textContent = 'Suggest changes';
  link.addEventListener('click', e => { e.preventDefault(); open(); });
  foot.prepend(link);
}
