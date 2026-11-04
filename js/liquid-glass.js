/**
 * Liquid glass material runtime.
 *
 * Responsibilities:
 *  - attach the CSS-only glass material to every opted-in surface
 *  - sample the 5x3 background grid behind each surface (ink / density)
 *  - build the per-surface SVG rim lens (feImage + feDisplacementMap, with a
 *    three-pass chromatic split at 1x DPR; HiDPI uses a single displacement
 *    pass because Chrome bleeds isolated channels at backdrop-filter edges)
 *  - persist and apply the per-theme tint scale
 *
 * The page background is a stack of CSS gradients, so pixel-perfect sampling
 * of it is not practical. The sampler therefore uses a small offscreen canvas
 * that approximates the exact body gradients (kept in sync with style.css),
 * overlays known scrims (lightbox / modal / map scrim), and samples real
 * <img> / <canvas> pixels when they sit behind a surface. Map areas use a
 * heuristic (page gradient + translucent teal land wash). If anything is
 * cross-origin or unreadable, the surface falls back to the theme ink with a
 * dense tint, exactly as the spec requires.
 */

const GLASS_SELECTOR = '[data-glass], .liquid-glass';

const TINT_KEYS = {
  light: 'bonvoyage-glass-tint-light',
  dark: 'bonvoyage-glass-tint-dark'
};

const INK_KEY = 'bonvoyage-glass-ink';

const MAX_TINT = 1.5;
const GRID_X = 5;
const GRID_Y = 3;

const INK_THRESHOLD = 0.5;
const INK_HYSTERESIS = 0.05;

const DENSE_TINT = { light: 0.75, dark: 0.8 };

const SVG_NS = 'http://www.w3.org/2000/svg';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let started = false;
let lensSupported = false;
let reducedTransparency = false;
let forcedColors = false;

const surfaceStates = new WeakMap();
const gradientCache = new Map();
const displacementCache = new Map();
const DISPLACEMENT_CACHE_LIMIT = 48;

let lensSeq = 0;
let samplePixelCanvas = null;
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

  lensSupported = detectLensSupport();
  reducedTransparency = matchesMedia('(prefers-reduced-transparency: reduce)');
  forcedColors = matchesMedia('(forced-colors: active)');

  loadTintValues();
  loadInkStore();

  tintInput = document.getElementById('glass-tint');
  bindTintControl();
  applyTintImmediately(getTheme());

  observeTheme();
  observeDom();
  observeViewport();
  observeMedia();

  refresh(true);
}

function matchesMedia(query) {
  try {
    return window.matchMedia(query).matches;
  } catch (error) {
    return false;
  }
}

function detectLensSupport() {
  if (typeof CSS === 'undefined' || !CSS.supports) {
    return false;
  }

  const ua = navigator.userAgent || '';

  // Firefox parses url() backdrop filters but draws nothing; skip the lens
  // there and keep the CSS-only glass.
  if (/Firefox|FxiOS/i.test(ua)) {
    return false;
  }

  return CSS.supports('backdrop-filter', 'url(#lg-detect)') ||
    CSS.supports('-webkit-backdrop-filter', 'url(#lg-detect)');
}

function getTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/* =========================
   Tint persistence
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

function updateTintInput() {
  if (!tintInput) {
    return;
  }

  const value = tintValues[getTheme()];

  if (tintInput.value !== String(value)) {
    tintInput.value = String(value);
  }
}

function applyTintImmediately(theme) {
  cancelAnimationFrame(tintFrame);
  setTintScale(tintValues[theme]);
  updateTintInput();
}

function glideTintTo(theme) {
  cancelAnimationFrame(tintFrame);

  const target = tintValues[theme];

  if (matchesMedia('(prefers-reduced-motion: reduce)') || Math.abs(tintScale - target) < 0.001) {
    setTintScale(target);
    updateTintInput();
    return;
  }

  const from = tintScale;
  const start = performance.now();
  const duration = 420;

  const step = now => {
    const t = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    setTintScale(from + (target - from) * eased);

    if (t < 1) {
      tintFrame = requestAnimationFrame(step);
      return;
    }

    setTintScale(target);
    updateTintInput();
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
    updateTintInput();
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
    resizeTimer = window.setTimeout(() => scheduleRefresh(true), 180);
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

    const onChange = event => {
      apply(event.matches);
    };

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
   Surfaces
   ========================= */

