-- The match page's events (the user, 5 Nov 2026): new and redone looks, a third place final, and the Grand Final's round marked as finals so its stage can be set in the Editor.
-- js/looks.js (PRESETS) holds the same settings. The Fresh Chalk look and Opening Week are in 0083. Safe to re-run. Needs 0071 and 0083.

-- A third place final as a stage. Like the other stages, it doesn't count for the table.
alter table public.fixtures drop constraint if exists fixtures_stage_check;
alter table public.fixtures add constraint fixtures_stage_check check (stage in ('SF', 'GF', 'TP'));

-- The looks. The four redone ones overwrite their earlier settings; a look's settings are the row's, so they would otherwise keep their old colours and no falling pieces.
insert into public.looks (key, name, settings) values
  ('festive', 'Festive', '{"accent":"#b3203a","banner":"FESTIVE","theme":{"bg":["#1a5c3e","#0b2c1f"],"edge":"#d9b36a","ink":"#fff7ea","score":["#fff3dc","#f1d9a8"],"plate":["#c4213f","#8f1a2e"],"plateInk":"#ffffff","glow":"#d4a373","clock":"#c4213f","clockInk":"#ffffff","fx":["lights","snow"],"spill":"snow"}}'),
  ('movember', 'Movember', '{"accent":"#26c6da","banner":"MOVEMBER","theme":{"bg":["#0e3a5c","#07192e"],"edge":"#1b7f9a","ink":"#eaf9ff","score":["#ffffff","#aef0ff"],"plate":["#8a5a3a","#6b4429"],"plateInk":"#ffffff","glow":"#26c6da","clock":"#26c6da","clockInk":"#04222a","fx":["moustache"],"spill":"moustaches"}}'),
  ('new_year', 'New Year', '{"accent":"#e8c76a","banner":"NEW YEAR","theme":{"bg":["#262c78","#0c0f30"],"edge":"#e8c76a","ink":"#f8f2de","score":["#fff3c9","#d9b863"],"plate":["#f1deb0","#d9b863"],"plateInk":"#2a2208","glow":"#e8c76a","clock":"#e8d3a2","clockInk":"#2a2208","fx":["sparkle","confetti"],"art":"beams","spill":"confetti"}}'),
  ('australia_day', 'Australia Day', '{"accent":"#ffc72c","banner":"AUSTRALIA DAY","theme":{"bg":["#1d6a3c","#0c3a20"],"edge":"#ffc72c","ink":"#fff8e0","score":["#ffe27a","#f2b705"],"plate":["#ffc72c","#e0a800"],"plateInk":"#2a1d00","glow":"#f2b705","clock":"#ffc72c","clockInk":"#2a1d00","fx":["stars"],"spill":"stars"}}'),
  ('spring_blossom', 'Spring Blossom', '{"accent":"#ff9fbd","banner":"SPRING","theme":{"bg":["#3c2a4d","#1a1226"],"edge":"#ffc4d6","ink":"#fff4f8","score":["#ffffff","#ffe0ea"],"plate":["#ffc4d6","#f08fb0"],"plateInk":"#3a0f24","glow":"#ff9fbd","clock":"#ffd6e3","clockInk":"#3a0f24","fx":[],"spill":"petals"}}'),
  ('last_round', 'Last Round', '{"accent":"#42a5f5","banner":"LAST ROUND","theme":{"bg":["#0d2a52","#050d1f"],"edge":"#42a5f5","ink":"#f2f8ff","score":["#ffffff","#d6ebff"],"plate":["#42a5f5","#1565c0"],"plateInk":"#ffffff","glow":"#90caf9","clock":"#42a5f5","clockInk":"#04142b","fx":[],"art":"beams","spill":"glints"}}'),
  ('third_place', 'Third Place Final', '{"accent":"#d99a5b","banner":"THIRD PLACE FINAL","theme":{"bg":["#54301a","#1e1008"],"edge":"#d99a5b","ink":"#fbeee0","score":["#eeb47a","#c9823f"],"plate":["#eeb47a","#b0733a"],"plateInk":"#241204","glow":"#d99a5b","clock":"#e0a56a","clockInk":"#241204","fx":["shine"],"art":"beams","spill":"confetti"}}'),
  ('lunar_new_year', 'Lunar New Year', '{"accent":"#e8b923","banner":"LUNAR NEW YEAR","theme":{"bg":["#8f1420","#3c060c"],"edge":"#e8b923","ink":"#fff3d6","score":["#ffffff","#ffe9a8"],"plate":["#f2c94c","#c9971c"],"plateInk":"#3c0a0a","glow":"#e8b923","clock":"#f2c94c","clockInk":"#3c0a0a","fx":["shine"],"spill":"gold"}}')
on conflict (key) do update set name = excluded.name, settings = excluded.settings;

-- The third place final's round. No fixtures yet: the office adds the match and its date in the Editor.
insert into public.rounds (week, name, kind, look, numbered, counts_for_ladder)
values (29, 'Third Place Final', 'finals', 'third_place', false, false)
on conflict (week) do nothing;

-- The Grand Final's round was 'regular', which hid its stage in the Editor, and the league's champion is read from that stage.
update public.rounds set kind = 'finals' where week = 28 and name = 'Grand Final' and kind = 'regular';
