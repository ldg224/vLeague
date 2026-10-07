# Changelog

Every published version of the vLeague app. Newest first. How versions work and how to roll back:
`docs/RELEASING.md`.

## 0.34.1 (2026-10-07)

No database change in the app (one data fix, below).

- **Fixed:** three clubs (NEE, PRF, SSF) showed coloured initials instead of their crest everywhere. Their saved crest paths pointed at old
  folder names, but the pictures were stored under the new club codes. The paths now point at the real files.
- **Fixed:** a crest that failed to load once (easy on a weak phone connection, the pictures are 250 to 400 KB) stayed as initials until the
  page was reloaded. It is now tried a second time before the initials stand in.

## 0.34.0 (2026-10-07)

Matches and the Game centre. No database change.

- **Added, managers:** a **Matches** tab: a card for every game of the round (Home, **Matches**, League, ...). Each card shows both clubs with league
  position and form, the score or kick-off time, the **win chance**, the stadium, and each club's home or away record. Tap a card to open the
  Game centre. Scores follow the same spoiler-free rules as League.
- **Added:** the **Game centre** (`game.html`), the page for one match. Open to guests too. Before kick-off: a preview (win chance, side-by-side
  comparison, this season's meetings, line-ups once locked). From kick-off: **Watch** (a top-down replay of the match; live games follow the
  broadcast and can be scrubbed back but never ahead), **Timeline**, **Stats** (possession, xG, shots, passes and more, counted only up to now
  while live) and **Line-ups** with ratings and Man of the Match at full time. The 3D view is still to come.
- **Changed:** every match link (League, Home, the guest dashboard) now opens the Game centre. Before this they went nowhere.
- **Win chance:** worked out from the starting XI's attack and defence ratings (the locked line-ups, else each club's best 4-3-3), goals scored
  and conceded so far (counting for more as the season goes on), recent form, the league's home advantage and this season's meetings. Each side
  gets an expected number of goals and the win, draw and loss chances come from every possible scoreline. League keeps its plain match rows with
  no win chance on them.

## 0.33.2 (2026-10-07)

- **Fixed:** every page failed to load after 0.33.1, because the version file had been emptied by mistake. The version file is back.

## 0.33.1 (2026-10-07)

No database change.

- **Changed, managers:** the Home "What's new" note is always open (no tap needed).
- **Removed, Editor → Draft:** the draft status label and clock from the top of the page. The Start, Pause and Resume buttons stay.

## 0.33.0 (2026-10-07)

No database change.

- **Added, managers:** a small **What's new** note on Home, just under the club name: the latest version, its one-line summary and, when you tap it,
  the main changes (Editor-only changes are left out). It reads `CHANGELOG.md` itself, so there is nothing extra to write at release time.

## 0.32.0 (2026-10-07)

Draft: a visibility switch, a big status bar, and a simpler page. Needs `0033_draft_visible.sql` (run it once).

- **Added, Editor → Draft:** a big **MAKE PAGE VISIBLE: NO / YES** switch at the very top. It is separate from starting the draft, so you can
  open the page to managers early. A draft that is already live, paused or finished stays visible. Only one draft is shown to managers, so
  switching one on turns the others off. New drafts start hidden.
- **Added, managers:** once the page is visible, managers can read everything about the upcoming draft and **build their queues and
  auto-pick settings before it starts**, or while its open time is still later. Picking waits until the draft is live and open.
- **Added, managers:** a big **status bar** at the top: Not started yet, Opens soon (with a countdown), Live (whose pick it is, and the clock),
  Paused, Closed or Finished. It is tinted when it is your pick. Roster rules and quiet times are its small print.
- **Removed, managers:** the Picked players table (and its filters) under the draft grid on the Board. The grid is the board now; Download
  CSV sits next to it. The tour is updated to match.
- **Changed, Editor → Draft:** a bigger status bar with the main button (Start, Pause or Resume) and the rarer actions under **More
  actions**. Pick for a club, Auto-assign, Recent picks, Clubs' queues and Start another draft now fold away until you open them.

## 0.31.1 (2026-10-07)

- **Fixed:** typing in the Draft page's **Search** and **Max value** boxes. The boxes were being rebuilt after every keystroke, which dropped
  the cursor (and closed a phone's keyboard) so you could only type one character at a time. The page now updates the table around the
  box and leaves the box itself alone. The **Max value** box was also being written into the search text by mistake; it now filters by
  value as intended.

## 0.31.0 (2026-10-07)

Draft as a grid, and drag-and-drop draft order. No database change.

- **Added, managers:** the Draft **Board** now starts with the draft as a grid: a row for each round, a column for each club, and in each
  cell the pick number and who was taken (the pick on the clock is outlined, your club's column is tinted). It updates live like the rest
  of the page.
- **Added, Editor → Draft → Draft order:** the same grid, where you **drag an unmade pick onto another to swap them**. Before any pick is
  made you can also **drag a club's column heading** to change its draft position in every round (snake order carries over). On a phone
  or with a keyboard: press a pick, then press the pick to swap it with, and use the ◀ ▶ buttons on the headings. Made picks stay fixed.
  The earlier tools (swap, move, add, reverse, shuffle, rotate) are all still there.

## 0.30.0 (2026-10-07)

Inbox: delete buttons, press conferences and reactions. Needs `0032_press_reactions.sql` (run it once).

- **Added, Inbox:** every post has a small **✕ delete** button, and **Clear all** removes the lot. It only clears *your* Inbox (everyone else
  still has the post), it follows your account across devices, and an **Undo** link brings the posts back right away. The phone-number
  post can't be deleted until a number is saved, and an open press conference can't be deleted.
- **Added, press conferences:** from 24 hours before kick-off, a pinned Inbox item asks three questions with a few preset answers each
  (confident, humble, deflecting). Pick one per question and change it any time until kick-off. Answers move four meters (fans, happiness,
  team, opposition), each capped at 3%. After kick-off, both clubs' answers show as quotes. The match uses the **Team** and **Opposition**
  meters: a club's players play at up to 3% better or worse, and so do its opponent's. Both clubs are asked the same three questions
  (picked from a bank of eight by the match).
- **Added, reactions:** 👍 🔥 😂 👏 😮 on news posts and on press quotes, one per person, press again to take it back.
- **Changed:** a week's line-ups now always lock **at or before its first kick-off**. A lock time typed by hand that is later than the
  first game is pulled back to the first kick-off, and the Editor says so.
- **Database:** `0032_press_reactions.sql` adds `press_questions`, `press_answers` (written only through `save_press_answer()`, which
  checks the window and the club) and `reactions`, and fixes the lock rule. Checked in `supabase/tests/rls_check.py`.

## 0.29.2 (2026-10-07)

- **Fixed:** on the Draft page, the **Max value** box lost its cursor after every digit, so you had to click back in to type each number. It now keeps the cursor.

## 0.29.1 (2026-10-07)

- **Changed:** the **Draft** tab is always there for managers. When no draft is open it shows a small preview: the draft's name, when it opens and closes, and the pick order.

## 0.29.0 (2026-10-07)

Draft: emails, instant updates, a better phone page. Needs `0031_draft_notifications.sql` (run it once) and the two email functions
redeployed (`send-reminders`, `email-unsubscribe`).

- **Added, emails:** managers now get **"You're on the clock"** when their pick starts and **"Your pick time is nearly up"** (about two
  hours of timer left, for drafts with picks of three hours or more). They explain what happens if the manager isn't around (their queue,
  else a random player who fits). They never go out in the draft's quiet times or between 10 pm and 8 am, a pick is emailed once, and a
  club on "auto-pick the moment it's my turn" isn't emailed. New Settings choice **Draft: your pick** (On the clock + warning, On the
  clock, Off), and every email has its one-click turn-off.
