/*
 * Official Glasswork path (v1.1.0): glass.css materials, lens.js rim,
 * adapt.js sampling, refract.js where backdrop-filter cannot take the lens.
 * Kinds follow the site's data-theme switch. Liquid glass is only attached
 * to [data-glass] surfaces that sit over the window wallpaper, the map, or
 * a photograph.
 */

import { liquidGlass, isLensSupported } from './glasswork/lens.js';
import { sampler, adapt, tintFloor, contrast, luma } from './glasswork/adapt.js';
import { createRefraction } from './glasswork/refract.js';

const LENS = { rim: 40, edge: 1.1, power: 2.6, dispersion: 0.15 };
const MAX_REFRACT = 8;

const TINT = {
  light: [255, 255, 255],
  dark: [30, 30, 34]
};

/* Lightest ink that still has to clear 4.5:1 (the muted role). */
const WORST_INK = {
  light: [184, 176, 164],
  dark: [81, 76, 68]
};

const read = sampler();
const lenses = new Map();
let sampleFrame = 0;
let refraction = null;
let refractOn = false;
let dirtyCapture = true;

function themeKind() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function wallpaperEl() {
  return document.querySelector(themeKind() === 'dark' ? '.wallpaper-dark' : '.wallpaper-light');
}

function sourceOf(el) {
  if (el.dataset.glassSource) return el.dataset.glassSource;
  if (el.classList.contains('map-popup') || el.classList.contains('map-reset') || el.classList.contains('map-close')) {
    return 'map';
  }
  if (el.classList.contains('lightbox-close')) return 'photo';
  return 'wallpaper';
}

function reducedTransparency() {
  return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
}

function setVar(el, name, value) {
  const next = value.toFixed(3);
  if (el.style.getPropertyValue(name) === next) return;
  const old = Number.parseFloat(el.style.getPropertyValue(name));
  if (Number.isFinite(old) && Math.abs(value - old) < 0.04) return;
  el.style.setProperty(name, next);
}

/*
 * Official tintFloor keeps the primary ink at 4.5:1. Raise it until the
 * lighter muted role clears the same bar over the brightest or darkest
 * part of the patch.
 */
function floorFor(luminance, texture, ink) {
  const tint = ink === 'light' ? TINT.dark : TINT.light;
  const tintLevel = luma(tint);
  let floor = tintFloor(luminance, texture, ink, tintLevel);
  const worst = WORST_INK[ink];
  const spread = Math.min(1, Math.max(0, Number(texture) || 0)) / 2;
  const mean = Math.min(1, Math.max(0, Number(luminance) || 0));
  const backdrop = ink === 'light' ? Math.min(1, mean + spread) : Math.max(0, mean - spread);
  const reads = (alpha) => {
    const gray = backdrop * 255;
    const mixed = tint.map(channel => gray + (channel - gray) * alpha);
    return contrast(worst, mixed) >= 4.5;
  };
  if (reads(floor)) return floor;
  if (!reads(0.9)) return 0.9;
  let low = floor;
  let high = 0.9;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (reads(middle)) high = middle;
    else low = middle;
  }
  return high;
}

function applyKind(el) {
  const lock = el.dataset.kindLock;
  const kind = lock === 'light' || lock === 'dark' ? lock : themeKind();
  el.dataset.kind = kind;
  return kind === 'dark' ? 'light' : 'dark';
}

function visibleGlass() {
  return [...document.querySelectorAll('[data-glass]')].filter(el => {
    if (el.hidden || el.closest('[hidden]')) return false;
    const box = el.getBoundingClientRect();
    return box.width >= 32 && box.height >= 32;
  });
}

function decide(el) {
  const ink = applyKind(el);
  const source = sourceOf(el);
  const box = el.getBoundingClientRect();
  const onScreen = box.width >= 8 && box.height >= 8 && !el.hidden && !el.closest('[hidden]');
  let density = 0.72;
  let keep = 1;
  let floor = 0.72;

  if (source === 'wallpaper' && onScreen && read.ready) {
    const patch = read.sample({ x: box.left, y: box.top, w: box.width, h: box.height });
    if (patch) {
      const adapted = adapt(patch, ink);
      density = adapted.density;
      keep = adapted.saturate;
      floor = floorFor(patch.luminance, patch.texture, ink);
    }
  } else if (source === 'map') {
    /* Sea is light and land is mid. 0.55 is the floor that keeps muted
       ink at 4.5:1 on the darker land and the lighter night land. */
    density = 0.7;
    floor = 0.55;
  } else if (source === 'photo') {
    density = 0.85;
    floor = 0.84;
  }

  const min = Number(el.dataset.floorMin);
  if (Number.isFinite(min)) floor = Math.max(floor, min);
  floor = Math.min(0.9, floor);

  setVar(el, '--density', density);
  setVar(el, '--keep', keep);
  setVar(el, '--floor', floor);
}

