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

export const COLORS = {
  copper: [184, 98, 48], honey: [214, 164, 84], ash: [178, 170, 160], chocolate: [74, 42, 28],
  burgundy: [110, 22, 46], rose: [206, 130, 128], rainbow: null,
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
      let v = (q[i] * gain - 0.22) / 0.56; v = v < 0 ? 0 : v > 1 ? 1 : v;
      q[i] = v * v * (3 - 2 * v);
    }
    return q;
  }

  // Recolor full-size pixels `px` (W x H RGBA, edited in place) using matte (ww x wh).
  paint(px, W, H, matte, ww, wh, colorKey, strength, temporal) {
    const fixed = COLORS[colorKey];
    const low = this.low;
    // Hair statistics at matte resolution, read from the full image by sampling.
    const sx = W / ww, sy = H / wh;
    let sum = 0, wsum = 0, top = wh, bot = -1;
    for (let y = 0; y < wh; y++) {
      const py = Math.min(H - 1, ((y + 0.5) * sy) | 0) * W;
      let rowHit = false;
      for (let x = 0; x < ww; x++) {
        const m = matte[y * ww + x];
        if (m < 0.5) continue;
        rowHit = true;
        const p = (py + Math.min(W - 1, ((x + 0.5) * sx) | 0)) * 4;
        sum += lum(px[p], px[p + 1], px[p + 2]) * m; wsum += m;
      }
      if (rowHit) { if (y < top) top = y; bot = y; }
    }
    if (wsum < 30) return false; // no hair found
    const mean = sum / wsum;
    const k = temporal ? 0.15 : 1;
    this.meanL = this.meanL < 0 || !temporal ? mean : this.meanL + (mean - this.meanL) * k;
    const t0 = top * sy, b0 = (bot + 1) * sy;
    if (this.top < 0 || !temporal) { this.top = t0; this.bot = b0; }
    else { this.top += (t0 - this.top) * 0.2; this.bot += (b0 - this.bot) * 0.2; }

    // Precompute bilinear lookups from full-res columns/rows into the matte.
    if (!this.cx || this.cx.length !== W || this.cxW !== ww) {
      this.cx = new Int32Array(W); this.cf = new Float32Array(W); this.cxW = ww;
    }
    const cx = this.cx, cf = this.cf;
    for (let x = 0; x < W; x++) {
      let f = (x + 0.5) / sx - 0.5; if (f < 0) f = 0; if (f > ww - 1) f = ww - 1;
      const i = Math.min(ww - 2, f | 0); cx[x] = i < 0 ? 0 : i; cf[x] = ww > 1 ? f - cx[x] : 0;
    }

    // Brightness mapping. OFF stops near-black noise from being multiplied into blotches.
    const OFF = 28, mL = this.meanL + OFF;
    const span = Math.max(1, this.bot - this.top);
    let tr = 0, tg = 0, tb = 0, tL = 1;
    const setTarget = (c) => { tr = c[0]; tg = c[1]; tb = c[2]; tL = Math.max(8, lum(tr, tg, tb)); };
    if (fixed) setTarget(fixed);
    const rc = [0, 0, 0];

    for (let y = 0; y < H; y++) {
      if (!fixed) {
        const t = clamp01((y - this.top) / span) * (RAINBOW.length - 1 - 1e-6);
        const i = t | 0, f = t - i, a = RAINBOW[i], c = RAINBOW[i + 1];
        rc[0] = a[0] + (c[0] - a[0]) * f; rc[1] = a[1] + (c[1] - a[1]) * f; rc[2] = a[2] + (c[2] - a[2]) * f;
        setTarget(rc);
      }
      let fy = (y + 0.5) / sy - 0.5; if (fy < 0) fy = 0; if (fy > wh - 1) fy = wh - 1;
      let my = Math.min(wh - 2, fy | 0); if (my < 0) my = 0;
      const ty = wh > 1 ? fy - my : 0, r0 = my * ww, r1 = Math.min(wh - 1, my + 1) * ww;
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i0 = cx[x], i1 = i0 + 1 < ww ? i0 + 1 : i0, tx = cf[x];
        const a0 = matte[r0 + i0] + (matte[r0 + i1] - matte[r0 + i0]) * tx;
        const a1 = matte[r1 + i0] + (matte[r1 + i1] - matte[r1 + i0]) * tx;
        let m = a0 + (a1 - a0) * ty;
        if (m < 0.004) continue;
        m *= strength;
        const p = row + x * 4;
        const r = px[p], g = px[p + 1], b = px[p + 2];
        // Split brightness into a smooth base (shape of the hair, light and shadow)
        // and fine detail (strands, plus camera noise). Only the base is remapped
        // to the new shade; detail goes back on at its natural strength, so noise
        // in dark hair is never amplified into blotches or shimmer.
        const b0 = low[r0 + i0] + (low[r0 + i1] - low[r0 + i0]) * tx;
        const b1 = low[r1 + i0] + (low[r1 + i1] - low[r1 + i0]) * tx;
        const base = (b0 + (b1 - b0) * ty) * 255;
        const detail = lum(r, g, b) - base;
        const s = Math.pow((base + OFF) / mL, 0.85);
        let nr, ng, nb;
        if (s <= 1) { nr = tr * s; ng = tg * s; nb = tb * s; }
        else { // highlights roll smoothly toward white instead of clipping
          const u = (1 - 1 / s) * (0.45 + 0.55 * tL / 255); // dark shades keep depth
          nr = tr + (255 - tr) * u; ng = tg + (255 - tg) * u; nb = tb + (255 - tb) * u;
        }
        nr += detail; ng += detail; nb += detail;
        px[p] = r + (nr - r) * m; px[p + 1] = g + (ng - g) * m; px[p + 2] = b + (nb - b) * m;
      }
    }
    return true;
  }
}
