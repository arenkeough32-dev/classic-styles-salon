/* Classic Styles v2 motion layer. Vanilla, no libraries. One rAF-throttled scroll loop (transform + opacity only).
   Honors prefers-reduced-motion and Save-Data: posters only, no scrub, no tilt, no parallax. */
(function () {
  'use strict';
  var doc = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conn = navigator.connection || {};
  var saveData = !!conn.saveData, slow = /(^|-)2g$/.test(conn.effectiveType || '');
  var mo = doc.classList.contains('mo');
  var canVideo = !reduce && !saveData && !slow;
  var small = matchMedia('(max-width:860px)').matches;
  var fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  var $ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (n, a, b) { return n < a ? a : n > b ? b : n; };
  var HD = 73.6; // header height in px (4.6rem)
  var vw = innerWidth, vh = innerHeight;

  /* ================= video manager ================= */
  var MAXP = 2, userPaused = false, vids = [];
  $('video.mv').forEach(function (el) {
    if (small && el.hasAttribute('data-nosm')) { el.remove(); return; } // phones keep the sharp still
    vids.push({ el: el, scrub: el.classList.contains('scrub'), inView: false, near: false,
      gate: !el.hasAttribute('data-gate'), attached: false, ready: false, cur: 0 });
  });
  function srcFor(el) {
    var d = el.dataset, base = (small && d.sm) ? d.sm : d.s;
    var w = small ? (d.wsm || d.wm) : d.wd;
    return base + '-' + w + '.mp4';
  }
  function attach(o) {
    if (o.attached || !canVideo) return;
    o.attached = true;
    var v = o.el;
    v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); v.playsInline = true;
    if (!o.scrub) v.loop = true;
    v.preload = 'auto';
    v.addEventListener('playing', function () { v.classList.add('on'); });
    var markReady = function () {
      if (o.ready || !(v.readyState >= 2 && v.duration > 0)) return;
      o.ready = true;
      if (o.scrub) { v.classList.add('on'); queue(); }
    };
    // several events: browsers that ignore preload=auto (iOS, data-saver) may never fire loadeddata on their own
    ['loadedmetadata', 'loadeddata', 'canplay'].forEach(function (ev) { v.addEventListener(ev, markReady); });
    if (o.scrub) {
      // nudge the decoder: a muted play/pause forces the first frames to load where preload is ignored
      v.addEventListener('loadedmetadata', function () {
        if (v.readyState >= 2) return;
        var p = v.play(); if (p && p.then) p.then(function () { v.pause(); }).catch(function () {});
      }, { once: true });
    }
    v.addEventListener('error', function () { v.style.display = 'none'; });
    v.src = srcFor(v);
    v.load();
  }
  function wants(o) { return !o.scrub && o.attached && o.inView && o.gate && !userPaused && !document.hidden; }
  function balance() {
    var c = vh / 2;
    var want = vids.filter(wants);
    want.forEach(function (o) { var r = o.el.getBoundingClientRect(); o.d = Math.abs(r.top + r.height / 2 - c); });
    want.sort(function (a, b) { return a.d - b.d; });
    vids.forEach(function (o) {
      if (o.scrub || !o.attached) return;
      var i = want.indexOf(o);
      if (i > -1 && i < MAXP) {
        if (o.el.paused) { var p = o.el.play(); if (p && p.catch) p.catch(function () {}); }
      } else if (!o.el.paused) o.el.pause();
    });
  }
  if (canVideo && 'IntersectionObserver' in window) {
    var map = new Map(); vids.forEach(function (o) { map.set(o.el, o); });
    var ioNear = new IntersectionObserver(function (es) {
      es.forEach(function (e) { var o = map.get(e.target); o.near = e.isIntersecting; if (e.isIntersecting && o.gate) attach(o); });
    }, { rootMargin: '90% 0px 90% 0px' });
    var ioView = new IntersectionObserver(function (es) {
      es.forEach(function (e) { map.get(e.target).inView = e.isIntersecting; });
      balance();
    }, { threshold: 0.12 });
    vids.forEach(function (o) { ioNear.observe(o.el); ioView.observe(o.el); });
    // hero loads right after first paint, never blocks it
    var heroV = vids.filter(function (o) { return o.el.hasAttribute('data-hero-video'); })[0];
    if (heroV) {
      var kick = function () { attach(heroV); heroV.inView = true; balance(); };
      if (document.readyState === 'complete') kick(); else addEventListener('load', kick);
    }
    setInterval(function () { if (!document.hidden) balance(); }, 1200); // watchdog: anything in view must be moving
    document.addEventListener('visibilitychange', balance);
  }
  var pbtn = document.querySelector('.pauseall');
  if (pbtn && canVideo && vids.length) {
    pbtn.hidden = false;
    pbtn.addEventListener('click', function () {
      userPaused = !userPaused;
      pbtn.setAttribute('aria-pressed', userPaused);
      pbtn.textContent = userPaused ? 'Play videos' : 'Pause videos';
      balance();
    });
  }

  /* ================= service stage ================= */
  var svc = document.querySelector('[data-svc]');
  if (svc && mo) {
    var layers = $('.svc-layer', svc), rows = $('.svc-list li', svc), curKey = null;
    var layerOf = {};
    layers.forEach(function (l) { layerOf[l.getAttribute('data-layer')] = { el: l, o: vids.filter(function (o) { return l.contains(o.el); })[0] }; });
    var activate = function (key) {
      if (key === curKey) return; curKey = key;
      layers.forEach(function (l) { var on = l.getAttribute('data-layer') === key; l.classList.toggle('on', on); });
      rows.forEach(function (r) { r.classList.toggle('is-active', r.getAttribute('data-stage') === key); });
      Object.keys(layerOf).forEach(function (k) {
        var o = layerOf[k].o; if (!o) return; var on = k === key; o.gate = on;
        if (on) { attach(o); } 
      });
      // warm the next clip so the crossfade has motion in it
      var idx = rows.map(function (r) { return r.getAttribute('data-stage'); }).indexOf(key), nx = rows[idx + 1];
      if (nx) { var o2 = layerOf[nx.getAttribute('data-stage')].o; if (o2) attach(o2); }
      balance();
    };
    if ('IntersectionObserver' in window) {
      var ioRow = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) activate(e.target.getAttribute('data-stage')); });
      }, { rootMargin: '-42% 0px -48% 0px' });
      rows.forEach(function (r) { ioRow.observe(r); r.addEventListener('mouseenter', function () { activate(r.getAttribute('data-stage')); }); r.addEventListener('focusin', function () { activate(r.getAttribute('data-stage')); }); });
    }
    activate(rows[0].getAttribute('data-stage'));
  } else if (svc) {
    var l0 = $('.svc-layer', svc)[0]; if (l0) l0.classList.add('on');
  }

  /* ================= reveals ================= */
  if (mo && 'IntersectionObserver' in window) {
    var rv = $('.sec-head,.svc-head,.ext-copy,.nails2-copy,.gift-copy,.wed-copy,.sigreel-head,.nails2-lab,.reel-intro,.facts>div,.stats>div,.quote,.in7-row figure,.finder');
    rv.forEach(function (el, i) { el.classList.add('r2'); el.style.setProperty('--d', ((i % 4) * 0.08).toFixed(2) + 's'); });
    $('.ext-frame,.nf,.gift-frame,.wf-frame,.member .arch').forEach(function (el, i) { el.classList.add('u2'); el.style.setProperty('--d', ((i % 3) * 0.1).toFixed(2) + 's'); });
    // clipped elements cannot report intersection, so unveil targets are observed through their parent
    var tgt = new Map();
    var ioR = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { (tgt.get(e.target) || []).forEach(function (t) { t.classList.add('in'); }); ioR.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    setTimeout(function () { $('.r2:not(.in),.u2:not(.in)').forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < vh * 1.1 && r.bottom > -vh) el.classList.add('in'); }); }, 2500);
    $('.r2,.u2').forEach(function (el) {
      var o = el.classList.contains('u2') ? el.parentElement : el;
      if (!tgt.has(o)) { tgt.set(o, []); ioR.observe(o); }
      tgt.get(o).push(el);
    });
  }

  /* ================= tilt (desktop pointer only) ================= */
  if (mo && fine) {
    $('.member .arch.has-photo,.reel .frame,.reel .arch,.in7-row .frame,.nails7-ph .frame').forEach(function (el) { el.classList.add('tiltable'); });
    $('.tiltable').forEach(function (el) {
      var raf = 0, ev;
      el.addEventListener('pointermove', function (e) {
        ev = e; if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0; var r = el.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
          el.style.setProperty('--ry', (x * 9).toFixed(2) + 'deg'); el.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg');
          el.style.setProperty('--mx', (x * 100 + 50).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100 + 50).toFixed(1) + '%');
        });
      });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });
  }

  /* ================= scroll-driven scenes ================= */
  var hero = document.querySelector('[data-hero]'), heroMedia = hero && hero.querySelector('.hero2-media');
  var pars = $('[data-par]').map(function (el) { return { el: el, k: parseFloat(el.getAttribute('data-par')) || 0 }; });
  var closeSec = document.querySelector('[data-scene="close"]'), closeMedia = closeSec && closeSec.querySelector('.close2-media');
  var scrubs = [];
  ['door', 'orbit'].forEach(function (n) {
    var sec = document.querySelector('[data-scene="' + n + '"]'); if (!sec) return;
    var o = vids.filter(function (x) { return sec.contains(x.el); })[0];
    scrubs.push({ n: n, sec: sec, stage: sec.firstElementChild, o: o, media: sec.querySelector('.' + n + '-media'), a: sec.querySelector('.door-a'), b: $('.door-b', sec), num: sec.querySelector('.orbit-num'), t: 0 });
  });
  var hs = document.querySelector('[data-hscroll]'), hsTrack = hs && hs.querySelector('.sigreel-track'), hsView = hs && hs.querySelector('.sigreel-view'), hsCards = hs ? $('[data-card]', hs) : [], hsDist = 0, hsOn = false;
  var wcards = $('.wcard');

  function layout() {
    vw = innerWidth; vh = innerHeight; small = matchMedia('(max-width:860px)').matches;
    hsOn = !!(hs && mo && vw >= 900);
    if (hsOn) {
      var stageH = vh - HD;
      hs.style.setProperty('--cardh', Math.min(vh * 0.46, 28 * 16) + 'px');
      hsTrack.style.transform = 'none';
      hsDist = Math.max(0, hsTrack.scrollWidth - hsView.clientWidth);
      hs.style.setProperty('--sr-h', Math.round(stageH + hsDist * 1.05) + 'px');
    } else if (hs) { hs.style.removeProperty('--sr-h'); if (hsTrack) hsTrack.style.transform = ''; hsCards.forEach(function (c) { c.style.transform = ''; }); }
  }

  var ticking = false, lerping = false;
  function queue() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  function frame() {
    ticking = false;
    var y = scrollY, again = false;
    var tnow = performance.now(), dt = Math.min(100, tnow - (frame.t || tnow - 16)); frame.t = tnow;
    var lerpK = 1 - Math.exp(-dt / 70);
    if (!mo) return;

    if (hero && heroMedia && y < vh * 1.4) {
      var p = clamp(y / (hero.offsetHeight || 1), 0, 1);
      heroMedia.style.transform = 'translate3d(0,' + (p * 6).toFixed(2) + '%,0) scale(' + (1 + p * 0.1).toFixed(4) + ')';
    }

    // pinned, scroll-scrubbed film scenes
    scrubs.forEach(function (s) {
      var r = s.sec.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) return;
      var span = Math.max(1, r.height - s.stage.offsetHeight);
      var p = clamp((HD - r.top) / span, 0, 1);
      if (s.n === 'door') {
        s.a.style.opacity = clamp(1 - (p - 0.12) * 4.5, 0, 1).toFixed(3);
        var b = clamp((p - 0.5) * 3.2, 0, 1);
        s.b.forEach(function (el, i) { var q = clamp(b * (i ? 1.0 : 1.0) - i * 0.15, 0, 1); el.style.opacity = q.toFixed(3); el.style.transform = 'translate3d(0,' + ((1 - q) * 30).toFixed(1) + 'px,0)'; });
        s.media.style.transform = 'scale(' + (1 + p * 0.06).toFixed(4) + ')';
      } else if (s.num) {
        s.num.style.transform = 'translate3d(' + ((p - 0.5) * -14).toFixed(2) + 'vw,0,0)';
        s.media.style.transform = 'scale(' + (1.05 + p * 0.03).toFixed(4) + ')';
      }
      var v = s.o && s.o.el;
      if (v && s.o.ready && v.duration) {
        var target = p * (v.duration - 0.06);
        s.o.cur += (target - s.o.cur) * lerpK; // time-based ease: same feel at 30 or 120 fps
        if (Math.abs(s.o.cur - target) < 0.012) s.o.cur = target; else again = true;
        if (Math.abs(v.currentTime - s.o.cur) > 0.02) v.currentTime = s.o.cur;
      } else if (v && s.o && s.o.near && !s.o.attached) attach(s.o);
      else if (v && s.o && s.o.attached && !s.o.ready) { if (v.readyState >= 2 && v.duration > 0) { s.o.ready = true; v.classList.add('on'); again = true; } else if (!s.o.kicked && v.readyState === 0) { s.o.kicked = true; v.load(); } }
    });

    // horizontal signature reel (desktop): vertical scroll drives sideways travel with 3D card tilt
    if (hsOn) {
      var hr = hs.getBoundingClientRect();
      if (hr.bottom > -80 && hr.top < vh + 80) {
        var hp = clamp((HD - hr.top) / (hs.offsetHeight - (vh - HD)) , 0, 1);
        var tx = -hp * hsDist;
        hsTrack.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,0,0)';
        hsCards.forEach(function (c) {
          var cx = c.offsetLeft + c.offsetWidth / 2 + tx, d = clamp((cx - hsView.clientWidth / 2) / (hsView.clientWidth / 2), -1.2, 1.2);
          c.style.transform = 'perspective(1400px) rotateY(' + (-d * 15).toFixed(2) + 'deg) translateZ(' + (-Math.abs(d) * 60).toFixed(1) + 'px) scale(' + (1 - Math.abs(d) * 0.04).toFixed(3) + ')';
          var im = c.querySelector('.ph img'); if (im) im.style.transform = 'translate3d(' + (d * -5).toFixed(2) + '%,0,0)';
        });
      }
    }

    // layered parallax
    pars.forEach(function (p) {
      var r = p.el.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      p.el.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * p.k).toFixed(1) + 'px');
    });

    // wedding card stack: each card sinks as the next slides over it
    for (var i = 0; i < wcards.length - 1; i++) {
      var nr = wcards[i + 1].getBoundingClientRect(), fig = wcards[i].firstElementChild;
      if (nr.top > vh + 50 && !fig._s) continue;
      var q = clamp((vh - nr.top) / (vh * 0.85), 0, 1);
      fig.style.transform = 'scale(' + (1 - q * 0.09).toFixed(4) + ')'; fig.style.opacity = (1 - q * 0.55).toFixed(3); fig._s = q > 0;
    }

    if (closeMedia) {
      var cr = closeSec.getBoundingClientRect();
      if (cr.bottom > 0 && cr.top < vh) closeMedia.style.transform = 'translate3d(0,' + (((cr.top + cr.height / 2 - vh / 2) / vh) * -4).toFixed(2) + '%,0) scale(' + (1.04 + clamp(1 - cr.top / vh, 0, 1) * 0.04).toFixed(4) + ')';
    }

    var now = performance.now();
    if (now - (frame.lb || 0) > 350) { frame.lb = now; balance(); }
    if (again) queue();
  }
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', function () { layout(); queue(); });
  addEventListener('load', function () { layout(); queue(); });
  addEventListener('orientationchange', function () { setTimeout(function () { layout(); queue(); }, 250); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { layout(); queue(); });
  if ('ResizeObserver' in window && hsTrack) new ResizeObserver(function () { layout(); queue(); }).observe(hsTrack);
  layout(); queue();

  /* ================= phone ring on swipe reels (replaces the old library-driven version) ================= */
  if (mo || true) {
    var rings = $('.reel').concat(hs ? [hsView] : []);
    rings.forEach(function (rail) {
      if (!rail || reduce) return;
      var items = $('figure,[data-card]', rail), t = 0;
      var upd = function () {
        t = 0;
        if (rail === hsView && hsOn) return;
        if (vw >= 861 && rail.classList.contains('reel')) return;
        var c = rail.scrollLeft + rail.clientWidth / 2;
        items.forEach(function (f) {
          var m = f.offsetLeft + f.offsetWidth / 2, d = clamp((m - c) / f.offsetWidth, -1, 1);
          f.style.transform = 'perspective(1000px) rotateY(' + (-d * 28).toFixed(1) + 'deg) translateZ(' + (-Math.abs(d) * 70).toFixed(0) + 'px) scale(' + (1 - Math.abs(d) * 0.07).toFixed(3) + ')';
        });
      };
      rail.addEventListener('scroll', function () { if (!t) t = requestAnimationFrame(upd); }, { passive: true });
      upd();
    });
  }
})();
