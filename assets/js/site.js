(function(){
  const $=(s,r=document)=>r.querySelector(s);
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
  let slideTimer=null,faqOpen=null,lastTrackedRoute='';
  const directionSections=['albums','preparation','process','questions','photos'];

  function hasOwn(obj,key){return Boolean(obj&&Object.prototype.hasOwnProperty.call(obj,key))}

  function normalizeDirectionImages(target,raw){
    Object.keys(target.directions||{}).forEach(key=>{
      const d=target.directions[key];
      const saved=raw?.directions?.[key]||{};
      const legacy=saved.hero||d.hero||'';
      if(hasOwn(saved,'cardImage'))d.cardImage=saved.cardImage||'';
      else if(hasOwn(saved.pageImages,'home'))d.cardImage=saved.pageImages.home||'';
      else d.cardImage=d.cardImage||legacy;
      if(!d.pageImages||typeof d.pageImages!=='object')d.pageImages={};
      directionSections.forEach(section=>{
        if(hasOwn(saved.pageImages,section))d.pageImages[section]=saved.pageImages[section]||'';
        else if(!d.pageImages[section])d.pageImages[section]=legacy;
      });
      if(!d.hero)d.hero=legacy;
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
    return `<header class="topbar"><div class="container"><div class="topbar-inner">
      <button class="brand" data-go="home"><strong>${esc(content.brandTop)}</strong><span>${esc(content.brandBottom)}</span></button>
      <nav class="topnav" aria-label="Основная навигация">
        <button class="nav-button ${active==='about'?'active':''}" data-go="about">Обо мне</button>
        <button class="nav-button ${active==='contacts'?'active':''}" data-go="contacts">Контакты</button>
      </nav>
    </div></div></header>`;
  }

  function home(){
    return `${header('home')}<main id="main"><section class="home container"><h1 class="slogan">${esc(content.homeSlogan)}</h1><div class="direction-grid">${['school','kindergarten'].map(k=>{
      const d=content.directions[k],src=asset(directionImage(d,'home'));
      return `<button class="direction-card ${src?'has-media':'no-media'}" data-go="direction/${k}/albums">${src?media(src,d.title,'loading="eager"'):''}<span class="direction-card-copy"><h2>${esc(d.title)}</h2><p>${esc(d.subtitle)}</p></span></button>`;
    }).join('')}</div></section></main>`;
  }

  function about(){
    const a=content.about,slides=(a.slides||[]).filter(u=>asset(u));
    const slideshow=slides.length?`<div class="slideshow" id="slideshow">${slides.map((s,i)=>`<div class="slide ${i===0?'active':''}">${media(s,`Фото ${i+1}`,i===0?'loading="eager"':'loading="lazy"')}</div>`).join('')}${slides.length>1?`<div class="slide-dots">${slides.map((_,i)=>`<button class="slide-dot ${i===0?'active':''}" data-slide="${i}" aria-label="Фото ${i+1}"></button>`).join('')}</div>`:''}</div>`:'';
    return `${header('about')}<main id="main"><section class="page container"><div class="about-layout ${slides.length?'':'without-media'}"><article class="about-copy"><h1 class="page-title">${esc(a.title)}</h1><p class="page-text">${esc(a.text)}</p></article>${slideshow}</div></section></main>`;
  }

  function contacts(){
    const c=content.contacts,photo=(content.about.slides||[]).find(u=>asset(u))||'',hasPhoto=Boolean(asset(photo));
    return `${header('contacts')}<main id="main"><section class="page container"><div class="contacts-layout ${hasPhoto?'':'without-media'}"><article class="contacts-copy"><h1 class="page-title">${esc(c.title)}</h1><p class="page-text">${esc(c.text)}</p><div class="contacts-actions"><a class="action-button dark" href="${esc(safeHref(c.vk))}" target="_blank" rel="noopener noreferrer">Написать во ВКонтакте</a><a class="action-button" href="${esc(safeHref(c.max))}" target="_blank" rel="noopener noreferrer">Написать в MAX</a></div></article>${hasPhoto?`<div class="slideshow"><div class="slide active">${media(photo,'Фотограф Лена Сибирская','loading="eager"')}</div></div>`:''}</div></section></main>`;
  }

  const menu=[['albums','Виды альбомов'],['preparation','Подготовка'],['process','Процесс'],['questions','Вопросы'],['photos','Фото']];

  function directionTop(dir,section){
    const d=content.directions[dir],heroUrl=directionImage(d,section),hasHero=Boolean(asset(heroUrl));
    return `<section class="direction-page container"><div class="direction-shell ${hasHero?'':'without-hero'}"><aside class="direction-panel"><h1 class="direction-heading">${esc(d.title)}</h1><p class="direction-subtitle">${esc(d.subtitle)}</p><nav class="side-menu">${menu.map(([id,label])=>`<button class="side-button ${section===id?'active':''}" data-go="direction/${dir}/${id}">${label}</button>`).join('')}<a class="side-button external video-button" href="${esc(safeHref(content.videoUrl))}" target="_blank" rel="noopener noreferrer">Видеообзоры</a><button class="side-button external" data-go="contacts">Обсудить съёмку</button><button class="side-button external" data-go="home">На главную</button></nav></aside>${hasHero?`<div class="direction-hero">${media(heroUrl,d.title,'loading="eager" fetchpriority="high"')}</div>`:''}<div class="section-content">`;
  }

  function sectionHeader(title,intro=''){
    const text=String(intro??'').trim();
    return `<div class="section-header ${text?'':'without-intro'}"><h2 class="section-title">${esc(title)}</h2>${text?`<p class="section-intro">${esc(text)}</p>`:''}</div>`;
  }

  function albums(dir,item){
    const d=content.directions[dir];
    if(item){
      const a=d.albums.find(x=>x.id===item);
      if(!a)return empty('Альбом не найден');
      const cover=albumImage(a,d),hasCover=Boolean(asset(cover));
      return `<button class="back-button" style="width:auto;margin-bottom:22px" data-go="direction/${dir}/albums">Назад к альбомам</button><div class="album-detail ${hasCover?'':'without-cover'}"><article class="album-detail-copy"><span class="direction-kicker">${esc(d.title)}</span><h2>${esc(a.title)}</h2><p>${esc(a.subtitle)}</p><div class="album-description">${esc(a.text)}</div></article>${hasCover?`<div class="album-detail-cover">${media(cover,a.title,'loading="eager"')}</div>`:''}</div>${gallery(a.gallery||[])}`;
    }
    return `${sectionHeader(d.albumsSectionTitle||'Виды альбомов',d.albumsSectionIntro)}<div class="album-grid">${d.albums.map(a=>{
      const cover=albumImage(a,d),hasCover=Boolean(asset(cover));
      return `<button class="album-card ${hasCover?'has-media':'no-media'}" data-go="direction/${dir}/albums/${a.id}">${hasCover?media(cover,a.title,'loading="lazy"'):''}<span class="album-copy"><h3>${esc(a.title)}</h3><p>${esc(a.subtitle)}</p></span></button>`;
    }).join('')}</div>`;
  }

  function textSection(s){return `${sectionHeader(s.title,s.intro)}${s.body?`<div class="free-text">${esc(s.body)}</div>`:empty('Информация будет добавлена позже.')}`}

  function questions(s){
    const items=s.items||[];
    return `${sectionHeader(s.title,s.intro)}${items.length?`<div class="faq">${items.map((q,i)=>`<article class="faq-item ${faqOpen===i?'open':''}" data-faq-item="${i}"><button class="faq-question" data-faq="${i}" aria-expanded="${faqOpen===i}"><span>${esc(q.question)}</span><span class="faq-icon">+</span></button><div class="faq-answer"><div><p>${esc(q.answer)}</p></div></div></article>`).join('')}</div>`:empty('Вопросы и ответы будут добавлены позже.')}`;
  }

  function photos(d){
    const folders=(d.photoFolders||[]).map(f=>({...f,images:(f.images||[]).filter(u=>asset(u))})).filter(f=>f.images.length);
    if(!folders.length)return empty('Фотографии будут добавлены позже.');
    return `${sectionHeader('Фото','Выберите подборку.')}<div class="folder-tabs">${folders.map((f,i)=>`<button class="folder-tab ${i===0?'active':''}" data-folder="${esc(f.id)}">${esc(f.title)}</button>`).join('')}</div>${folders.map((f,i)=>`<section class="photo-folder ${i===0?'active':''}" data-folder-panel="${esc(f.id)}">${gallery(f.images)}</section>`).join('')}`;
  }

  function gallery(images){
    const valid=(images||[]).filter(u=>asset(u));
    return valid.length?`<div class="gallery">${valid.map((u,i)=>`<figure>${media(u,`Фото ${i+1}`,'loading="lazy"')}</figure>`).join('')}</div>`:'';
  }

  function empty(t){return `<div class="empty-state">${esc(t)}</div>`}

  function direction(r){
    const d=content.directions[r.dir]||content.directions.school,s=r.section||'albums';
    const body=s==='albums'?albums(r.dir,r.item):s==='preparation'?textSection(d.preparation):s==='process'?textSection(d.process):s==='questions'?questions(d.questions):photos(d);
    return `<main id="main">${directionTop(r.dir,s)}${body}</div></div></section></main>`;
  }

  function startSlides(){
    clearInterval(slideTimer);
    const slides=[...document.querySelectorAll('.slide')];
    if(slides.length<2)return;
    let i=0;
    const set=n=>{
      i=n;
      slides.forEach((x,j)=>x.classList.toggle('active',j===i));
      document.querySelectorAll('.slide-dot').forEach((x,j)=>x.classList.toggle('active',j===i));
    };
    document.querySelectorAll('[data-slide]').forEach(b=>b.onclick=()=>set(Number(b.dataset.slide)));
    slideTimer=setInterval(()=>set((i+1)%slides.length),Math.max(2,Number(content.about.slideInterval)||4)*1000);
  }

  function bind(){
    document.querySelectorAll('[data-go]').forEach(el=>el.addEventListener('click',()=>go(el.dataset.go)));
    document.querySelectorAll('[data-faq]').forEach(b=>b.onclick=()=>{faqOpen=faqOpen===Number(b.dataset.faq)?null:Number(b.dataset.faq);render()});
    document.querySelectorAll('[data-folder]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('[data-folder]').forEach(x=>x.classList.toggle('active',x===b));
      document.querySelectorAll('[data-folder-panel]').forEach(x=>x.classList.toggle('active',x.dataset.folderPanel===b.dataset.folder));
    });
    startSlides();
  }

  function render(){
    clearInterval(slideTimer);
    const r=route();
    document.body.className=`view-${r.view}${r.dir?' direction-'+r.dir:''}`;
    $('#app').innerHTML=r.view==='home'?home():r.view==='about'?about():r.view==='contacts'?contacts():direction(r);
    bind();
    const key=[r.view,r.dir,r.section,r.item].filter(Boolean).join('/');
    if(key!==lastTrackedRoute){lastTrackedRoute=key;window.SiteBackend.trackPageView(key)}
  }

  async function init(){
    try{
      const res=await window.SiteBackend.getContent(),raw=res.data||{};
      content=deepMerge(window.DEFAULT_SITE_CONTENT,raw);
      normalizeDirectionImages(content,raw);
      if(!res.configured)$('#setupNotice').classList.remove('hidden');
    }catch(e){
      console.error(e);
      normalizeDirectionImages(content,{});
      $('#setupNotice').classList.remove('hidden');
    }
    applyTheme();
    render();
    window.addEventListener('hashchange',render);
  }

  document.addEventListener('DOMContentLoaded',init,{once:true});
})();