- **Added, instant updates:** the Draft page updates the moment anyone picks or the clock changes (it still checks every 15 seconds as a
  backup). It also no longer jumps back to the top of a long table on each refresh, and doesn't redraw when nothing changed.
- **Added, phones:** the page now fits a phone's screen (a wide table was stretching the whole page sideways). Available players has
  **Players / My queue / Auto-pick** buttons instead of one long scroll, and its table fits without sideways scrolling: one button per row
  (Pick on your turn, otherwise +), and ratings OFF and DEF.
- **Added:** **tap a player's name** for their card (ratings, value, who has them, Queue and Pick buttons); **Max value** and **Fits my
  squad** filters on Available players; a proper **Pick dialog** (instead of the browser's plain popup) showing the player's ratings and
  what the pick does to your budget and position count; **Download CSV** of the board.
- **Fixed:** the Editor's email link for the clubs-without-a-team digest pointed at the removed Deadlines tab; it now opens Fixtures.
- **Database:** `0031_draft_notifications.sql` adds the draft emails to `due_emails()` and turns on live updates for the draft tables.
  Checked with a dry run of 10 email cases (timing, settings, quiet times, once-only, auto-pick clubs).

## 0.28.1 (2026-10-07)

Draft: a missed pick is no longer lost. Needs `0030_draft_random_instead_of_skip.sql`.

- **Changed:** where the draft used to **skip** a pick (time ran out with nothing in the queue), it now picks a **random free
  player who fits one of the club's open spots**, using the same roster rules as manager picks (position maximums, and keeping each
  position's minimum reachable). It only skips if nobody left fits. "When time runs out" options now read: *a random player who
  fits*, *the next player in their queue, else a random player who fits*, and *the best-value player who fits* (random if none
  is allowed). Existing drafts keep working with no edit.
- **Changed, Editor:** "Skip this pick" is now **Random pick for them**, and does the same.
- Checked with a dry run of 8 cases (never picks a full position, each timeout rule, nobody fits, office and guest access).

## 0.28.0 (2026-10-07)

Draft active times. Needs `0029_draft_active_times.sql` (run it once).

- **Added:** **Active times** in Editor → Draft. Add quiet times (for example 10 pm to 7 am every night, or a weekday lunch break)
  when the **pick timer doesn't run**. Nobody is locked out: managers and the office can still pick in them, and the draft keeps
  working. Only the countdown stops, so a pick that starts at 3 am gets its full time counted from 7 am. Pick days, a start and
  an end, add as many as you like, or use "Every night, 10 pm to 7 am". Times are Melbourne time.
- **Changed, managers' Draft page:** the clock shows **active time left** and freezes with "Timer paused" during a quiet time, with
  a note saying when it resumes ("You can still pick"). When quiet times are set, a line under the roster rules lists them, and the
  tour has a step for it. The Editor's clock does the same.
- **Changed:** the pick timer, "Extend by", the "after N minutes" auto-pick and "if I miss my turn" all count active time only.
  Changing the quiet times mid-draft keeps the active time the current pick had left. Auto-pick set to "the moment it's my
  turn" is unchanged. Drafts with no quiet times behave exactly as before.
- **Database:** `drafts.quiet` (the schedule) and `drafts.pick_started`, and functions that work out deadlines skipping quiet time
  (`0029_draft_active_times.sql`). Checked with a dry run of 26 cases (overnight, daytime, weekend-crossing, invalid input).

## 0.27.1 (2026-10-07)

- **Fixed, Draft:** the Available players table was drawn wrongly: its heading row didn't line up with the players and shared
  space with the first one, and there was a wide empty gap. The table was accidentally picking up the page's two-column layout.
  The headings are now a solid row above the players, the columns line up under them, and the Player column no longer stretches.

## 0.27.0 (2026-10-07)

Byes, and one less Editor tab. Needs `0028_byes.sql` (run it once).

- **Added, byes:** a week can now name the clubs that are **on a bye**. In Editor → Fixtures, under each week, clubs with no match
  are split into **No match or bye yet** (with a **Bye** button each, and **All on a bye**) and **On a bye** (✕ to undo). The
  Checks list no longer mentions a club on a bye; it still flags a club that has neither a match nor a bye, so an unfinished
  roster still shows up. "Clubs by week" shows **Bye** for a bye and "–" for not placed yet. Weeks made by Quick create, the
  planner or Fill the rest record their byes automatically, and the bye counts and fair rotation use the byes you set.
- **Removed:** the **Deadlines** tab. Line-up locks are set per round in Fixtures (a lock rule, or an exact time), and have been
  worked out from kick-offs since 0.13. A locked week there now also shows how many team sheets were saved ("14 of 16 team
  sheets"). The **Email me about clubs without a team** checkbox moved to the top of **Clubs**. Old `#deadlines` links open Clubs.
- The public Fixtures page is unchanged: it still shows a "Bye" for any club without a match.

## 0.26.0 (2026-10-07)

A guided tour of the Draft page.

- **Added:** a **How it works** tour on the Draft page. The screen darkens, a glowing spotlight moves from one part of the page to
  the next (clock, budget, tabs, board, sorting, available players, queue, auto-pick, making a pick, team values) and a card
  explains each in plain words. Next/Back buttons or arrow keys, Esc to leave. It opens by itself the first time a manager visits
  the Draft page, and the **? How it works** button beside the tabs starts it again any time. It follows reduced-motion settings.
- **Changed, Draft tables:** headings now line up with their columns (numbers centred, value on the right). OFF, DEF and OVR use the
  same red-to-green rating chips as the club page, and the tables are lighter: smaller headings, muted club/value/how columns.

## 0.25.0 (2026-10-07)

The managers' Draft page, reorganised.

- **Added:** a **weekly budget bar** under the roster rules: how much of the $100,000 cap your squad uses, how much is left, and a
  warning colour near and over the cap. It's a guide, not a block: a pick over the cap still goes through.
- **Changed, Board:** the full spreadsheet of every **picked** player: pick number, club, position, name, number, offensive,
  defensive and overall rating, value, and how it was picked (picked, queue, auto, office, skipped). Filter by club, position or
  name, and sort by several levels.
- **Changed, Available players:** a new tab with **My queue** and **Auto-pick** down the left side and the full sortable table of
  free players beside it. Auto-pick is now two dropdowns (what to pick, when) and saves as you change them.
- **Changed:** the page now uses the full width of the screen (it was squeezed into a narrow column). Team values shows each club's
  total against the cap.
- **Removed:** the separate My queue and Auto-pick tabs (old links to them open Available players).

## 0.24.0 (2026-10-07)

Draft: smarter auto-pick and a sortable board. Needs `0027_draft_pick_how.sql` (run).

- **Added, auto-pick:** two questions now. **What** to pick: from my queue (the first player still free who fits the roster
  rules), or a **random** player who fits. **When**: the moment it's my turn, after a few minutes, if I miss my turn, or never.
  Managers set it on the Auto-pick tab; the office can see and change it per club in the Editor.
- **Changed, the board:** the Available players are now a full table: position, name, number, offensive rating, defensive rating,
  overall rating and value. Tap a heading to sort by it, tap again to flip it. Add more levels with Shift-tap or "Then by…" (for
  example Position, then Defensive rating high to low, to find a strong defender). The chips above the table show the order and
  flip or remove each level.

## 0.23.0 (2026-10-07)

More draft tools (Editor → Draft). Needs `0026_draft_tools.sql` (run).

- **Added, roster rules:** the fewest and most players a club may hold in each position (for example at most 5 defenders). Set when
  creating a draft or later under **Draft settings**. Managers' picks and every automatic pick (queue, timeout, auto-assign) follow
  them, and the database refuses a pick that breaks them. A minimum also has to stay reachable: a club can't use up the picks it needs
  to fill a position. Your own picks from the Editor are overrides and ignore the rules. Managers see the rules on the Draft board,
  and the Pick button is greyed out for a player their club can't take.
- **Added, order tools:** swap two picks, move a pick, add an extra pick, remove a pick, reverse, shuffle or rotate the unmade picks,
  and ▲ ▼ ✕ on each pick. Rebuild the order with the first round shuffled, lowest or highest team value first, or A to Z.
- **Added, draft tools:** **Delete draft** at any stage (choose whether its drafted players return to free agents), **Reset to set-up**,
  **Finish now**, **Duplicate**, and editing a draft's name, window, pick time and timeout rule after it is created.
- **Changed:** the auto-assign preview skips players a club isn't allowed to take.

## 0.22.1 (2026-10-07)

- **Fixed:** the Editor's News and Draft tabs were squeezed into a narrow column. They now use the full width, like Players and Fixtures.

## 0.22.0 (2026-10-07)

Draft, office side. Needs `0023_draft.sql`, `0024_draft_tick.sql` and `0025_week_ladder.sql` (all run).

- **Added:** an **Editor → Draft** tab. Create a draft (window, time per pick, rounds, what happens when time runs out), build or
  shuffle the order (snake or the same every round) and change any single pick. Start, pause, resume and extend the clock, skip
  a pick, or make/override the pick on the clock. **Auto-assign the rest** shows a preview first and can be undone; **Undo last
  pick** takes back a pick. See every club's queue and auto-pick rule, change the rule, or remove a queued player.
- **Added:** the draft clock runs in the database (every minute): a club's auto-pick rule and the timeout rule are applied
  without anyone watching.
- **Fixed:** the Draft tab flashed up for everyone, then vanished. It now stays hidden until a draft is open.
- **Not yet:** "you're on the clock" emails.

## 0.21.1 (2026-10-06)

- **Added:** each week has a **Counts for the ladder** setting (Editor → Fixtures → Week tools → Name and numbering). Untick it for a
  showcase or pre-season week: its matches are still played, shown and simulated, but add nothing to the table (finals already work
  this way). Such weeks show a "Not on the ladder" tag. Needs `0025_week_ladder.sql`; until it's run the box is greyed out.

## 0.21.0 (2026-10-06)

Draft, manager side (the Editor → Draft tab and the database, `0023_draft.sql`, come from the office side of the same version).

- **Added:** a **Draft** tab, shown only while a draft is live or paused and inside its opening window. **Board**: whose pick it is, a
  countdown, recent picks, and the available players (search and position filter) with **+ Queue** and, on your turn, **Pick**.
- **Added:** **My queue**: drag (or use the arrows) to rank players, remove them, and **Pick now** on your turn.
- **Added:** **Auto-pick** per club: always, if I miss my turn, after a number of minutes, or never (reference only).
- **Added:** **Team values**: every club's roster with each player's value and the club total, your club first and highlighted.

## 0.20.1 (2026-10-06)

- **Added:** a **Quick create week** button above and below the list of weeks (Editor → Fixtures → Weeks). One press makes the next
  week: paired from the weeks so far, timed like the last week a week later. If those dates have already passed, the kick-off
  times are left blank so the week isn't locked before you've set its dates.
- **Added:** **Unlock line-ups** on a locked week (next to its lock time). A locked week used to be stuck for good, even after its
  matches were removed. Unlocking drops that week's saved line-up copies and works the deadline out again; it refuses a week with
  played matches (`0022_unlock_week.sql`, **run it before using the button**).
- **Fixed:** weeks locking by themselves. A week's line-up deadline is its first kick-off minus the lock rule, and a deadline in the
  past locks within a minute and can't be unlocked, so a kick-off time set in the past locked the week for good and changing the
  lock time later did nothing. The Editor now asks before setting kick-offs (by hand, shift, move or re-time) that would lock the
  week straight away.

## 0.20.0 (2026-10-06)

Roster tools: full control over weeks and matches in Editor → Fixtures.

- **Added, weeks:** **reorder** (▲ ▼, or drag a week by its ⠿ handle), **renumber** (to a free number, swap with a taken one, push
  later weeks up, or move to a position), **insert a blank week** before or after, **delete** a week (optionally closing the
  gap), **copy** a week to another number (dates shifted, home and away optionally swapped), and **whole-season** tools: close
  gaps in the numbers, put weeks in date order, reverse the order, shift every date. Every move keeps each week's matches,
  results, name, look and line-up lock together. A week whose line-ups have locked stays put.
- **Added, numbers and names:** a week can be **named** (shown next to its number, "Round 5 · Opening Week"; `round_name` is kept on each fixture for the live scoreboard later), **numbered automatically** (it follows the week when weeks move),
  given **a round number you choose**, or have **no number at all** (a Christmas Cup, a break week). Dashboard, League, Home,
  News starters and Deadlines show these names. A private **note** per week.
- **Added, matches:** change **home, away** or both; **swap home and away**; **swap any two teams** by tapping one then another
  (across weeks, or with a club that isn't playing); **move or copy** a match to another week; **swap kick-offs**; set a
  semi-final or grand final; **drag a match onto another week**; tick several matches to **move, shift, set a date or time,
  swap home/away, postpone or remove** them together.
- **Added, building weeks:** **Next week, built from the weeks so far**: pairs the clubs with opponents they haven't met,
  keeps byes and home games fair, avoids recent repeats, looks ahead so the last weeks of a round robin still work, and can
  make several weeks at once. It shows a **preview** with a **re-roll** before anything is saved, and "Same as the last week"
  copies the last week's kick-off pattern. Also per week: **Re-pair** (new opponents), **Fill the rest** (pair whoever isn't
  playing), **Re-time** with the pattern, **Clear times**, **Postpone all**. **Add a custom week** makes an empty week to fill
  by hand.
- **Added, checks and views:** **Checks** finds a club playing twice in a week, matches with no time, early rematches, runs of
  home or away games, uneven byes, clubs inactive but scheduled, and weeks that overlap. **Clubs by week** is a grid of every
  club's opponent each week. **Meetings** counts how often each pair plays.
- **Added, safety:** **Undo and Redo** for everything above (up to 40 steps; a result removed on the way stays removed), a
  question before anything removes a saved result, and a failed step puts back whatever it had already changed.
- **Added, import and export:** copy the roster as CSV or plain text, or paste matches in (`week, home, away, date, time`).
- **Changed:** weeks are no longer given a typed-in name like "Round 5"; the round number is worked out, so it stays right when
  weeks move. Round names older than this are cleared by the migration and show as the same "Round N".
- **Database:** `rounds` gains `numbered`, `number_override` and `note`; `office_move_weeks()` moves any set of weeks in one safe
  step (`0021_roster_tools.sql`). **Run that migration before using the new week tools.** Until then the site keeps working and
  the Editor says what to run.

## 0.19.1 (2026-10-06)

- **Fixed:** emails showed stray `=20` (and similar) through the text. They're now sent in a plainer encoding that every mail app reads
  correctly. This covers news emails and the reminder emails (`send-news`, `send-reminders`).

## 0.19.0 (2026-10-06)

News you can email, with pictures, and a tidier Editor News tab.

- **Added:** **email a post to managers**. Tick "Also email managers" when you publish (it says how many will get it), or press
  **Email** on a post later. A post goes out once, only to managers in its audience, and each email has a one-click turn-off.
  **Send me a test email** shows you exactly how it looks first. Managers can switch **League news** emails off in Settings.
- **Added:** posts can carry a **picture** (shrunk in your browser before it uploads), an **accent colour** and a **button** with a
  link. They show in the Inbox, on the guest dashboard and in the email.
- **Changed:** the News tab is rebuilt as four cards (Message, Look, Who is it for, Send) beside a **live preview** of the post as
  a manager sees it, with formatting buttons (bold, italic, list, link). The posted list shows each post's picture, audience and
  whether it has been emailed.
- **Database:** a public `news` picture bucket only the office can write to; `news.emailed_at` and `emailed_count`; the new
  `send-news` function (`0020_news_email_images.sql`).

## 0.18.0 (2026-10-06)

League news, written in the Editor.

- **Added:** an Editor **News** tab. Write a title and a message (bold, italic, lists and links), choose who it's for (**Everyone**
  including guests, **Every manager**, or **chosen clubs**), pin it, and see it as a manager will before it goes out. `{team}` and
  `{manager}` fill in for each manager. One-click **starters** write a Week preview (that week's fixtures and kick-offs) or a
  Deadline reminder (the next line-up lock) for you. Posted news can be edited, pinned or deleted.
- **Changed:** managers read posts in their Inbox as before (pinned first); guests see public posts in the dashboard's News.
- **Database:** `news` gains `audience`, `public` and `pinned`. The database decides who can read a post, so a post for two clubs
  can't be read by anyone else (`0019_news_posts.sql`).

## 0.17.0 (2026-10-06)

A club's primary colour now runs its whole page, and the accent colour is gone.

- **Changed:** on a manager's pages (Home, My club, Inbox, League, Settings and the set-up wizard) the club's **primary colour** is
  used as picked: the page background and cards take a tint of it, and the band, buttons, selected tabs and pills, switches, links and
  the club's row in the table use the colour itself. Text on top of it is white or dark, whichever reads better, and coloured text
  is lightened (or darkened on the light theme) so a navy or black club still reads.
- **Removed:** the **accent** (the club colour lifted until it read on navy) is gone everywhere: the Editor's Accent pen and
  "Work it out", the wizard's "Shown lighter" note, and the **Accent** setting in Settings (Club colour / vLeague blue).
- **Database:** the `clubs.accent` column is dropped (`0018_remove_accent.sql`). The Editor and signed-out pages stay vLeague navy and blue.

## 0.16.1 (2026-10-06)

- **Added:** the League matches list names any club that has a bye that week, under a Bye heading.

## 0.16.0 (2026-10-06)

Edit anything in a club from the Editor.

- **Added:** a little pen (✎) next to everything in a club's panel: **name, short name, code, primary and secondary colour,
  accent, manager name, stadium, motto, crest, status and phone number**, plus each manager account's **name and email**.
  Press it, change it, Save (or Cancel). It saves straight away, with no approval step. Changing a colour works the accent
  out again; **Work it out** does that for the accent by itself.
- **Safety:** a club's code can be changed until it has results (they record the code); then it says why it can't.
  Changing it updates fixtures, players and line-ups too. Changing an email takes effect at once (no confirmation email).
- **Database:** `office_set_phone` lets the office set or clear a club's phone (`0017_office_set_phone.sql`), and a new
  `change-email` function changes an account's sign-in email (office only).

## 0.15.1 (2026-10-06)

- **Changed:** matches on the League page show club codes (initials) instead of short names.

## 0.15.0 (2026-10-06)

A simpler Editor: Requests, Clubs, Managers and Phones are now one **Clubs** tab.

- **Changed:** each club is a row that opens into its own panel: **approve or send back** what's waiting, its **manager
  account** (send a password link, take them off the club, or invite one if it has none), its **phone number**, its
  **details** (colours, stadium, motto, set-up status, **Set up again**) and **every registration it has sent**. Clubs
  waiting on you come first and start open; panels stay open after you act. There's a search box, and the Clubs tab
  shows how many are waiting.
- **Added:** each registration keeps a **full copy** of what was sent: the form as typed, plus the club's colours, manager,
  stadium, motto and account email at that moment. Earlier registrations show what they have and say so.
- **Added:** downloads for **Phones CSV**, **Copy phone numbers** and **Registrations CSV** (every submission, every field).
- **Changed:** accounts with no club (such as the office's own) are under **Accounts without a club**, where they can be
  given one. Old `#requests`, `#managers` and `#phones` links open Clubs.
- **Database:** registrations gain a `snapshot` column (`0016_request_snapshot.sql`).

## 0.14.1 (2026-10-06)

- **Changed:** the full ladder on the League page shows each club's full name; matches keep the short names.

## 0.14.0 (2026-10-06)

Simulate.

- **Added:** Editor → Fixtures can play matches. **Simulate** on a match, **Simulate week** on a week, or **Simulate all
  unplayed**, with a progress bar and Cancel. Each club plays its week's locked team sheet; a club with no locked sheet
  gets the engine's own picks; players sent off in an earlier game miss the next one. The first run loads the engine
  (about 10 MB, then cached by the browser).
- **Added:** each played match shows its score in the Editor. **Play again** replaces it with a new match; **Remove
  result** takes the result and its match file away.
- **Added:** the match engine now lives in this app (`js/sim/`), so vLeague no longer depends on the s3 test site for it.
- **Changed:** the reminder emails read fixtures and results from the database instead of the s3 site (needs the
  `send-reminders` function redeployed).
- **Database:** full match files (about 2 MB each) are kept in a private `matches` bucket and can't be read by anyone but
  the office until the match kicks off (`0015_match_files.sql`). This replaces the plan to publish them on this site.
- Match pages (the "Match" link) come later, with the match centre.

## 0.13.1 (2026-10-06)

- **Added:** Editor → Fixtures can clear a whole week (**Clear week**) or every fixture (**Clear everything**), each with a
  confirmation. Their results and rounds go with them.

## 0.13.0 (2026-10-05)

The season planner.

- **Added:** Editor → Fixtures → Plan a season. Pick a pattern (Saturday night, Saturday and Sunday, Friday night + Saturday,
  Midweek, or your own) made of **blocks**: each block has a weekday, a first game, how many games and the gap between them.
  A week can have several blocks, so it can be split across different settings. Games are spread over the blocks in order.
- **Added:** rounds. Each week can be named ("Christmas Round"), given a scoreboard **look** (Classic, Finals, Grand Final,
  Christmas, Derby), and a line-up lock rule.
- **Added:** line-up deadlines are worked out. Each week locks a chosen time (1 hour to 2 days) before its first
  kick-off, and the lock moves by itself when you move a kick-off. The Editor shows the exact lock time on every week.
- **Added:** the dashboard's matchday board uses the round's look: its banner and accent colour.
- **Database:** `looks`, `rounds` and `match_windows` tables, and the week deadline is kept up to date by the database
  (`0014_season_planner.sql`). Looks are stored as data, so new ones are added without a release.
- Finals brackets are not in yet, by choice. A custom look editor comes later.

## 0.12.2 (2026-10-05)

- **Changed:** in Editor → Fixtures each team's name is in its club colour (lifted so dark colours stay readable, and
  darkened on the light theme).

## 0.12.1 (2026-10-05)

- **Fixed:** the screen no longer jumps sideways when you open Editor → Players. Every Editor tab is now the same width, and
  pages keep room for the scrollbar, so nothing shifts when a list gets long enough to scroll.

## 0.12.0 (2026-10-05)

vLeague's fixtures and results are its own. The app no longer reads the s3 test site.

- **Added:** Editor → Fixtures. Generate a whole season in one press (everyone plays everyone once, or home and away;
  an odd number of clubs rests one each week), add a single match, change a kick-off time (Melbourne time), postpone
  or restore a match, remove one.
- **Changed:** the dashboard, Home, League, club pages and the table read clubs, players, fixtures and results from
  Supabase (`0013_fixtures_results.sql`). Club logos come from the crests uploaded in club set-up.
- **Private until kick-off:** a result can't be read before its match kicks off. The database enforces it, so even
  calling the API directly shows nothing early. Only the league office sees results early.
- **Reset:** the 4 s3 test results are no longer shown. vLeague starts with no matches until you generate a season.
- **Not yet:** results come with Simulate in 0.13, and so do match pages (the Match link is empty until then). The
  reminder emails still read s3 for kick-off times, so they stay quiet until that is switched over (next patch).

## 0.11.5 (2026-10-05)

- **Fixed:** "Add players" failed for anyone whose browser still had the previous Editor page cached (it didn't send the
  new singlet number, which the database then refused). The database now gives a usual number for the position when none
  is sent (`0012_default_player_number.sql`), so a cached page can't break it.
- **Changed:** when adding players fails, the message now includes the real reason in brackets, not just "That didn't work".

## 0.11.4 (2026-10-05)

- **Changed:** generated names are now mostly Australian (about 85%), with a sprinkling of Irish, Italian, Greek, Pacific
  and other backgrounds, instead of an even mix of 18 cultures. Editor → Players → Generate → Options → Names switches to
  "Mixed cultures" if you want the old spread. Still no repeated first or last name, and never the same word twice
  (no "Ryan Ryan").
- **Added:** every player has a **singlet number** (1 to 99), given by position (keepers 1, 12, 13..., strikers 7, 9, 11...).
  Free agents can share a number. At a club each number is used once: if a player joins a club that already has his
  number, he gets the next free one automatically, and typing a clashing number by hand is refused (`0011_player_numbers.sql`).
- **Added:** the player's database **ID** (like 0042, never reused) is shown in Editor → Players, and you can search by name,
  ID or number. The line-up picker shows the number too.
- **Changed:** the Players page is wider so the nine columns fit.

## 0.11.3 (2026-10-05)

- **Reset:** the locked test Week 1 (its deadline and the one saved line-up) was removed at the league office's request,
  so no old player names are left anywhere. No code changed. Line-up deadlines start again from Week 1 in the Editor.

## 0.11.2 (2026-10-05)

- **Changed:** the weekly cap is $100,000 per team, so prices are scaled to fit. The weakest player is $700, an average
  midfielder about $4,100, a 9/10 forward $15,400 and a 10/9 forward $16,900. A typical 16-man squad costs about
  $90,000; stronger ones go over, so the draft means choices (`0010_cap_100k_prices.sql`).
- **Changed:** goalkeepers have a real offense rating (passing out from the back), typically 2 to 8, and it counts for
  a quarter of a keeper's price (defense is three quarters).

## 0.11.1 (2026-10-05)

- **Changed:** nobody is a perfect 10. A player's offense and defense add up to at most 19, so the very best is a
  10/9 or 9/10. The generator makes stars rare (about 1 in 80 has a 9, none a 10) and the database refuses anything higher.
- **Changed:** prices are steeper at the top: $500 for the weakest, about $2,750 for an average midfielder, $10,300 for
  a 9/10 forward and $11,250 for a 10/9. A typical 16-man squad costs about $55k to $60k. Still worked out from the
  ratings, never typed in (`0009_player_ratings.sql`).
- **Added:** ratings are colour coded, red for weak through amber and yellow to green for outstanding, in Editor →
  Players (the table and the preview) and in the line-up picker.

## 0.11.0 (2026-10-05)

vLeague has its own players. It no longer reads them from the s3 test site.

- **Added:** Editor → Players. **Generate** makes a pool in one press (a preview first: re-roll or leave out anyone,
  then add). Names come from 18 cultures, and no first or last name is repeated anywhere in the league. Ratings
  (offense and defense, 1 to 10) suit the position. Generated players are **free agents**: no club, ready for a draft.
- **Added:** every player has a **value** ($500 to $8,000) worked out from their ratings and position. It can't be
  typed in, so it always matches.
- **Added:** paste a list (`Name, FWD, 8, 3`, anything left out is filled in), edit a name, position, rating or club
  right in the table, filter by club, position or free agents, remove one player or all.
- **Changed:** My club, the line-up picker, the dashboard board and Home read players from vLeague. The 80 test
  players from s3 are gone, so clubs have no squads until the draft.
- **Reset:** every club's saved team sheet (it pointed at the old players) was cleared. The locked test Week 1 is left
  as it was; its line-up names won't show.
- **Database:** `players` table, readable by everyone and changed only by the league office (`0008_players.sql`).

## 0.10.0 (2026-10-05)

- **Added:** every club's manager gets a pinned post in their Inbox, "Add your phone number", with a small form.
  They can change the number there any time.
- **Added:** Editor → Phones: who has added a number and who hasn't, with Copy all and Download CSV.
- **Private:** a number can only be read by that club's manager and the league office, and only saved through the
  app's check (8 to 15 digits). Guests and other clubs can't see or change it (`0007_manager_phones.sql`).

## 0.9.0 (2026-10-05)

Light mode.

- **Added:** Settings → Appearance → Theme: Dark, Light or System. It's per device, so your phone and laptop can
  differ. System follows the device and switches with it. Dark stays the default, so nothing changes until you pick.
- **Changed:** colours are named once and shared by every page (`css/site.css`), instead of being typed into each
  stylesheet. The dark look is unchanged.
- **Kept dark on purpose:** the matchday board on the guest dashboard and the pitch (team sheets), in both themes.
- **Changed:** club-coloured text (like "Next match" and your position on Home) is darkened on light backgrounds so
  pale club colours, such as cyan, stay readable. Club colours themselves are untouched.

## 0.8.6 (2026-10-05)

- **Fixed:** the league table lists exactly the clubs in Editor → Clubs. Old placeholder teams (Reserved Team 1 and 2)
  and withdrawn clubs no longer show.

## 0.8.5 (2026-10-05)

- **Fixed:** clubs added in Editor → Clubs now show in the league table (and the other places that list clubs). They
  start on 0 points; they get matches once fixtures include them.

## 0.8.4 (2026-10-05)

- **Fixed:** the footer showed v0.8.0 after 0.8.2 and 0.8.3; it shows the real version again.

## 0.8.3 (2026-10-05)

- **Added:** Editor → Clubs has an "Add clubs" box: one club per line (`Name`, `CODE, Name` or `CODE, Name, Manager`).
  Codes and colours are picked for you if left out, and the whole list is checked before any club is added.
  (Second go: 0.8.1 had a typo that stopped the Editor loading, so it was reverted in 0.8.2.)

## 0.8.2 (2026-10-05)

- **Fixed:** reverted 0.8.1 (bulk "Add clubs" in the Editor), which didn't work. The Editor is back as it was in 0.8.0.

## 0.8.0 (2026-10-02)

Clearer and simpler all round, after a look at everything a new manager would trip over.

- **Changed:** Settings is its own tab next to League (in the bottom bar on phones), instead of hiding behind the club
  crest at the top right. Settings is for managers only.
- **Removed:** the Start page setting. Everyone lands on Home.
- **Moved:** the office's "clubs without a team" email is a checkbox in Editor → Deadlines.
- **Fixed:** a new team sheet now saves itself as soon as you open it. Before, it showed a full XI but said "Not
  saved", so a manager who didn't press Save got the engine's team.
- **Changed:** on phones, tapping a position on the pitch opens the player list from the bottom of the screen, with
  that position's players first. Tapping a player first scrolls you to the pitch.
- **Changed:** tactics show the presets; the five sliders are under Custom.
- **Changed:** Inbox posts you've read stay read on all your devices.
- **Changed:** matches open in the same tab from Home, like they do from League.
- **Fixed:** opening the dashboard while signed in no longer signs you out; the corner button says Home instead.
- **Changed:** dashboard "Leaders" is "Top players". The empty board shows "Season 1" with the first kick-off.
- **Changed:** sign-in always shows the form ("View as guest" isn't remembered). `index.html?reset` opens Forgot
  password.
- **Changed:** invite links say "Welcome to vLeague" with your club's name. An expired link goes straight to "Get a
  new link".
- **Changed:** club setup is 3 steps (Club, Colours, Details) with no Review step, and one preview instead of five.
  A crest is optional (the code badge stands in). The code stays as it is unless you tap Change. Colours start from
  a default instead of an error.
- **Changed:** Edit club has a button per card. Club (name, code, crest): "Send to the office". Colours and Details:
  "Save". Changing only the note to the office no longer sends a request.
- **Changed:** Editor: one state per club (No manager, Invited, Setting up, Waiting for approval, Active). Changing an
  account's club asks first, and a club can't get a second manager. Deadlines has "Set all empty weeks to 1 h before
  kick-off". Database errors are in plain words. The header link says Home.
- **Removed:** hint lines, intro paragraphs and developer messages ("docs/BACKEND.md", "isn't switched on yet",
  "Result soon").
- **Changed:** the roadmap: light mode is 0.9 now, and everything after moves back one.

## 0.7.0 (2026-10-01)

Settings, and email reminders that only arrive when they're useful.

- **Added:** Settings, behind your club crest at the top right (it replaces the Sign out button; Sign out is in
  Settings now). Account: name, email, password, sign out, sign out on all devices. Appearance: accent (club colour
  or vLeague blue) and text size (four steps, with a preview). Matches: spoiler-free results, 12 or 24-hour clock,
  start page. Accessibility: reduce motion. Text size and motion are kept on this device; the rest follows your
  account.
- **Added:** spoiler-free results. Scores you haven't seen show as "Show score" on Home and League, and your place,
  points and form leave those results out until you show them ("N results hidden · Show all"). Opening a match
  counts as seeing it.
- **Added:** email reminders. A deadline reminder only if your club hasn't picked a team since the last week locked
  (24 hours before, 3 hours before, both, or off). Also: club changes sent back (on), line-ups out with your
  opponent's XI (off), a Monday round-up of the week's results (off), and for the league office, clubs without a team
  (on). Never twice, never between 10 pm and 8 am, and every email has a one-click "Turn these off". "Send me a test
  email" in Settings.
- **Changed:** every page follows the text size setting, including body text.
- **Added:** database tables `user_settings` and `email_log`, the reminder rules, and Edge Functions `send-reminders`
  and `email-unsubscribe` (migration `0006_settings_and_reminders.sql`). 16 more security checks (69 in all).
- **Changed:** the roadmap: 0.8 is light mode (a Theme setting), and everything after moves back one.

## 0.6.0 (2026-10-01)

Pick your team, with a line-up deadline each week.

- **Added:** My club → Team sheet: your XI on a pitch. Pick one of the engine's four formations, tap a slot then a
  player (or two players to swap), choose the captain, penalty, free-kick and corner takers, and set tactics with
  presets or five sliders. It saves itself as you go. Squad (ratings and stats) is its own tab.
- **Added:** a line-up deadline for each week, set by the league office (Editor → Deadlines). At the deadline every
  club's team sheet is locked for that week; managers can keep editing and changes count for the next week.
- **Added:** the reveal. Once a week locks, both clubs' XIs show on pitches on each club's Home, and the line-ups
  show on the dashboard's matchday board.
- **Changed:** Home's match card shows when your line-up locks and has "Pick your XI" again.
- **Changed:** line-ups now come out at the week's deadline instead of 10 minutes before kick-off.
- **Added:** database tables `deadlines`, `team_sheet_versions` and `week_sheets`, and a job that locks each week on
  time, to the second (migration `0005_lineup_deadlines.sql`). 12 more security checks (53 in all).
- **Changed (s3 site):** the Editor's Simulate plays each match with its week's locked team sheets and waits until
  the week is locked. The old Manager Hub's Lineup and Tactics tabs point to My club; press stays there for now.

## 0.5.1 (2026-10-01)

Home is about your club; League is about everyone.

- **Changed:** Home no longer repeats League. It shows the match card (full width), then **Your season** (position,
  points, W-D-L, goal difference, form and your last match) and **Coming up** (your next matches). The mini table
  and "Around the league" are gone: the full table and every match are on League, news is in Inbox.
- **Changed:** the To do card is gone. Unread news shows as the count on the Inbox tab; club changes with the league
  office show as a notice at the top of Home (with "Fix and resend" when they come back).
- **Removed:** the "Pick your XI" button on the match card until the XI picker arrives in 0.6.

## 0.5.0 (2026-10-01)

Home, and the four places a manager moves between.

- **Added:** Home, My club, Inbox and League, with a nav in the top bar (a bar along the bottom on phones) and an
  unread count on Inbox.
- **Added:** Home: the next match with a countdown and when the line-up locks (a live score and minute during the
  match), what needs doing (pick your XI, unread inbox, club changes sent back), the last result, your place in the
  table and what's happening around the league.
- **Added:** League: the full table with your club's row marked and form, matches by week with live and full-time
  scores, top scorers and assists.
- **Added:** My club: crest, motto, manager and code, Edit club, and the squad with appearances, goals, assists and
  average rating.
- **Added:** Inbox: league news for your club and crest reveals, newest first, with read and unread.
- **Changed:** win, draw and loss colours are shared by every page (`css/site.css`).

## 0.4.2 (2026-10-01)

- **Fixed:** on long signed-in pages (like Edit club), the club-colour glow repeated down the page every screen
  height and the footer sat in the middle of the page. The glow now shows once at the top, and the footer sits at the
  bottom.

## 0.4.1 (2026-10-01)

Tidier "Set up your club".

- **Changed:** much less text in the wizard and on Edit club: no intro paragraph or step counter, fewer hints,
  "Optional" next to optional fields, and the colour step only speaks up when it changes your colour.
- **Changed:** on Edit club, each section shows a small "Needs approval" or "Saves instantly" tag. The review step
  has tighter rows with Edit links.
- **Fixed:** an empty blue box under the title on every step.

## 0.4.0 (2026-10-01)

Set up your club.

- **Added:** "Set up your club" (setup.html), a wizard every manager goes through once at sign-in, the league
  office's own club included: name, short name and 3-letter code (checked live); primary and secondary colour with a
  contrast check and an exact preview of the club's accent; crest upload (fitted to 512 px, with previews on the
  band, the Home card and a table row); manager name, stadium, motto and notes for the office. It isn't shown again
  once sent, until the office switches it back on for that club.
- **Added:** colours, accent, motto, manager name and stadium change straight away. Name, short name, code and crest
  go to the league office for approval; Home shows "Waiting for the league office", or the office's note with
  "Fix and resend". "Edit club" on Home for later changes.
- **Added:** Editor tabs. **Requests**: each request against the club as it is, with the crest, colours and a
  preview; Approve (applies it, a new code carries through everywhere, and a crest reveal is posted to the new
  news table) or Send back with a note. **Clubs**: status, manager account, and "Set up again". **Managers**:
  invite a manager by email (the new `invite-manager` Edge Function), link or unlink an account, send a password link.
- **Changed:** managers can only add crest files, never replace or delete them, so a new crest goes live only when
  the office approves it.
- **Added:** database tables `club_requests` and `news`, the functions behind all of this, and 26 more security
  checks (41 in all, `supabase/tests/rls_check.py`). Migrations `0003_club_setup.sql` and `0004_crest_storage.sql`.

## 0.3.1 (2026-09-30)

- **Changed:** anyone with a club now signs in to their club's Home, including the league office account, which
  also manages FC Turtle. Office accounts get a quiet "Editor" link in Home's footer, and the Editor has a
  "My club" link back. Only an office account with no club goes straight to the Editor.

## 0.3.0 (2026-09-30)

Foundation: accounts, clubs and roles in the database.

- **Added:** Supabase tables for clubs, profiles (manager or league office, and their club) and team sheets, each
  with row-level security, so the database decides who can read and change what. A public `crests` storage bucket
  with the six club crests. The 8 Season 1 clubs imported. Security checks for guest, manager and office
  (`supabase/tests/rls_check.py`, 15 checks).
- **Added:** "Set your password" page for invite and reset emails, and "Forgot password?" on the sign-in page.
  Emails come from vLeague (vleague.admin@gmail.com).
- **Added:** Home (for managers; shows their club for now) and Editor (for the league office; lists the clubs and
  which have a manager account). Signing in takes you to the right one.
- **Changed:** sign-ups are off in Supabase (they had been left on), the site address is set for email links, and
  passwords need at least 8 characters.
- **Removed:** the placeholder Hello page, its photo slideshow and the two photos only it used.
- **Changed:** `docs/PLAN.md` is now the agreed roadmap to 1.0; `docs/BACKEND.md` describes the new setup;
  `docs/RELEASING.md` explains how to restart a GitHub Pages build that doesn't start.

## 0.2.5 (2026-09-30)

- **Changed:** the dashboard is the guest profile. Anyone who reaches it while signed in (for example with the
  browser's Back button) is signed out and treated as a guest from then on, and the top bar always shows
  "Sign in".
- **Removed:** the "My club" button that signed-in visitors saw on the dashboard (it only led to the
  placeholder Hello page).

## 0.2.4 (2026-09-30)

- **Fixed:** on the sign-in page, when the browser (e.g. Google autofill) fills in the email and password, the
  "Email" and "Password" labels now move up out of the way instead of sitting on top of the text, and the fields
  stay dark instead of taking Chrome's light autofill colour.

## 0.2.3 (2026-09-30)

- **Removed:** explanatory text on the dashboard: the "fixtures appear here…" line under "Season 1 kicks off
  soon", the empty-table note, the footer tagline and "League data updated…", and the long empty-state and poll
  wording. The Leaders section stays hidden until there are results.
- **Changed:** shorter wording: line-ups "Out at 7:50 pm", "No fixtures yet.", "No news yet.", "Result soon",
  "Club poll: …". The footer is just the version number.

## 0.2.2 (2026-09-30)

- **Removed:** the Matches / Table / News links in the dashboard's top bar. They only scrolled down the same
  page; the bar is now just the vLeague crest and Sign in.

## 0.2.1 (2026-09-30)

- **Changed:** a new sign-in page: one centred column (crest, email, password, Sign in, View as guest) on the
  pitch's centre circle and halfway line, which draw in once on load. Labels sit inside the fields.
- **Removed:** the photos and the extra text on the sign-in page (the subtitle, the "or" divider, the guest
  explanation and the note about accounts).
- **Added:** the version number at the bottom of the sign-in page.

## 0.2.0 (2026-09-30)

Guest access.

- **Added:** "View as guest" on the sign-in page. Guests need no account; a returning guest goes straight to the
  dashboard, and `index.html?signin` always shows the form.
- **Added:** the dashboard (`dashboard.html`): matchday board (live score and scorers, or the next kick-off with
  a countdown), line-ups from 10 minutes before kick-off, matches by week, the table, league news for guests
  (no poll results) and the leaders. It reads the s3 site's public data until the league moves to Supabase.
- **Added:** `docs/PLAN.md` (roadmap, what guests and members see, news audiences), this changelog,
  `docs/RELEASING.md`, and the version number in the dashboard footer.

## 0.1.1 (2026-09-30)

- **Changed:** the sign-in page no longer has a headline over the photos.
- **Added:** the connection to the vLeague Supabase project (project URL and anon public key in `js/config.js`),
  so signing in works.

## 0.1.0 (2026-09-30)

First version.

- **Added:** the sign-in page (email and password, "Keep me signed in") and the first signed-in page (`hello.html`).
