# Backend: Supabase (free)

vLeague's sign-in and data live in **Supabase**, a hosted Postgres database with built-in accounts. The free plan
covers this easily: 50,000 monthly active users (we need about 10), a 500 MB database, and no credit card.
The website stays on GitHub Pages; it talks to Supabase directly from the browser.

One thing to know about the free plan: a project that gets **no activity for 7 days is paused**. It's restored
from the Supabase dashboard with one click (nothing is lost). During the season the site keeps it active.

## 1. Make the project (about 5 minutes)

1. Go to <https://supabase.com> and sign up (a GitHub login works).
2. **New project**: name `vleague`, pick a strong database password (save it somewhere), region **Sydney**
   (ap-southeast-2), plan **Free**. Wait a minute for it to start.

## 2. Accounts: only the ones you make

1. **Authentication → Sign In / Providers**: under **Email**, keep Email enabled, and turn **off**
   "Allow new users to sign up". Now nobody can create their own account.
   (Also turn off "Confirm email", or accounts you create will need to click a link first.)
2. **Authentication → Users → Add user → Create new user** for each manager and the league office:
   their email, a temporary password, and tick **Auto Confirm User**. Send each person their details.
3. Optional: to show names on the site, open a user and set **User metadata** to `{"name": "Luke Grogan"}`.

## 3. Connect the website

1. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
2. Put them in `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi…';
   ```
   Both are safe to publish. The anon key can only do what the database rules allow, and sign-ups are off.
   **Never** put the `service_role` key in the website.
3. **Authentication → URL Configuration**: set **Site URL** to `https://ldg224.github.io/vLeague/`.
4. Commit and push. Signing in on the site now works; a wrong password shows a clear message.

## 4. Later: league data

League data (teams, fixtures, results, press) will go in Supabase tables with **Row Level Security** on,
so each manager can only change their own team and only the league office can change the league. That comes
with the next steps; nothing to do yet.