function captureWallpaper() {
  const source = wallpaperEl();
  const stageWidth = window.innerWidth;
  const stageHeight = window.innerHeight;
  if (!source || !read.capture(source, stageWidth, stageHeight)) read.clear();
}

function sampleNow() {
  sampleFrame = 0;
  if (dirtyCapture) {
    captureWallpaper();
    if (read.ready) dirtyCapture = false;
  }
  document.querySelectorAll('[data-glass]').forEach(decide);
  syncRefraction();
}

function scheduleSample() {
  if (!sampleFrame) sampleFrame = requestAnimationFrame(sampleNow);
}

function attach(el) {
  if (lenses.has(el)) return;
  el.classList.add('glass');
  applyKind(el);
  if (reducedTransparency()) {
    lenses.set(el, null);
    return;
  }
  try {
    lenses.set(el, liquidGlass(el, LENS));
  } catch (error) {
    lenses.set(el, null);
  }
}

function scan() {
  document.querySelectorAll('[data-glass]').forEach(attach);
}

function refractionSource() {
  const el = wallpaperEl();
  if (!el || !(el.naturalWidth || el.width)) return null;
  return { el, moving: false, external: false };
}

function refractionSurfaces() {
  return visibleGlass().slice(0, MAX_REFRACT).map(el => {
    const box = el.getBoundingClientRect();
    const kind = el.dataset.kind === 'dark' ? 'dark' : 'light';
    const style = getComputedStyle(el);
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    const blur = Number.parseFloat(style.getPropertyValue('--m-blur')) || 2;
    const saturate = Number.parseFloat(style.getPropertyValue('--m-sat')) || 1;
    const contrastValue = Number.parseFloat(style.getPropertyValue('--m-con')) || 1;
    const brightness = Number.parseFloat(style.getPropertyValue('--m-bri')) || 1;
    const veil = 1;
    return {
      x: box.left,
      y: box.top,
      w: box.width,
      h: box.height,
      radius: Math.min(radius, box.width / 2, box.height / 2),
      rim: Math.max(4, Math.min(LENS.rim, Math.min(box.width, box.height) / 3.5)),
      edge: LENS.edge,
      power: LENS.power,
      dispersion: LENS.dispersion,
      blur,
      saturate,
      contrast: 1 + (contrastValue - 1) * veil,
      brightness: 1 + (brightness - 1) * veil,
      keep: Number.parseFloat(el.style.getPropertyValue('--keep')) || 1
    };
  });
}

function syncRefraction() {
  if (!refraction) return;
  const stage = document.getElementById('stage');
  const count = visibleGlass().length;
  const enable = !reducedTransparency() && count > 0 && count <= MAX_REFRACT && !refraction.failed;
  if (enable !== refractOn) {
    refractOn = enable;
    refraction.setEnabled(enable);
    if (enable) stage.dataset.refract = 'webgl';
    else delete stage.dataset.refract;
  }
  if (enable) refraction.wake();
}

function startRefraction() {
  if (isLensSupported() || reducedTransparency() || typeof WebGL2RenderingContext !== 'function') return;
  const canvas = document.getElementById('glass-refraction');
  const stage = document.getElementById('stage');
  if (!canvas || !stage) return;
  try {
    refraction = createRefraction(canvas, {
      source: refractionSource,
      surfaces: refractionSurfaces
    });
  } catch (error) {
    refraction = null;
  }
  if (!refraction) return;
  canvas.addEventListener('refractionfailed', () => {
    refractOn = false;
    refraction.setEnabled(false);
    delete stage.dataset.refract;
  });
}

function markEngine() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Android/.test(ua);
  if (iOS || safari) document.documentElement.dataset.engine = 'webkit';
}

export function initGlass() {
  markEngine();
  const stage = document.getElementById('stage');
  if (!stage) return;

  scan();
  startRefraction();

  document.querySelectorAll('.wallpaper').forEach(image => {
    if (image.complete) scheduleSample();
    else image.addEventListener('load', scheduleSample, { once: true });
  });

  const themeObserver = new MutationObserver(() => {
    dirtyCapture = true;
    scan();
    scheduleSample();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });

  const domObserver = new MutationObserver(() => {
    scan();
    scheduleSample();
  });
  domObserver.observe(stage, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden']
  });

  window.addEventListener('resize', () => {
    dirtyCapture = true;
    scheduleSample();
  }, { passive: true });
  window.addEventListener('scroll', () => {
    if (refraction && refractOn) refraction.wake();
    scheduleSample();
  }, { passive: true });

  const reduceMedia = window.matchMedia('(prefers-reduced-transparency: reduce)');
  reduceMedia.addEventListener?.('change', () => {
    if (reducedTransparency() && refraction) {
      refractOn = false;
      refraction.setEnabled(false);
      delete stage.dataset.refract;
    }
    scheduleSample();
  });

  scheduleSample();
}
