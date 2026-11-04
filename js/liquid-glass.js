/**
 * Liquid glass material runtime.
 *
 * The CSS in style.css owns the token-driven material. This module:
 *  - samples the 5x3 patch behind each [data-glass] surface
 *  - picks ink (with hysteresis) and tint density/chroma
 *  - builds the optional SVG rim lens (feImage + feDisplacementMap, with a
 *    three-pass chromatic split where it is safe)
 *  - persists the per-theme tint scale and the last ink decision
 *
 * The page background is a stack of gradients, so the sampler paints a small
 * offscreen canvas that mirrors the body gradients. Real images and canvases
 * that sit behind a surface are sampled directly when they are readable.
 */

const GLASS_SELECTOR = '[data-glass]';

const TINT_KEYS = {
  light: 'bonvoyage-glass-tint-light',
  dark: 'bonvoyage-glass-tint-dark'
};

const INK_KEY = 'bonvoyage-glass-ink';

const MAX_TINT = 1.5;
const GRID_COLUMNS = 5;
const GRID_ROWS = 3;

const INK_THRESHOLD = 0.5;
const INK_HYSTERESIS = 0.05;
const DENSE_TINT = { light: 0.75, dark: 0.8 };

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_LIMIT = 48;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let started = false;
let lensSupported = false;
let reducedTransparency = false;
let forcedColors = false;

const states = new Map();
const gradientCache = new Map();
const displacementCache = new Map();

let lensSequence = 0;
let sampleCanvas = null;
let sampleContext = null;

let inkStore = {};
let inkSaveTimer = 0;

let tintValues = { light: 1, dark: 1 };
let tintInput = null;
let tintScale = 1;
let tintFrame = 0;

let refreshTimer = 0;
let refreshForce = false;
let resizeTimer = 0;
let scrollFrame = 0;

let domObserver = null;
let themeObserver = null;

/* =========================
   Boot
   ========================= */

export function initLiquidGlass() {
  if (started || typeof document === 'undefined') {
    return;
  }

  started = true;

  lensSupported = supportsRimLens();
  reducedTransparency = mediaMatches('(prefers-reduced-transparency: reduce)');
  forcedColors = mediaMatches('(forced-colors: active)');

  loadTintValues();
  loadInkStore();

  tintInput = document.getElementById('glass-tint');
  bindTintControl();
  applyTintForTheme(getTheme());

  observeTheme();
  observeDom();
  observeViewport();
  observeMedia();

  refresh(true);
}

function mediaMatches(query) {
  try {
    return window.matchMedia(query).matches;
  } catch (error) {
    return false;
  }
}

function supportsRimLens() {
  if (typeof CSS === 'undefined' || !CSS.supports) {
    return false;
  }

  // Firefox parses url() backdrop filters but paints nothing for them.
  if (/Firefox|FxiOS/i.test(navigator.userAgent || '')) {
    return false;
  }

  try {
    return CSS.supports('backdrop-filter', 'url(#lg-probe)') ||
      CSS.supports('-webkit-backdrop-filter', 'url(#lg-probe)');
  } catch (error) {
    return false;
  }
}

function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/* =========================
   Tint scale
   ========================= */

function readStoredNumber(key, fallback) {
  try {
    const raw = localStorage.getItem(key);

    if (raw === null) {
      return fallback;
    }

    const value = Number.parseFloat(raw);

    return Number.isFinite(value) ? clamp(value, 0, MAX_TINT) : fallback;
  } catch (error) {
    return fallback;
  }
}

function loadTintValues() {
  tintValues.light = readStoredNumber(TINT_KEYS.light, 1);
  tintValues.dark = readStoredNumber(TINT_KEYS.dark, 1);
}

function persistTint(theme) {
  try {
    localStorage.setItem(TINT_KEYS[theme], String(tintValues[theme]));
  } catch (error) {
    /* private mode / storage disabled */
  }
}

function setTintScale(value) {
  tintScale = clamp(value, 0, MAX_TINT);
  document.documentElement.style.setProperty('--lg-tint-scale', tintScale.toFixed(3));
}

function syncTintInput() {
  if (!tintInput) {
    return;
  }

  const value = tintValues[getTheme()];

  if (tintInput.value !== String(value)) {
    tintInput.value = String(value);
  }
}

function applyTintForTheme(theme) {
  cancelAnimationFrame(tintFrame);
  setTintScale(tintValues[theme]);
  syncTintInput();
}

