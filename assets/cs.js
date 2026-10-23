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
  if(art && !document.body.classList.contains('story') && !reduce && window.matchMedia('(min-width: 861px) and (hover: hover)').matches){
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

/* ===== v5.1 interactions ===== */
(function(){
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine=window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // 1. masthead depth: wordmark drifts slower than the page, photo faster (desktop)
  var mast=document.querySelector('.mast');
  if(mast && !document.body.classList.contains('story') && !reduce && window.innerWidth>860){
    var t=false; window.addEventListener('scroll',function(){ if(t) return; t=true; requestAnimationFrame(function(){
      var s=Math.min(window.scrollY,window.innerHeight); mast.style.transform='translate3d(0,'+(s*0.18).toFixed(1)+'px,0)'; t=false; }); },{passive:true});
  }

  // 2. mirror sheen follows the cursor across arch frames
  if(fine && !reduce){
    document.querySelectorAll('.arch').forEach(function(a){
      var s=document.createElement('span'); s.className='sheen'; a.appendChild(s);
      a.addEventListener('pointermove',function(e){ var r=a.getBoundingClientRect(); a.style.setProperty('--mx',(e.clientX-r.left)+'px'); a.style.setProperty('--my',(e.clientY-r.top)+'px'); });
    });
  }

  // 3. price list unfolds once when it scrolls into view
  var ml=document.querySelector('.menu-list');
  if(ml){ if(reduce||!('IntersectionObserver' in window)){ ml.classList.add('in'); }
    else { var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ ml.classList.add('in'); io.disconnect(); } }); },{threshold:.15}); io.observe(ml); } }

  // 4. ambient videos only play while visible
  var vids=document.querySelectorAll('video[data-play-visible]');
  if(vids.length && 'IntersectionObserver' in window && !reduce){
    var vo=new IntersectionObserver(function(es){ es.forEach(function(e){ var v=e.target; if(e.isIntersecting){ if(v.preload==='none') v.preload='auto'; var p=v.play(); if(p&&p.catch) p.catch(function(){}); } else v.pause(); }); },{threshold:.25});
    vids.forEach(function(v){ vo.observe(v); });
  }

  // 5. phone gallery: 3D ring of arches while swiping
  var ring=document.querySelector('.gallery.ring');
  if(ring && !reduce){
    var upd=function(){ if(window.innerWidth>860){ ring.querySelectorAll('figure').forEach(function(f){ f.style.transform=''; }); return; }
      var c=ring.scrollLeft+ring.clientWidth/2;
      ring.querySelectorAll('figure').forEach(function(f){ var m=f.offsetLeft+f.offsetWidth/2, d=Math.max(-1,Math.min(1,(m-c)/f.offsetWidth));
        f.style.transform='rotateY('+(-d*38).toFixed(1)+'deg) translateZ('+(-Math.abs(d)*90).toFixed(0)+'px) scale('+(1-Math.abs(d)*.08).toFixed(3)+')'; }); };
    ring.addEventListener('scroll',function(){ requestAnimationFrame(upd); },{passive:true}); window.addEventListener('resize',upd); upd();
  }

  // 6. service finder
  var fd=document.getElementById('finder');
  if(fd){
    var R={
      cut:['Haircut & style','from $25','Walk-ins welcome Tuesday to Saturday. Most cuts take about 30 minutes, and kids are welcome.','/haircuts-styling/','haircut'],
      color:['Color, highlights or balayage','from $60','Every color service starts with a free consultation. Bring a photo of the look you love, or preview a shade on yourself first.','/hair-color-balayage/','color appointment'],
      fix:['Color correction','by consultation','Box-dye mishaps and brassy tones fixed patiently, in stages if needed. Natalie’s brassy-to-blonde correction is in our gallery.','/hair-color-balayage/','color correction consult'],
      curl:['Perm or body wave','by consultation','Classic perms, body waves and spiral curls from stylists with 35 years of practice. Most last 3 to 6 months.','/perms/','perm consult'],
      care:['Deep-conditioning treatment','by consultation','Repair for dry, sun-stressed or frizzy Florida hair. An easy add-on to any cut or color.','/treatments/','treatment'],
      nails:['Manicure or pedicure','by consultation','Relaxing manicures and pedicures with Kelly in our nail room.','/nail-salon/','manicure or pedicure'],
      event:['Bridal or special-occasion updo','by consultation','Weddings, proms and big days, and whole wedding parties are welcome. Book groups a few weeks ahead.','/#work','bridal or event updo']
    };
    var ES=document.documentElement.lang==='es';
    if(ES){R={
      cut:['Corte y peinado','desde $25','Sin cita son bienvenidos de martes a sábado. La mayoría de los cortes toman unos 30 minutos, y los niños son bienvenidos.','/haircuts-styling/','corte'],
      color:['Color, mechas o balayage','desde $60','Todo servicio de color empieza con una consulta gratis. Traiga una foto del look que le gusta, o pruebe primero un tono en usted misma.','/hair-color-balayage/','cita de color'],
      fix:['Corrección de color','con consulta','Arreglamos con paciencia los desastres de tinte casero y los tonos anaranjados, por etapas si hace falta. La corrección de Natalie, de anaranjado a rubio, está en nuestra galería.','/hair-color-balayage/','consulta de corrección de color'],
      curl:['Permanente u onda de cuerpo','con consulta','Permanentes clásicas, ondas de cuerpo y rizos en espiral con estilistas de 35 años de práctica. La mayoría dura de 3 a 6 meses.','/perms/','consulta de permanente'],
      care:['Tratamiento de hidratación profunda','con consulta','Reparación para el cabello seco, maltratado por el sol o con frizz de Florida. Se agrega fácilmente a cualquier corte o color.','/treatments/','tratamiento'],
      nails:['Manicura o pedicura','con consulta','Manicuras y pedicuras relajantes con Kelly en nuestro cuarto de uñas.','/nail-salon/','manicura o pedicura'],
      event:['Recogido de novia o evento','con consulta','Bodas, graduaciones, quinceañeras y grandes días; los grupos de boda son bienvenidos. Reserve los grupos con unas semanas de anticipación.','/#work','recogido para boda o evento']
    };}
    var pick=null;
    fd.querySelectorAll('[data-pick]').forEach(function(b){ b.addEventListener('click',function(){
      pick=b.getAttribute('data-pick'); fd.querySelectorAll('[data-pick]').forEach(function(x){ x.setAttribute('aria-pressed', x===b?'true':'false'); });
      fd.querySelector('[data-step="1"]').classList.remove('on'); fd.querySelector('[data-step="2"]').classList.add('on'); fd.querySelector('[data-step="2"] button').focus();
    }); });
    fd.querySelectorAll('[data-when]').forEach(function(b){ b.addEventListener('click',function(){
      var r=R[pick], soon=b.getAttribute('data-when')==='soon';
      var body=encodeURIComponent(ES?('Hola Classic Styles! Quisiera reservar: '+r[4]+(soon?' esta semana.':'. ¿Cuándo tienen espacio?')):("Hi Classic Styles! I'd like to book a "+r[4]+(soon?' this week.':'. When do you have openings?')));
      var out=fd.querySelector('.f-result');
      out.innerHTML='<h3>'+r[0]+'</h3><span class="price">'+r[1]+'</span><p>'+r[2]+'</p>'
        +(ES?(soon?'<p>Recibimos sin cita de martes a sábado, pero una llamada o un texto rápido le asegura su silla.</p>':'<p>Envíenos un texto y una estilista le responde entre clientas con los horarios disponibles.</p>'):(soon?'<p>Walk-ins are welcome Tuesday to Saturday, but a quick call or text guarantees your chair.</p>':'<p>Text us and a stylist will reply between clients with open times.</p>'))
        +'<div class="cta-row"><a class="btn btn-solid" href="sms:+17274874475?&body='+body+'">'+(ES?'Enviar texto para reservar':'Text to book this')+'</a><a class="btn btn-outline" href="tel:+17274874475">'+(ES?'Llamar al':'Call')+' (727) 487-4475</a></div>'
        +'<p><a class="textlink" href="'+r[3]+'">'+(ES?'Más sobre este servicio (en inglés)':'More about this service')+'</a>'+((pick==='color'||pick==='fix')?' &nbsp; <a class="textlink" href="/try-on/">'+(ES?'Pruebe un color (en inglés)':'Try a color on yourself')+'</a>':'')+'</p>';
      fd.querySelector('[data-step="2"]').classList.remove('on'); fd.querySelector('[data-step="3"]').classList.add('on'); out.querySelector('h3').setAttribute('tabindex','-1'); out.querySelector('h3').focus();
    }); });
    fd.querySelectorAll('.f-back').forEach(function(b){ b.addEventListener('click',function(){ fd.querySelectorAll('.f-step').forEach(function(s){ s.classList.remove('on'); }); fd.querySelector('[data-step="1"]').classList.add('on'); }); });
  }
})();
/* before/after compare slider */
document.querySelectorAll('.compare').forEach(function(c){
  var r=c.querySelector('input[type=range]'); if(!r) return;
  var set=function(){ c.style.setProperty('--pos', r.value + '%'); };
  r.addEventListener('input', set); set();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(!e.isIntersecting) return; io.disconnect();
      var t0=null; function step(t){ if(!t0) t0=t; var p=Math.min(1,(t-t0)/1600); r.value = 50 + Math.sin(p*Math.PI*2)*28*(1-p); set(); if(p<1) requestAnimationFrame(step); } requestAnimationFrame(step); }); }, {threshold:.5});
    io.observe(c);
  }
});
