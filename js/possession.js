// B-39: both teams' possession as whole percentages that always add up to 100. The match file keeps one decimal (47.5 and 52.5), and rounding each
// side on its own showed 48% and 53%. The home share is rounded and the away side is the rest.
export function possPair(home, away) {
  const h = Number(home) || 0, a = Number(away) || 0, tot = h + a;
  if (!tot) return [50, 50];
  const ph = Math.round(100 * h / tot);
  return [ph, 100 - ph];
}