function glideTintTo(theme) {
  cancelAnimationFrame(tintFrame);

  const target = tintValues[theme];

  if (mediaMatches('(prefers-reduced-motion: reduce)') ||
      Math.abs(tintScale - target) < 0.001) {
    setTintScale(target);
    syncTintInput();
    return;
  }

  const from = tintScale;
  const start = performance.now();
  const duration = 420;

  const step = now => {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    setTintScale(from + (target - from) * eased);

    if (progress < 1) {
      tintFrame = requestAnimationFrame(step);
      return;
    }

    setTintScale(target);
    syncTintInput();
  };

  tintFrame = requestAnimationFrame(step);
}

function bindTintControl() {
  if (!tintInput) {
    return;
  }

  tintInput.addEventListener('input', () => {
    const theme = getTheme();
    const value = clamp(Number.parseFloat(tintInput.value) || 0, 0, MAX_TINT);

    tintValues[theme] = value;
    persistTint(theme);

    cancelAnimationFrame(tintFrame);
    setTintScale(value);
  });
}

/* =========================
   Observers
   ========================= */

function observeTheme() {
  themeObserver = new MutationObserver(() => {
    // The sampler paints the gradients from source colours; drop the old
    // theme's cached canvases before resampling.
    gradientCache.clear();
    syncTintInput();
    glideTintTo(getTheme());
    scheduleRefresh(true);
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

function observeDom() {
  domObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        scheduleRefresh(false);
        return;
      }

      if (mutation.type === 'attributes' &&
          (mutation.attributeName === 'hidden' ||
           mutation.attributeName === 'class' ||
           mutation.attributeName === 'data-glass')) {
        scheduleRefresh(false);
        return;
      }
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'class', 'data-glass']
  });
}

function observeViewport() {
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);

    resizeTimer = window.setTimeout(() => {
      // The gradient canvas follows the viewport aspect ratio.
      gradientCache.clear();
      scheduleRefresh(true);
    }, 180);
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (scrollFrame) {
      return;
    }

    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      scheduleRefresh(false);
    });
  }, { passive: true });

  window.addEventListener('load', () => scheduleRefresh(true), { once: true });

  // Note images can arrive after the card is in the DOM; resample when they
  // finish decoding so ink and density reflect the photo, not the fallback.
  document.addEventListener('load', event => {
    if (event.target && event.target.tagName === 'IMG') {
      scheduleRefresh(false);
    }
  }, true);
}

function observeMedia() {
  const listeners = [
    ['(prefers-reduced-transparency: reduce)', value => {
      reducedTransparency = value;
      scheduleRefresh(true);
    }],
    ['(forced-colors: active)', value => {
      forcedColors = value;
      scheduleRefresh(true);
    }]
  ];

  listeners.forEach(([query, apply]) => {
    let media = null;

    try {
      media = window.matchMedia(query);
    } catch (error) {
      return;
    }

    const onChange = event => apply(event.matches);

    if (media.addEventListener) {
      media.addEventListener('change', onChange);
    } else if (media.addListener) {
      media.addListener(onChange);
    }
  });
}

function scheduleRefresh(force) {
  refreshForce = refreshForce || force;

  if (refreshTimer) {
    return;
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;

    const runForce = refreshForce;
    refreshForce = false;

    refresh(runForce);
  }, 90);
}

/* =========================
   Surface refresh
   ========================= */

function refresh(force) {
  const theme = getTheme();
  const nodes = document.querySelectorAll(GLASS_SELECTOR);
  const visible = [];
  const pending = [];

  // Remove lens SVGs that belonged to removed / detached surfaces.
  for (const [element, state] of states) {
    if (!element.isConnected) {
      releaseLens(state);
      states.delete(element);
      continue;
    }

    if (!element.matches(GLASS_SELECTOR)) {
      releaseLens(state);
      states.delete(element);
    }
  }

  nodes.forEach(element => {
    const state = ensureState(element);
    const rect = element.getBoundingClientRect();

    if (rect.width < 1 || rect.height < 1) {
      return;
    }

    const style = getComputedStyle(element);

    if (style.display === 'none' || style.visibility === 'hidden') {
      return;
    }

    // Leave off-screen cards on the designed default tokens. Sampling them
    // would only force an "unreadable" dense tint before they scroll in.
    if (rect.bottom <= 0 || rect.top >= window.innerHeight ||
        rect.right <= 0 || rect.left >= window.innerWidth) {
      return;
    }

    const moved = !state.lastRect ||
      Math.abs(rect.left - state.lastRect.left) > 0.5 ||
      Math.abs(rect.top - state.lastRect.top) > 0.5 ||
      Math.abs(rect.width - state.lastRect.width) > 0.5 ||
      Math.abs(rect.height - state.lastRect.height) > 0.5;

    const entry = { element, state, rect, style, sample: null };

    visible.push(entry);

    if (force || moved || state.lastTheme !== theme) {
      entry.sample = sampleSurface(element, rect, theme);
      pending.push(entry);
    }
  });

  const shared = shareRowInk(pending, theme);

  pending.forEach(entry => {
    applySample(entry.element, entry.state, entry.sample, theme, shared.get(entry));
  });

  visible.forEach(entry => {
    entry.state.texture = entry.sample
      ? entry.sample.texture
      : (entry.state.texture || 0);

    updateLens(entry.element, entry.state, entry.rect);
  });
}

