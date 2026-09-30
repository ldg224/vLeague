# Backend: Supabase (free)

vLeague's accounts and data live in **Supabase**, a hosted Postgres database with built-in accounts. The free plan
covers this easily: 50,000 monthly active users (we need about 10), a 500 MB database, 1 GB of file storage.
The website stays on GitHub Pages; it talks to Supabase directly from the browser.

A project that gets **no activity for 7 days is paused**. It's restored from the Supabase dashboard with one click
(nothing is lost). During the season the site keeps it active.

## How it's set up (as of 0.3.0)

Project `ywkhjpfzqtfssbxbvnbl` (Sydney). The URL and the **anon public** key are in `js/config.js`; both are safe to
publish, because the database rules decide what they can do. The `service_role` key never goes in the website.

**Authentication settings**

| Setting | Value |
|---|---|
| New sign-ups | **Off**. Accounts are made or invited by the league office. |
| Site URL | `https://ldg224.github.io/vLeague/` |
| Allowed redirects | `https://ldg224.github.io/vLeague/**`, `http://localhost:8767/**` (local testing) |
| Minimum password | 8 characters |
| Email | Gmail SMTP from **vLeague &lt;vleague.admin@gmail.com&gt;** (an app password, not the account password). Up to 30 emails an hour. |

Supabase's built-in email only reaches members of the Supabase organisation, 2 an hour, so the Gmail sender is what
makes invites and password resets work.

**Database** (`supabase/migrations/`, run in order):

| Table | What | Who can read | Who can change |
|---|---|---|---|
| `clubs` | Each club's public identity: code, name, colours, crest, manager name, status | Everyone, guests too | League office |
| `profiles` | One per account: role (`manager` or `office`) and club. Made automatically for every new account. | Yourself; the office reads all | League office only (nobody can promote themselves) |
| `team_sheets` | Each club's current team sheet (formation, tactics, XI, set pieces) | That club's manager and the office | That club's manager and the office |

Storage bucket **`crests`**: public to read; PNG or WebP up to 500 KB; a manager can upload only into their own club's
folder (`tur/…`), the office anywhere. Crests are 512 px.

The league office is **lukedanielgrogan@gmail.com** (role `office`), and it's the only one.

**Checking the rules:** `python supabase/tests/rls_check.py` acts as a guest, a manager, an account with no club
and the office, and checks what each can read and change (15 checks; nothing is left behind). Run it after any
database change. It needs the Management API token in `C:\Users\offic\.vleague\supabase-token.txt`.

## Adding a manager

1. Invite them with the redirect set to the "Set your password" page, e.g. with the admin API:
   `inviteUserByEmail(email, { redirectTo: 'https://ldg224.github.io/vLeague/set-password.html' })`.
   **Always** set that redirect: without it the link signs them in on the home page and they never choose a password.
2. They get an email from vLeague, choose a password, and land on their Home.
3. Link the account to its club: `update public.profiles set club = 'TUR' where id = (select id from auth.users where email = '…')`.
   (The Editor gets buttons for invite and linking in a later version.)

Forgotten passwords: "Forgot password?" on the sign-in page emails a link to `set-password.html`.
