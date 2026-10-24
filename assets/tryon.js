// Live hair color mirror. Runs entirely in the visitor's browser (MediaPipe Tasks Vision, on-device).
import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import { HairPainter } from './tryon-core.js?v=3';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite';
const TIP_FIND = 'Face the camera with your hair down and in good light so the mirror can see all of it.';
const TIP_PHOTO = 'This style is hard for the mirror to read, so the color may look patchy. For the best preview, use a photo facing forward with your hair down.';
const SHARE_TEXT = 'Hi Classic Styles! I tried this color on your website — what would it take to get it?';
const STILL_MAX = 1080;           // photos: sharp enough to look good when saved
let liveMax = 720;                // camera: lowered automatically on slow phones

const $ = (id) => document.getElementById(id);
const els = {
  start: $('tryStart'), stop: $('tryStop'), file: $('tryFile'), canvas: $('tryCanvas'), video: $('tryVideo'),
  status: $('tryStatus'), strength: $('tryStrength'), strengthOut: $('tryStrengthOut'), swatches: $('trySwatches'),
  save: $('trySave'), note: $('tryNote'), idle: $('tryIdle'), compare: $('tryCompare'),
};
const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
const small = document.createElement('canvas');
const sctx = small.getContext('2d', { willReadFrequently: true });
const painter = new HairPainter();

let color = 'copper';
let strength = els.strength.value / 100;
let comparing = false;

let videoSeg = null, imageSeg = null, stream = null, rafId = 0, running = false;
let still = null; // { base: ImageData, mask: Float32Array, mw, mh }
let lastVideoTime = -1, avgMs = 0, noHairFrames = 0;

function say(msg, kind) {
  els.status.textContent = msg || '';
  els.status.dataset.kind = kind || '';
}

const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof WebAssembly === 'object';
if (!supported) {
  els.start.disabled = true;
  say('This browser cannot open a camera mirror. You can still upload a photo below.', 'warn');
}

async function makeSegmenter(mode) {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: mode, outputCategoryMask: false, outputConfidenceMasks: true,
  });
  try { return await ImageSegmenter.createFromOptions(fileset, opts('GPU')); }
  catch (e) { return await ImageSegmenter.createFromOptions(fileset, opts('CPU')); }
}

async function ensure(mode) {
  if (mode === 'VIDEO' && videoSeg) return videoSeg;
  if (mode === 'IMAGE' && imageSeg) return imageSeg;
  say('Loading the hair model. This takes a few seconds the first time.', 'busy');
  const seg = await makeSegmenter(mode);
  if (mode === 'VIDEO') videoSeg = seg; else imageSeg = seg;
  say('');
  return seg;
}

function hairMask(result) {
  const ms = result.confidenceMasks;
  return ms && (ms.length > 1 ? ms[1] : ms[0]);
}

function sizeCanvas(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  const cw = Math.round(w * s), ch = Math.round(h * s);
  if (els.canvas.width !== cw || els.canvas.height !== ch) { els.canvas.width = cw; els.canvas.height = ch; }
}

// Work resolution for the edge-aware matte: about 360 px on the long side is
// plenty for clean edges and keeps the camera smooth.
function workSize(W, H, cap) {
  const s = Math.min(1, cap / Math.max(W, H));
  const ww = Math.max(16, Math.round(W * s)), wh = Math.max(16, Math.round(H * s));
  if (small.width !== ww || small.height !== wh) { small.width = ww; small.height = wh; }
  return [ww, wh];
}

// Run one recolor pass over what is currently on the main canvas.
function process(mask, mw, mh, flipX, temporal, cap) {
  const W = els.canvas.width, H = els.canvas.height;
  const [ww, wh] = workSize(W, H, cap);
  sctx.drawImage(els.canvas, 0, 0, ww, wh);
  const guide = sctx.getImageData(0, 0, ww, wh).data;
  const matte = painter.matte(guide, ww, wh, mask, mw, mh, flipX, temporal);
  const img = ctx.getImageData(0, 0, W, H);
  const found = painter.paint(img.data, W, H, matte, ww, wh, color, strength, temporal);
  if (found) ctx.putImageData(img, 0, 0);
  return found;
}

