// Hair recolor engine for the Classic Styles color mirror.
// Pure pixel math, no DOM: it takes RGBA pixels plus the model's soft hair mask
// and returns natural-looking color. Kept separate so it can be tested offline.
//
// Why each step exists (the old version looked blotchy and glitchy):
//  1. The model's mask is small (about 256 px). Stretching it with nearest-neighbour
//     gave blocky, stair-stepped edges. We resample it smoothly instead.
//  2. The raw mask shimmers from frame to frame. We blend each new mask with the
//     last one, quickly where the head moves and slowly where it is still.
//  3. Mask edges ignore the real outline of the hair. An edge-aware ("guided")
//     filter snaps the soft mask to actual hair edges in the photo.
//  4. Dark hair is mostly camera noise. Scaling that noise up to reach a light
//     shade made blotches. We map brightness relative to the hair's own average,
//     with an offset that stops tiny dark values from being amplified.
//  5. The old code allocated arrays for every pixel, which stuttered on phones.
//     Everything here reuses typed buffers.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Shades are the color of the hair's average tone (not the shine), tuned in OKLab.
export const COLORS = {
  copper: [176, 86, 40], honey: [205, 152, 84], ash: [176, 168, 154], platinum: [222, 216, 202],
  chocolate: [84, 50, 34], espresso: [40, 28, 24], burgundy: [104, 24, 44], rose: [198, 130, 122],
  rainbow: null,
};
const RAINBOW = [[226, 60, 70], [240, 150, 50], [240, 210, 70], [70, 190, 110], [60, 130, 220], [140, 90, 210]];

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// ---- buffers ---------------------------------------------------------------
function makeBufs(n) {
  return {
    n, I: new Float32Array(n), p: new Float32Array(n), q: new Float32Array(n),
    mI: new Float32Array(n), mP: new Float32Array(n), cII: new Float32Array(n), cIP: new Float32Array(n),
    a: new Float32Array(n), b: new Float32Array(n), t1: new Float32Array(n), t2: new Float32Array(n),
  };
}

// Normalised box blur with radius r, O(n) per pass regardless of r.
export function boxBlur(src, dst, tmp, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0, c = 0;
    for (let x = 0; x <= r && x < w; x++) { s += src[o + x]; c++; }
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / c;
      const add = x + r + 1, sub = x - r;
      if (add < w) { s += src[o + add]; c++; }
      if (sub >= 0) { s -= src[o + sub]; c--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let y = 0; y <= r && y < h; y++) { s += tmp[y * w + x]; c++; }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = s / c;
      const add = y + r + 1, sub = y - r;
      if (add < h) { s += tmp[add * w + x]; c++; }
      if (sub >= 0) { s -= tmp[sub * w + x]; c--; }
    }
  }
}

// Bilinear resample of a w0 x h0 float map into w1 x h1. flipX mirrors horizontally.
export function resample(src, w0, h0, dst, w1, h1, flipX) {
  const sx = w0 / w1, sy = h0 / h1;
  for (let y = 0; y < h1; y++) {
    let fy = (y + 0.5) * sy - 0.5; if (fy < 0) fy = 0;
    let y0 = fy | 0; if (y0 > h0 - 1) y0 = h0 - 1;
    const y1 = y0 + 1 < h0 ? y0 + 1 : y0, ty = fy - y0;
    const r0 = y0 * w0, r1 = y1 * w0;
    for (let x = 0; x < w1; x++) {
      let fx = (x + 0.5) * sx - 0.5; if (fx < 0) fx = 0;
      if (flipX) fx = (w0 - 1) - fx; if (fx < 0) fx = 0;
      let x0 = fx | 0; if (x0 > w0 - 1) x0 = w0 - 1;
      const x1 = x0 + 1 < w0 ? x0 + 1 : x0, tx = fx - x0;
      const a = src[r0 + x0] + (src[r0 + x1] - src[r0 + x0]) * tx;
      const b = src[r1 + x0] + (src[r1 + x1] - src[r1 + x0]) * tx;
      dst[y * w1 + x] = a + (b - a) * ty;
    }
  }
}

