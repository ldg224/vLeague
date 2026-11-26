-- The Festive Summer Cup look (the user, 27 Nov 2026): the two Summer Cup matches in the Festive Round wear the cup and Christmas together. Safe to re-run. Needs 0099.
insert into public.looks (key, name, settings) values ('summer_festive', 'Festive Summer Cup', '{"accent":"#c4213f","banner":"SUMMER CUP","theme":{"bg":["#0b2f3a","#061a21"],"edge":"#ffb627","ink":"#fff3df","score":["#ffffff","#ffe3b0"],"plate":["#c4213f","#ff6b4a"],"plateInk":"#ffffff","glow":"#ffb627","clock":"#22b8b0","clockInk":"#061a21","fx":["lights","snow"],"spill":"snow"}}'::jsonb)
on conflict (key) do nothing;
-- Round 11 (week 15, the Festive Round): Donald Trump v Turtle (Group A) and SKS v Come Come (Group C), only while they still wear the plain cup look
update public.fixtures f set look = 'summer_festive'
from public.rounds r
where r.week = f.week and r.look = 'festive' and f.cup is not null and f.look = 'summer_cup';
