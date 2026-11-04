-- The Fresh Chalk look for Opening Week (the user, 4 Nov 2026): a mown pitch with chalk markings behind the score bug. js/looks.js (PRESETS) has the same settings.
-- Opening Week takes the look only if it is still on Classic, so the office's own choice isn't overwritten. Safe to re-run. Needs 0071.
insert into public.looks (key, name, settings) values ('opening_week', 'Fresh Chalk', '{"accent":"#7fd66a","banner":"OPENING WEEK","theme":{"bg":["#1a6b39","#0d3d20"],"edge":"#7fae88","ink":"#f5f8ef","score":["#ffffff","#e4efdc"],"plate":["#f6f8f0","#dbe6cf"],"plateInk":"#0c2a16","glow":"#a6e08a","clock":"#f6f8f0","clockInk":"#0c2a16","fx":[],"art":"chalk"}}')
on conflict (key) do nothing;
update public.rounds set look = 'opening_week' where name = 'Opening Week' and (look is null or look = 'classic');
