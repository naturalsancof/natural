/*
 * Reading the wallpaper under a glass surface, and what the surface makes
 * of it. Ported from lumno-extension (newtab/wallpaper/wallpaper-adaptive-tone.ts
 * and domain/glass-legibility.ts).
 *
 * - sampler(): draws the wallpaper (an image or a video frame) the way CSS
 *   lays it out with object-fit: cover, small, and samples a 5 x 3 grid of
 *   points under a box, dropping the two darkest and two brightest.
 * - pickInk(): light text over a dark patch, dark text over a light one,
 *   with a band around the line so a surface never flickers at it.
 * - adapt(): how dense the tint should be and how much of the material's
 *   saturation boost to keep.
 * - tintFloor(): the least tint opacity at which the ink keeps 4.5:1 over
 *   the brightest (light ink) or darkest (dark ink) part of the patch.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (v) => {
  const a = clamp(v, 0, 1);
  return a * a * (3 - 2 * a);
};
export const luma = ([r, g, b]) => (r * 0.299 + g * 0.587 + b * 0.114) / 255;
const chroma = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

// The scale the wallpaper is drawn at for sampling: plenty for a 5 x 3 grid
// under each surface, and little to copy back from the GPU.
const SAMPLE_SCALE = 0.125;

const XS = [0.18, 0.34, 0.5, 0.66, 0.82];
const YS = [0.24, 0.5, 0.76];

export function sampler() {
  let canvas;
  let context;
  // A canvas that once drew an unreadable (cross-origin) image stays
  // unreadable, so it is replaced.
  const fresh = () => {
    canvas = document.createElement('canvas');
    context = canvas.getContext('2d', { willReadFrequently: true });
  };
  fresh();
  let pixels = null;
  let width = 1;
  let height = 1;

  const at = (x, y) => {
    const i = (clamp(Math.round(y * SAMPLE_SCALE), 0, height - 1) * width + clamp(Math.round(x * SAMPLE_SCALE), 0, width - 1)) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };

  return {
    // Draws `source` (img, video or canvas) as it covers a stage of this size.
    // Returns false when there is nothing to draw yet.
    capture(source, stageWidth, stageHeight) {
      const sw = source.videoWidth || source.naturalWidth || source.width;
      const sh = source.videoHeight || source.naturalHeight || source.height;
      if (!sw || !sh || (source.readyState !== undefined && source.readyState < 2)) return false;
      width = Math.max(1, Math.round(stageWidth * SAMPLE_SCALE));
      height = Math.max(1, Math.round(stageHeight * SAMPLE_SCALE));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const scale = Math.max(width / sw, height / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      try {
        context.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
        pixels = context.getImageData(0, 0, width, height).data;
      } catch {
        // A cross-origin wallpaper can't be read.
        pixels = null;
        fresh();
        return false;
      }
      return true;
    },
    // Forgets the last wallpaper read, when there is none to read.
    clear() {
      pixels = null;
    },
    get ready() {
      return pixels !== null;
    },
    // A box in stage pixels: { x, y, w, h }.
    sample(box) {
      if (!pixels) return null;
      const grid = YS.flatMap((fy) => XS.map((fx) => {
        const color = at(box.x + box.w * fx, box.y + box.h * fy);
        return { color, luminance: luma(color) };
      }));
      const values = [...grid].sort((a, b) => a.luminance - b.luminance);
      const texture = values[values.length - 1].luminance - values[0].luminance;
      const kept = values.slice(2, -2);
      const mean = (pick) => kept.reduce((sum, v) => sum + pick(v), 0) / kept.length;
      return {
        luminance: mean((v) => v.luminance),
        texture,
        color: [0, 1, 2].map((i) => mean((v) => v.color[i])),
      };
    },
  };
}

// Light ink below the threshold. A surface that has an ink keeps it within
// `band` of the line.
export function pickInk(luminance, previous, threshold = 0.5, band = 0.05) {
  const shift = previous === 'light' ? band : previous === 'dark' ? -band : 0;
  return luminance < threshold + shift ? 'light' : 'dark';
}

/*
 * density (0 thin, 1 dense): grows with texture and color, and as the
 * patch's brightness nears the ink's own. saturate: how much of the
 * material's saturation boost to keep; a vivid patch keeps less, or the
 * glass turns the wallpaper's color up.
 */
export function adapt({ luminance, texture, color }, ink) {
  const near = ink === 'dark'
    ? smoothstep((0.8 - luminance) / 0.35)
    : smoothstep((luminance - 0.12) / 0.4);
  const c = chroma(color);
  return {
    density: clamp(near * 0.55 + texture * 0.7 + c * 0.3, 0, 1),
    saturate: clamp(1 - c * 0.75, 0.45, 1),
  };
}

// ---------- Legibility ----------

// Body text's contrast (WCAG AA).
export const TEXT_CONTRAST = 4.5;
const INK_RGB = { light: [245, 245, 247], dark: [29, 29, 31] };
// Past this a plate stops reading as glass, and it reads anyway.
const MAX_FLOOR = 0.9;

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const relativeLuminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const gray = (level) => {
  const v = Math.round(clamp(level, 0, 1) * 255);
  return [v, v, v];
};

/*
 * The least tint opacity (0-1) at which `ink` reads over a patch of mean
 * `luminance` whose brightest and darkest points are `texture` apart, with
 * a tint of brightness `tintLevel` (0-1) composited over it.
 */
export function tintFloor(luminance, texture, ink, tintLevel) {
  const spread = clamp(Number(texture) || 0, 0, 1) / 2;
  const mean = clamp(Number(luminance) || 0, 0, 1);
  const backdrop = ink === 'light' ? Math.min(1, mean + spread) : Math.max(0, mean - spread);
  const reads = (alpha) => contrast(INK_RGB[ink], gray(backdrop + (tintLevel - backdrop) * alpha)) >= TEXT_CONTRAST;
  if (reads(0)) return 0;
  if (!reads(MAX_FLOOR)) return MAX_FLOOR;
  let low = 0;
  let high = MAX_FLOOR;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (reads(middle)) high = middle;
    else low = middle;
  }
  return high;
}
