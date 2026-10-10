// Player generator for the Editor (0.11): names from 18 cultures and ratings shaped by position.
// Loaded only by editor.js. Rules:
//  - No two players share a first name or a last name, in one batch or against players already in the league.
//  - Nobody is given a club; players start as free agents and are dealt out later (a draft).
//  - Ratings are offense and defense, 1 to 10, and together at most 19: nobody is a perfect 10 (MAX_TOTAL).
//    Value is worked out from them (playerValue), the same sum as the `value` column in
//    supabase/migrations/0010_cap_100k_prices.sql: keep the two in step.

const words = s => s.split(/\s+/).filter(Boolean);

// Each culture: first names and last names. Spaced-out lists, so adding a name is one word.
export const CULTURES = {
  'Australian': [
    'Jack Oliver William Noah Thomas James Lucas Ethan Mason Liam Henry Hunter Cooper Lachlan Jackson Riley Archie Harry Max Charlie Ryan Joshua Nathan Dylan Zac Callum Mitchell Blake Brodie Jarrod Luke Matthew Daniel Benjamin Samuel Joseph Lewis Isaac Alexander Leo Oscar George Harrison Hudson Flynn Angus Xavier Jordan Connor Tyler Lincoln Kyle Aaron Adam Andrew Anthony Ashton Austin Bailey Beau Bradley Brandon Brayden Brendan Brett Bryce Cameron Campbell Carter Chase Christian Cody Colby Cole Corey Cory Craig Curtis Damian Darcy Darren David Dean Declan Dominic Dustin Eli Elijah Evan Finn Fletcher Gabriel Gavin Grant Gregory Hayden Heath Hugo Jacob Jake Jarvis Jason Jayden Jeremy Jesse Joel Jonathan Jordy Josh Justin Kane Keegan Keith Kieran Kristian Lachie Lance Logan Mark Marcus Mathew Michael Miles Nicholas Nick Nolan Owen Patrick Paul Peter Phillip Preston Quinn Reece Reuben Rhys Richard Robert Rohan Ronan Ross Russell Sam Scott Sean Seth Shane Simon Spencer Stephen Steven Taylor Timothy Toby Todd Travis Trent Trevor Troy Tristan Tyson Vincent Wade Warren Wayne Zachary Zane',
    'Smith Jones Williams Brown Wilson Taylor Anderson Thompson White Martin Walker Harris Lee Ryan Robinson Kelly King Campbell Clarke Johnson Hall Wood Young Mitchell Watson Morgan Davies Cooper Bennett Murray Reid Stewart Hughes Fletcher Hartley Barnes Whitaker Pearce Holloway Cartwright Ellison Thornton Marsh Gibbs Redfern Atkins Bradshaw Dawson Kendall Mercer Sutton Ashworth Pritchard Langley Harker Wilcox Denton Allen Baker Bell Bishop Black Booth Bowen Boyd Bradley Brooks Bryant Burke Burns Butler Carr Carter Chapman Clark Cole Collins Cook Cox Crawford Cunningham Curtis Davidson Day Dixon Doyle Duncan Edwards Elliott Ellis Evans Ferguson Fisher Foster Fox Francis Fraser Freeman Gardner George Gordon Graham Grant Gray Green Griffiths Hamilton Hansen Harper Harrison Hart Hawkins Hayes Henderson Henry Hill Holmes Howard Hunt Hunter Jackson James Jenkins Jordan Kennedy Knight Lawrence Lawson Lewis Lloyd Marshall Mason Matthews Miller Moore Morris Morrison Murphy Nash Nelson Newman Nicholson Norris Owen Palmer Parker Patterson Payne Perry Phillips Porter Powell Price Quinn Reynolds Rice Richards Richardson Riley Roberts Rogers Rose Ross Russell Saunders Scott Shaw Simpson Sinclair Spencer Stevens Stone Sullivan Tucker Turner Wallace Ward Warren Webb Wells West Wheeler Whitehead Wright'],
  'Irish': [
    'Cian Oisin Fionn Eoghan Darragh Niall Ronan Colm Cathal Donal Padraig Seamus Tadhg Conor Rory Aidan Eamon Dermot Liam Declan Kieran Brendan Diarmuid Lorcan Ruairi Senan',
    'Murphy Kelly Brennan Gallagher Doyle Quinn Byrne Fitzgerald Callaghan Dunne Kavanagh Maguire Nolan Costello Lynch Daly Hennessy Rafferty Gilligan Moran Tierney Boyle Concannon Crowley Devlin Sheehan'],
  'Italian': [
    'Luca Matteo Lorenzo Marco Giorgio Alessandro Federico Davide Riccardo Tommaso Emilio Enzo Dario Fabio Stefano Gianni Paolo Nico Salvatore Massimo Bruno Valerio Piero Aldo Renzo Santo',
    'Rossi Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti Costa Giordano Mancini Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Vitale'],
  'Spanish': [
    'Javier Alejandro Diego Pablo Sergio Adrian Ivan Raul Hugo Alvaro Mateo Rodrigo Gonzalo Joaquin Emilio Andres Ricardo Fernando Ramon Esteban Cristian Nacho Gael Lucas Leandro Tomas',
    'Garcia Martinez Lopez Sanchez Perez Gomez Fernandez Moreno Jimenez Navarro Torres Dominguez Vazquez Ramos Gil Serrano Blanco Molina Castro Ortega Delgado Santana Marquez Iglesias Cabrera Pascual'],
  'Brazilian': [
    'Thiago Gabriel Rafael Bruno Caio Vinicius Leonardo Matheus Felipe Joao Henrique Danilo Wesley Murilo Everton Gustavo Rodrigo Renan Otavio Samuel Iago Davi Heitor Emerson Ronaldo Neymar',
    'Silva Santos Oliveira Souza Rodrigues Ferreira Alves Pereira Lima Gomes Ribeiro Carvalho Barbosa Rocha Dias Nascimento Araujo Moura Teixeira Cardoso Machado Freitas Castro Mendes Pinto Campos Faria'],
  'French': [
    'Antoine Hugo Theo Louis Mathis Baptiste Remi Quentin Maxime Etienne Yann Corentin Florian Gaspard Lucien Olivier Pascal Remy Sacha Timothee Valentin Xavier Anatole Benoit Cyril Damien',
    'Martin Bernard Dubois Moreau Laurent Lefevre Michel Garnier Faure Mercier Blanc Guerin Boyer Chevalier Perrin Morel Fournier Girard Lambert Rousseau Masson Clement Gauthier Lemaire Roux Colin'],
  'German': [
    'Lukas Jonas Felix Leon Maximilian Tobias Florian Niklas Jannik Matthias Stefan Dieter Klaus Lars Moritz Emil Fabian Kai Jens Sven Ulrich Ralf Torsten Henrik Gunther Anton',
    'Mueller Schmidt Schneider Fischer Weber Wagner Becker Hoffmann Koch Richter Klein Wolf Schroeder Neumann Braun Zimmermann Kruger Hartmann Lange Werner Schmitz Krause Meier Lehmann Keller Vogel'],
  'Dutch': [
    'Daan Sem Luuk Finn Bram Jesse Ruben Stijn Thijs Gijs Joost Niek Wouter Mees Teun Jorrit Maarten Pieter Sander Koen Floris Lars Rens Bastiaan Tijmen Dirk',
    'De Vries Van Dijk Bakker Janssen Visser Smit Meijer De Boer Mulder De Groot Bos Vos Peters Hendriks Dekker Van Leeuwen Kok Jacobs Verhoeven Van Der Berg Brouwer Huisman Scholten Willems Postma'],
  'Nordic': [
    'Erik Anders Magnus Sven Olaf Henrik Gustav Leif Nils Bjorn Axel Mikkel Rasmus Soren Torben Viktor Emil Oskar Elias Jens Knut Thor Jonas Aksel Tobias Mattias',
    'Andersen Johansson Nielsen Larsson Hansen Lindqvist Eriksson Berg Holm Dahl Lund Nystrom Sandberg Ekdahl Haugen Solberg Strand Forsberg Bergstrom Kvist Lindgren Halvorsen Moen Aalto Virtanen Korhonen'],
  'Slavic': [
    'Marek Tomasz Piotr Jakub Mateusz Dominik Bartosz Milan Dragan Luka Nikola Stefan Vladimir Andrei Dmitri Pavel Ivo Goran Zoran Branko Marko Radek Lukasz Sasha Viktor Mirko',
    'Kowalski Novak Horvat Kovacevic Petrovic Jovanovic Nowak Wisniewski Dvorak Svoboda Popescu Ivanov Kozlov Volkov Babic Markovic Zielinski Kaminski Lewandowski Matic Radic Bogdan Sokolov Pavlenko Kuzmin'],
  'Greek': [
    'Nikos Giorgos Dimitris Kostas Yannis Christos Panagiotis Stavros Vasilis Thanos Manolis Alexandros Spyros Petros Lefteris Aris Takis Stelios Michalis Orestis Fotis Haris Odysseas Telemachos Pavlos Theo',
    'Papadopoulos Karagiannis Vlachos Nikolaidis Georgiou Makris Oikonomou Dimitriou Alexiou Pappas Antoniou Stavrou Kyriakou Lazarou Galanis Theodorou Markou Mavros Zografos Kostopoulos Manolis Pantelidis Samaras Tsolakis Vassilakis Argyros'],
  'Turkish': [
    'Emre Burak Kerem Mert Cem Arda Baris Onur Tolga Deniz Kaan Murat Selim Yusuf Ozan Volkan Hakan Serkan Eren Berk Umut Can Tuncay Barkin Levent Ismail',
    'Yilmaz Kaya Demir Celik Sahin Yildiz Ozturk Aydin Arslan Dogan Kilic Aslan Cetin Kara Koc Kurt Ozdemir Polat Erdogan Gunes Tekin Aksoy Bozkurt Uysal Tas Karaca'],
  'Arabic': [
    'Omar Karim Tariq Samir Khalid Hassan Youssef Rashid Nabil Faisal Idris Zayd Bilal Malik Amir Jamal Walid Sami Ziad Nadim Fadi Hamza Anwar Mansour Rami Saleh',
    'Haddad Nasser Khoury Saleh Mansour Aziz Farouk Rahman Sabbagh Darwish Jaber Hamdan Tamimi Qureshi Bakr Zaman Habib Najjar Salem Sayegh Barakat Issa Masri Shaheen Abboud Antar'],
  'Indian': [
    'Arjun Rohan Vikram Aditya Karthik Rahul Sanjay Nikhil Siddharth Pranav Ravi Anil Deepak Manish Suresh Kabir Varun Ishaan Dev Harsh Tarun Yash Ajay Rishi Kunal Amit',
    'Sharma Patel Singh Kumar Gupta Reddy Nair Iyer Menon Kapoor Mehta Joshi Chopra Bose Desai Rao Banerjee Pillai Malhotra Bhatt Verma Khanna Sethi Agarwal Chatterjee Naidu'],
  'Chinese': [
    'Wei Jun Hao Ming Lei Jian Tao Bo Kai Feng Yi Chen Long Hui Peng Xin Yong Zhi Cheng Dong Hong Liang Rui Shan Yang Zhen',
    'Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Lin Gao Luo Zheng Liang Xie Song Tang Han'],
  'Japanese': [
    'Haruto Ren Sota Yuto Riku Kenji Takumi Daichi Hiroshi Kaito Shin Taro Jiro Koji Makoto Naoki Ryo Satoshi Yuki Akira Daiki Eiji Goro Haruki Isamu Masaru',
    'Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Matsumoto Inoue Kimura Hayashi Shimizu Mori Ikeda Hashimoto Ishikawa Ogawa Okada Fujita Goto'],
  'African': [
    'Kwame Kofi Chidi Emeka Tunde Sipho Thabo Musa Ade Kwesi Obi Yaw Jabari Tendai Kagiso Mandla Olu Seun Bakari Amadou Ibrahim Moussa Seydou Idrissa Nnamdi Femi',
    'Mensah Okafor Adeyemi Nkosi Dlamini Osei Boateng Diallo Traore Camara Okonkwo Abara Mbeki Zulu Sesay Kamara Owusu Nwosu Balogun Ndlovu Mahlaba Keita Sow Bangura Appiah Eze'],
  'Pacific': [
    'Tane Manu Sione Mika Lemi Tevita Isaac Josese Sefa Viliami Eti Maka Kalani Koa Rawiri Hemi Wiremu Tipene Ioane Fetu Siosaia Mosese Atonio Malakai Pita Semisi',
    'Tuilagi Faleolo Fonoti Havili Ioane Latu Moala Penitani Tupou Vaea Leota Taufa Fifita Afoa Paea Toomua Aumua Salesa Tago Mafi Pouono Savea Talia Nonu Kolo'],
};