// He et al. guided filter: makes the soft mask follow edges in the guide image.
function guided(B, w, h, r, eps) {
  const { I, p, q, mI, mP, cII, cIP, a, b, t1, t2, n } = B;
  boxBlur(I, mI, t2, w, h, r);
  boxBlur(p, mP, t2, w, h, r);
  for (let i = 0; i < n; i++) t1[i] = I[i] * I[i];
  boxBlur(t1, cII, t2, w, h, r);
  for (let i = 0; i < n; i++) t1[i] = I[i] * p[i];
  boxBlur(t1, cIP, t2, w, h, r);
  for (let i = 0; i < n; i++) {
    const v = cII[i] - mI[i] * mI[i];
    const cv = cIP[i] - mI[i] * mP[i];
    a[i] = cv / (v + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  boxBlur(a, t1, t2, w, h, r);
  boxBlur(b, a, t2, w, h, r); // reuse a as mean(b)
  for (let i = 0; i < n; i++) q[i] = t1[i] * I[i] + a[i];
}

// ---- the engine ------------------------------------------------------------
export class HairPainter {
  constructor() { this.reset(); }

  // Forget history (call when switching camera <-> photo, or after a pause).
  reset() {
    this.prevMask = null; this.prevW = 0; this.prevH = 0;
    this.meanL = -1; this.top = -1; this.bot = -1; this.gain = 0; this.low = null;
  }

  // Blend a fresh model mask into the running mask. Fast where it changed a lot
  // (head moved), slow where it only shimmers. Returns the smoothed mask.
  smoothMask(mask, mw, mh, temporal) {
    const n = mw * mh;
    if (!temporal || !this.prevMask || this.prevW !== mw || this.prevH !== mh) {
      this.prevMask = new Float32Array(mask); this.prevW = mw; this.prevH = mh;
      return this.prevMask;
    }
    const pm = this.prevMask;
    for (let i = 0; i < n; i++) {
      const d = mask[i] - pm[i];
      const ad = d < 0 ? -d : d;
      const k = 0.3 + 0.7 * (ad > 0.4 ? 1 : ad * 2.5);
      pm[i] += d * k;
    }
    return pm;
  }

  // Build the final matte at work resolution (ww x wh).
  // guidePx: RGBA pixels of the image at ww x wh. mask: model mask mw x mh.
  matte(guidePx, ww, wh, mask, mw, mh, flipX, temporal) {
    const n = ww * wh;
    if (!this.B || this.B.n !== n) this.B = makeBufs(n);
    const B = this.B;
    const m = this.smoothMask(mask, mw, mh, temporal);
    resample(m, mw, mh, B.p, ww, wh, flipX);
    for (let i = 0, j = 0; i < n; i++, j += 4) B.I[i] = lum(guidePx[j], guidePx[j + 1], guidePx[j + 2]) / 255;
    const r = Math.max(2, Math.round(Math.min(ww, wh) / 90));
    guided(B, ww, wh, r, 0.0025);
    // Smooth brightness base used by paint(); steadied over time on camera.
    if (!this.low || this.low.length !== n || !temporal) this.low = new Float32Array(B.mI);
    else { const L = this.low, M = B.mI; for (let i = 0; i < n; i++) L[i] += (M[i] - L[i]) * 0.5; }
    // Grade on a curve: on braids, updos and dim light the model can be unsure
    // everywhere (scores well under 1). Rescale so the clearest hair counts as
    // full hair. The floor stops us inflating random noise when there is no hair.
    const q = B.q;
    const hist = this.hist || (this.hist = new Uint32Array(64)); hist.fill(0);
    for (let i = 0; i < n; i++) { const v = q[i]; hist[v <= 0 ? 0 : v >= 1 ? 63 : (v * 64) | 0]++; }
    let need = Math.max(1, Math.round(n * 0.015)), bin = 63;
    for (; bin > 0; bin--) { need -= hist[bin]; if (need <= 0) break; }
    this.rawPeak = (bin + 1) / 64;
    const peak = Math.max(0.62, Math.min(1, this.rawPeak));
    const gain = temporal && this.gain ? this.gain + (1 / peak - this.gain) * 0.1 : 1 / peak;
    this.gain = gain;
    // True when the model can't clearly see hair (updos, braids, back of head, dark room).
    this.unsure = this.rawPeak < 0.5;
    // Contrast curve: kills faint halos on skin/background, keeps soft strand edges.
    for (let i = 0; i < n; i++) {
      let v = (q[i] * gain - 0.14) / 0.6; v = v < 0 ? 0 : v > 1 ? 1 : v;
      q[i] = v * v * (3 - 2 * v);
    }
    return q;
  }

  // ---- color state (OKLab, animated) ----------------------------------------
  // Pick a shade. Unless `instant`, step() glides from the old shade to the new.
  setColor(key, instant) {
    const c = COLORS[key];
    if (c) this.goal = rgbToLab(c);
    this.goalRainbow = c ? 0 : 1;
    if (!this.cur || instant) { this.cur = (this.goal || rgbToLab(COLORS.copper)).slice(); this.rainbow = this.goalRainbow; }
    if (!this.goal) this.goal = this.cur.slice();
  }

  // Advance the glide by dt milliseconds. Returns true while still moving.
  step(dt) {
    if (!this.cur) return false;
    const k = 1 - Math.exp(-dt / 90); // ~300 ms to settle, eases out
    let moving = false;
    for (let i = 0; i < 3; i++) {
      const d = this.goal[i] - this.cur[i];
      if (Math.abs(d) > 0.002) { this.cur[i] += d * k; moving = true; } else this.cur[i] = this.goal[i];
    }
    const dr = this.goalRainbow - this.rainbow;
    if (Math.abs(dr) > 0.01) { this.rainbow += dr * k; moving = true; } else this.rainbow = this.goalRainbow;
    return moving;
  }

  // Recolor full-size pixels `px` (W x H RGBA, edited in place) using matte (ww x wh).
  // Columns left of xMin are left untouched (the "before" side of the compare slider).
  paint(px, W, H, matte, ww, wh, strength, temporal, xMin) {
    if (!this.cur) this.setColor('copper', true);
    const low = this.low;
    xMin = Math.max(0, Math.min(W, xMin | 0));
    // Hair statistics, in perceptual lightness, from the smooth base.
    let sum = 0, wsum = 0, top = wh, bot = -1;
    for (let y = 0; y < wh; y++) {
      let rowHit = false;
      for (let x = 0; x < ww; x++) {
        const i = y * ww + x, m = matte[i];
        if (m < 0.5) continue;
        rowHit = true;
        sum += lumToL(low[i]) * m; wsum += m;
      }
      if (rowHit) { if (y < top) top = y; bot = y; }
    }
    if (wsum < 30) return false; // no hair found
    const sx = W / ww, sy = H / wh;
    const mean = sum / wsum;
    this.meanL = this.meanL < 0 || !temporal ? mean : this.meanL + (mean - this.meanL) * 0.15;
    const t0 = top * sy, b0 = (bot + 1) * sy;
    if (this.top < 0 || !temporal) { this.top = t0; this.bot = b0; }
    else { this.top += (t0 - this.top) * 0.2; this.bot += (b0 - this.bot) * 0.2; }

    if (!this.cx || this.cx.length !== W || this.cxW !== ww) {
      this.cx = new Int32Array(W); this.cf = new Float32Array(W); this.cxW = ww;
    }
    const cx = this.cx, cf = this.cf;
    for (let x = 0; x < W; x++) {
      let f = (x + 0.5) / sx - 0.5; if (f < 0) f = 0; if (f > ww - 1) f = ww - 1;
      const i = Math.min(ww - 2, f | 0); cx[x] = i < 0 ? 0 : i; cf[x] = ww > 1 ? f - cx[x] : 0;
    }

    const OFF = 0.08, mL = this.meanL + OFF;
    const span = Math.max(1, this.bot - this.top);
    const cur = this.cur, rb = this.rainbow;
    let tL = cur[0], ta = cur[1], tb = cur[2];

    for (let y = 0; y < H; y++) {
      if (rb > 0) { // rainbow: shade runs down the length of the hair
        const t = clamp01((y - this.top) / span) * (RAINBOW_LAB.length - 1 - 1e-6);
        const i = t | 0, f = t - i, A = RAINBOW_LAB[i], C = RAINBOW_LAB[i + 1];
        tL = cur[0] + ((A[0] + (C[0] - A[0]) * f) - cur[0]) * rb;
        ta = cur[1] + ((A[1] + (C[1] - A[1]) * f) - cur[1]) * rb;
        tb = cur[2] + ((A[2] + (C[2] - A[2]) * f) - cur[2]) * rb;
      }
      const keep = 0.45 + 0.55 * tL;       // dark shades keep depth in highlights
      const hiSpan = 1 - tL + 1e-3;
      let fy = (y + 0.5) / sy - 0.5; if (fy < 0) fy = 0; if (fy > wh - 1) fy = wh - 1;
      let my = Math.min(wh - 2, fy | 0); if (my < 0) my = 0;
      const ty = wh > 1 ? fy - my : 0, r0 = my * ww, r1 = Math.min(wh - 1, my + 1) * ww;
      const row = y * W * 4;
      for (let x = xMin; x < W; x++) {
        const i0 = cx[x], i1 = i0 + 1 < ww ? i0 + 1 : i0, tx = cf[x];
        const a0 = matte[r0 + i0] + (matte[r0 + i1] - matte[r0 + i0]) * tx;
        const a1 = matte[r1 + i0] + (matte[r1 + i1] - matte[r1 + i0]) * tx;
        let m = a0 + (a1 - a0) * ty;
        if (m < 0.004) continue;
        m *= strength;
        const p = row + x * 4;
        const r = px[p], g = px[p + 1], b = px[p + 2];
        // Smooth base (light and shadow) vs fine detail (strands, camera grain).
        const l0 = low[r0 + i0] + (low[r0 + i1] - low[r0 + i0]) * tx;
        const l1 = low[r1 + i0] + (low[r1 + i1] - low[r1 + i0]) * tx;
        const Lb = lumToL(l0 + (l1 - l0) * ty);
        const Lp = L8[(0.299 * r + 0.587 * g + 0.114 * b) | 0];
        // Remap only the base so the hair's average lands on the shade's lightness.
        const xr = Math.pow((Lb + OFF) / mL, 0.85);
        let Ln = xr <= 1 ? tL * xr : tL + (1 - tL) * (1 - 1 / xr) * keep;
        Ln += Lp - Lb;                      // strands go back on at natural strength
        if (Ln < 0) Ln = 0; else if (Ln > 1) Ln = 1;
        // Real dyed hair: less saturated in deep shadow and in bright shine.
        const cf2 = Ln < tL ? Math.sqrt(Ln / (tL + 1e-3)) : 1 - 0.55 * (Ln - tL) / hiSpan;
        const oa = ta * cf2, ob = tb * cf2;
        // OKLab -> linear sRGB
        const l_ = Ln + 0.3963377774 * oa + 0.2158037573 * ob;
        const m_ = Ln - 0.1055613458 * oa - 0.0638541728 * ob;
        const s_ = Ln - 0.0894841775 * oa - 1.2914855480 * ob;
        const l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_;
        const nr = enc(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
        const ng = enc(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
        const nb = enc(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3);
        px[p] = r + (nr - r) * m; px[p + 1] = g + (ng - g) * m; px[p + 2] = b + (nb - b) * m;
      }
    }
    return true;
  }
}

// ---- color helpers ---------------------------------------------------------
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
// Perceptual lightness of a gray with sRGB value i (0..255).
const L8 = new Float32Array(256);
for (let i = 0; i < 256; i++) L8[i] = Math.cbrt(toLin(i));
// Same, for a luma value in 0..1 (interpolated).
function lumToL(v) {
  const f = (v < 0 ? 0 : v > 1 ? 1 : v) * 255, i = f | 0;
  return i >= 255 ? L8[255] : L8[i] + (L8[i + 1] - L8[i]) * (f - i);
}
// Linear 0..1 -> sRGB 0..255 via a 4096-entry table.
const ENC = new Uint8ClampedArray(4097);
for (let i = 0; i <= 4096; i++) { const c = i / 4096; ENC[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
const enc = (c) => ENC[c <= 0 ? 0 : c >= 1 ? 4096 : (c * 4096) | 0];

export function rgbToLab(c) {
  const r = toLin(c[0]), g = toLin(c[1]), b = toLin(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
const RAINBOW_LAB = RAINBOW.map(rgbToLab);

// Merge two models' opinions (same size masks). The detailed multi-part model
// decides boundaries and protects skin; the dedicated hair model fills gaps.
export function fuseMasks(multiHair, multiSkin, hairOnly, out) {
  const n = multiHair.length;
  out = out && out.length === n ? out : new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sk = multiSkin[i] * 1.6; if (sk > 1) sk = 1;
    const fill = hairOnly ? hairOnly[i] * (1 - sk) * 0.92 : 0;
    out[i] = multiHair[i] > fill ? multiHair[i] : fill;
  }
  return out;
}