// ---- live camera ---------------------------------------------------------
function frame() {
  if (!running) return;
  const v = els.video;
  if (v.readyState >= 2 && v.videoWidth && v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime;
    const t0 = performance.now();
    sizeCanvas(v.videoWidth, v.videoHeight, liveMax);
    const w = els.canvas.width, h = els.canvas.height;
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, w, h); ctx.restore();
    if (!comparing) {
      try {
        const res = videoSeg.segmentForVideo(v, t0);
        const m = hairMask(res);
        if (m) {
          const found = process(m.getAsFloat32Array(), m.width, m.height, true, true, 360);
          noHairFrames = found && !painter.unsure ? 0 : noHairFrames + 1;
          if (noHairFrames === 45) say(TIP_FIND);
          if (found && noHairFrames === 0 && els.status.dataset.kind === '' && els.status.textContent.startsWith('Move')) say('');
        }
        if (res && res.close) res.close();
      } catch (e) { /* skip a bad frame */ }
    }
    // Keep the mirror smooth on slower phones by stepping resolution down.
    const ms = performance.now() - t0;
    avgMs = avgMs ? avgMs * 0.9 + ms * 0.1 : ms;
    if (avgMs > 45 && liveMax > 480) { liveMax = liveMax > 600 ? 600 : 480; avgMs = 0; }
  }
  rafId = requestAnimationFrame(frame);
}

async function startCamera() {
  els.start.disabled = true;
  try {
    await ensure('VIDEO');
  } catch (e) {
    say('The hair model could not load. Check your connection, or upload a photo instead.', 'warn');
    els.start.disabled = false; return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
  } catch (e) {
    say('We could not use your camera. You can allow it in your browser settings, or upload a photo instead.', 'warn');
    els.start.disabled = false; return;
  }
  els.video.srcObject = stream;
  try { await els.video.play(); } catch (e) { /* autoplay quirks */ }
  still = null; painter.reset(); lastVideoTime = -1; noHairFrames = 0;
  running = true;
  els.idle.hidden = true; els.stop.hidden = false; els.start.hidden = true; els.save.disabled = false; els.compare.disabled = false;
  say('Tip: face a window or a lamp. Even light gives the cleanest color.');
  frame();
}

function stopCamera() {
  running = false;
  cancelAnimationFrame(rafId);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  els.video.srcObject = null;
  els.stop.hidden = true; els.start.hidden = false; els.start.disabled = !supported;
  els.start.textContent = 'Start the mirror';
}

// ---- still photo ---------------------------------------------------------
function renderStill() {
  if (!still) return;
  ctx.putImageData(still.base, 0, 0);
  if (comparing) return;
  process(still.mask, still.mw, still.mh, false, false, 720);
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  stopCamera();
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { say('We could not open that picture. Try a JPG or PNG.', 'warn'); return; }
  try { await ensure('IMAGE'); }
  catch (e) { say('The hair model could not load. Check your connection and try again.', 'warn'); return; }
  sizeCanvas(bmp.width, bmp.height, STILL_MAX);
  const w = els.canvas.width, h = els.canvas.height;
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const base = ctx.getImageData(0, 0, w, h);
  say('Finding your hair...', 'busy');
  still = null; painter.reset();
  try {
    const res = imageSeg.segment(els.canvas);
    const m = hairMask(res);
    if (m) still = { base, mask: new Float32Array(m.getAsFloat32Array()), mw: m.width, mh: m.height };
    if (res && res.close) res.close();
  } catch (e) { say('Something went wrong reading that photo. Try another.', 'warn'); return; }
  if (!still) { say('We could not find hair in that photo. Try one where your hair is clearly visible.', 'warn'); return; }
  els.idle.hidden = true; els.save.disabled = false; els.compare.disabled = false;
  say('');
  renderStill();
  if (painter.unsure) say(TIP_PHOTO, 'warn');
}

// ---- controls ------------------------------------------------------------
els.start.addEventListener('click', startCamera);
els.stop.addEventListener('click', () => { stopCamera(); say('Camera off.'); });
els.file.addEventListener('change', () => { handleFile(els.file.files[0]); els.file.value = ''; });

els.swatches.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-color]');
  if (!b) return;
  color = b.dataset.color;
  els.swatches.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderStill();
});

let pending = 0;
els.strength.addEventListener('input', () => {
  strength = els.strength.value / 100;
  els.strengthOut.textContent = els.strength.value + '%';
  if (still && !pending) pending = requestAnimationFrame(() => { pending = 0; renderStill(); });
});

// Hold to see your real hair; let go to see the new color.
function setCompare(on) {
  if (comparing === on || els.compare.disabled) return;
  comparing = on;
  els.compare.setAttribute('aria-pressed', String(on));
  renderStill();
}
els.compare.addEventListener('pointerdown', (e) => { e.preventDefault(); setCompare(true); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => els.compare.addEventListener(ev, () => setCompare(false)));
els.compare.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); setCompare(true); } });
els.compare.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') setCompare(false); });
els.compare.addEventListener('contextmenu', (e) => e.preventDefault());

els.save.addEventListener('click', () => {
  els.canvas.toBlob(async (blob) => {
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
  }, 'image/jpeg', 0.92);
});

// Release the camera whenever the page is hidden or left.
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { stopCamera(); say('Camera paused. Tap Start the mirror to continue.'); } });
window.addEventListener('pagehide', stopCamera);