// Names that read as one word or two: "De Vries" is one last name, "Van Der Berg" too.
const split = s => words(s);
function pool(list) {
  // The lists above are space-separated, but Dutch last names have spaces in them. Those are written Capitalised
  // pieces that are re-joined below by a small set of known prefixes.
  const prefixes = new Set(['De', 'Van', 'Der']);
  const out = [];
  for (let i = 0, parts = split(list); i < parts.length; i++) {
    let n = parts[i];
    while (prefixes.has(parts[i]) && i + 1 < parts.length) n += ` ${parts[++i]}`;
    out.push(n);
  }
  return out;
}
const NAME_POOLS = Object.fromEntries(Object.entries(CULTURES).map(([k, [f, l]]) => [k, { first: pool(f), last: pool(l) }]));
// Dutch: the prefixed surnames above come out as "De Vries" etc. First names never use prefixes.
NAME_POOLS.Dutch.first = words(CULTURES.Dutch[0]);

// How often each culture is picked. "Mostly Australian" is the default: the league's players sound like an Australian
// competition, with a sprinkling of the backgrounds that make up one. "Mixed" is all 18 equally.
export const NAME_MIXES = {
  local: { Australian: 85, Irish: 4, Italian: 3, Greek: 1.5, Slavic: 1.5, Pacific: 1.5, Dutch: 1, German: 1, Indian: 0.5,
    Chinese: 0.5, Arabic: 0.25, Turkish: 0.25, Spanish: 0.25, Brazilian: 0.25, French: 0.25, Nordic: 0.25, Japanese: 0.1, African: 0.1 },
  mixed: Object.fromEntries(Object.keys(CULTURES).map(k => [k, 1])),
};
function pickCulture(mix) {
  const w = NAME_MIXES[mix] || NAME_MIXES.local, entries = Object.entries(w);
  let r = Math.random() * entries.reduce((a, [, x]) => a + x, 0);
  for (const [k, x] of entries) if ((r -= x) <= 0) return k;
  return entries[0][0];
}

