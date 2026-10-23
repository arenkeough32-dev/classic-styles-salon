(function(){
  var hd=document.querySelector('header.site');
  var onScroll=function(){ if(hd) hd.classList.toggle('scrolled', window.scrollY>8); };
  window.addEventListener('scroll', onScroll, {passive:true}); onScroll();

  var b=document.getElementById('burger'), m=document.getElementById('mmenu');
  if(b&&m){
    b.addEventListener('click',function(){
      var open=m.classList.toggle('open'); b.setAttribute('aria-expanded',open?'true':'false');
      document.body.style.overflow=open?'hidden':'';
    });
    m.addEventListener('click',function(e){ if(e.target.closest('a')){ m.classList.remove('open'); b.setAttribute('aria-expanded','false'); document.body.style.overflow=''; }});
  }

  var y=document.getElementById('yr'); if(y) y.textContent=new Date().getFullYear();

  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('video[data-ambient]').forEach(function(v){ if(reduce){ v.removeAttribute('autoplay'); v.pause(); } });

  // Depth: the hero arch drifts slower than the page (desktop, motion allowed only)
  var art=document.querySelector('.mh-art');
  if(art && !reduce && window.matchMedia('(min-width: 861px) and (hover: hover)').matches){
    var ticking=false;
    window.addEventListener('scroll',function(){
      if(ticking) return; ticking=true;
      requestAnimationFrame(function(){
        var s=Math.min(window.scrollY, window.innerHeight);
        art.style.transform='translate3d(0,'+(s*-0.12).toFixed(1)+'px,0)';
        ticking=false;
      });
    },{passive:true});
  }
})();