function ensureState(element) {
  let state = states.get(element);

  if (state) {
    return state;
  }

  const markupInk = element.dataset.glassInk;

  state = {
    key: surfaceKey(element),
    forcedInk: markupInk === 'light' || markupInk === 'dark' ? markupInk : null,
    ink: null,
    lastRect: null,
    lastTheme: null,
    texture: 0,
    lensKey: '',
    lensPending: '',
    lensSvg: null,
    lensReady: false
  };

  states.set(element, state);

  return state;
}

function surfaceKey(element) {
  if (element.id) {
    return `#${element.id}`;
  }

  const note = element.closest('[data-note-id]');
  const classes = [...element.classList].sort().join('.');
  const parent = element.parentElement;
  const index = parent ? [...parent.children].indexOf(element) : 0;

  return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}` +
    `${note ? `@${note.dataset.noteId}` : ''}:${index}`;
}

function rawInk(state, sample) {
  const previous = state.ink || inkStore[state.key] || null;

  const threshold = previous === 'light'
    ? INK_THRESHOLD + INK_HYSTERESIS
    : previous === 'dark'
      ? INK_THRESHOLD - INK_HYSTERESIS
      : INK_THRESHOLD;

  return sample.lum < threshold ? 'light' : 'dark';
}

function shareRowInk(entries, theme) {
  const decisions = new Map();

  if (!entries.length) {
    return decisions;
  }

  // In dark mode every surface uses light ink, so no row negotiation is
  // needed. Forced-ink surfaces (e.g. the lightbox close button) are also
  // independent.
  if (theme === 'dark') {
    entries.forEach(entry => decisions.set(entry, 'light'));
    return decisions;
  }

  const rows = new Map();

  entries.forEach(entry => {
    if (entry.state.forcedInk) {
      decisions.set(entry, entry.state.forcedInk);
      return;
    }

    // Side-by-side neighbours share a horizontal band. Bands are deliberately
    // coarse so a small vertical offset does not split a row.
    const band = Math.round((entry.rect.top + entry.rect.height / 2) / 48);

    if (!rows.has(band)) {
      rows.set(band, []);
    }

    rows.get(band).push(entry);
  });

  rows.forEach(row => {
    const raw = row.map(entry => ({
      entry,
      ink: rawInk(entry.state, entry.sample)
    }));

    const light = raw.filter(item => item.ink === 'light').length;
    const dark = raw.length - light;

    let ink;

    if (light === 0 || dark === 0) {
      ink = light > 0 ? 'light' : 'dark';
    } else {
      const average = row.reduce((sum, entry) => sum + entry.sample.lum, 0) / row.length;
      ink = average < INK_THRESHOLD ? 'light' : 'dark';
    }

    raw.forEach(item => decisions.set(item.entry, ink));
  });

  return decisions;
}

function applySample(element, state, sample, theme, sharedInk) {
  let ink;

  if (theme === 'dark') {
    ink = 'light';
  } else if (state.forcedInk) {
    ink = state.forcedInk;
  } else if (sharedInk) {
    ink = sharedInk;
  } else {
    ink = rawInk(state, sample);
  }

  state.ink = ink;

  if (element.dataset.glassInk !== ink) {
    element.dataset.glassInk = ink;
  }

  if (inkStore[state.key] !== ink) {
    inkStore[state.key] = ink;
    scheduleInkSave();
  }

  let chroma = sample.chroma;
  let density;

  if (sample.unreadable) {
    // Video / cross-origin / tainted: theme ink plus a dense frost.
    density = DENSE_TINT[theme] || 0.75;
    chroma = Math.max(chroma, 0.15);
  } else {
    // Contrast to the chosen ink brightness grows the tint, as does texture
    // and chroma. The designed light default lands near the thin end.
    const inkLuminance = ink === 'light' ? 0.95 : 0.1;
    const contrast = Math.abs(sample.lum - inkLuminance);

    density = clamp(
      0.55 * contrast +
      0.7 * sample.texture +
      0.3 * chroma,
      0,
      1
    );
  }

  // Light ink needs enough frost for legibility.
  if (ink === 'light') {
    density = Math.max(density, 0.5);
  }

  element.style.setProperty('--lg-density', density.toFixed(3));
  element.style.setProperty('--lg-chroma', chroma.toFixed(3));
}

function scheduleInkSave() {
  if (inkSaveTimer) {
    return;
  }

  inkSaveTimer = window.setTimeout(() => {
    inkSaveTimer = 0;

    try {
      localStorage.setItem(INK_KEY, JSON.stringify(inkStore));
    } catch (error) {
      /* private mode / storage disabled */
    }
  }, 280);
}

function loadInkStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(INK_KEY) || '{}');

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      inkStore = parsed;
    }
  } catch (error) {
    inkStore = {};
  }
}

/* =========================
   Background sampling
   ========================= */

function sampleSurface(element, rect, theme) {
  const samples = [];

  let darkest = 1;
  let brightest = 0;
  let failed = 0;
  let tested = 0;

  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const x = left + width * ((column + 0.5) / GRID_COLUMNS);
      const y = top + height * ((row + 0.5) / GRID_ROWS);

      tested += 1;

      const rgb = samplePoint(element, x, y, theme);

      if (!rgb) {
        failed += 1;
        continue;
      }

      const lum = luminance(rgb);

      darkest = Math.min(darkest, lum);
      brightest = Math.max(brightest, lum);

      samples.push({ rgb, lum });
    }
  }

  if (!samples.length) {
    return {
      lum: theme === 'dark' ? 0.1 : 0.9,
      texture: 0.4,
      chroma: 0.1,
      unreadable: true
    };
  }

  // Drop the two darkest and two brightest samples, then average.
  const sorted = samples.slice().sort((a, b) => a.lum - b.lum);
  const kept = sorted.length > 5
    ? sorted.slice(2, sorted.length - 2)
    : sorted;

  const average = kept.reduce((acc, item) => {
    acc[0] += item.rgb[0];
    acc[1] += item.rgb[1];
    acc[2] += item.rgb[2];
    return acc;
  }, [0, 0, 0]).map(value => value / kept.length);

  const max = Math.max(average[0], average[1], average[2]);
  const min = Math.min(average[0], average[1], average[2]);

  return {
    lum: luminance(average),
    texture: clamp(brightest - darkest, 0, 1),
    chroma: clamp((max - min) / 255, 0, 1),
    unreadable: tested > 0 && failed / tested > 0.5
  };
}

function luminance(rgb) {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

function samplePoint(element, x, y, theme) {
  let stack;

  try {
    stack = document.elementsFromPoint(x, y);
  } catch (error) {
    return null;
  }

  let image = null;
  let canvas = null;
  let video = false;
  let onMap = false;
  let mapCanvas = null;
  let scrim = 0;

  for (const node of stack) {
    if (!(node instanceof Element)) {
      continue;
    }

    if (node === element || element.contains(node)) {
      continue;
    }

    if (node.id === 'lightbox' || node.classList.contains('lightbox')) {
      scrim = Math.max(scrim, theme === 'dark' ? 0.92 : 0.86);
    } else if (node.classList.contains('modal')) {
      scrim = Math.max(scrim, 0.55);
    } else if (node.classList.contains('map-scrim')) {
      scrim = Math.max(scrim, 0.46);
    }

    if (!image && node.tagName === 'IMG') {
      image = node;
    }

    if (!canvas && node.tagName === 'CANVAS') {
      canvas = node;
    }

    if (node.tagName === 'VIDEO') {
      video = true;
    }

    if (!onMap &&
        (node.classList.contains('map-canvas') ||
         node.classList.contains('world-map') ||
         node.closest('.map-canvas'))) {
      onMap = true;
    }

    if (!mapCanvas && node.classList.contains('map-canvas')) {
      mapCanvas = node;
    }

    if (node === document.body) {
      break;
    }
  }

  if (video) {
    // A live video cannot be sampled reliably.
    return null;
  }

  if (image) {
    const pixel = sampleImagePixel(image, x, y);

    if (pixel === false) {
      return null;
    }

    if (pixel) {
      return applyScrim(pixel, scrim);
    }
    // Letterboxed outside the drawn image: fall through to the page.
  }

  if (canvas) {
    const pixel = sampleCanvasPixel(canvas, x, y);

    if (pixel === false) {
      return null;
    }

    if (pixel) {
      return applyScrim(pixel, scrim);
    }
  }

  let base = sampleGradient(theme, x, y);

  if (onMap) {
    // The map is transparent over the page, with a neutral translucent land
    // wash and, on narrow screens, a translucent canvas backing.
    if (mapCanvas) {
      const backing = parseCssColor(getComputedStyle(mapCanvas).backgroundColor);

      if (backing && backing[3] > 0) {
        base = mix(base, backing, backing[3]);
      }
    }

    const land = theme === 'dark' ? [196, 206, 216] : [90, 100, 112];
    base = mix(base, land, theme === 'dark' ? 0.18 : 0.22);
  }

  return applyScrim(base, scrim);
}

function applyScrim(rgb, alpha) {
  if (!alpha) {
    return rgb;
  }

  return mix(rgb, [12, 25, 29], alpha);
}

function parseCssColor(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/i);

  if (!match) {
    return null;
  }

  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);

  if (parts.length < 3 || parts.some(part => !Number.isFinite(part))) {
    return null;
  }

  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function sampleImagePixel(image, x, y) {
  const rect = image.getBoundingClientRect();

  if (rect.width < 1 || rect.height < 1 || !image.complete) {
    return null;
  }

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (!naturalWidth || !naturalHeight) {
    return null;
  }

  // Drawing a cross-origin image would taint the shared canvas; treat it as
  // unreadable immediately instead.
  if (!isReadableImageSource(image.currentSrc || image.src)) {
    return false;
  }

  const fit = getComputedStyle(image).objectFit || 'fill';

  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (fit === 'contain' || fit === 'scale-down') {
    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);

    drawWidth = naturalWidth * scale;
    drawHeight = naturalHeight * scale;
    offsetX = (rect.width - drawWidth) / 2;
    offsetY = (rect.height - drawHeight) / 2;
  } else if (fit === 'cover') {
    const scale = Math.max(rect.width / naturalWidth, rect.height / naturalHeight);

    drawWidth = naturalWidth * scale;
    drawHeight = naturalHeight * scale;
    offsetX = (rect.width - drawWidth) / 2;
    offsetY = (rect.height - drawHeight) / 2;
  }

  const localX = x - rect.left - offsetX;
  const localY = y - rect.top - offsetY;

  if (localX < 0 || localY < 0 || localX > drawWidth || localY > drawHeight) {
    return null;
  }

  const sourceX = (localX / drawWidth) * naturalWidth;
  const sourceY = (localY / drawHeight) * naturalHeight;
  const sourceWidth = Math.max(1, naturalWidth / drawWidth);
  const sourceHeight = Math.max(1, naturalHeight / drawHeight);

  const context = getSampleContext();

  if (!context) {
    return null;
  }

  try {
    context.clearRect(0, 0, 1, 1);
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      1,
      1
    );

    const pixel = context.getImageData(0, 0, 1, 1).data;

    return [pixel[0], pixel[1], pixel[2]];
  } catch (error) {
    // Defensive: drop the now-tainted canvas so same-origin samples keep
    // working afterwards.
    sampleCanvas = null;
    sampleContext = null;
    return false;
  }
}

function isReadableImageSource(source) {
  if (!source) {
    return false;
  }

  if (source.startsWith('data:') || source.startsWith('blob:')) {
    return true;
  }

  try {
    return new URL(source, window.location.href).origin === window.location.origin;
  } catch (error) {
    return false;
  }
}

function sampleCanvasPixel(canvas, x, y) {
  const rect = canvas.getBoundingClientRect();

  if (rect.width < 1 || rect.height < 1 || !canvas.width || !canvas.height) {
    return null;
  }

  const px = clamp(
    Math.floor(((x - rect.left) / rect.width) * canvas.width),
    0,
    canvas.width - 1
  );
  const py = clamp(
    Math.floor(((y - rect.top) / rect.height) * canvas.height),
    0,
    canvas.height - 1
  );

  const context = getSampleContext();

  if (!context) {
    return null;
  }

  try {
    context.clearRect(0, 0, 1, 1);
    context.drawImage(canvas, px, py, 1, 1, 0, 0, 1, 1);

    const pixel = context.getImageData(0, 0, 1, 1).data;

    return [pixel[0], pixel[1], pixel[2]];
  } catch (error) {
    sampleCanvas = null;
    sampleContext = null;
    return false;
  }
}

function getSampleContext() {
  if (sampleContext) {
    return sampleContext;
  }

  sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 1;
  sampleCanvas.height = 1;

  try {
    sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
  } catch (error) {
    sampleContext = null;
  }

  return sampleContext;
}

function sampleGradient(theme, x, y) {
  const canvas = getGradientCanvas(theme);
  const px = clamp(
    Math.floor((x / Math.max(1, window.innerWidth)) * canvas.width),
    0,
    canvas.width - 1
  );
  const py = clamp(
    Math.floor((y / Math.max(1, window.innerHeight)) * canvas.height),
    0,
    canvas.height - 1
  );
  const index = (py * canvas.width + px) * 4;

  return [
    canvas.data[index],
    canvas.data[index + 1],
    canvas.data[index + 2]
  ];
}

function getGradientCanvas(theme) {
  // Keep the sampler's aspect ratio aligned with the fixed-attachment body
  // gradient, so radial positions are not stretched on wide screens.
  const width = 192;
  const height = clamp(
    Math.round(width * (window.innerHeight / Math.max(1, window.innerWidth))),
    64,
    384
  );
  const key = `${theme}:${width}x${height}`;

  if (gradientCache.has(key)) {
    return gradientCache.get(key);
  }

  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    const fallback = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(
        theme === 'dark' ? 15 : 247
      )
    };

    gradientCache.set(key, fallback);

    return fallback;
  }

  if (theme === 'dark') {
    // Mirrors [data-theme="dark"] body in style.css (visible soft forms).
    paintLinear(context, width, height, 155, [
      [0, [7, 9, 12]],
      [0.48, [18, 22, 26]],
      [1, [26, 31, 38]]
    ]);

    paintRadial(context, width, height, 0.12, 0.10, 0.58, [255, 255, 255, 0.12]);
    paintRadial(context, width, height, 0.94, 0.14, 0.56, [170, 184, 204, 0.14]);
    paintRadial(context, width, height, 0.72, 0.92, 0.62, [255, 255, 255, 0.08]);
    paintRadial(context, width, height, 0.28, 0.72, 0.56, [0, 0, 0, 0.42]);
    paintRadial(context, width, height, 0.48, 0.40, 0.68, [70, 78, 90, 0.28]);
  } else {
    // Mirrors body in style.css (cool paper + luminance-step blobs).
    paintLinear(context, width, height, 150, [
      [0, [223, 229, 238]],
      [0.46, [238, 241, 245]],
      [1, [228, 232, 239]]
    ]);

    paintRadial(context, width, height, 0.10, 0.16, 0.62, [132, 156, 188, 0.48]);
    paintRadial(context, width, height, 0.92, 0.06, 0.58, [168, 184, 208, 0.42]);
    paintRadial(context, width, height, 0.78, 0.92, 0.64, [148, 158, 176, 0.36]);
    paintRadial(context, width, height, 0.24, 0.78, 0.56, [198, 186, 172, 0.30]);
    paintRadial(context, width, height, 0.52, 0.42, 0.70, [255, 255, 255, 0.55]);
  }

  const entry = {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data
  };

  gradientCache.set(key, entry);

  return entry;
}

function paintLinear(context, width, height, degrees, stops) {
  const angle = (degrees * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;

  const gradient = context.createLinearGradient(
    cx - (dx * length) / 2,
    cy - (dy * length) / 2,
    cx + (dx * length) / 2,
    cy + (dy * length) / 2
  );

  stops.forEach(([offset, rgb]) => {
    gradient.addColorStop(offset, `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`);
  });

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function paintRadial(context, width, height, cxRatio, cyRatio, size, rgba) {
  const cx = width * cxRatio;
  const cy = height * cyRatio;
  const farthest = Math.hypot(
    Math.max(cx, width - cx),
    Math.max(cy, height - cy)
  );
  const radius = farthest * size;

  const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);

  gradient.addColorStop(0, `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3]})`);
  gradient.addColorStop(1, `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, 0)`);

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function mix(rgb, target, amount) {
  const t = clamp(amount, 0, 1);

  return [
    rgb[0] + (target[0] - rgb[0]) * t,
    rgb[1] + (target[1] - rgb[1]) * t,
    rgb[2] + (target[2] - rgb[2]) * t
  ];
}

/* =========================
   Rim lens
   ========================= */

function canUseLens(element, rect) {
  if (!lensSupported || reducedTransparency || forcedColors) {
    return false;
  }

  if (rect.width < 32 || rect.height < 32) {
    return false;
  }

  if (element.dataset.glassLens === 'off') {
    return false;
  }

  // Nested glass would stack url() backdrop filters. Keep those CSS-only.
  if (element.parentElement && element.parentElement.closest('[data-glass]')) {
    return false;
  }

  const style = getComputedStyle(element);

  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  if (style.willChange && style.willChange !== 'auto') {
    return false;
  }

  if (style.transform !== 'none' || style.animationName !== 'none') {
    return false;
  }

  if (style.mixBlendMode && style.mixBlendMode !== 'normal') {
    return false;
  }

  // Menus and animated drawers own compositing layers. Check ancestors for
  // transforms / will-change / animated transitions before attaching a lens.
  for (let parent = element.parentElement;
    parent && parent !== document.body;
    parent = parent.parentElement) {
    const parentStyle = getComputedStyle(parent);

    if (parentStyle.willChange && parentStyle.willChange !== 'auto') {
      return false;
    }

    if (parentStyle.animationName && parentStyle.animationName !== 'none') {
      return false;
    }

    if (parentStyle.transform && parentStyle.transform !== 'none') {
      return false;
    }

    if (/transform/.test(parentStyle.transitionProperty || '')) {
      return false;
    }
  }

  return !(rect.right < 0 || rect.bottom < 0 ||
    rect.left > window.innerWidth || rect.top > window.innerHeight);
}

function updateLens(element, state, rect) {
  if (!canUseLens(element, rect)) {
    if (state.lensReady || state.lensSvg || state.lensPending) {
      clearLens(element, state);
    }

    return;
  }

  const shortSide = Math.min(rect.width, rect.height);
  const rim = Math.max(4, Math.min(44, shortSide / 3.5));
  const style = getComputedStyle(element);
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;

  // Maps are reusable at the same radius + rim; a resize keeps the existing
  // map and the filter stretches with the host surface.
  const key = `${Math.round(radius * 2) / 2}:${Math.round(rim * 2) / 2}`;

  if (state.lensKey === key || state.lensPending === key) {
    return;
  }

  state.lensPending = key;

  buildLens(element, state, key, rect.width, rect.height, radius, rim)
    .catch(() => {
      /* keep the CSS-only glass */
    })
    .finally(() => {
      if (state.lensPending === key) {
        state.lensPending = '';
      }
    });
}

function buildLens(element, state, key, width, height, radius, rim) {
  const id = `lg-lens-${++lensSequence}`;
  const mapUrl = getDisplacementMap(width, height, radius, rim);

  if (!mapUrl) {
    return Promise.reject(new Error('glass displacement map unavailable'));
  }

  const dpr = window.devicePixelRatio || 1;
  let split = dpr > 1.05 ? 0 : Math.min(0.15, 0.04 + rim / 400);

  // Busy backgrounds haze when the channels split hard.
  if (state.texture > 0.45) {
    split *= 0.35;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  svg.style.pointerEvents = 'none';

  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const map = document.createElementNS(SVG_NS, 'feImage');
  map.setAttribute('href', mapUrl);
  map.setAttribute('x', '0');
  map.setAttribute('y', '0');
  map.setAttribute('width', '100%');
  map.setAttribute('height', '100%');
  map.setAttribute('preserveAspectRatio', 'none');
  map.setAttribute('result', 'lg-map');

  const scale = 2 * 1.1 * rim;

  filter.appendChild(map);

  if (split > 0) {
    filter.appendChild(displace(scale * (1 + split), 'lg-red-disp'));
    filter.appendChild(displace(scale, 'lg-green-disp'));
    filter.appendChild(displace(scale * (1 - split), 'lg-blue-disp'));

    // Keep the recombined channels opaque; the host tint supplies alpha.
    filter.appendChild(isolateChannel('lg-red-disp', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1', 'lg-red'));
    filter.appendChild(isolateChannel('lg-green-disp', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1', 'lg-green'));
    filter.appendChild(isolateChannel('lg-blue-disp', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1', 'lg-blue'));

    filter.appendChild(blend('lg-red', 'lg-green', 'screen', 'lg-red-green'));
    filter.appendChild(blend('lg-red-green', 'lg-blue', 'screen'));
  } else {
    // HiDPI fallback: one opaque displacement pass, no channel bleed.
    filter.appendChild(displace(scale, ''));
  }

  svg.appendChild(filter);

  return decodeMap(mapUrl).then(() => {
    if (!element.isConnected || state.lensPending !== key) {
      return;
    }

    const previous = state.lensSvg;

    document.documentElement.appendChild(svg);

    element.style.setProperty('--lg-rim', `url(#${id})`);

    state.lensSvg = svg;
    state.lensReady = true;
    state.lensKey = key;

    if (previous && previous !== svg) {
      previous.remove();
    }
  });
}