export const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
// A 16-man squad: 2 GK, 5 DEF, 5 MID, 4 FWD.
const SHARE = { GK: 2 / 16, DEF: 5 / 16, MID: 5 / 16, FWD: 4 / 16 };

const key = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pick = list => list[Math.floor(Math.random() * list.length)];
function gauss() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

export const MAX_TOTAL = 19;

// A position's overall rating (1 to 10): what the player is mainly valued for.
export const overall = ({ position, offense, defense }) => (position === 'GK' ? 0.25 * offense + 0.75 * defense
  : position === 'DEF' ? 0.3 * offense + 0.7 * defense
  : position === 'MID' ? 0.5 * offense + 0.5 * defense
  : 0.7 * offense + 0.3 * defense);

// The price in dollars, $700 to about $16,900 (the weekly cap is $125,000 since 0.39.1; prices are unchanged). Same as the `value` column in the database.
export function playerValue(p) {
  return Math.round((700 + 17300 * ((overall(p) - 1) / 9) ** 2) / 100) * 100;
}

// Stars are rare: ability above 7.5 is squeezed, so an 8 or 9 is a real standout and a 10 almost never happens.
const squeeze = x => (x > 7.5 ? 7.5 + (x - 7.5) * 0.55 : x);

// Offense and defense for a position. `mean` is the typical player; `spread` how far players vary.
export function rate(position, mean = 5.5, spread = 1.3) {
  const q = squeeze(mean + gauss() * spread);   // overall ability, so stars are good at both ends of their job
  const jitter = () => gauss() * 0.7;
  let offense, defense;
  switch (position) {
    case 'GK': offense = clamp(squeeze(q - 1.5 + jitter()), 2, 9); defense = clamp(squeeze(q + 0.8 + jitter()), 1, 10); break;
    case 'DEF': offense = clamp(squeeze(q - 1.6 + jitter()), 1, 10); defense = clamp(squeeze(q + 1 + jitter()), 1, 10); break;
    case 'FWD': offense = clamp(squeeze(q + 1 + jitter()), 1, 10); defense = clamp(squeeze(q - 1.6 + jitter()), 1, 10); break;
    default: offense = clamp(squeeze(q + jitter()), 1, 10); defense = clamp(squeeze(q + jitter()), 1, 10);
  }
  while (offense + defense > MAX_TOTAL) { if (offense > defense) offense--; else defense--; }
  return { offense, defense };
}

