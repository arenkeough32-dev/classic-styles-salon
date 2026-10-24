// Live hair color mirror. Runs entirely in the visitor's browser (MediaPipe Tasks Vision, on-device).
import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import { HairPainter, fuseMasks } from './tryon-core.js?v=4';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const BASE = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/';
// Detailed model: hair, face skin, body skin, clothes. Clean, solid hair maps and no color on skin.
const MULTI = BASE + 'selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
// Small hair-only model: fast fallback for older phones, and a gap-filler for photos.
const HAIR = BASE + 'hair_segmenter/float32/latest/hair_segmenter.tflite';

const PHONE = '(727) 487-4475';
const SHARE_TEXT = 'Hi Classic Styles! I tried this color on your website — what would it take to get it?';
const TIP_FIND = 'Face the camera with your hair down and in good light so the mirror can see all of it.';
const TIP_PHOTO = 'This style is hard for the mirror to read, so the color may look patchy. For the best preview, use a photo facing forward with your hair down.';
const STILL_MAX = 1080;
let liveMax = 800;

const DEBUG = /[?&]debug\b/.test(location.search);
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const els = {
  start: $('tryStart'), stop: $('tryStop'), file: $('tryFile'), canvas: $('tryCanvas'), video: $('tryVideo'),
  status: $('tryStatus'), strength: $('tryStrength'), strengthOut: $('tryStrengthOut'), swatches: $('trySwatches'),
  save: $('trySave'), note: $('tryNote'), idle: $('tryIdle'), compare: $('tryCompare'),
  stage: $('tryStage'), split: $('trySplit'), handle: $('tryHandle'), shade: $('tryShade'),
};
const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas');
const sctx = small.getContext('2d', { willReadFrequently: true });
const painter = new HairPainter();

let colorKey = 'copper';
painter.setColor(colorKey, true);
let strength = els.strength.value / 100;
let compareOn = false, split = 0.5;

let liveModel = 'multi';
let stream = null, rafId = 0, running = false;
let still = null;       // { base, matte, ww, wh, low }
let lastVideoTime = -1, lastTick = 0, segMs = 0, frames = 0, noHairFrames = 0;
const buf = { hair: null, skin: null, fused: null };

function say(msg, kind) { els.status.textContent = msg || ''; els.status.dataset.kind = kind || ''; }
function idle(msg) { els.idle.textContent = msg; els.idle.hidden = !msg; }

const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof WebAssembly === 'object';
if (!supported) {
  els.start.disabled = true;
  say('This browser cannot open a camera mirror. You can still upload a photo below.', 'warn');
}

