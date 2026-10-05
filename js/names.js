// Player generator for the Editor (0.11): names from 18 cultures and ratings shaped by position.
// Loaded only by editor.js. Rules:
//  - No two players share a first name or a last name, in one batch or against players already in the league.
//  - Nobody is given a club; players start as free agents and are dealt out later (a draft).
//  - Ratings are offense and defense, 1 to 10, and together at most 19: nobody is a perfect 10 (MAX_TOTAL).
//    Value is worked out from them (playerValue), the same sum as the `value` column in
//    supabase/migrations/0009_player_ratings.sql: keep the two in step.

const words = s => s.split(/\s+/).filter(Boolean);

// Each culture: first names and last names. Spaced-out lists, so adding a name is one word.
export const CULTURES = {
  'Anglo': [
    'Oliver Jack William Henry Thomas Lachlan Mitchell Harrison Callum Declan Flynn Hayden Cooper Riley Angus Jordan Tyson Beau Dylan Spencer Caleb Brodie Wade Heath Nathan Josh',
    'Walker Hughes Fletcher Hartley Barnes Whitaker Pearce Holloway Cartwright Ellison Thornton Marsh Gibbs Redfern Atkins Bradshaw Dawson Kendall Mercer Sutton Ashworth Pritchard Langley Harker Wilcox Denton'],
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
export const overall = ({ position, offense, defense }) => (position === 'GK' ? 0.1 * offense + 0.9 * defense
  : position === 'DEF' ? 0.3 * offense + 0.7 * defense
  : position === 'MID' ? 0.5 * offense + 0.5 * defense
  : 0.7 * offense + 0.3 * defense);

// The price in dollars, $500 to about $11,250. Same as the `value` column in the database.
export function playerValue(p) {
  return Math.round((500 + 11500 * ((overall(p) - 1) / 9) ** 2) / 50) * 50;
}

// Stars are rare: ability above 7.5 is squeezed, so an 8 or 9 is a real standout and a 10 almost never happens.
const squeeze = x => (x > 7.5 ? 7.5 + (x - 7.5) * 0.55 : x);

// Offense and defense for a position. `mean` is the typical player; `spread` how far players vary.
export function rate(position, mean = 5.5, spread = 1.3) {
  const q = squeeze(mean + gauss() * spread);   // overall ability, so stars are good at both ends of their job
  const jitter = () => gauss() * 0.7;
  let offense, defense;
  switch (position) {
    case 'GK': offense = clamp(2 + gauss() * 0.9, 1, 4); defense = clamp(squeeze(q + 0.8 + jitter()), 1, 10); break;
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
    // One unused full name, or null if every combination is taken. `culture` forces one culture (otherwise random).
    next(culture) {
      const names = culture ? [culture] : Object.keys(NAME_POOLS);
      for (let tries = 0; tries < 400; tries++) {
        const p = NAME_POOLS[culture || pick(names)];
        const f = pick(p.first), l = pick(p.last);
        if (firsts.has(key(f)) || lasts.has(key(l))) continue;
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
export function generate(count, existing = [], { mean = 5.5, spread = 1.3 } = {}) {
  const n = namer(existing), out = [];
  const counts = positionCounts(count);
  for (const position of POSITIONS) {
    for (let i = 0; i < counts[position]; i++) {
      const name = n.next();
      if (!name) throw new Error('Ran out of unused names. Add fewer players, or remove some first.');
      out.push({ name, position, ...rate(position, mean, spread), club: null });
    }
  }
  return out;
}

// A replacement for one previewed player: a new name and new ratings, same position.
export function reroll(player, taken, opts = {}) {
  const n = namer(taken);
  const name = n.next();
  if (!name) throw new Error('Ran out of unused names.');
  return { ...player, name, ...rate(player.position, opts.mean, opts.spread) };
}
