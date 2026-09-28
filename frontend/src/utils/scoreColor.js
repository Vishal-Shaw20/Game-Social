/* Score colour as a continuous gradient, so every percentage gets its own
   shade: 0 = dried-blood red, 50 = yellow, 100 = bright green.
   Interpolated in HSL across two segments rather than in RGB, because a
   straight RGB blend from red to green passes through a muddy brown in the
   middle; HSL walks the hue wheel instead (red -> orange -> yellow -> lime ->
   green) while lightness rises out of the dark red. */
const SCORE_STOPS = [
  { at: 0, h: 0, s: 78, l: 27 },    // dried blood
  { at: 50, h: 48, s: 96, l: 54 },  // yellow
  { at: 100, h: 135, s: 82, l: 52 }, // bright green
];

export function scoreColor(score) {
  const v = Math.min(100, Math.max(0, score));
  const hi = v <= 50 ? 1 : 2;
  const a = SCORE_STOPS[hi - 1];
  const b = SCORE_STOPS[hi];
  const t = (v - a.at) / (b.at - a.at);
  const mix = (x, y) => (x + (y - x) * t).toFixed(1);
  return `hsl(${mix(a.h, b.h)} ${mix(a.s, b.s)}% ${mix(a.l, b.l)}%)`;
}
