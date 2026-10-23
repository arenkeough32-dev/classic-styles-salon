/* Classic Styles v6 — homepage scroll story. Needs gsap, ScrollTrigger, SplitText (and optionally Lenis) loaded first. */
(function(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desktop = window.matchMedia('(min-width: 861px)').matches;
  var vid = document.querySelector('.walk-frame video');

  // Reduced motion or missing libraries: show the calm, static version.
  if (reduce || !window.gsap || !window.ScrollTrigger) {
    document.querySelectorAll('.walk-cap,.walk-end').forEach(function(el){ el.style.opacity = 1; });
    document.querySelectorAll('.bigquote .w').forEach(function(w){ w.style.opacity = 1; });
    if (vid) { vid.setAttribute('controls',''); }
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);
  document.documentElement.classList.add('story-ready');
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(run);
  function run(){

  // 1. Smooth, weighted scrolling (desktop only; phones keep native scroll)
  if (window.Lenis && desktop) {
    var lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function(t){ lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    document.querySelectorAll('a[href^="#"],a[href^="/#"]').forEach(function(a){
      a.addEventListener('click', function(e){
        var id = a.getAttribute('href').replace(/^\//,''); var el = id.length > 1 && document.querySelector(id);
        if (el && location.pathname === '/') { e.preventDefault(); lenis.scrollTo(el, { offset: -70 }); }
      });
    });
  }

  // 2. Masthead letters rise in, then the copy follows
  var mast = document.querySelectorAll('.mast span');
  if (window.SplitText && mast.length) {
    mast.forEach(function(l){ l.style.overflow = 'hidden'; });
    var chars = new SplitText(mast, { type: 'chars' }).chars;
    gsap.from(chars, { yPercent: 110, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.035, delay: 0.1 });
  }
  gsap.from('.hero-dk .mh-copy > *', { y: 24, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, delay: 0.55 });
  gsap.from('.hero-dk .mh-art', { clipPath: 'inset(100% 0 0 0)', duration: 1.4, ease: 'expo.out', delay: 0.3 });
  // hero parallax depth: words drift slowly, photo lifts faster
  gsap.to('.hero-dk .mast', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '.hero-dk', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.hero-dk .mh-art', { yPercent: -14, ease: 'none', scrollTrigger: { trigger: '.hero-dk', start: 'top top', end: 'bottom top', scrub: true } });

  // 3. Walk in the front door: pinned scene, scroll scrubs the video and grows the arch
  var walk = document.querySelector('.walk');
  if (walk && vid) {
    var prime = function(){ var p = vid.play(); if (p && p.then) p.then(function(){ vid.pause(); }).catch(function(){}); };
    vid.preload = 'auto'; vid.load(); prime();
    var dur = 7.2; vid.addEventListener('loadedmetadata', function(){ dur = vid.duration || dur; });
    var tl = gsap.timeline({ scrollTrigger: { trigger: walk, start: 'top top', end: desktop ? '+=260%' : '+=200%', pin: true, scrub: 0.6, anticipatePin: 1 } });
    var state = { t: 0 };
    tl.to(state, { t: 1, ease: 'none', duration: 10, onUpdate: function(){ var target = state.t * (dur - 0.05); if (Math.abs(vid.currentTime - target) > 0.02) vid.currentTime = target; } }, 0)
      .fromTo('.walk-frame', { scale: desktop ? 0.62 : 0.8 }, { scale: desktop ? 1.08 : 1.02, ease: 'none', duration: 10 }, 0)
      .to('.walk-cap.c1', { opacity: 1, y: -10, duration: 1 }, 0.6).to('.walk-cap.c1', { opacity: 0, duration: 1 }, 3.2)
      .to('.walk-cap.c2', { opacity: 1, y: -10, duration: 1 }, 3.6).to('.walk-cap.c2', { opacity: 0, duration: 1 }, 6.2)
      .to('.walk-cap.c3', { opacity: 1, y: -10, duration: 1 }, 6.6)
      .to('.walk-end', { opacity: 1, duration: 1 }, 8.2);
  }

  // 4. Horizontal reel of real work (desktop): vertical scroll slides the gallery sideways
  var reel = document.querySelector('.reel');
  if (reel && desktop) {
    var dist = function(){ return Math.max(0, reel.scrollWidth - window.innerWidth); };
    gsap.to(reel, { x: function(){ return -dist(); }, ease: 'none',
      scrollTrigger: { trigger: '.reel-wrap', start: 'center center', end: function(){ return '+=' + dist(); }, pin: '#work', scrub: 0.8, invalidateOnRefresh: true } });
  } else if (reel) { // phones: 3D ring while swiping
    var upd = function(){ var c = reel.scrollLeft + reel.clientWidth / 2;
      reel.querySelectorAll('figure').forEach(function(f){ var m = f.offsetLeft + f.offsetWidth / 2, d = Math.max(-1, Math.min(1, (m - c) / f.offsetWidth));
        f.style.transform = 'rotateY(' + (-d * 34).toFixed(1) + 'deg) translateZ(' + (-Math.abs(d) * 80).toFixed(0) + 'px) scale(' + (1 - Math.abs(d) * .08).toFixed(3) + ')'; }); };
    reel.addEventListener('scroll', function(){ requestAnimationFrame(upd); }, { passive: true }); upd();
  }

  // 5. The wedding review lights up word by word
  var bq = document.querySelector('.bigquote');
  if (bq) {
    var words = bq.querySelectorAll('.w');
    gsap.to(words, { opacity: 1, stagger: 0.08, ease: 'none', scrollTrigger: { trigger: bq, start: 'top 80%', end: 'bottom 45%', scrub: true } });
  }

  // 6. Section headlines rise line by line, once
  if (window.SplitText) {
    document.querySelectorAll('main h2:not(.sr-only):not(.no-split)').forEach(function(h){
      var s = new SplitText(h, { type: 'lines', linesClass: 'line-mask-inner' });
      s.lines.forEach(function(l){ var m = document.createElement('span'); m.className = 'line-mask'; l.parentNode.insertBefore(m, l); m.appendChild(l); });
      gsap.from(s.lines, { yPercent: 105, duration: 1, ease: 'expo.out', stagger: 0.09, scrollTrigger: { trigger: h, start: 'top 88%', once: true } });
    });
  }

  // 7. Count-up numbers
  document.querySelectorAll('[data-count]').forEach(function(el){
    var to = parseFloat(el.getAttribute('data-count')), dec = (el.getAttribute('data-count').split('.')[1] || '').length, o = { v: 0 };
    el.textContent = (0).toFixed(dec);
    gsap.to(o, { v: to, duration: 1.8, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true }, onUpdate: function(){ el.textContent = o.v.toFixed(dec); } });
  });

  window.addEventListener('load', function(){ ScrollTrigger.refresh(); });
  }
})();
/* wedding stack: each card sinks back as the next one slides over it */
(function(){
  var cards = document.querySelectorAll('.wcard');
  cards.forEach(function(c, i){ c.style.setProperty('--i', i); });
  if (!window.gsap || !window.ScrollTrigger || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cards.forEach(function(c, i){
    var next = cards[i + 1]; if (!next) return;
    gsap.to(c.querySelector('figure'), { scale: 0.9, filter: 'brightness(.55)', ease: 'none',
      scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 20%', scrub: true } });
  });
})();
