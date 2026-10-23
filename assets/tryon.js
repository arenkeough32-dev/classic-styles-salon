// Live hair color mirror. Runs entirely in the visitor's browser (MediaPipe Tasks Vision, on-device).
import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite';
const SHARE_TEXT = 'Hi Classic Styles! I tried this color on your website — what would it take to get it?';
const MAX_W = 640;

const $ = (id) => document.getElementById(id);
const els = {
  start: $('tryStart'), stop: $('tryStop'), file: $('tryFile'), canvas: $('tryCanvas'), video: $('tryVideo'),
  status: $('tryStatus'), strength: $('tryStrength'), strengthOut: $('tryStrengthOut'), swatches: $('trySwatches'),
  save: $('trySave'), note: $('tryNote'), idle: $('tryIdle'),
};
const ctx = els.canvas.getContext('2d', { willReadFrequently: true });

const COLORS = {
  copper: [184, 98, 48], honey: [214, 164, 84], ash: [178, 170, 160], chocolate: [74, 42, 28],
  burgundy: [110, 22, 46], rose: [206, 130, 128], rainbow: null,
};
const RAINBOW = [[226, 60, 70], [240, 150, 50], [240, 210, 70], [70, 190, 110], [60, 130, 220], [140, 90, 210]];
let color = 'copper';
let strength = 0.6;

let videoSeg = null, imageSeg = null, stream = null, rafId = 0, running = false;
let loadingPromise = null;
let still = null; // { base: ImageData, mask: Float32Array, mw, mh }

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

// ---- recolor -------------------------------------------------------------
function tintPixel(r, g, b, tr, tg, tb) {
  let l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  l = Math.min(1, 0.2 + l * 1.5); // lift so dark hair can take a light color
  if (l < 0.5) { const k = l * 2; return [tr * k, tg * k, tb * k]; }
  const k = (l - 0.5) * 1.1;
  return [tr + (255 - tr) * k, tg + (255 - tg) * k, tb + (255 - tb) * k];
}

function recolor(img, mask, mw, mh) {
  const d = img.data, w = img.width, h = img.height;
  const fixed = COLORS[color];
  let top = 0, bot = h;
  if (!fixed) { // vertical extent of the hair, for the gradient
    top = h; bot = 0;
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x += 4) {
      if (mask[y * mw + x] > 0.5) { const yy = y / mh * h; if (yy < top) top = yy; if (yy > bot) bot = yy; }
    }
    if (bot <= top) { top = 0; bot = h; }
  }
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, (y * mh / h) | 0) * mw;
    let rc = fixed;
    if (!fixed) {
      const t = Math.min(0.999, Math.max(0, (y - top) / (bot - top))) * (RAINBOW.length - 1);
      const i = t | 0, f = t - i, a = RAINBOW[i], c = RAINBOW[i + 1];
      rc = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    }
    for (let x = 0; x < w; x++) {
      let m = mask[my + Math.min(mw - 1, (x * mw / w) | 0)];
      if (m < 0.08) continue;
      m = Math.min(1, (m - 0.08) / 0.6) * strength; // soft edge, gentle ramp
      const p = (y * w + x) * 4;
      const t = tintPixel(d[p], d[p + 1], d[p + 2], rc[0], rc[1], rc[2]);
      d[p] += (t[0] - d[p]) * m; d[p + 1] += (t[1] - d[p + 1]) * m; d[p + 2] += (t[2] - d[p + 2]) * m;
    }
  }
}

function hairMask(result) {
  const ms = result.confidenceMasks;
  return ms && (ms.length > 1 ? ms[1] : ms[0]);
}

function sizeCanvas(w, h) {
  const s = Math.min(1, MAX_W / w);
  const cw = Math.round(w * s), ch = Math.round(h * s);
  if (els.canvas.width !== cw || els.canvas.height !== ch) { els.canvas.width = cw; els.canvas.height = ch; }
  els.canvas.parentElement.style.aspectRatio = '';
}

// ---- live camera ---------------------------------------------------------
function frame() {
  if (!running) return;
  const v = els.video;
  if (v.readyState >= 2 && v.videoWidth) {
    sizeCanvas(v.videoWidth, v.videoHeight);
    const w = els.canvas.width, h = els.canvas.height;
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, w, h); ctx.restore();
    try {
      videoSeg.segmentForVideo(v, performance.now(), (res) => {
        const m = hairMask(res);
        if (!m) return;
        const arr = m.getAsFloat32Array();
        // the mask is in camera orientation; the canvas is mirrored, so flip x while reading
        const mw = m.width, mh = m.height, flipped = new Float32Array(mw * mh);
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) flipped[y * mw + x] = arr[y * mw + (mw - 1 - x)];
        const img = ctx.getImageData(0, 0, w, h);
        recolor(img, flipped, mw, mh);
        ctx.putImageData(img, 0, 0);
        m.close();
      });
    } catch (e) { /* skip a bad frame */ }
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
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } }, audio: false });
  } catch (e) {
    say('We could not use your camera. You can allow it in your browser settings, or upload a photo instead.', 'warn');
    els.start.disabled = false; return;
  }
  els.video.srcObject = stream;
  try { await els.video.play(); } catch (e) { /* autoplay quirks */ }
  still = null;
  running = true;
  els.idle.hidden = true; els.stop.hidden = false; els.start.hidden = true; els.save.disabled = false;
  say('');
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
  const img = new ImageData(new Uint8ClampedArray(still.base.data), still.base.width, still.base.height);
  recolor(img, still.mask, still.mw, still.mh);
  ctx.putImageData(img, 0, 0);
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  stopCamera();
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { say('We could not open that picture. Try a JPG or PNG.', 'warn'); return; }
  try { await ensure('IMAGE'); }
  catch (e) { say('The hair model could not load. Check your connection and try again.', 'warn'); return; }
  sizeCanvas(bmp.width, bmp.height);
  const w = els.canvas.width, h = els.canvas.height;
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const base = ctx.getImageData(0, 0, w, h);
  say('Finding your hair...', 'busy');
  try {
    imageSeg.segment(els.canvas, (res) => {
      const m = hairMask(res);
      if (!m) return;
      still = { base, mask: new Float32Array(m.getAsFloat32Array()), mw: m.width, mh: m.height };
      m.close();
    });
  } catch (e) { say('Something went wrong reading that photo. Try another.', 'warn'); return; }
  els.idle.hidden = true; els.save.disabled = false;
  say('');
  renderStill();
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

els.strength.addEventListener('input', () => {
  strength = els.strength.value / 100;
  els.strengthOut.textContent = els.strength.value + '%';
  renderStill();
});

els.save.addEventListener('click', () => {
  els.canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], 'my-classic-styles-color.png', { type: 'image/png' });
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
  }, 'image/png');
});

// Release the camera whenever the page is hidden or left.
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { stopCamera(); say('Camera paused. Tap Start the mirror to continue.'); } });
window.addEventListener('pagehide', stopCamera);