// ---- models --------------------------------------------------------------
let filesetP = null;
const cache = {};
// Build (once) a segmenter for a model, mode and processor. GPU falls back to CPU.
async function make(kind, mode, delegate) {
  const key = kind + mode + delegate;
  if (cache[key]) return cache[key];
  filesetP = filesetP || FilesetResolver.forVisionTasks(WASM);
  const fileset = await filesetP;
  const opts = (d) => ({
    baseOptions: { modelAssetPath: kind === 'multi' ? MULTI : HAIR, delegate: d },
    runningMode: mode, outputCategoryMask: false, outputConfidenceMasks: true,
  });
  let s;
  try { s = await ImageSegmenter.createFromOptions(fileset, opts(delegate)); }
  catch (e) { if (delegate === 'CPU') throw e; s = await ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
  cache[key] = s;
  return s;
}
const get = (name) => make(name.startsWith('multi') ? 'multi' : 'hair', name.endsWith('V') ? 'VIDEO' : 'IMAGE', 'GPU');

// Live mirror tries these in order and steps down if a phone can't keep up.
const FORCE = DEBUG && (location.search.match(/force=(multi|hair)/) || [])[1];
const LIVE_PLAN = FORCE ? [[FORCE, 'CPU']] : [['multi', 'GPU'], ['hair', 'GPU'], ['hair', 'CPU']];
let planIdx = 0, liveSeg = null, switching = false;
async function useLive(i) {
  for (; i < LIVE_PLAN.length; i++) {
    try { liveSeg = await make(LIVE_PLAN[i][0], 'VIDEO', LIVE_PLAN[i][1]); planIdx = i; liveModel = LIVE_PLAN[i][0]; return; }
    catch (e) { /* try the next option */ }
  }
  throw new Error('no model');
}
function stepDown() {
  if (switching || planIdx >= LIVE_PLAN.length - 1) return;
  switching = true;
  useLive(planIdx + 1).then(() => { painter.reset(); painter.setColor(colorKey, true); segMs = 0; frames = 0; })
    .catch(() => {}).finally(() => { switching = false; });
}

// Copy what we need out of a result, then release it.
function readMasks(res, kind) {
  const ms = res && res.confidenceMasks;
  if (!ms || !ms.length) return null;
  const m1 = ms.length > 1 ? ms[1] : ms[0];
  const w = m1.width, h = m1.height, n = w * h;
  if (!buf.hair || buf.hair.length !== n) { buf.hair = new Float32Array(n); buf.skin = new Float32Array(n); }
  buf.hair.set(m1.getAsFloat32Array());
  if (kind === 'multi' && ms.length > 3) {
    const a = ms[2].getAsFloat32Array(), b = ms[3].getAsFloat32Array();
    for (let i = 0; i < n; i++) buf.skin[i] = a[i] + b[i];
  } else buf.skin.fill(0);
  return { w, h, n };
}

// ---- drawing -------------------------------------------------------------
function fitStage(w, h) {
  const r = Math.max(0.6, Math.min(1, w / h));
  els.stage.style.aspectRatio = String(r);
}

function workSize(W, H, cap) {
  const s = Math.min(1, cap / Math.max(W, H));
  const ww = Math.max(16, Math.round(W * s)), wh = Math.max(16, Math.round(H * s));
  if (small.width !== ww || small.height !== wh) { small.width = ww; small.height = wh; }
  return [ww, wh];
}

function buildMatte(mask, mw, mh, temporal, cap) {
  const W = els.canvas.width, H = els.canvas.height;
  const [ww, wh] = workSize(W, H, cap);
  sctx.drawImage(els.canvas, 0, 0, ww, wh);
  const guide = sctx.getImageData(0, 0, ww, wh).data;
  const matte = painter.matte(guide, ww, wh, mask, mw, mh, false, temporal);
  return { matte, ww, wh };
}

function paintOnto(img, m, temporal) {
  const W = img.width;
  const xMin = compareOn ? Math.round(split * W) : 0;
  return painter.paint(img.data, W, img.height, m.matte, m.ww, m.wh, strength, temporal, xMin);
}

// ---- live camera ---------------------------------------------------------
function frame(now) {
  if (!running) return;
  const v = els.video;
  const dt = lastTick ? Math.min(100, now - lastTick) : 16; lastTick = now;
  painter.step(reduceMotion ? 1e4 : dt);
  if (v.readyState >= 2 && v.videoWidth && v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime;
    // Crop the camera to the 3:4 mirror and flip it like a real mirror.
    const vw = v.videoWidth, vh = v.videoHeight;
    let sw = vw, sh = vh;
    if (vw / vh > 0.75) sw = Math.round(vh * 0.75); else sh = Math.round(vw / 0.75);
    const H = Math.min(liveMax, sh), W = Math.round(H * 0.75);
    if (els.canvas.width !== W || els.canvas.height !== H) { els.canvas.width = W; els.canvas.height = H; }
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H); ctx.restore();
    if (!switching && liveSeg) try {
      const t0 = performance.now();
      const res = liveSeg.segmentForVideo(els.canvas, now);
      const dims = readMasks(res, liveModel);
      if (res && res.close) res.close();
      const took = performance.now() - t0;
      frames++;
      if (frames > 2) segMs = segMs ? segMs * 0.8 + took * 0.2 : took; // first frames warm up
      if (frames > 2 && (took > 400 || (frames > 6 && segMs > 80))) stepDown();
      if (dims) {
        const mask = liveModel === 'multi' ? (buf.fused = fuseMasks(buf.hair, buf.skin, null, buf.fused)) : buf.hair;
        const m = buildMatte(mask, dims.w, dims.h, true, 360);
        const img = ctx.getImageData(0, 0, W, H);
        const found = paintOnto(img, m, true);
        if (found) ctx.putImageData(img, 0, 0);
        noHairFrames = found && !painter.unsure ? 0 : noHairFrames + 1;
        if (noHairFrames === 45) say(TIP_FIND);
        if (noHairFrames === 0 && els.status.textContent === TIP_FIND) say('');
      }
    } catch (e) { if (DEBUG) console.warn("frame error", e && e.message); }
    if (DEBUG) window.__tryon = { model: LIVE_PLAN[planIdx].join("/"), segMs: +segMs.toFixed(1), frames, size: [els.canvas.width, els.canvas.height], unsure: painter.unsure };
    // Comfortable but heavy? Use a slightly smaller frame.
    if (frames === 40 && segMs > 45 && liveMax > 560) liveMax = 560;
  }
  rafId = requestAnimationFrame(frame);
}

