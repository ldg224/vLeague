// V2 faces: the traits js/portrait.js draws for a player (skin, hair style and colour, beard, eyes, face shape), so the 3D head can
// match his portrait. Reads portrait.js itself and follows its draw() step for step (same seed, same order of random picks), so the
// two can never drift apart as long as draw()'s pick order is unchanged.
//   node v2/faces/traits.mjs players.json > traits.json      players.json: [{ id, name, look, face, club }]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'js', 'portrait.js'), 'utf8')
  .replace(/^import .*$/m, 'const isHex = () => true;')
  + '\nexport { GROUPS, SKIN, KIT, MOUTH, rng, pick };\n';
const tmp = join(mkdtempSync(join(tmpdir(), 'traits-')), 'portrait.mjs');
writeFileSync(tmp, src);
const P = await import(pathToFileURL(tmp));

export function traits(p) {
  const group = P.lookOf(p), g = P.GROUPS[group], r = P.rng(`${p.id}#${p.face || 0}`);
  const skin = P.SKIN[P.pick(r, g.skin)], hairC = P.pick(r, g.hairC), hair = P.pick(r, g.hair);
  P.pick(r, P.KIT);                                   // kit pattern (unused here)
  const eyes = P.pick(r, g.eyes), iris = P.pick(r, g.iris), mouth = P.pick(r, P.MOUTH), beard = P.pick(r, g.beard);
  const w = g.face[0] + r() * g.face[1], hh = g.face[2] + r() * g.face[3], jaw = g.face[4] + r() * g.face[5];
  return { id: p.id, name: p.name, club: p.club, look: group, skin, hair, hairC, beard, eyes, iris, nose: g.nose,
           faceW: +w.toFixed(2), faceH: +hh.toFixed(2), jaw: +jaw.toFixed(3) };
}

if (process.argv[2]) {
  const players = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(players.map(traits), null, 1));
}