function displace(scale, result) {
  const node = document.createElementNS(SVG_NS, 'feDisplacementMap');

  node.setAttribute('in', 'SourceGraphic');
  node.setAttribute('in2', 'lg-map');
  node.setAttribute('scale', String(scale));
  node.setAttribute('xChannelSelector', 'R');
  node.setAttribute('yChannelSelector', 'G');

  if (result) {
    node.setAttribute('result', result);
  }

  return node;
}

function isolateChannel(input, values, result) {
  const node = document.createElementNS(SVG_NS, 'feColorMatrix');

  node.setAttribute('in', input);
  node.setAttribute('type', 'matrix');
  node.setAttribute('values', values);
  node.setAttribute('result', result);

  return node;
}

function blend(input, input2, mode, result) {
  const node = document.createElementNS(SVG_NS, 'feBlend');

  node.setAttribute('in', input);
  node.setAttribute('in2', input2);
  node.setAttribute('mode', mode);

  if (result) {
    node.setAttribute('result', result);
  }

  return node;
}

function decodeMap(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve();
    image.onerror = () => reject(new Error('glass displacement map decode failed'));
    image.src = url;

    if (image.complete && image.naturalWidth > 0) {
      resolve();
    }
  });
}

function clearLens(element, state) {
  releaseLens(state);
  element.style.removeProperty('--lg-rim');

  state.lensKey = '';
  state.lensPending = '';
}