async function startCamera() {
  els.start.disabled = true;
  idle('Getting the mirror ready…');
  say('The first time takes a few seconds while the mirror loads.', 'busy');
  try { if (!liveSeg) await useLive(0); }
  catch (e) {
    say('The mirror could not load. Check your connection, or upload a photo instead.', 'warn');
    idle('Your mirror will appear here.'); els.start.disabled = false; return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  } catch (e) {
    say('We could not use your camera. You can allow it in your browser settings, or upload a photo instead.', 'warn');
    idle('Your mirror will appear here.'); els.start.disabled = false; return;
  }
  els.video.srcObject = stream;
  try { await els.video.play(); } catch (e) { /* autoplay quirks */ }
  still = null; painter.reset(); painter.setColor(colorKey, true);
  lastVideoTime = -1; lastTick = 0; frames = 0; segMs = 0; noHairFrames = 0;
  fitStage(3, 4);
  running = true;
  idle(''); els.stop.hidden = false; els.start.hidden = true; ready(true);
  say('Tip: face a window or a lamp. Even light gives the cleanest color.');
  rafId = requestAnimationFrame(frame);
}

function stopCamera() {
  running = false;
  cancelAnimationFrame(rafId);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  els.video.srcObject = null;
  els.stop.hidden = true; els.start.hidden = false; els.start.disabled = !supported;
}

function ready(on) { els.save.disabled = !on; els.compare.disabled = !on; }

// ---- still photo ---------------------------------------------------------
let glide = 0;
function renderStill() {
  if (!still) return;
  const img = new ImageData(new Uint8ClampedArray(still.base.data), still.base.width, still.base.height);
  painter.low = still.low;
  paintOnto(img, still, false);
  ctx.putImageData(img, 0, 0);
}
// Animate a still photo while the shade glides from old to new.
function animateStill() {
  if (!still || glide) return;
  let last = performance.now();
  const tick = (t) => {
    const moving = painter.step(reduceMotion ? 1e4 : t - last); last = t;
    renderStill();
    glide = moving ? requestAnimationFrame(tick) : 0;
  };
  glide = requestAnimationFrame(tick);
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  stopCamera();
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { say('We could not open that picture. Try a JPG or PNG.', 'warn'); return; }
  idle('Reading your photo…');
  say('Finding your hair…', 'busy');
  const s = Math.min(1, STILL_MAX / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * s), H = Math.round(bmp.height * s);
  els.canvas.width = W; els.canvas.height = H; fitStage(W, H);
  ctx.drawImage(bmp, 0, 0, W, H);
  if (bmp.close) bmp.close();
  const base = ctx.getImageData(0, 0, W, H);
  let mask = null, mw = 0, mh = 0;
  try {
    const multi = await get('multiI');
    const r1 = multi.segment(els.canvas); const d1 = readMasks(r1, 'multi'); if (r1 && r1.close) r1.close();
    const multiHair = new Float32Array(buf.hair), skin = new Float32Array(buf.skin);
    let hairOnly = null;
    try {
      const hs = await get('hairI');
      const r2 = hs.segment(els.canvas); const d2 = readMasks(r2, 'hair'); if (r2 && r2.close) r2.close();
      if (d2 && d2.n === d1.n) hairOnly = new Float32Array(buf.hair);
    } catch (e) { /* fine without the gap-filler */ }
    mask = fuseMasks(multiHair, skin, hairOnly); mw = d1.w; mh = d1.h;
  } catch (e) {
    try {
      const hs = await get('hairI');
      const r = hs.segment(els.canvas); const d = readMasks(r, 'hair'); if (r && r.close) r.close();
      mask = new Float32Array(buf.hair); mw = d.w; mh = d.h;
    } catch (e2) { say('The mirror could not load. Check your connection and try again.', 'warn'); idle('Your mirror will appear here.'); return; }
  }
  painter.reset(); painter.setColor(colorKey, true);
  const m = buildMatte(mask, mw, mh, false, 720);
  still = { base, matte: new Float32Array(m.matte), ww: m.ww, wh: m.wh, low: new Float32Array(painter.low) };
  idle(''); ready(true);
  say(painter.unsure ? TIP_PHOTO : '', painter.unsure ? 'warn' : '');
  renderStill();
}

