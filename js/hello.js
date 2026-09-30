// The first signed-in page: only shown with a session; otherwise back to sign in.
import { currentUser, signOut } from './auth.js';
import { startPhotos } from './photos.js';

const user = await currentUser();
if (!user) {
  location.replace('index.html');
} else {
  const name = user.user_metadata?.name || user.user_metadata?.full_name;
  document.getElementById('who').textContent = name ? `${name} · ${user.email}` : `Signed in as ${user.email}`;
  document.getElementById('page').hidden = false;
  startPhotos(9000);
  document.getElementById('signout').addEventListener('click', async () => {
    await signOut();
    location.replace('index.html');
  });
}