// How many of each position in a pool of `count` (the 16-man squad shape, largest remainder).
export function positionCounts(count) {
  const raw = POSITIONS.map(p => count * SHARE[p]);
  const out = raw.map(Math.floor);
  let left = count - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) out[i]++; });
  return Object.fromEntries(POSITIONS.map((p, i) => [p, out[i]]));
}

// Singlet numbers, 1 to 99. Positions get their usual numbers first (keepers 1, strikers 9...), then the rest. Free
// agents can share a number; at a club numbers are unique (the database moves a clash to the next free number).
const TYPICAL = { GK: [1, 12, 13, 21, 30], DEF: [2, 3, 4, 5, 15, 16, 22, 23], MID: [6, 8, 10, 14, 17, 18, 20], FWD: [7, 9, 11, 19, 24, 27] };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function numbersFor(position, count) {
  const typical = TYPICAL[position];
  const rest = Array.from({ length: 98 }, (_, i) => i + 2).filter(n => !typical.includes(n));
  const order = [...shuffle([...typical]), ...shuffle(rest.filter(n => n <= 45)), ...shuffle(rest.filter(n => n > 45))];
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}

// A used-names tracker. Seed it with the league's current players so new ones never repeat a first or last name.
export function namer(existing = []) {
  const firsts = new Set(), lasts = new Set();
  const note = full => {
    const parts = String(full).trim().split(/\s+/);
    if (parts.length < 2) return;
    firsts.add(key(parts[0]));
    lasts.add(key(parts.slice(1).join(' ')));
  };
  existing.forEach(note);
  return {
    // One unused full name, or null if every combination is taken. `mix` is 'local' (mostly Australian) or 'mixed'.
    next(mix) {
      for (let tries = 0; tries < 600; tries++) {
        const p = NAME_POOLS[pickCulture(mix)];
        const f = pick(p.first), l = pick(p.last);
        if (key(f) === key(l) || firsts.has(key(f)) || lasts.has(key(l))) continue;
        const full = `${f} ${l}`;
        note(full);
        return full;
      }
      return null;
    },
    release(full) {      // a name dropped from a preview can be used again
      const parts = String(full).trim().split(/\s+/);
      firsts.delete(key(parts[0]));
      lasts.delete(key(parts.slice(1).join(' ')));
    },
  };
}

// `count` new players, all free agents (club null). `existing` = names already in the league.
// Quality: mean rating (4.5 weak, 5.5 typical, 6.5 strong). Mix: spread (1 even, 1.6 varied).
export function generate(count, existing = [], { mean = 5.5, spread = 1.3, names = 'local' } = {}) {
  const n = namer(existing), out = [];
  const counts = positionCounts(count);
  for (const position of POSITIONS) {
    const numbers = numbersFor(position, counts[position]);
    for (let i = 0; i < counts[position]; i++) {
      const name = n.next(names);
      if (!name) throw new Error('Ran out of unused names. Add fewer players, or remove some first.');
      out.push({ name, position, number: numbers[i], ...rate(position, mean, spread), club: null });
    }
  }
  return out;
}
