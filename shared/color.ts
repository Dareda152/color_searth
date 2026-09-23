export type RGB = [number, number, number];
export type Oklab = [number, number, number];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function toLinear(value: number): number {
  const x = value / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
}

export function rgbToOklab([r, g, b]: RGB): Oklab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgbRaw([L, a, b]: Oklab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function oklabToRgb(lab: Oklab): RGB {
  return oklabToRgbRaw(lab).map((value) => Math.round(clamp(value / 255) * 255)) as RGB;
}

export function isInGamut(lab: Oklab): boolean {
  return oklabToRgbRaw(lab).every((value) => Number.isFinite(value) && value >= -0.0001 && value <= 255.0001);
}

export function maxChroma(L: number, hue: number): number {
  let low = 0;
  let high = 0.5;
  for (let index = 0; index < 15; index += 1) {
    const mid = (low + high) / 2;
    const lab: Oklab = [L, mid * Math.cos(hue), mid * Math.sin(hue)];
    if (isInGamut(lab)) low = mid;
    else high = mid;
  }
  return low;
}

export function wheelToRgb(L: number, hue: number, radius: number): RGB {
  const chroma = clamp(radius) * maxChroma(L, hue);
  return oklabToRgb([L, chroma * Math.cos(hue), chroma * Math.sin(hue)]);
}

export function oklabDistance(a: RGB, b: RGB): number {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Levels 1–5 go from forgiving to strict. A distance of lambda halves neither
// the score nor the perceived color difference; it is the exponential decay scale.
export const SCORE_SCALES = [0.24, 0.19, 0.15, 0.11, 0.08] as const;

export function scoreGuess(target: RGB, guess: RGB, strictness: number): number {
  const scale = SCORE_SCALES[Math.round(clamp(strictness, 1, 5)) - 1];
  return Math.round(5000 * Math.exp(-oklabDistance(target, guess) / scale));
}

export function rgbCss([r, g, b]: RGB): string {
  return `rgb(${r} ${g} ${b})`;
}

export function randomTarget(grayPercent: number, random = Math.random): RGB {
  const L = 0.25 + 0.6 * random();
  const hue = 2 * Math.PI * random();
  const muted = random() * 100 < grayPercent;
  const radius = muted ? 0.15 * random() : 0.15 + 0.8 * random();
  return wheelToRgb(L, hue, radius);
}