function refresh(force) {
  const theme = getTheme();
  const nodes = document.querySelectorAll(GLASS_SELECTOR);

  nodes.forEach(node => updateSurface(node, force, theme));
}

function surfaceKey(element) {
  if (element.id) {
    return `#${element.id}`;
  }

  const note = element.closest('[data-note-id]');
  const classes = [...element.classList]
    .filter(name => name !== 'liquid-glass')
    .sort()
    .join('.');

  const parent = element.parentElement;
  const index = parent ? [...parent.children].indexOf(element) : 0;

  return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}` +
    `${note ? `@${note.dataset.noteId}` : ''}:${index}`;
}

function updateSurface(element, force, theme) {
  let state = surfaceStates.get(element);

  if (!state) {
    const markupInk = element.dataset.glassInk;

    state = {
      key: surfaceKey(element),
      forcedInk: markupInk === 'light' || markupInk === 'dark' ? markupInk : null,
      ink: null,
      lastRect: null,
      lastTheme: null,
      lensKey: '',
      lensSvg: null,
      lensId: '',
      lensReady: false,
      lensBuilding: false
    };

    surfaceStates.set(element, state);
  }

  const rect = element.getBoundingClientRect();

  if (rect.width < 1 || rect.height < 1) {
    return;
  }

  const style = getComputedStyle(element);

  if (style.display === 'none' || style.visibility === 'hidden') {
    return;
  }

  // Leave fully off-screen cards on the designed default tokens; sampling
  // them would only produce "unreadable" and force a wrong dense tint before
  // they scroll into view.
  if (rect.bottom <= 0 || rect.top >= window.innerHeight ||
      rect.right <= 0 || rect.left >= window.innerWidth) {
    return;
  }

  const moved = !state.lastRect ||
    Math.abs(rect.left - state.lastRect.left) > 0.5 ||
    Math.abs(rect.top - state.lastRect.top) > 0.5 ||
    Math.abs(rect.width - state.lastRect.width) > 0.5 ||
    Math.abs(rect.height - state.lastRect.height) > 0.5;

  if (force || moved || state.lastTheme !== theme) {
    const sample = sampleSurface(element, rect, theme);

    applySample(element, state, sample, theme);

    state.lastRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    state.lastTheme = theme;
  }

  updateLens(element, state, rect);
}

function applySample(element, state, sample, theme) {
  let ink;

  if (theme === 'dark') {
    // Dark mode always uses light ink, regardless of the sample.
    ink = 'light';
  } else if (state.forcedInk) {
    ink = state.forcedInk;
  } else {
    const previous = state.ink || inkStore[state.key] || null;
    const threshold = previous === 'light'
      ? INK_THRESHOLD + INK_HYSTERESIS
      : previous === 'dark'
        ? INK_THRESHOLD - INK_HYSTERESIS
        : INK_THRESHOLD;

    ink = sample.lum < threshold ? 'light' : 'dark';
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
    density = DENSE_TINT[theme] || 0.75;
    chroma = Math.max(chroma, 0.15);
  } else {
    // "Closeness to ink brightness": low contrast means the surface needs a
    // denser fill. This keeps the designed light default near 0.45 and dark
    // areas dense.
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

  // Dark-area glass should never be so thin that light text loses contrast.
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
  }, 260);
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

  // Sample the visible part of a partially scrolled surface (a card entering
  // the viewport should not read as "unreadable").
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  for (let row = 0; row < GRID_Y; row += 1) {
    for (let column = 0; column < GRID_X; column += 1) {
      const x = left + width * ((column + 0.5) / GRID_X);
      const y = top + height * ((row + 0.5) / GRID_Y);

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

  // Drop the two darkest and two brightest samples before averaging.
  const sorted = samples.slice().sort((a, b) => a.lum - b.lum);
  const kept = sorted.length > 5 ? sorted.slice(2, sorted.length - 2) : sorted;

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
  let onMap = false;
  let scrim = 0;

  for (const node of stack) {
    if (!(node instanceof Element)) {
      continue;
    }

    // The surface itself and its own children are content, not background.
    if (node === element || element.contains(node)) {
      continue;
    }

    if (node.id === 'lightbox' || node.classList.contains('lightbox')) {
      scrim = Math.max(scrim, 0.86);
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

    if (!onMap &&
        (node.classList.contains('map-canvas') ||
         node.classList.contains('world-map') ||
         node.closest('.map-canvas'))) {
      onMap = true;
    }

    if (node === document.body) {
      break;
    }
  }

  if (image) {
    const pixel = sampleImage(image, x, y);

    if (pixel === false) {
      // Cross-origin / tainted / not decodable: dense tint fallback.
      return null;
    }

    if (pixel) {
      return applyScrim(pixel, scrim);
    }
    // Letterbox outside the drawn image: fall through to the page gradient.
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
    // Map heuristic: page gradient under a translucent teal land wash.
    // (The map card itself stays transparent per the existing exception.)
    const wash = theme === 'dark' ? [140, 210, 196] : [42, 120, 113];
    base = mix(base, wash, theme === 'dark' ? 0.24 : 0.26);
  }

  return applyScrim(base, scrim);
}

function applyScrim(rgb, alpha) {
  if (!alpha) {
    return rgb;
  }

  return mix(rgb, [12, 25, 29], alpha);
}

function sampleImage(image, x, y) {
  const rect = image.getBoundingClientRect();

  if (rect.width < 1 || rect.height < 1 || !image.complete) {
    return null;
  }

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (!naturalWidth || !naturalHeight) {
    return null;
  }

  // Drawing a cross-origin image would taint the sampling canvas and make
  // every later read fail. Treat it as unreadable immediately.
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
    // Defensive: drop the (now tainted) shared canvas so same-origin
    // samples still work afterwards.
    sampleContext = null;
    samplePixelCanvas = null;
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

  const px = clamp(Math.floor(((x - rect.left) / rect.width) * canvas.width), 0, canvas.width - 1);
  const py = clamp(Math.floor(((y - rect.top) / rect.height) * canvas.height), 0, canvas.height - 1);

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
    sampleContext = null;
    samplePixelCanvas = null;
    return false;
  }
}

function getSampleContext() {
  if (sampleContext) {
    return sampleContext;
  }

  samplePixelCanvas = document.createElement('canvas');
  samplePixelCanvas.width = 1;
  samplePixelCanvas.height = 1;

  try {
    sampleContext = samplePixelCanvas.getContext('2d', { willReadFrequently: true });
  } catch (error) {
    sampleContext = null;
  }

  return sampleContext;
}

function sampleGradient(theme, x, y) {
  const canvas = getGradientCanvas(theme);
  const px = clamp(Math.floor((x / window.innerWidth) * canvas.width), 0, canvas.width - 1);
  const py = clamp(Math.floor((y / window.innerHeight) * canvas.height), 0, canvas.height - 1);
  const index = (py * canvas.width + px) * 4;

  return [
    canvas.data[index],
    canvas.data[index + 1],
    canvas.data[index + 2]
  ];
}

function getGradientCanvas(theme) {
  if (gradientCache.has(theme)) {
    return gradientCache.get(theme);
  }

  const width = 192;
  const height = 192;
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    const fallback = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4).fill(240)
    };

    gradientCache.set(theme, fallback);

    return fallback;
  }

  if (theme === 'dark') {
    paintLinear(context, width, height, 155, [
      [0, [10, 19, 23]],
      [0.55, [16, 29, 34]],
      [1, [20, 26, 29]]
    ]);

    paintRadial(context, width, height, 1, 0.1, 0.42, [118, 72, 54, 0.26]);
    paintRadial(context, width, height, 0.16, 0, 0.44, [44, 98, 92, 0.40]);
  } else {
    paintLinear(context, width, height, 150, [
      [0, [232, 245, 243]],
      [0.58, [253, 244, 230]],
      [1, [250, 231, 223]]
    ]);

    paintRadial(context, width, height, 1, 0.2, 0.32, [220, 242, 239, 0.55]);
    paintRadial(context, width, height, 0.2, 0, 0.34, [255, 255, 255, 0.75]);
  }

  const entry = {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data
  };

  gradientCache.set(theme, entry);

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

  // Nested glass (composer control, comments inside a note card) would stack
  // a backdrop filter inside another backdrop filter. Keep those CSS-only;
  // they still get the full tint / edge / ink material.
  if (element.parentElement && element.parentElement.closest('[data-glass]')) {
    return false;
  }

  const style = getComputedStyle(element);

  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  // Menus / animated panels own a compositing layer; a url() backdrop filter
  // on those is costly and can smear. CSS-only glass remains.
  if (style.willChange && style.willChange !== 'auto') {
    return false;
  }

  if (style.transform !== 'none') {
    return false;
  }

  if (style.animationName && style.animationName !== 'none') {
    return false;
  }

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

    // Animated drawers/menus (e.g. the mobile map panel) own a compositing
    // layer; a url() backdrop filter on their children can smear.
    if (/transform/.test(parentStyle.transitionProperty || '')) {
      return false;
    }
  }

  // Off-screen drawer/panel children don't need a lens until they slide in.
  if (rect.right < 0 || rect.bottom < 0 ||
      rect.left > window.innerWidth || rect.top > window.innerHeight) {
    return false;
  }

  return true;
}

function updateLens(element, state, rect) {
  if (!canUseLens(element, rect)) {
    if (state.lensReady || state.lensSvg) {
      clearLens(element, state);
    }

    return;
  }

  const shortSide = Math.min(rect.width, rect.height);
  const rim = Math.max(4, Math.min(44, shortSide / 3.5));
  const style = getComputedStyle(element);
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;

  const key = [
    Math.round(rect.width / 2) * 2,
    Math.round(rect.height / 2) * 2,
    Math.round(radius * 2) / 2,
    Math.round(rim * 2) / 2
  ].join(':');

  if (state.lensKey === key || state.lensBuilding) {
    return;
  }

  state.lensKey = key;
  state.lensBuilding = true;

  buildLens(element, state, key, rect.width, rect.height, radius, rim)
    .catch(() => {
      /* keep the CSS-only glass */
    })
    .finally(() => {
      state.lensBuilding = false;
    });
}

function buildLens(element, state, key, width, height, radius, rim) {
  const id = `lg-lens-${++lensSeq}`;
  const mapUrl = getDisplacementMap(width, height, radius, rim);

  // Chrome's backdrop-filter edge compositing bleeds the isolated chromatic
  // channels on HiDPI (visible as a blue/dark stripe on the right/bottom rim).
  // The spec allows lowering the split; on scaled displays we drop it and
  // keep the displacement lens, which is the part that defines the rim.
  const dpr = window.devicePixelRatio || 1;
  const split = dpr > 1.05 ? 0 : Math.min(0.15, 0.04 + rim / 400);

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
    filter.appendChild(displacement(scale * (1 + split), 'lg-red-disp'));
    filter.appendChild(displacement(scale, 'lg-green-disp'));
    filter.appendChild(displacement(scale * (1 - split), 'lg-blue-disp'));

    // The alpha row writes 1: in a backdrop-filter, SourceGraphic alpha
    // follows the surface's own translucent tint. Preserving it here would
    // make the screen recombine semi-transparent (a grey wash); forcing
    // opaque channels keeps the split invisible except at the rim.
    filter.appendChild(isolate('lg-red-disp', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1', 'lg-red-channel'));
    filter.appendChild(isolate('lg-green-disp', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1', 'lg-green-channel'));
    filter.appendChild(isolate('lg-blue-disp', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1', 'lg-blue-channel'));

    const redGreen = document.createElementNS(SVG_NS, 'feBlend');
    redGreen.setAttribute('in', 'lg-red-channel');
    redGreen.setAttribute('in2', 'lg-green-channel');
    redGreen.setAttribute('mode', 'screen');
    redGreen.setAttribute('result', 'lg-red-green');
    filter.appendChild(redGreen);

    const recombine = document.createElementNS(SVG_NS, 'feBlend');
    recombine.setAttribute('in', 'lg-red-green');
    recombine.setAttribute('in2', 'lg-blue-channel');
    recombine.setAttribute('mode', 'screen');
    filter.appendChild(recombine);
  } else {
    // HiDPI fallback: a single opaque displacement pass. No channel
    // isolation/blend means no edge bleed, while the rim still bends.
    filter.appendChild(displacement(scale, ''));
  }

  svg.appendChild(filter);

  return decodeImage(mapUrl).then(() => {
    if (!element.isConnected || state.lensKey !== key) {
      return;
    }

    const previous = state.lensSvg;

    document.documentElement.appendChild(svg);

    element.style.setProperty('--lg-rim', `url(#${id})`);

    state.lensSvg = svg;
    state.lensId = id;
    state.lensReady = true;

    if (previous && previous !== svg) {
      previous.remove();
    }
  });
}

