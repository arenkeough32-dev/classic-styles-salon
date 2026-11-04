/* Classic Styles cinema layer: opening + closing scenes.
   No third-party code. Video loads after first paint; skipped for reduced motion, Save-Data and 2g. */
(function(){
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conn = navigator.connection || {};
  var slow = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
  var canVideo = !reduce && !slow;
  var small = matchMedia('(max-width: 900px)').matches;
  var clamp = function(n, a, b){ return n < a ? a : n > b ? b : n; };
  var scenes = [];

  document.querySelectorAll('[data-cin]').forEach(function(sec){
    var v = sec.querySelector('video');
    var s = {
      el: sec, kind: sec.getAttribute('data-cin'), video: v,
      media: sec.querySelector('.cin-media'), blur: sec.querySelector('.cin-blur'),
      veil: sec.querySelector('.close7-veil'), copy: sec.querySelector('.close7-copy'),
      btn: sec.querySelector('.cin-pause'), attached: false, ended: false, userPaused: false, visible: false
    };
    scenes.push(s);
    if (s.kind === 'strip') {
      s.scrub = sec.hasAttribute('data-scrub'); s.imgs = sec.querySelectorAll('img,video');
      if (!s.scrub && v && canVideo) {
        v.loop = true; s.btn = document.createElement('button'); s.btn.type = 'button'; s.btn.className = 'cin-pause'; s.btn.hidden = true; s.btn.textContent = 'Pause video'; sec.appendChild(s.btn);
      }
    }
    if (!v || !canVideo) return;

    function attach(){
      if (s.attached) return;
      s.attached = true;
      var base = '/media/' + v.getAttribute('data-clip') + '-' + ((small || s.kind === 'strip') ? '960' : '1920');
      [['mp4', 'video/mp4'], ['webm', 'video/webm']].forEach(function(t){
        var so = document.createElement('source'); so.src = base + '.' + t[0]; so.type = t[1]; v.appendChild(so);
      });
      v.addEventListener('playing', function(){ v.classList.add('on'); if (s.btn) { s.btn.hidden = false; label(); } });
      v.addEventListener('ended', function(){ s.ended = true; label(); });
      v.load();
    }
    function label(){ if (s.btn) s.btn.textContent = (s.ended || v.paused) ? (s.ended ? 'Replay video' : 'Play video') : 'Pause video'; }
    function play(){
      var p = v.play(); if (p && p.catch) p.catch(function(){ if (s.btn) s.btn.hidden = true; });
    }
    s.attach = attach; s.play = play; s.label = label;

    if (s.btn) s.btn.addEventListener('click', function(){
      if (s.ended) { s.ended = false; s.userPaused = false; v.currentTime = 0; play(); }
      else if (v.paused) { s.userPaused = false; play(); }
      else { s.userPaused = true; v.pause(); }
      setTimeout(label, 30);
    });
    v.addEventListener('pause', label); v.addEventListener('play', label);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function(es){
        es.forEach(function(e){
          s.visible = e.isIntersecting;
          if (s.kind !== 'hero' && e.isIntersecting) attach();
          if (!s.attached || s.scrub) return;
          if (!e.isIntersecting) { if (!v.paused) v.pause(); }
          else if (!s.userPaused && !s.ended && (s.kind !== 'close' || e.intersectionRatio > .3)) play();
        });
      }, { rootMargin: s.kind === 'hero' ? '0px' : '60% 0px', threshold: [0, .3] }).observe(sec);
    }
  });

  // opening video: after load and first paint, when the browser is idle
  var hero = scenes.filter(function(s){ return s.kind === 'hero'; })[0];
  if (hero && hero.attach) {
    var go = function(){ hero.attach(); if (hero.visible !== false) hero.play(); };
    var kick = function(){ ('requestIdleCallback' in window) ? requestIdleCallback(go, { timeout: 2000 }) : setTimeout(go, 800); };
    if (document.readyState === 'complete') kick(); else addEventListener('load', kick);
  }

  // scroll-linked motion (transform + opacity only), one rAF per frame
  var close = scenes.filter(function(s){ return s.kind === 'close'; })[0];
  if (reduce) return;
  if (close) close.el.classList.add('cin-on');

  var ticking = false, vh = innerHeight;
  function frame(){
    ticking = false;
    var y = scrollY;
    if (hero) {
      var h = hero.el.offsetHeight, p = clamp(y / (h * .95), 0, 1);
      if (p < 1 || hero.last !== 1) {
        hero.media.style.transform = 'translate3d(0,' + (p * 7).toFixed(2) + '%,0) scale(' + (1 + p * .14).toFixed(4) + ')';
        hero.media.style.opacity = (1 - p * .8).toFixed(3);
        if (hero.blur) hero.blur.style.opacity = clamp(p * 1.7, 0, 1).toFixed(3);
      }
      hero.last = p;
    }
    scenes.forEach(function(s){
      if (s.kind !== 'strip') return;
      var r = s.el.getBoundingClientRect();
      if (r.bottom < -50 || r.top > vh + 50) return;
      var k = clamp((r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2), -1, 1);
      var tr = 'translate3d(0,' + (k * -3).toFixed(2) + '%,0)';
      s.imgs.forEach(function(n){ n.style.transform = tr; });
      if (s.scrub && s.video && s.video.duration) {
        var q = clamp((vh - r.top) / (vh + r.height), 0, 1);
        var t = q * (s.video.duration - .05);
        if (Math.abs(s.video.currentTime - t) > .04) s.video.currentTime = t;
        s.video.classList.add('on');
      }
    });
    if (close) {
      var r = close.el.getBoundingClientRect(), span = r.height - vh;
      var q = span > 0 ? clamp(-r.top / span, 0, 1) : 1;
      if (r.bottom > -50 && r.top < vh + 50) {
        close.media.style.transform = 'translate3d(0,' + ((1 - q) * -3).toFixed(2) + '%,0) scale(' + (1.2 - .2 * clamp(q * 1.5, 0, 1)).toFixed(4) + ')';
        close.veil.style.opacity = (1 - clamp(q / .3, 0, 1)).toFixed(3);
        var t = clamp((q - .22) / .3, 0, 1);
        close.copy.style.opacity = t.toFixed(3);
        close.copy.style.transform = 'translate3d(0,' + ((1 - t) * 28).toFixed(1) + 'px,0)';
      }
    }
  }
  function req(){ if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', function(){ vh = innerHeight; req(); });
  frame();
})();
