// src/hooks/useArtTint.js
//
// A game's colour, taken from its art: the most common colourful hue (not
// the average of all of them, which turns red + blue art into a purple that
// isn't in it), as an hsl() accent bright enough to tint dark UI.
//
// useArtTint(sources): the images to try, best first (the page passes the
// cover art, then a few screenshots). The first one that can be read and has
// enough colour wins. null while loading, or when none qualifies.
//
// Reads a 200px copy (utils/gameArt.js) with CORS. RAWG only sends CORS
// headers to requests with an Origin, and the browser cache would hand a
// CORS request the non-CORS copy of a URL a plain <img> already loaded, so
// this uses a width nothing else on the site shows. Keep it that way. Steam's
// images (screenshots of Steam games) can't be read at all; they're skipped.
import { useEffect, useState } from "react";
import { gameArt } from "../utils/gameArt";

const TINT_WIDTH = 200;
const W = 32;
const H = 18;
const BINS = 24; // 15° of hue each

/** The dominant colourful hue of an image's pixels, or null if it's too grey. */
export function dominantHue(data) {
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const chroma = max - min;
    if (chroma < 0.08) continue; // greys don't vote
    let h;
    if (max === r) h = ((g - b) / chroma) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    const hue = (h * 60 + 360) % 360;
    const l = (max + min) / 2;
    const sat = chroma / (1 - Math.abs(2 * l - 1) || 1);
    pixels.push({ hue, chroma, sat, bin: Math.floor((hue / 360) * BINS) % BINS });
  }
  const total = data.length / 4;
  const colourful = pixels.reduce((w, p) => w + p.chroma, 0);
  if (colourful < total * 0.04) return null; // too little colour to call it

  // The hue band with the most (vivid) colour, counting its neighbours half.
  const bins = new Array(BINS).fill(0);
  for (const p of pixels) bins[p.bin] += p.chroma * p.sat;
  let peak = 0, best = -1;
  for (let i = 0; i < BINS; i++) {
    const v = bins[i] + 0.5 * (bins[(i + 1) % BINS] + bins[(i - 1 + BINS) % BINS]);
    if (v > best) { best = v; peak = i; }
  }

  // The hue and saturation of that band (and its neighbours).
  let x = 0, y = 0, w = 0, s = 0;
  for (const p of pixels) {
    const d = Math.min((p.bin - peak + BINS) % BINS, (peak - p.bin + BINS) % BINS);
    if (d > 1) continue;
    const a = (p.hue * Math.PI) / 180;
    x += Math.cos(a) * p.chroma;
    y += Math.sin(a) * p.chroma;
    w += p.chroma;
    s += p.sat * p.chroma;
  }
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const saturation = Math.min(80, Math.max(45, (s / w) * 100));
  return `hsl(${Math.round(hue)} ${Math.round(saturation)}% 62%)`;
}

/** The image's pixels at W×H, or null if it can't be loaded or read. */
function readPixels(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        resolve(ctx.getImageData(0, 0, W, H).data);
      } catch {
        resolve(null); // no CORS (Steam's images): can't be read
      }
    };
    img.onerror = () => resolve(null);
    img.src = gameArt(src, TINT_WIDTH);
  });
}

export function useArtTint(sources) {
  // A string key, so a new array with the same images doesn't start over.
  const key = (sources ?? []).filter(Boolean).join("|");
  const [tint, setTint] = useState({ key: null, value: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      for (const src of key.split("|")) {
        const data = await readPixels(src);
        if (cancelled) return;
        const value = data && dominantHue(data);
        if (value) return setTint({ key, value });
      }
      setTint({ key, value: null });
    })();
    return () => { cancelled = true; };
  }, [key]);

  // Only the answer for these images (not the last game's).
  return tint.key === key ? tint.value : null;
}
