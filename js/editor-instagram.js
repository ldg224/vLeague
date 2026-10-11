// Editor -> News -> Instagram (WR-30): the account link, the latest two posts (pasted links, shown as Instagram's own embed on the league page's
// Overview) and two optional numbers. One row in league_social (supabase/migrations/0052_league_social.sql); the database checks the links again.
import { postLink, accountLink, DEFAULT_ACCOUNT } from './instagram.js';

export const instagramView = () => '<h2 class="nw-h">Instagram</h2><div id="ig-root"><p class="quiet">Loading…</p></div>';

export async function mountInstagram({ db, esc, explain }) {
  const root = document.getElementById('ig-root');
  if (!root) return;
  const client = await db();
  const { data, error } = await client.from('league_social').select('*').eq('id', 1).maybeSingle();
  if (error) { root.innerHTML = `<p class="quiet">${esc(explain(error))}</p>`; return; }
  const row = data || { instagram_url: DEFAULT_ACCOUNT, instagram_posts: [], followers: null, posts: null }, posts = row.instagram_posts || [];
  root.innerHTML = `<form class="nw-card ig-form" novalidate>
    <p class="nw-note">Shown on the league page's Overview. Open a post on Instagram, copy its link (Share, Copy link) and paste it here: the newest first. Instagram's embed loads from instagram.com.</p>
    <label class="nw-field">Account link<input type="url" name="account" maxlength="120" value="${esc(row.instagram_url || DEFAULT_ACCOUNT)}" placeholder="${DEFAULT_ACCOUNT}"></label>
    <label class="nw-field">Newest post <small>link, or leave empty</small><input type="url" name="p1" maxlength="200" value="${esc(posts[0] || '')}" placeholder="https://www.instagram.com/p/…"></label>
    <label class="nw-field">Second newest post <small>link, or leave empty</small><input type="url" name="p2" maxlength="200" value="${esc(posts[1] || '')}" placeholder="https://www.instagram.com/p/…"></label>
    <div class="nw-row">
      <label class="nw-field">Followers <small>optional, you type it</small><input type="number" name="followers" min="0" max="100000000" inputmode="numeric" value="${row.followers ?? ''}"></label>
      <label class="nw-field">Posts <small>optional, you type it</small><input type="number" name="posts" min="0" max="1000000" inputmode="numeric" value="${row.posts ?? ''}"></label>
    </div>
    <div class="nw-actions"><button class="btn" type="submit">Save Instagram</button></div>
    <p class="nw-msg" role="status"></p></form>`;
  const form = root.querySelector('form'), msg = root.querySelector('.nw-msg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const account = accountLink(form.account.value), list = [form.p1.value, form.p2.value].map(v => v.trim());
    if (!account) { msg.textContent = 'That account link isn’t an instagram.com profile.'; form.account.focus(); return; }
    const bad = list.findIndex(v => v && !postLink(v));
    if (bad >= 0) { msg.textContent = `Post ${bad + 1} isn’t an Instagram post, reel or video link (instagram.com/p/…).`; form[`p${bad + 1}`].focus(); return; }
    const num = v => (v === '' ? null : Math.max(0, Math.floor(Number(v))));
    const btn = form.querySelector('button'); btn.disabled = true; msg.textContent = 'Saving…';
    const { error: err } = await client.from('league_social').upsert({
      id: 1, instagram_url: account, instagram_posts: list.map(v => v && postLink(v)).filter(Boolean),
      followers: num(form.followers.value), posts: num(form.posts.value), updated_at: new Date().toISOString(),
    });
    btn.disabled = false;
    if (err) { msg.textContent = explain(err); return; }
    msg.textContent = 'Saved. The Overview shows it next time the page opens.';
  });
}