function displacement(scale, result) {
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

function isolate(input, values, result) {
  const node = document.createElementNS(SVG_NS, 'feColorMatrix');

  node.setAttribute('in', input);
  node.setAttribute('type', 'matrix');
  node.setAttribute('values', values);
  node.setAttribute('result', result);

  return node;
}

function decodeImage(url) {
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
  if (state.lensSvg) {
    state.lensSvg.remove();
  }

  element.style.removeProperty('--lg-rim');

  state.lensSvg = null;
  state.lensId = '';
  state.lensReady = false;
  state.lensKey = '';
}

function getDisplacementMap(width, height, radius, rim) {
  const roundedWidth = Math.max(2, Math.round(width / 2) * 2);
  const roundedHeight = Math.max(2, Math.round(height / 2) * 2);
  const roundedRadius = Math.round(radius * 2) / 2;
  const roundedRim = Math.round(rim * 2) / 2;

  const key = `${roundedWidth}x${roundedHeight}:${roundedRadius}:${roundedRim}`;

  if (displacementCache.has(key)) {
    return displacementCache.get(key);
  }

  const scale = Math.min(1, 220 / Math.max(roundedWidth, roundedHeight));
  const mapWidth = Math.max(4, Math.round(roundedWidth * scale));
  const mapHeight = Math.max(4, Math.round(roundedHeight * scale));

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
  const localScale = mapWidth / roundedWidth;

  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const px = (x + 0.5) / localScale;
      const py = (y + 0.5) / localScale;

      const distance = Math.max(
        0,
        -sdRoundRect(px, py, roundedWidth, roundedHeight, roundedRadius)
      );

      let offsetX = 0;
      let offsetY = 0;

      if (distance < roundedRim) {
        const falloff = Math.pow(1 - distance / roundedRim, 2.6);
        const magnitude = 1.1 * roundedRim * falloff;

        const epsilon = 0.75;
        const gx = (
          sdRoundRect(px + epsilon, py, roundedWidth, roundedHeight, roundedRadius) -
          sdRoundRect(px - epsilon, py, roundedWidth, roundedHeight, roundedRadius)
        ) / (2 * epsilon);
        const gy = (
          sdRoundRect(px, py + epsilon, roundedWidth, roundedHeight, roundedRadius) -
          sdRoundRect(px, py - epsilon, roundedWidth, roundedHeight, roundedRadius)
        ) / (2 * epsilon);

        const length = Math.hypot(gx, gy) || 1;

        // Inward normal: bend only the rim toward the flat centre.
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

  if (displacementCache.size > DISPLACEMENT_CACHE_LIMIT) {
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