// ---- controls ------------------------------------------------------------
els.start.addEventListener('click', startCamera);
els.stop.addEventListener('click', () => { stopCamera(); say('Camera off.'); });
els.file.addEventListener('change', () => { handleFile(els.file.files[0]); els.file.value = ''; });

els.swatches.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-color]');
  if (!b) return;
  colorKey = b.dataset.color;
  els.swatches.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  els.shade.textContent = b.title;
  painter.setColor(colorKey, reduceMotion);
  if (!running) { if (reduceMotion) renderStill(); else animateStill(); }
});

let pending = 0;
const later = () => { if (!running && still && !pending) pending = requestAnimationFrame(() => { pending = 0; renderStill(); }); };
els.strength.addEventListener('input', () => {
  strength = els.strength.value / 100;
  els.strengthOut.textContent = els.strength.value + '%';
  later();
});

// Before / after slider: left of the line is your real hair.
function setSplit(v) {
  split = Math.max(0.04, Math.min(0.96, v));
  els.split.style.left = (split * 100) + '%';
  els.handle.setAttribute('aria-valuenow', String(Math.round(split * 100)));
  els.handle.setAttribute('aria-valuetext', Math.round(split * 100) + '% showing your real hair');
  later();
}
function setCompare(on) {
  compareOn = on;
  els.compare.setAttribute('aria-pressed', String(on));
  els.compare.textContent = on ? 'Hide before and after' : 'Compare before and after';
  els.split.hidden = !on;
  if (on) setSplit(0.5); else later();
}
els.compare.addEventListener('click', () => setCompare(!compareOn));
let dragging = false;
const toSplit = (e) => { const r = els.stage.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); };
els.stage.addEventListener('pointerdown', (e) => {
  if (!compareOn) return;
  dragging = true; els.stage.setPointerCapture(e.pointerId); toSplit(e);
});
els.stage.addEventListener('pointermove', (e) => { if (dragging) toSplit(e); });
['pointerup', 'pointercancel'].forEach((ev) => els.stage.addEventListener(ev, () => { dragging = false; }));
els.handle.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.04;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setSplit(split - step);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setSplit(split + step);
  else if (e.key === 'Home') setSplit(0);
  else if (e.key === 'End') setSplit(1);
  else return;
  e.preventDefault();
});

// Saved picture gets a small salon caption, so it is easy to text to the stylist.
async function savedImage() {
  const W = els.canvas.width, H = els.canvas.height, band = Math.round(Math.max(56, H * 0.075));
  const out = document.createElement('canvas'); out.width = W; out.height = H + band;
  const o = out.getContext('2d');
  o.drawImage(els.canvas, 0, 0);
  if (compareOn) { // keep the divider so the before/after reads clearly
    const x = Math.round(split * W);
    o.fillStyle = '#F1ECE4'; o.fillRect(x - 1, 0, 3, H);
  }
  o.fillStyle = '#F1ECE4'; o.fillRect(0, H, W, band);
  try { await document.fonts.ready; } catch (e) { /* ignore */ }
  const fs = Math.round(band * 0.36);
  o.fillStyle = '#231B16'; o.textBaseline = 'middle';
  o.font = `500 ${fs}px "Bodoni Moda", Georgia, serif`;
  o.fillText('Classic Styles', Math.round(fs * 0.8), H + band / 2);
  o.font = `400 ${Math.round(fs * 0.78)}px Jost, system-ui, sans-serif`;
  o.textAlign = 'right'; o.fillStyle = '#7A4A2E';
  o.fillText(`${els.shade.textContent} · ${PHONE}`, W - Math.round(fs * 0.8), H + band / 2);
  return new Promise((res) => out.toBlob(res, 'image/jpeg', 0.92));
}

els.save.addEventListener('click', async () => {
  const blob = await savedImage();
  if (!blob) return;
  const file = new File([blob], 'my-classic-styles-color.jpg', { type: 'image/jpeg' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: SHARE_TEXT });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  els.note.hidden = false;
});

// Release the camera whenever the page is hidden or left.
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { stopCamera(); say('Camera paused. Tap Start the mirror to continue.'); } });
window.addEventListener('pagehide', stopCamera);
