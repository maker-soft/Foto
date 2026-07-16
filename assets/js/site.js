(function(){
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const deepMerge=(base,value)=>{
    if(Array.isArray(base))return Array.isArray(value)?value:base;
    if(base&&typeof base==='object'){
      const out={...base};
      if(value&&typeof value==='object')Object.keys(value).forEach(k=>out[k]=k in base?deepMerge(base[k],value[k]):value[k]);
      return out;
    }
    return value===undefined?base:value;
  };

  let content=JSON.parse(JSON.stringify(window.DEFAULT_SITE_CONTENT));
  let slideTimer=null,faqOpen=null,lastTrackedRoute='',lightboxItems=[],lightboxIndex=0,touchStartX=null;
  const directionSections=['albums','preparation','process','questions','photos'];

  function hasOwn(obj,key){return Boolean(obj&&Object.prototype.hasOwnProperty.call(obj,key))}

  function normalizeContent(target,raw){
    if(!hasOwn(raw,'brandCity')){
      target.brandCity='Новосибирск';
      if(String(raw?.brandTop||'').trim().toLowerCase()==='выпускной альбом новосибирск')target.brandTop='Выпускной альбом';
    }
    Object.keys(target.directions||{}).forEach(key=>{
      const d=target.directions[key],saved=raw?.directions?.[key]||{},legacy=saved.hero||d.hero||'';
      if(hasOwn(saved,'cardImage'))d.cardImage=saved.cardImage||'';
      else if(hasOwn(saved.pageImages,'home'))d.cardImage=saved.pageImages.home||'';
      else d.cardImage=d.cardImage||legacy;
      if(!d.pageImages||typeof d.pageImages!=='object')d.pageImages={};
      directionSections.forEach(section=>{
        if(hasOwn(saved.pageImages,section))d.pageImages[section]=saved.pageImages[section]||'';
        else if(!d.pageImages[section])d.pageImages[section]=legacy;
      });
      if(!d.hero)d.hero=legacy;
      d.menuLabels=d.menuLabels||{};
      d.photosSectionTitle=d.photosSectionTitle||d.menuLabels.photos||'Фото';
      if(!hasOwn(saved,'photosSectionIntro'))d.photosSectionIntro='';
    });
  }

  function directionImage(d,section='home'){
    if(section==='home'){
      if(hasOwn(d,'cardImage'))return d.cardImage||'';
      if(hasOwn(d?.pageImages,'home'))return d.pageImages.home||'';
      return d?.hero||'';
    }
    if(hasOwn(d?.pageImages,section))return d.pageImages[section]||'';
    return d?.hero||'';
  }

  const safeHref=u=>{
    try{
      const url=new URL(String(u||''),location.href);
      return /^https?:$/.test(url.protocol)?url.href:'#';
    }catch(_){return '#'}
  };

  const asset=u=>{
    if(!u)return '';
    const value=String(u).trim();
    if(/^https?:\/\//i.test(value))return safeHref(value);
    if(/^assets\//i.test(value))return value.replace(/^\.\//,'');
    return '';
  };

  function media(url,alt,attrs=''){
    const src=asset(url);
    return src?`<img src="${esc(src)}" alt="${esc(alt)}" ${attrs}>`:'';
  }

  function richHtml(value){
    const source=String(value??'').trim();
    if(!source)return '';
    if(!/<[a-z][\s\S]*>/i.test(source))return `<p>${esc(source).replace(/\r?\n/g,'<br>')}</p>`;
    const template=document.createElement('template');
    template.innerHTML=source;
    const allowed=new Set(['P','BR','STRONG','EM','UL','OL','LI']);
    const clean=node=>{
      [...node.childNodes].forEach(child=>{
        if(child.nodeType===Node.COMMENT_NODE){child.remove();return}
        if(child.nodeType!==Node.ELEMENT_NODE)return;
        let tag=child.tagName.toUpperCase();
        if(tag==='B')tag='STRONG';
        if(tag==='I')tag='EM';
        if(tag==='DIV')tag='P';
        if(!allowed.has(tag)){
          const frag=document.createDocumentFragment();
          while(child.firstChild)frag.appendChild(child.firstChild);
          child.replaceWith(frag);
          clean(node);
          return;
        }
        if(child.tagName.toUpperCase()!==tag){
          const replacement=document.createElement(tag.toLowerCase());
          while(child.firstChild)replacement.appendChild(child.firstChild);
          child.replaceWith(replacement);
          child=replacement;
        }
        [...child.attributes].forEach(a=>child.removeAttribute(a.name));
        clean(child);
      });
    };
    clean(template.content);
    return template.innerHTML;
  }

  function albumImage(album,direction){
    return hasOwn(album,'cover')?(album.cover||''):directionImage(direction,'albums');
  }

  function applyTheme(){
    const t=content.theme||{},r=document.documentElement.style;
    const m={bg:'--bg',ink:'--ink',muted:'--muted',line:'--line',surface:'--surface',button:'--button',active:'--active',bodyFont:'--font-body',headingFont:'--font-heading'};
    Object.keys(m).forEach(k=>t[k]&&r.setProperty(m[k],t[k]));
    [['baseSize','--base-size','px'],['brandSize','--brand-size','px'],['navSize','--nav-size','px'],['homeTitleSize','--home-title-size','px'],['directionTitleSize','--direction-title-size','px'],['directionSubtitleSize','--direction-subtitle-size','px'],['pageTitleSize','--page-title-size','px'],['sectionTitleSize','--section-title-size','px'],['cardTitleSize','--card-title-size','px'],['bodyLetterSpacing','--body-ls','px'],['headingLetterSpacing','--heading-ls','px'],['navLetterSpacing','--nav-ls','px']]
      .forEach(([k,v,u])=>Number.isFinite(Number(t[k]))&&r.setProperty(v,Number(t[k])+u));
    Number.isFinite(Number(t.lineHeight))&&r.setProperty('--body-lh',t.lineHeight);
  }

  function route(){
    const raw=(location.hash||'#home').slice(1),p=raw.split('/').filter(Boolean);
    if(!p.length||p[0]==='home')return{view:'home'};
    if(p[0]==='about'||p[0]==='contacts')return{view:p[0]};
    if(p[0]==='direction')return{view:'direction',dir:p[1]||'school',section:p[2]||'albums',item:p[3]||null};
    return{view:'home'};
  }

  function go(hash){location.hash=hash;window.scrollTo({top:0,behavior:'smooth'})}

  function header(active){
    const l=content.labels||{};
    return `<header class="topbar"><div class="container"><div class="topbar-inner">
      <button class="brand" data-go="home"><strong>${esc(content.brandTop)}</strong><span class="brand-name">${esc(content.brandBottom)}</span>${content.brandCity?`<span class="brand-city">${esc(content.brandCity)}</span>`:''}</button>
      <nav class="topnav" aria-label="Основная навигация">
        <button class="nav-button ${active==='about'?'active':''}" data-go="about">${esc(l.navAbout)}</button>
        <button class="nav-button ${active==='contacts'?'active':''}" data-go="contacts">${esc(l.navContacts)}</button>
      </nav>
    </div></div></header>`;
  }

  function home(){
    return `${header('home')}<main id="main"><section class="home container"><h1 class="slogan">${esc(content.homeSlogan)}</h1><div class="direction-grid">${['school','kindergarten'].map(k=>{
      const d=content.directions[k],src=asset(directionImage(d,'home'));
      return `<button class="direction-card ${src?'has-media':'no-media'}" data-go="direction/${k}/albums">${src?media(src,d.title,'loading="eager"'):''}<span class="direction-card-copy"><h2>${esc(d.title)}</h2><p>${esc(d.subtitle)}</p></span></button>`;
    }).join('')}</div></section></main>`;
  }

  function lightboxTrigger(url,alt,inner,className=''){
    const src=asset(url);
    if(!src)return '';
    return `<button type="button" class="${esc(className)}" data-lightbox-src="${esc(src)}" data-lightbox-alt="${esc(alt)}" aria-label="Открыть фотографию">${inner}</button>`;
  }

  function about(){
    const a=content.about,slides=(a.slides||[]).filter(u=>asset(u));
    const slideshow=slides.length?`<div class="slideshow" id="slideshow">${slides.map((s,i)=>`<div class="slide ${i===0?'active':''}">${lightboxTrigger(s,`Фото ${i+1}`,media(s,`Фото ${i+1}`,i===0?'loading="eager"':'loading="lazy"'),'slide-view')}</div>`).join('')}${slides.length>1?`<div class="slide-dots">${slides.map((_,i)=>`<button class="slide-dot ${i===0?'active':''}" data-slide="${i}" aria-label="Фото ${i+1}"></button>`).join('')}</div>`:''}</div>`:'';
    return `${header('about')}<main id="main"><section class="page container"><div class="about-layout ${slides.length?'':'without-media'}"><article class="about-copy"><h1 class="page-title">${esc(a.title)}</h1><div class="page-text rich-text">${richHtml(a.text)}</div></article>${slideshow}</div></section></main>`;
  }

  function contacts(){
    const c=content.contacts,l=content.labels||{},photo=(content.about.slides||[]).find(u=>asset(u))||'',hasPhoto=Boolean(asset(photo));
    const photoBlock=hasPhoto?`<div class="slideshow"><div class="slide active">${lightboxTrigger(photo,'Фотограф Лена Сибирская',media(photo,'Фотограф Лена Сибирская','loading="eager"'),'slide-view')}</div></div>`:'';
    return `${header('contacts')}<main id="main"><section class="page container"><div class="contacts-layout ${hasPhoto?'':'without-media'}"><article class="contacts-copy"><h1 class="page-title">${esc(c.title)}</h1><div class="page-text rich-text">${richHtml(c.text)}</div><div class="contacts-actions"><a class="action-button" href="${esc(safeHref(c.vk))}" target="_blank" rel="noopener noreferrer">${esc(l.contactVk)}</a><a class="action-button" href="${esc(safeHref(c.max))}" target="_blank" rel="noopener noreferrer">${esc(l.contactMax)}</a></div></article>${photoBlock}</div></section></main>`;
  }

  function directionTop(dir,section){
    const d=content.directions[dir],heroUrl=directionImage(d,section),hasHero=Boolean(asset(heroUrl)),l=content.labels||{},menu=d.menuLabels||{};
    const entries=directionSections.map(id=>[id,menu[id]||id]);
    const hero=hasHero?`<div class="direction-hero">${lightboxTrigger(heroUrl,d.title,media(heroUrl,d.title,'loading="eager" fetchpriority="high"'),'hero-view')}</div>`:'';
    return `<section class="direction-page container"><div class="direction-shell ${hasHero?'':'without-hero'}"><aside class="direction-panel"><h1 class="direction-heading">${esc(d.title)}</h1><p class="direction-subtitle">${esc(d.subtitle)}</p><nav class="side-menu">${entries.map(([id,label])=>`<button class="side-button ${section===id?'active':''}" data-go="direction/${dir}/${id}">${esc(label)}</button>`).join('')}<a class="side-button external video-button" href="${esc(safeHref(content.videoUrl))}" target="_blank" rel="noopener noreferrer">${esc(l.videoReviews)}</a><button class="side-button external" data-go="contacts">${esc(l.discussShoot)}</button><button class="side-button external" data-go="home">${esc(l.home)}</button></nav></aside>${hero}<div class="section-content">`;
  }

  function sectionHeader(title,intro=''){
    const text=String(intro??'').trim();
    return `<div class="section-header ${text?'':'without-intro'}"><h2 class="section-title">${esc(title)}</h2>${text?`<div class="section-intro rich-text">${richHtml(text)}</div>`:''}</div>`;
  }

  function uniqueImages(items){
    const seen=new Set();
    return (items||[]).map(asset).filter(src=>src&&!seen.has(src)&&seen.add(src));
  }

  function albums(dir,item){
    const d=content.directions[dir],l=content.labels||{};
    if(item){
      const a=d.albums.find(x=>x.id===item);
      if(!a)return empty(l.albumNotFound);
      const images=uniqueImages([albumImage(a,d),...(a.gallery||[])]);
      const mediaBlock=images.length?`<div class="album-detail-media">${gallery(images,'album-detail-gallery')}</div>`:'';
      return `<button class="back-button album-back" data-go="direction/${dir}/albums">${esc(l.backAlbums)}</button>${mediaBlock}<article class="album-detail-copy album-detail-copy-bottom"><span class="direction-kicker">${esc(d.title)}</span><h2>${esc(a.title)}</h2>${a.subtitle?`<div class="album-subtitle rich-text">${richHtml(a.subtitle)}</div>`:''}${a.text?`<div class="album-description rich-text">${richHtml(a.text)}</div>`:''}</article>`;
    }
    return `${sectionHeader(d.albumsSectionTitle||d.menuLabels?.albums||'Виды альбомов',d.albumsSectionIntro)}<div class="album-grid">${d.albums.map(a=>{
      const cover=albumImage(a,d),hasCover=Boolean(asset(cover));
      return `<button class="album-card ${hasCover?'has-media':'no-media'}" data-go="direction/${dir}/albums/${a.id}">${hasCover?media(cover,a.title,'loading="lazy"'):''}<span class="album-copy"><h3>${esc(a.title)}</h3><p>${esc(a.subtitle)}</p></span></button>`;
    }).join('')}</div>`;
  }

  function textSection(s){
    const l=content.labels||{};
    return `${sectionHeader(s.title,s.intro)}${s.body?`<div class="free-text rich-text">${richHtml(s.body)}</div>`:empty(l.textComing)}`;
  }

  function questions(s){
    const items=s.items||[],l=content.labels||{};
    return `${sectionHeader(s.title,s.intro)}${items.length?`<div class="faq">${items.map((q,i)=>`<article class="faq-item ${faqOpen===i?'open':''}" data-faq-item="${i}"><button class="faq-question" data-faq="${i}" aria-expanded="${faqOpen===i}"><span>${esc(q.question)}</span><span class="faq-icon">+</span></button><div class="faq-answer"><div><div class="rich-text">${richHtml(q.answer)}</div></div></div></article>`).join('')}</div>`:empty(l.questionsComing)}`;
  }

  function photos(d){
    const folders=(d.photoFolders||[]).map(f=>({...f,images:(f.images||[]).filter(u=>asset(u))})).filter(f=>f.images.length),l=content.labels||{};
    if(!folders.length)return empty(l.photosComing);
    return `${sectionHeader(d.photosSectionTitle||d.menuLabels?.photos||'Фото',d.photosSectionIntro||'')}<div class="folder-tabs">${folders.map((f,i)=>`<button class="folder-tab ${i===0?'active':''}" data-folder="${esc(f.id)}">${esc(f.title)}</button>`).join('')}</div>${folders.map((f,i)=>`<section class="photo-folder ${i===0?'active':''}" data-folder-panel="${esc(f.id)}">${gallery(f.images,'folder-gallery')}</section>`).join('')}`;
  }

  function gallery(images,className=''){
    const valid=uniqueImages(images);
    return valid.length?`<div class="gallery ${esc(className)} count-${Math.min(valid.length,4)}">${valid.map((u,i)=>`<figure>${lightboxTrigger(u,`Фото ${i+1}`,media(u,`Фото ${i+1}`,'loading="lazy"'),'gallery-view')}</figure>`).join('')}</div>`:'';
  }

  function empty(t){return `<div class="empty-state">${esc(t||'')}</div>`}

  function direction(r){
    const d=content.directions[r.dir]||content.directions.school,s=r.section||'albums';
    const body=s==='albums'?albums(r.dir,r.item):s==='preparation'?textSection(d.preparation):s==='process'?textSection(d.process):s==='questions'?questions(d.questions):photos(d);
    return `<main id="main">${directionTop(r.dir,s)}${body}</div></div></section></main>`;
  }

  function lightboxMarkup(){
    const l=content.labels||{};
    return `<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Просмотр фотографии"><button class="lightbox-close" data-lightbox-close aria-label="${esc(l.lightboxClose)}">×</button><button class="lightbox-nav lightbox-prev" data-lightbox-prev aria-label="${esc(l.lightboxPrevious)}">‹</button><div class="lightbox-stage"><img id="lightboxImage" alt=""><div class="lightbox-counter" id="lightboxCounter"></div></div><button class="lightbox-nav lightbox-next" data-lightbox-next aria-label="${esc(l.lightboxNext)}">›</button></div>`;
  }

  function startSlides(){
    clearInterval(slideTimer);
    const slides=$$('.slide');
    if(slides.length<2)return;
    let i=0;
    const set=n=>{
      i=n;
      slides.forEach((x,j)=>x.classList.toggle('active',j===i));
      $$('.slide-dot').forEach((x,j)=>x.classList.toggle('active',j===i));
    };
    $$('[data-slide]').forEach(b=>b.onclick=()=>set(Number(b.dataset.slide)));
    slideTimer=setInterval(()=>set((i+1)%slides.length),Math.max(2,Number(content.about.slideInterval)||4)*1000);
  }

  function refreshLightbox(){
    const modal=$('#lightbox'),img=$('#lightboxImage'),counter=$('#lightboxCounter');
    if(!modal||!img||!lightboxItems.length)return;
    lightboxIndex=(lightboxIndex+lightboxItems.length)%lightboxItems.length;
    const item=lightboxItems[lightboxIndex];
    img.src=item.src;
    img.alt=item.alt||'';
    counter.textContent=lightboxItems.length>1?`${lightboxIndex+1} / ${lightboxItems.length}`:'';
    $$('[data-lightbox-prev],[data-lightbox-next]').forEach(b=>b.classList.toggle('hidden',lightboxItems.length<2));
  }

  function openLightbox(index){
    if(!lightboxItems.length)return;
    lightboxIndex=index;
    refreshLightbox();
    $('#lightbox').classList.add('open');
    document.body.classList.add('lightbox-open');
    $('[data-lightbox-close]')?.focus();
  }

  function closeLightbox(){
    $('#lightbox')?.classList.remove('open');
    document.body.classList.remove('lightbox-open');
  }

  function stepLightbox(delta){lightboxIndex+=delta;refreshLightbox()}

  function bindLightbox(){
    const triggers=$$('[data-lightbox-src]');
    const openFrom=el=>{
      const root=el.closest('.gallery,.slideshow,.direction-hero')||document;
      const group=$$('[data-lightbox-src]',root);
      lightboxItems=group.map(item=>({src:item.dataset.lightboxSrc,alt:item.dataset.lightboxAlt||''}));
      openLightbox(Math.max(0,group.indexOf(el)));
    };
    triggers.forEach(el=>{
      el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openFrom(el)});
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openFrom(el)}});
    });
    $('[data-lightbox-close]')?.addEventListener('click',closeLightbox);
    $('[data-lightbox-prev]')?.addEventListener('click',()=>stepLightbox(-1));
    $('[data-lightbox-next]')?.addEventListener('click',()=>stepLightbox(1));
    $('#lightbox')?.addEventListener('click',e=>{if(e.target.id==='lightbox')closeLightbox()});
    const stage=$('.lightbox-stage');
    stage?.addEventListener('touchstart',e=>touchStartX=e.changedTouches[0].clientX,{passive:true});
    stage?.addEventListener('touchend',e=>{
      if(touchStartX===null)return;
      const dx=e.changedTouches[0].clientX-touchStartX;
      if(Math.abs(dx)>45)stepLightbox(dx>0?-1:1);
      touchStartX=null;
    },{passive:true});
  }

  function bind(){
    $$('[data-go]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.go)));
    $$('[data-faq]').forEach(b=>b.onclick=()=>{faqOpen=faqOpen===Number(b.dataset.faq)?null:Number(b.dataset.faq);render()});
    $$('[data-folder]').forEach(b=>b.onclick=()=>{
      $$('[data-folder]').forEach(x=>x.classList.toggle('active',x===b));
      $$('[data-folder-panel]').forEach(x=>x.classList.toggle('active',x.dataset.folderPanel===b.dataset.folder));
    });
    startSlides();
    bindLightbox();
  }

  function render(){
    clearInterval(slideTimer);
    closeLightbox();
    const r=route();
    document.body.className=`view-${r.view}${r.dir?' direction-'+r.dir:''}`;
    const page=r.view==='home'?home():r.view==='about'?about():r.view==='contacts'?contacts():direction(r);
    $('#app').innerHTML=page+lightboxMarkup();
    bind();
    const key=[r.view,r.dir,r.section,r.item].filter(Boolean).join('/');
    if(key!==lastTrackedRoute){lastTrackedRoute=key;window.SiteBackend.trackPageView(key)}
  }

  async function init(){
    try{
      const res=await window.SiteBackend.getContent(),raw=res.data||{};
      content=deepMerge(window.DEFAULT_SITE_CONTENT,raw);
      normalizeContent(content,raw);
      if(!res.configured)$('#setupNotice').classList.remove('hidden');
    }catch(e){
      console.error(e);
      normalizeContent(content,{});
      $('#setupNotice').classList.remove('hidden');
    }
    applyTheme();
    render();
    window.addEventListener('hashchange',render);
    window.addEventListener('keydown',e=>{
      if(!$('#lightbox')?.classList.contains('open'))return;
      if(e.key==='Escape')closeLightbox();
      if(e.key==='ArrowLeft')stepLightbox(-1);
      if(e.key==='ArrowRight')stepLightbox(1);
    });
  }

  document.addEventListener('DOMContentLoaded',init,{once:true});
})();
