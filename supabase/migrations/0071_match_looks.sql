-- 1.17: a look for a single match, and the four event looks (Movember, Australia Day, New Year, Festive).
-- A match's look is its own (this column), else its match window's, else its round's. null = no choice of its own.
-- Office-only writes come from the existing fixtures_office_write policy. The looks' settings are also in js/looks.js (PRESETS), which
-- fills in anything a row leaves out, so a look can be tuned here without a release. Safe to re-run; changes nothing that exists.

alter table public.fixtures add column if not exists look text references public.looks (key) on update cascade on delete set null;

insert into public.looks (key, name, settings) values
  ('movember', 'Movember', '{"accent":"#26c6da","banner":"MOVEMBER","theme":{"bg":["#0e3a5c","#07192e"],"edge":"#1b7f9a","ink":"#eaf9ff","score":["#ffffff","#aef0ff"],"plate":["#8a5a3a","#6b4429"],"plateInk":"#ffffff","glow":"#26c6da","clock":"#26c6da","clockInk":"#04222a","fx":["moustache"]}}'::jsonb),
  ('australia_day', 'Australia Day', '{"accent":"#ffc72c","banner":"AUSTRALIA DAY","theme":{"bg":["#1b4a2a","#0e2a18"],"edge":"#8a7a1c","ink":"#f4f1dc","score":["#ffe27a","#f2b705"],"plate":["#ffc72c","#e0a800"],"plateInk":"#2a1d00","glow":"#f2b705","clock":"#ffc72c","clockInk":"#2a1d00","fx":["stars"]}}'::jsonb),
  ('new_year', 'New Year', '{"accent":"#e8c76a","banner":"NEW YEAR","theme":{"bg":["#1c2150","#0a0d24"],"edge":"#6f6a96","ink":"#f3ecd6","score":["#fff3c9","#d9b863"],"plate":["#f1deb0","#d9b863"],"plateInk":"#2a2208","glow":"#e8c76a","clock":"#e8d3a2","clockInk":"#2a2208","fx":["sparkle","confetti"]}}'::jsonb),
  ('festive', 'Festive', '{"accent":"#b3203a","banner":"FESTIVE","theme":{"bg":["#174a31","#4a1f2c"],"edge":"#b23a4e","ink":"#fff7ea","score":["#fff3dc","#f1d9a8"],"plate":["#b3203a","#8f1a2e"],"plateInk":"#ffffff","glow":"#d4a373","clock":"#a3182f","clockInk":"#ffffff","fx":["lights","snow"]}}'::jsonb)
on conflict (key) do nothing;
