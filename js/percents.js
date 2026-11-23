// Whole percentages that add up to exactly 100 (largest remainder), for showing win / draw / loss side by side.
// Shared by the win chance (js/match-model.js) and Stakes (js/stakes.js), so both show the same numbers (B-41).
export function percents({ home, draw, away }) {
  const raw = [home, draw, away].map(x => x * 100), fl = raw.map(Math.floor);
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) fl[i]++; });
  return fl;
}