function releaseLens(state) {
  if (state.lensSvg) {
    state.lensSvg.remove();
  }

  state.lensSvg = null;
  state.lensReady = false;
}

function getDisplacementMap(width, height, radius, rim) {
  const roundedRadius = Math.round(radius * 2) / 2;
  const roundedRim = Math.round(rim * 2) / 2;
  const key = `${roundedRadius}:${roundedRim}`;

  if (displacementCache.has(key)) {
    return displacementCache.get(key);
  }

  const canvasWidth = Math.max(4, Math.round(width / 2) * 2);
  const canvasHeight = Math.max(4, Math.round(height / 2) * 2);
  const scale = Math.min(1, 220 / Math.max(canvasWidth, canvasHeight));
  const mapWidth = Math.max(4, Math.round(canvasWidth * scale));
  const mapHeight = Math.max(4, Math.round(canvasHeight * scale));

  const canvas = document.createElement('canvas');

  canvas.width = mapWidth;
  canvas.height = mapHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    return '';
  }

  const imageData = context.createImageData(mapWidth, mapHeight);
  const data = imageData.data;

  const maxOffset = 1.1 * roundedRim;
  const localScale = mapWidth / canvasWidth;

  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const px = (x + 0.5) / localScale;
      const py = (y + 0.5) / localScale;

      const distance = Math.max(
        0,
        -sdRoundRect(px, py, canvasWidth, canvasHeight, roundedRadius)
      );

      let offsetX = 0;
      let offsetY = 0;

      if (distance < roundedRim) {
        const falloff = Math.pow(1 - distance / roundedRim, 2.6);
        const magnitude = 1.1 * roundedRim * falloff;

        const epsilon = 0.75;
        const gx = (
          sdRoundRect(px + epsilon, py, canvasWidth, canvasHeight, roundedRadius) -
          sdRoundRect(px - epsilon, py, canvasWidth, canvasHeight, roundedRadius)
        ) / (2 * epsilon);
        const gy = (
          sdRoundRect(px, py + epsilon, canvasWidth, canvasHeight, roundedRadius) -
          sdRoundRect(px, py - epsilon, canvasWidth, canvasHeight, roundedRadius)
        ) / (2 * epsilon);

        const length = Math.hypot(gx, gy) || 1;

        // Inward normal: only the rim bends, the middle stays flat.
        offsetX = (-gx / length) * (magnitude / maxOffset);
        offsetY = (-gy / length) * (magnitude / maxOffset);
      }

      const index = (y * mapWidth + x) * 4;

      data[index] = clamp(Math.round(127.5 + 127.5 * offsetX), 0, 255);
      data[index + 1] = clamp(Math.round(127.5 + 127.5 * offsetY), 0, 255);
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);

  const url = canvas.toDataURL('image/png');

  displacementCache.set(key, url);

  if (displacementCache.size > MAP_LIMIT) {
    displacementCache.delete(displacementCache.keys().next().value);
  }

  return url;
}

function sdRoundRect(px, py, width, height, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  const qx = Math.abs(px - width / 2) - (width / 2 - r);
  const qy = Math.abs(py - height / 2) - (height / 2 - r);

  return Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    r;
}
