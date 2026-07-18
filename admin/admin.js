
(function(){
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)],esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=o=>JSON.parse(JSON.stringify(o)),deepMerge=(base,value)=>{if(Array.isArray(base))return Array.isArray(value)?value:base;if(base&&typeof base==='object'){const out={...base};if(value&&typeof value==='object')Object.keys(value).forEach(k=>out[k]=k in base?deepMerge(base[k],value[k]):value[k]);return out}return value===undefined?base:value};
  let data=clone(window.DEFAULT_SITE_CONTENT),dirty=false,currentDirection='school',currentSub='albums',captchaToken='',captchaWidgetId=null,lockTimer=null,pendingBackup=null,pendingPortableBackup=null,backupProgress=null,pendingStorageDeletes=new Set();
  const directionSections=['albums','preparation','process','questions','photos'];
  const directionSectionLabels={albums:'страницы «Виды альбомов»',preparation:'страницы «Подготовка»',process:'страницы «Процесс»',questions:'страницы «Вопросы»',photos:'страницы «Фото»'};
  const BACKUP_FORMAT='lena-sibirskaya-site-backup',BACKUP_VERSION=1,MAX_BACKUP_BYTES=5*1024*1024,MAX_CONTENT_BYTES=2*1024*1024;
  function hasOwn(obj,key){return Boolean(obj&&Object.prototype.hasOwnProperty.call(obj,key))}


  function normalizeDirectionStructure(target,raw){
    const version=Number(raw?.version||0);
    const albumTemplate={id:'',title:'',subtitle:'',price:'',text:'',cover:'',gallery:[]};
    const folderTemplate={id:'',title:'',images:[]};
    const questionTemplate={question:'',answer:''};
    Object.keys(target.directions||{}).forEach(key=>{
      const d=target.directions[key],defaults=window.DEFAULT_SITE_CONTENT.directions?.[key]||{};
      d.menuLabels=deepMerge(defaults.menuLabels||{},d.menuLabels||{});
      d.preparation=deepMerge(defaults.preparation||{title:'Подготовка',intro:'',body:''},d.preparation||{});
      d.process=deepMerge(defaults.process||{title:'Процесс',intro:'',body:''},d.process||{});
      d.questions=deepMerge(defaults.questions||{title:'Вопросы',intro:'',items:[]},d.questions||{});
      d.questions.items=Array.isArray(d.questions.items)?d.questions.items.map(q=>deepMerge(questionTemplate,q||{})):[];
      d.albums=Array.isArray(d.albums)?d.albums.map(a=>deepMerge(albumTemplate,a||{})):[];
      d.photoFolders=Array.isArray(d.photoFolders)?d.photoFolders.map(f=>deepMerge(folderTemplate,f||{})):[];
      d.albums.forEach((a,i)=>{if(!a.id)a.id=`${key}-album-${i+1}`;if(!Array.isArray(a.gallery))a.gallery=[]});
      d.photoFolders.forEach((f,i)=>{if(!f.id)f.id=`${key}-folder-${i+1}`;if(!Array.isArray(f.images))f.images=[]});
    });
    if(version<5){
      const school=target.directions?.school;
      if(school&&Array.isArray(school.albums)&&!school.albums.some(a=>a.id==='school-more')){
        school.albums.push({id:'school-more',title:'Больше разворотов',subtitle:'Индивидуальный объём',price:'',text:'',cover:'',gallery:[]});
      }
    }
    target.version=Math.max(Number(target.version)||0,5);
  }

  function normalizeDirectionImages(target,raw){
    normalizeDirectionStructure(target,raw);
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
      d.menuLabels=d.menuLabels||clone(window.DEFAULT_SITE_CONTENT.directions[key].menuLabels);
      d.photosSectionTitle=d.photosSectionTitle||d.menuLabels.photos||'Фото';
      if(!hasOwn(saved,'photosSectionIntro'))d.photosSectionIntro='';
    });
  }
  function directionImage(d,section='home'){if(section==='home'){if(hasOwn(d,'cardImage'))return d.cardImage||'';if(hasOwn(d?.pageImages,'home'))return d.pageImages.home||'';return d?.hero||''}if(hasOwn(d?.pageImages,section))return d.pageImages[section]||'';return d?.hero||''}
  const asset=u=>{if(!u)return '';const v=String(u).trim();if(/^https?:\/\//i.test(v))return v;if(/^assets\//i.test(v))return '../'+v.replace(/^\.\//,'');return ''};
  const uid=p=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)}
  function markDirty(){dirty=true;$('#savebar').classList.remove('hidden')}
  function clean(){dirty=false;$('#savebar').classList.add('hidden')}

  function bindInputs(root=document){
    $$('[data-path]',root).forEach(el=>{
      el.addEventListener('input',()=>{setPath(el.dataset.path,el.type==='number'?Number(el.value):el.value);markDirty()});
      el.addEventListener('change',()=>{setPath(el.dataset.path,el.type==='number'?Number(el.value):el.value);markDirty()});
    });
    bindRichEditors(root);
  }
  function setPath(path,value){const a=path.split('.');let x=data;for(let i=0;i<a.length-1;i++)x=x[a[i]];x[a.at(-1)]=value}
  function field(label,path,value,type='text',extra=''){return `<div class="field"><label>${label}</label>${type==='textarea'?`<textarea data-path="${path}" ${extra}>${esc(value)}</textarea>`:`<input data-path="${path}" type="${type}" value="${esc(value)}" ${extra}>`}</div>`}
  function sanitizeRich(value){
    const source=String(value??'').trim();
    if(!source)return '';
    if(!/<[a-z][\s\S]*>/i.test(source))return esc(source).replace(/\r?\n/g,'<br>');
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

  function richField(label,path,value,extra=''){
    return `<div class="field rich-field"><label>${label}</label><div class="rich-toolbar" aria-label="Форматирование текста"><button type="button" data-rich-command="bold" title="Жирный"><strong>Ж</strong></button><button type="button" data-rich-command="italic" title="Курсив"><em>К</em></button></div><div class="rich-editor" contenteditable="true" spellcheck="true" data-rich-path="${path}" ${extra}>${sanitizeRich(value)}</div><small class="muted">Выделите фразу и нажмите «Ж» или «К».</small></div>`;
  }

  function bindRichEditors(root=document){
    $$('[data-rich-path]',root).forEach(editor=>{
      const sync=()=>{setPath(editor.dataset.richPath,sanitizeRich(editor.innerHTML));markDirty()};
      editor.addEventListener('input',sync);
      editor.addEventListener('blur',sync);
    });
    $$('[data-rich-command]',root).forEach(button=>{
      button.addEventListener('mousedown',e=>{
        e.preventDefault();
        const field=button.closest('.rich-field'),editor=$('[data-rich-path]',field);
        editor.focus();
        document.execCommand(button.dataset.richCommand,false,null);
        editor.dispatchEvent(new Event('input',{bubbles:true}));
      });
    });
  }

  function imagePreview(url,tall=false,deleteAction=''){const has=Boolean(url);return `<div class="photo-preview-block"><div class="thumb ${tall?'tall':''} ${has?'':'empty'}">${has?`<img src="${esc(asset(url))}" alt="Предпросмотр">`:`<span>Фото не добавлено</span>`}</div>${has&&deleteAction?`<button type="button" class="btn small danger photo-delete" data-action="delete-single-image" data-photo-action="${esc(deleteAction)}">Удалить фото</button>`:''}</div>`}
  function uploadField(label,action,multiple=false){return `<div class="upload-box"><div class="muted" style="margin-bottom:8px">${label}</div><input type="file" accept="image/*" ${multiple?'multiple':''} data-upload="${action}"></div>`}
  function imageReferenceCount(value,url,depth=0){if(!url||depth>80||value==null)return 0;if(typeof value==='string')return value===url?1:0;if(Array.isArray(value))return value.reduce((sum,item)=>sum+imageReferenceCount(item,url,depth+1),0);if(typeof value==='object')return Object.values(value).reduce((sum,item)=>sum+imageReferenceCount(item,url,depth+1),0);return 0}
  function queueStorageDelete(url){if(url)pendingStorageDeletes.add(String(url))}
  async function cleanupQueuedImages(){const failed=[];for(const url of [...pendingStorageDeletes]){if(imageReferenceCount(data,url)>0){pendingStorageDeletes.delete(url);continue}try{await SiteBackend.deleteImage(url);pendingStorageDeletes.delete(url)}catch(error){failed.push(error?.message||String(error))}}return failed}
  function queueAlbumImages(album){if(!album)return;queueStorageDelete(album.cover);(album.gallery||[]).forEach(queueStorageDelete)}
  function queueFolderImages(folder){(folder?.images||[]).forEach(queueStorageDelete)}

  function renderGeneral(){
    const p=$('#panel-general');
    p.innerHTML=`<h2>Главная страница</h2><div class="card"><h3>Название сайта и слоган</h3>${field('Верхняя строка','brandTop',data.brandTop)}${field('Имя фотографа','brandBottom',data.brandBottom)}${field('Город под именем фотографа','brandCity',data.brandCity||'')}${field('Фраза на главной','homeSlogan',data.homeSlogan,'textarea')}</div><div class="card"><h3>Ссылки</h3>${field('Клипы VK','videoUrl',data.videoUrl,'url')}</div><p class="muted">Ссылки на админку на основном сайте отсутствуют. Адрес админки открывается вручную: <code>/admin/</code>.</p>`;
    bindInputs(p);
  }
  function renderLabels(){
    const p=$('#panel-labels'),l=data.labels;
    p.innerHTML=`<h2>Надписи и кнопки</h2><div class="card"><h3>Верхнее меню</h3><div class="grid-2">${field('Кнопка «Обо мне»','labels.navAbout',l.navAbout)}${field('Кнопка «Контакты»','labels.navContacts',l.navContacts)}</div></div><div class="card"><h3>Кнопки разделов</h3><div class="grid-2">${field('Видеообзоры','labels.videoReviews',l.videoReviews)}${field('Обсудить съёмку','labels.discussShoot',l.discussShoot)}${field('На главную','labels.home',l.home)}${field('Назад к альбомам','labels.backAlbums',l.backAlbums)}</div></div><div class="card"><h3>Кнопки контактов</h3><div class="grid-2">${field('ВКонтакте','labels.contactVk',l.contactVk)}${field('MAX','labels.contactMax',l.contactMax)}</div></div><div class="card"><h3>Служебные сообщения сайта</h3>${field('Альбом не найден','labels.albumNotFound',l.albumNotFound)}${field('Пустая текстовая страница','labels.textComing',l.textComing)}${field('Нет вопросов','labels.questionsComing',l.questionsComing)}${field('Нет фотографий','labels.photosComing',l.photosComing)}</div><p class="muted">Названия кнопок «Виды альбомов», «Подготовка», «Процесс», «Вопросы» и «Фото» редактируются отдельно для школы и детского сада в разделе «Школа и сад».</p>`;
    bindInputs(p);
  }

  function renderDirectionButtons(){return `<div class="section-select"><button data-dir="school" class="${currentDirection==='school'?'active':''}">Начальная школа</button><button data-dir="kindergarten" class="${currentDirection==='kindergarten'?'active':''}">Детский сад</button></div><div class="section-select">${[['albums','Альбомы'],['preparation','Подготовка'],['process','Процесс'],['questions','Вопросы'],['photos','Фото']].map(([id,t])=>`<button data-sub="${id}" class="${currentSub===id?'active':''}">${t}</button>`).join('')}</div>`}
  function pageImageEditor(d){const label=directionSectionLabels[currentSub]||'текущей страницы',url=directionImage(d,currentSub);return `<div class="card"><h3>Фото ${label}</h3><p class="muted">Это изображение используется только в выбранном разделе и не меняет фотографии остальных страниц.</p><div class="grid-2"><div>${imagePreview(url,true,`direction-page-image:${currentSub}`)}</div><div>${uploadField('Заменить фото только для этой страницы',`direction-page-image:${currentSub}`)}</div></div></div>`}

  function renderDirections(){
    const p=$('#panel-directions'),d=data.directions[currentDirection],m=d.menuLabels||{};
    let body=`<h2>Школа и детский сад</h2>${renderDirectionButtons()}<div class="card"><h3>Общие настройки направления</h3><div class="grid-2"><div>${field('Название',`directions.${currentDirection}.title`,d.title)}${field('Подзаголовок',`directions.${currentDirection}.subtitle`,d.subtitle,'textarea')}</div><div>${imagePreview(directionImage(d,'home'),false,'direction-card-image')}${uploadField('Фото карточки направления на главной странице','direction-card-image')}<p class="muted">Это отдельное фото только для главной страницы. Загрузка фотографий в разделах его не меняет.</p></div></div></div><div class="card"><h3>Надписи на кнопках этого направления</h3><div class="grid-3">${field('Альбомы',`directions.${currentDirection}.menuLabels.albums`,m.albums)}${field('Подготовка',`directions.${currentDirection}.menuLabels.preparation`,m.preparation)}${field('Процесс',`directions.${currentDirection}.menuLabels.process`,m.process)}${field('Вопросы',`directions.${currentDirection}.menuLabels.questions`,m.questions)}${field('Фото',`directions.${currentDirection}.menuLabels.photos`,m.photos)}</div></div>${pageImageEditor(d)}`;
    if(currentSub==='albums')body+=albumsEditor(d);
    if(currentSub==='preparation'||currentSub==='process')body+=textEditor(d,currentSub);
    if(currentSub==='questions')body+=faqEditor(d);
    if(currentSub==='photos')body+=photosEditor(d);
    p.innerHTML=body;
    bindInputs(p);
    bindDirectionActions(p);
    bindSortableImages(p);
  }

  function albumsEditor(d){
    return `<div class="card"><h3>Заголовок раздела альбомов</h3>${field('Заголовок',`directions.${currentDirection}.albumsSectionTitle`,d.albumsSectionTitle||d.menuLabels?.albums||'Виды альбомов')}${richField('Пояснение под заголовком',`directions.${currentDirection}.albumsSectionIntro`,d.albumsSectionIntro||'')}<p class="muted">Пояснение отображается под заголовком во всю ширину строки. Чтобы убрать его, полностью очистите поле.</p></div><div class="card"><div class="item-head"><h3 style="margin:0;flex:1">Альбомы</h3><button class="btn small" data-action="add-album">Добавить альбом</button></div><div class="item-list">${d.albums.map((a,i)=>`<article class="item" data-album-index="${i}"><div class="item-head"><strong>${esc(a.title||'Без названия')}</strong><button class="btn small danger" data-action="delete-album" data-index="${i}">Удалить</button></div><div class="grid-2"><div>${field('Название',`directions.${currentDirection}.albums.${i}.title`,a.title)}${field('Подпись',`directions.${currentDirection}.albums.${i}.subtitle`,a.subtitle)}${field('Стоимость',`directions.${currentDirection}.albums.${i}.price`,a.price||'')}${richField('Основной текст',`directions.${currentDirection}.albums.${i}.text`,a.text,'style="min-height:180px"')}</div><div>${imagePreview(a.cover,false,`album-cover:${i}`)}${uploadField('Заменить обложку',`album-cover:${i}`)}</div></div><h4>Фотографии альбома</h4><p class="muted">На компьютере фотографии можно перетаскивать мышью. На смартфоне используйте стрелки.</p>${imageList(a.gallery||[],`album-gallery:${i}`)}${uploadField('Добавить фотографии',`album-gallery-add:${i}`,true)}</article>`).join('')}</div></div>`;
  }

  function textEditor(d,k){
    const s=d[k];
    return `<div class="card"><h3>${k==='preparation'?'Подготовка':'Процесс'}</h3>${field('Заголовок',`directions.${currentDirection}.${k}.title`,s.title)}${richField('Вступление',`directions.${currentDirection}.${k}.intro`,s.intro)}${richField('Основной текст',`directions.${currentDirection}.${k}.body`,s.body,'style="min-height:260px"')}</div>`;
  }

  function faqEditor(d){
    const s=d.questions;
    return `<div class="card"><h3>Настройки раздела</h3>${field('Заголовок',`directions.${currentDirection}.questions.title`,s.title)}${richField('Вступление',`directions.${currentDirection}.questions.intro`,s.intro)}</div><div class="card"><div class="item-head"><h3 style="margin:0;flex:1">Вопросы и ответы</h3><button class="btn small" data-action="add-faq">Добавить вопрос</button></div><div class="item-list">${(s.items||[]).map((q,i)=>`<article class="item"><div class="item-head"><strong>Вопрос ${i+1}</strong><button class="btn small" data-action="move-faq" data-index="${i}" data-delta="-1">↑</button><button class="btn small" data-action="move-faq" data-index="${i}" data-delta="1">↓</button><button class="btn small danger" data-action="delete-faq" data-index="${i}">Удалить</button></div>${field('Вопрос',`directions.${currentDirection}.questions.items.${i}.question`,q.question,'textarea')}${richField('Ответ',`directions.${currentDirection}.questions.items.${i}.answer`,q.answer)}</article>`).join('')}</div></div>`;
  }

  function photosEditor(d){
    return `<div class="card"><h3>Заголовок раздела фотографий</h3>${field('Заголовок',`directions.${currentDirection}.photosSectionTitle`,d.photosSectionTitle||d.menuLabels?.photos||'Фото')}${richField('Пояснение под заголовком',`directions.${currentDirection}.photosSectionIntro`,d.photosSectionIntro||'')}<p class="muted">Фраза «Выберите подборку» удалена. Здесь можно оставить поле пустым или написать собственное пояснение.</p></div><div class="card"><div class="item-head"><h3 style="margin:0;flex:1">Подпапки фотографий</h3><button class="btn small" data-action="add-folder">Добавить подпапку</button></div><p class="muted">На компьютере фотографии можно перетаскивать мышью. На смартфоне используйте стрелки.</p><div class="item-list">${(d.photoFolders||[]).map((f,i)=>`<article class="item"><div class="item-head"><strong>${esc(f.title)}</strong><button class="btn small danger" data-action="delete-folder" data-index="${i}">Удалить</button></div>${field('Название подпапки',`directions.${currentDirection}.photoFolders.${i}.title`,f.title)}${imageList(f.images||[],`folder-images:${i}`)}${uploadField('Добавить фотографии в подпапку',`folder-images-add:${i}`,true)}</article>`).join('')}</div></div>`;
  }

  function imageList(list,scope){
    return list.length?`<div class="image-list" data-image-list="${esc(scope)}">${list.map((u,i)=>`<div class="image-item" draggable="true" data-sort-scope="${esc(scope)}" data-sort-index="${i}"><img src="${esc(asset(u))}" alt="Фото"><div class="image-controls"><button type="button" data-action="move-image" data-scope="${esc(scope)}" data-index="${i}" data-delta="-1" aria-label="Переместить влево" title="Переместить влево">←</button><button type="button" data-action="move-image" data-scope="${esc(scope)}" data-index="${i}" data-delta="1" aria-label="Переместить вправо" title="Переместить вправо">→</button><button type="button" class="delete" data-action="delete-image" data-scope="${esc(scope)}" data-index="${i}" aria-label="Удалить фото" title="Удалить фото">×</button></div><span class="drag-hint" aria-hidden="true">⋮⋮</span></div>`).join('')}</div>`:`<p class="muted">Фотографий пока нет.</p>`;
  }
  function imageArray(scope){
    const [kind,index]=String(scope||'').split(':');
    if(kind==='about-slides')return data.about.slides;
    const d=data.directions[currentDirection];
    if(kind==='album-gallery')return d.albums[Number(index)]?.gallery;
    if(kind==='folder-images')return d.photoFolders[Number(index)]?.images;
    return null;
  }

  function reorderImage(scope,from,to){
    const arr=imageArray(scope);
    if(!arr||from===to||from<0||to<0||from>=arr.length||to>=arr.length)return false;
    const [item]=arr.splice(from,1);
    arr.splice(to,0,item);
    return true;
  }

  function bindSortableImages(root){
    $$('[data-sort-scope]',root).forEach(item=>{
      item.addEventListener('dragstart',e=>{
        e.dataTransfer.effectAllowed='move';
        e.dataTransfer.setData('text/plain',JSON.stringify({scope:item.dataset.sortScope,index:Number(item.dataset.sortIndex)}));
        item.classList.add('dragging');
      });
      item.addEventListener('dragend',()=>item.classList.remove('dragging'));
      item.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move'});
      item.addEventListener('drop',e=>{
        e.preventDefault();
        try{
          const from=JSON.parse(e.dataTransfer.getData('text/plain')||'{}'),scope=item.dataset.sortScope,to=Number(item.dataset.sortIndex);
          if(from.scope===scope&&reorderImage(scope,Number(from.index),to)){
            markDirty();
            scope.startsWith('about-')?renderAbout():renderDirections();
          }
        }catch(_){}
      });
    });
  }


  function bindDirectionActions(p){
    $$('[data-dir]',p).forEach(b=>b.onclick=()=>{currentDirection=b.dataset.dir;renderDirections()});
    $$('[data-sub]',p).forEach(b=>b.onclick=()=>{currentSub=b.dataset.sub;renderDirections()});
    $$('[data-action]',p).forEach(b=>b.onclick=()=>handleAction(b));
    $$('[data-upload]',p).forEach(inp=>inp.onchange=()=>handleUpload(inp));
  }

  async function handleAction(b){
    const d=data.directions[currentDirection],i=Number(b.dataset.index),action=b.dataset.action;
    if(action==='add-album')d.albums.push({id:uid(currentDirection),title:'Новый альбом',subtitle:'',price:'',text:'',cover:'',gallery:[]});
    if(action==='delete-album'){
      if(!confirm('Удалить альбом, его обложку и все фотографии?'))return;
      queueAlbumImages(d.albums[i]);d.albums.splice(i,1);
    }
    if(action==='add-faq')d.questions.items.push({question:'Новый вопрос',answer:''});
    if(action==='delete-faq')d.questions.items.splice(i,1);
    if(action==='move-faq'){
      const ni=i+Number(b.dataset.delta);
      if(ni>=0&&ni<d.questions.items.length)[d.questions.items[i],d.questions.items[ni]]=[d.questions.items[ni],d.questions.items[i]];
    }
    if(action==='add-folder')d.photoFolders.push({id:uid(currentDirection+'-photos'),title:'Новая подпапка',images:[]});
    if(action==='delete-folder'){
      if(!confirm('Удалить подпапку и все фотографии в ней?'))return;
      queueFolderImages(d.photoFolders[i]);d.photoFolders.splice(i,1);
    }
    if(action==='move-image'){
      const arr=imageArray(b.dataset.scope),to=i+Number(b.dataset.delta);
      if(!arr||to<0||to>=arr.length)return;
      reorderImage(b.dataset.scope,i,to);
    }
    if(action==='delete-image'){
      if(!confirm('Удалить эту фотографию?'))return;
      const arr=imageArray(b.dataset.scope),old=arr?.[i];
      if(!arr)return;
      arr.splice(i,1);queueStorageDelete(old);
    }
    if(action==='delete-single-image'){
      if(!confirm('Удалить эту фотографию с сайта?'))return;
      const parts=String(b.dataset.photoAction||'').split(':'),kind=parts[0];
      if(kind==='direction-card-image'){
        queueStorageDelete(d.cardImage);
        if(d.pageImages&&hasOwn(d.pageImages,'home'))queueStorageDelete(d.pageImages.home);
        d.cardImage='';
        if(d.pageImages&&hasOwn(d.pageImages,'home'))d.pageImages.home='';
      }
      if(kind==='direction-page-image'){
        const section=directionSections.includes(parts[1])?parts[1]:currentSub;
        d.pageImages=d.pageImages||{};
        queueStorageDelete(d.pageImages[section]);d.pageImages[section]='';
      }
      if(kind==='album-cover'){
        const album=d.albums[Number(parts[1])];
        queueStorageDelete(album?.cover);
        if(album)album.cover='';
      }
    }
    markDirty();
    renderDirections();
  }
  async function handleUpload(inp){const files=[...inp.files];if(!files.length)return;inp.disabled=true;toast('Загрузка…');try{const a=inp.dataset.upload.split(':'),d=data.directions[currentDirection];if(a[0]==='direction-card-image'){const old=d.cardImage,oldHome=d.pageImages?.home,url=await SiteBackend.uploadImage(files[0],`${currentDirection}/card`);d.cardImage=url;if(d.pageImages&&hasOwn(d.pageImages,'home'))d.pageImages.home=url;if(old&&old!==url)queueStorageDelete(old);if(oldHome&&oldHome!==old&&oldHome!==url)queueStorageDelete(oldHome)}if(a[0]==='direction-page-image'){const section=directionSections.includes(a[1])?a[1]:'albums',old=d.pageImages?.[section],url=await SiteBackend.uploadImage(files[0],`${currentDirection}/pages/${section}`);d.pageImages=d.pageImages||{};d.pageImages[section]=url;if(old&&old!==url)queueStorageDelete(old)}if(a[0]==='album-cover'){const album=d.albums[Number(a[1])],old=album.cover,url=await SiteBackend.uploadImage(files[0],`${currentDirection}/albums/${album.id}`);album.cover=url;if(old&&old!==url)queueStorageDelete(old)}if(a[0]==='album-gallery-add'){for(const f of files)d.albums[Number(a[1])].gallery.push(await SiteBackend.uploadImage(f,`${currentDirection}/albums/${d.albums[Number(a[1])].id}/gallery`))}if(a[0]==='folder-images-add'){for(const f of files)d.photoFolders[Number(a[1])].images.push(await SiteBackend.uploadImage(f,`${currentDirection}/photos/${d.photoFolders[Number(a[1])].id}`))}markDirty();renderDirections();toast('Фотографии загружены')}catch(e){toast('Ошибка загрузки: '+e.message)}finally{inp.disabled=false}}

  function renderAbout(){
    const p=$('#panel-about'),a=data.about;
    p.innerHTML=`<h2>Обо мне</h2><div class="card">${field('Заголовок','about.title',a.title)}${richField('Основной текст','about.text',a.text,'style="min-height:220px"')}${field('Интервал слайд-шоу, секунд','about.slideInterval',a.slideInterval,'number','min="2" max="20"')}</div><div class="card"><h3>Фотографии слайд-шоу</h3><p class="muted">На компьютере фотографии можно перетаскивать мышью. На смартфоне используйте стрелки.</p>${imageList(a.slides||[],'about-slides:0')}${uploadField('Добавить фотографии',`about-add`,true)}</div>`;
    bindInputs(p);
    $$('[data-action]',p).forEach(b=>b.onclick=()=>{
      const i=Number(b.dataset.index),action=b.dataset.action;
      if(action==='delete-image'){
        if(!confirm('Удалить эту фотографию из слайд-шоу?'))return;
        const old=a.slides[i];a.slides.splice(i,1);queueStorageDelete(old);
      }
      if(action==='move-image'){
        const to=i+Number(b.dataset.delta);
        if(to<0||to>=a.slides.length)return;
        reorderImage(b.dataset.scope,i,to);
      }
      markDirty();renderAbout();
    });
    bindSortableImages(p);
    $$('[data-upload]',p).forEach(inp=>inp.onchange=async()=>{
      try{
        for(const f of inp.files)a.slides.push(await SiteBackend.uploadImage(f,'about'));
        markDirty();renderAbout();toast('Фотографии загружены');
      }catch(e){toast(e.message)}
    });
  }

  function renderContacts(){
    const p=$('#panel-contacts'),c=data.contacts;
    p.innerHTML=`<h2>Контакты</h2><div class="card">${field('Заголовок','contacts.title',c.title)}${richField('Основной текст','contacts.text',c.text)}${field('Ссылка VK','contacts.vk',c.vk,'url')}${field('Ссылка MAX','contacts.max',c.max,'url')}</div>`;
    bindInputs(p);
  }
  function renderDesign(){const p=$('#panel-design'),t=data.theme,colors=[['Фон','bg'],['Основной текст','ink'],['Дополнительный текст','muted'],['Линии','line'],['Мягкая подложка','surface'],['Кнопки','button'],['Активная кнопка','active']];p.innerHTML=`<h2>Дизайн и шрифты</h2><div class="card"><h3>Цвета</h3><div class="grid-2">${colors.map(([l,k])=>`<div class="field"><label>${l}</label><div class="color-row"><input data-path="theme.${k}" value="${esc(t[k])}"><input type="color" value="${esc(t[k])}" data-color-sync="theme.${k}"></div></div>`).join('')}</div></div><div class="card"><h3>Шрифты</h3>${field('Основной шрифт','theme.bodyFont',t.bodyFont)}${field('Шрифт заголовков','theme.headingFont',t.headingFont)}<div class="grid-3">${field('Основной размер, px','theme.baseSize',t.baseSize,'number')}${field('Бренд, px','theme.brandSize',t.brandSize,'number')}${field('Меню, px','theme.navSize',t.navSize,'number')}${field('Главный слоган, px','theme.homeTitleSize',t.homeTitleSize,'number')}${field('Название направления, px','theme.directionTitleSize',t.directionTitleSize,'number')}${field('Подзаголовок направления, px','theme.directionSubtitleSize',t.directionSubtitleSize,'number','min="9" max="32"')}${field('Заголовок страницы, px','theme.pageTitleSize',t.pageTitleSize,'number')}${field('Заголовок раздела, px','theme.sectionTitleSize',t.sectionTitleSize,'number')}${field('Заголовок карточки, px','theme.cardTitleSize',t.cardTitleSize,'number')}${field('Межбуквенный интервал текста, px','theme.bodyLetterSpacing',t.bodyLetterSpacing,'number','step="0.1"')}${field('Межбуквенный интервал заголовков, px','theme.headingLetterSpacing',t.headingLetterSpacing,'number','step="0.1"')}${field('Межбуквенный интервал меню, px','theme.navLetterSpacing',t.navLetterSpacing,'number','step="0.1"')}${field('Межстрочный интервал','theme.lineHeight',t.lineHeight,'number','step="0.05"')}</div></div><p class="muted">Эти значения используются одной системой CSS-переменных и одинаково применяются на десктопе, Android и iOS. На узких экранах меняется только адаптивный масштаб крупных заголовков.</p>`;bindInputs(p);$$('[data-color-sync]',p).forEach(c=>c.oninput=()=>{const text=$(`[data-path="${c.dataset.colorSync}"]`,p);text.value=c.value;text.dispatchEvent(new Event('input',{bubbles:true}))})}


  function checksumText(text){let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return(hash>>>0).toString(16).padStart(8,'0')}
  function backupSummary(content){const directions=Object.values(content?.directions||{}),albums=directions.reduce((sum,d)=>sum+(Array.isArray(d?.albums)?d.albums.length:0),0),questions=directions.reduce((sum,d)=>sum+(Array.isArray(d?.questions?.items)?d.questions.items.length:0),0),images=new Set();const walk=(value,depth=0)=>{if(depth>60||value==null)return;if(typeof value==='string'){if(/(?:\/storage\/v1\/object\/|\.(?:jpe?g|png|webp)(?:[?#]|$))/i.test(value))images.add(value);return}if(Array.isArray(value)){value.forEach(v=>walk(v,depth+1));return}if(typeof value==='object')Object.values(value).forEach(v=>walk(v,depth+1))};walk(content);return{directions:directions.length,albums,questions,images:images.size}}
  function makeBackupPayload(content=data){const safe=clone(content),contentText=JSON.stringify(safe),summary=backupSummary(safe);return{format:BACKUP_FORMAT,version:BACKUP_VERSION,createdAt:new Date().toISOString(),site:'Лена Сибирская',summary,checksum:checksumText(contentText),data:safe}}
  function backupFileName(prefix='backup'){const d=new Date(),pad=n=>String(n).padStart(2,'0');return`lena-sibirskaya-${prefix}-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.json`}
  function downloadJson(payload,filename){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
  function downloadBackup(prefix='backup'){downloadJson(makeBackupPayload(data),backupFileName(prefix));toast('Быстрая резервная копия скачана')}
  function sanitizeBackupValue(value,state={nodes:0},depth=0){state.nodes++;if(state.nodes>100000)throw new Error('В резервной копии слишком много элементов');if(depth>60)throw new Error('Слишком большая вложенность резервной копии');if(value===null||typeof value==='string'||typeof value==='boolean')return value;if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('В копии найдено некорректное число');return value}if(Array.isArray(value))return value.map(v=>sanitizeBackupValue(v,state,depth+1));if(typeof value==='object'){const out={};for(const [key,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))continue;out[key]=sanitizeBackupValue(item,state,depth+1)}return out}throw new Error('Резервная копия содержит неподдерживаемые данные')}
  function validateRestoredContent(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('В файле отсутствуют данные сайта');const sanitized=sanitizeBackupValue(value),size=new Blob([JSON.stringify(sanitized)]).size;if(size>MAX_CONTENT_BYTES)throw new Error('Данные сайта в копии превышают 2 МБ');const restored=deepMerge(window.DEFAULT_SITE_CONTENT,sanitized);if(!restored.directions?.school||!restored.directions?.kindergarten)throw new Error('В копии отсутствуют разделы школы или детского сада');for(const key of ['school','kindergarten']){const d=restored.directions[key];if(!Array.isArray(d.albums)||!Array.isArray(d.photoFolders)||!Array.isArray(d.questions?.items))throw new Error(`Повреждена структура направления: ${key}`)}normalizeDirectionImages(restored,sanitized);return restored}
  async function parseBackupFile(file){if(!(file instanceof File))throw new Error('Файл не выбран');if(!/\.json$/i.test(file.name))throw new Error('Выберите резервную копию в формате JSON');if(!file.size||file.size>MAX_BACKUP_BYTES)throw new Error('Размер резервной копии не должен превышать 5 МБ');let payload;try{payload=JSON.parse(await file.text())}catch(_){throw new Error('Не удалось прочитать JSON-файл')}if(!payload||payload.format!==BACKUP_FORMAT)throw new Error('Это не резервная копия данного сайта');if(Number(payload.version)!==BACKUP_VERSION)throw new Error(`Версия резервной копии ${payload.version||'не указана'} не поддерживается`);const expected=String(payload.checksum||''),actual=checksumText(JSON.stringify(payload.data));if(expected&&expected!==actual)throw new Error('Контрольная сумма не совпала: файл повреждён или изменён');const restored=validateRestoredContent(payload.data);return{payload,restored,fileName:file.name,summary:backupSummary(restored)}}
  function formatBackupDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?'дата не указана':d.toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})}
  function humanBytes(value){const n=Math.max(0,Number(value)||0);if(n<1024)return`${n} Б`;if(n<1024*1024)return`${(n/1024).toFixed(n<10240?1:0)} КБ`;if(n<1024*1024*1024)return`${(n/1024/1024).toFixed(n<10*1024*1024?1:0)} МБ`;return`${(n/1024/1024/1024).toFixed(2)} ГБ`}
  function progressMarkup(){if(!backupProgress)return'<div class="backup-progress hidden" id="backupProgress"></div>';const p=backupProgress,total=Math.max(0,Number(p.total)||0),current=Math.max(0,Number(p.current)||0),percent=total?Math.min(100,Math.round(current/total*100)):0;return`<div class="backup-progress" id="backupProgress"><div class="backup-progress-head"><span>${esc(p.text||'Выполнение операции')}</span><strong>${percent}%</strong></div><div class="backup-progress-track"><i style="width:${percent}%"></i></div><small>Не закрывайте страницу до завершения операции.</small></div>`}
  function updateBackupProgress(progress){backupProgress=progress||null;const box=$('#backupProgress');if(!box)return;if(!backupProgress){box.classList.add('hidden');box.innerHTML='';return}const p=backupProgress,total=Math.max(0,Number(p.total)||0),current=Math.max(0,Number(p.current)||0),percent=total?Math.min(100,Math.round(current/total*100)):0;box.classList.remove('hidden');box.innerHTML=`<div class="backup-progress-head"><span>${esc(p.text||'Выполнение операции')}</span><strong>${percent}%</strong></div><div class="backup-progress-track"><i style="width:${percent}%"></i></div><small>Не закрывайте страницу до завершения операции.</small>`}
  function backupPreview(){if(!pendingBackup)return'';const b=pendingBackup,s=b.summary||{};return`<div class="backup-preview"><div class="backup-preview-head"><strong>JSON-копия готова к восстановлению</strong><span>${esc(b.fileName)}</span></div><div class="backup-metrics"><div><span>Создана</span><strong>${esc(formatBackupDate(b.payload.createdAt))}</strong></div><div><span>Альбомы</span><strong>${Number(s.albums)||0}</strong></div><div><span>Вопросы</span><strong>${Number(s.questions)||0}</strong></div><div><span>Ссылки на фото</span><strong>${Number(s.images)||0}</strong></div></div><div class="backup-actions"><button class="btn primary" id="restoreBackupBtn">Восстановить JSON-копию</button><button class="btn" id="cancelBackupBtn">Отменить</button></div></div>`}
  function portablePreview(){if(!pendingPortableBackup)return'';const b=pendingPortableBackup,s=b.summary||{},m=b.manifest||{};return`<div class="backup-preview portable"><div class="backup-preview-head"><strong>Полная ZIP-копия проверена</strong><span>${esc(b.fileName)}</span></div><div class="backup-metrics"><div><span>Создана</span><strong>${esc(formatBackupDate(m.createdAt))}</strong></div><div><span>Фотографии</span><strong>${Number(s.mediaCount)||0}</strong></div><div><span>Размер фото</span><strong>${esc(humanBytes(s.mediaBytes))}</strong></div><div><span>Файлы сайта</span><strong>${Number(s.projectFiles)||0}</strong></div></div><div class="backup-actions"><button class="btn primary" id="restoreFullBackupBtn">Загрузить фото и восстановить сайт</button><button class="btn" id="cancelFullBackupBtn">Отменить</button></div></div>`}
  async function createFullBackup(){if(!window.PortableBackup){toast('Модуль полного бекапа не загружен');return}const button=$('#downloadFullBackupBtn');if(button)button.disabled=true;try{updateBackupProgress({current:0,total:1,text:'Подготовка полного архива'});const result=await PortableBackup.create(data,{onProgress:updateBackupProgress});PortableBackup.download(result.blob,result.fileName);toast(`Полная копия скачана: ${result.summary.mediaCount} фото, ${humanBytes(result.summary.zipBytes)}`)}catch(err){toast('Ошибка полного бекапа: '+err.message)}finally{updateBackupProgress(null);if(button)button.disabled=false}}
  async function restoreFullBackup(){if(!pendingPortableBackup)return;const b=pendingPortableBackup,created=formatBackupDate(b.manifest?.createdAt),count=Number(b.summary?.mediaCount)||0;if(!confirm(`Восстановить полную копию от ${created}?\n\nБудет загружено фотографий: ${count}. Текущий контент будет заменён.`))return;const button=$('#restoreFullBackupBtn');if(button)button.disabled=true;const uploaded=[];try{downloadJson(makeBackupPayload(data),backupFileName('before-full-restore'));const replacements=new Map(),folder=`restored/${new Date().toISOString().slice(0,10)}`;for(let i=0;i<b.media.length;i++){const item=b.media[i],name=item.file.split('/').pop()||`image-${i+1}.jpg`;updateBackupProgress({current:i,total:b.media.length,text:`Загрузка фотографии ${i+1} из ${b.media.length} в новый Storage`});const file=new File([item.bytes],name,{type:item.mime||'image/jpeg',lastModified:Date.now()}),url=await SiteBackend.uploadImage(file,folder);uploaded.push(url);item.references.forEach(ref=>replacements.set(ref,url))}updateBackupProgress({current:b.media.length,total:b.media.length,text:'Публикация восстановленного контента'});const rewritten=PortableBackup.replaceReferences(b.content,replacements),restored=validateRestoredContent(rewritten);await SiteBackend.saveContent(restored);data=clone(restored);normalizeDirectionImages(data,data);pendingStorageDeletes.clear();pendingPortableBackup=null;clean();updateBackupProgress(null);renderBackup();toast('Полная копия восстановлена, фотографии перенесены')}catch(err){for(const url of uploaded.reverse()){try{await SiteBackend.deleteImage(url)}catch(_){}}updateBackupProgress(null);toast('Ошибка полного восстановления: '+err.message);if(button)button.disabled=false}}
  function renderBackup(){const p=$('#panel-backup');p.innerHTML=`<h2>Резервные копии</h2><div class="card backup-primary-card"><div class="backup-title-row"><div><h3>Полная переносимая копия с фотографиями</h3><p>Создаёт ZIP-архив с контентом, всеми используемыми фотографиями, файлами сайта, админкой и SQL-схемами. Такой архив можно восстановить в другом проекте Supabase и на другом хостинге.</p></div><span class="backup-badge">Рекомендуется</span></div><div class="backup-actions"><button class="btn primary" id="downloadFullBackupBtn">Скачать полный ZIP с фото</button></div><p class="muted">Перед созданием желательно сохранить изменения. Размер ZIP примерно равен суммарному размеру всех фотографий. На смартфоне большой архив может потребовать много памяти.</p>${progressMarkup()}</div><div class="card"><h3>Восстановить полную ZIP-копию</h3><p>На новом сайте сначала настройте Supabase и войдите в админку, затем выберите ZIP. Фотографии автоматически загрузятся в новый Storage, а их адреса будут заменены в контенте.</p><div class="backup-file"><input type="file" id="fullBackupFileInput" accept="application/zip,.zip"><small>Поддерживается ZIP, созданный этой версией админки. Максимальный технический размер — 2 ГБ.</small></div>${portablePreview()}<div class="backup-warning"><strong>Важно:</strong> восстановление может занять несколько минут. Не закрывайте вкладку и не блокируйте смартфон до завершения.</div></div><details class="backup-secondary"><summary>Быстрая JSON-копия без фотографий</summary><div class="card"><h3>Создать JSON-копию</h3><p>Сохраняет тексты, настройки, альбомы и адреса изображений, но не сами файлы фотографий.</p><div class="backup-actions"><button class="btn" id="downloadBackupBtn">Скачать JSON-копию</button></div></div><div class="card"><h3>Восстановить JSON-копию</h3><div class="backup-file"><input type="file" id="backupFileInput" accept="application/json,.json"><small>Максимальный размер файла — 5 МБ.</small></div>${backupPreview()}</div></details>`;$('#downloadFullBackupBtn').onclick=createFullBackup;$('#fullBackupFileInput').onchange=async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{updateBackupProgress({current:0,total:1,text:'Проверка полной ZIP-копии'});pendingPortableBackup=await PortableBackup.parse(file,{onProgress:updateBackupProgress});updateBackupProgress(null);renderBackup();toast('Полная ZIP-копия проверена')}catch(err){pendingPortableBackup=null;updateBackupProgress(null);input.value='';toast('Ошибка ZIP-копии: '+err.message)}};$('#downloadBackupBtn').onclick=()=>downloadBackup('backup');$('#backupFileInput').onchange=async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;try{pendingBackup=await parseBackupFile(file);renderBackup();toast('JSON-копия проверена')}catch(err){pendingBackup=null;input.value='';toast('Ошибка копии: '+err.message)}};const restore=$('#restoreBackupBtn'),cancel=$('#cancelBackupBtn'),restoreFull=$('#restoreFullBackupBtn'),cancelFull=$('#cancelFullBackupBtn');if(cancel)cancel.onclick=()=>{pendingBackup=null;renderBackup()};if(restore)restore.onclick=restoreBackup;if(cancelFull)cancelFull.onclick=()=>{pendingPortableBackup=null;renderBackup()};if(restoreFull)restoreFull.onclick=restoreFullBackup}
  async function restoreBackup(){if(!pendingBackup)return;const created=formatBackupDate(pendingBackup.payload.createdAt);if(!confirm(`Восстановить резервную копию от ${created}?\n\nТекущий контент будет полностью заменён.`))return;const button=$('#restoreBackupBtn');button.disabled=true;try{downloadJson(makeBackupPayload(data),backupFileName('before-restore'));await SiteBackend.saveContent(pendingBackup.restored);data=clone(pendingBackup.restored);normalizeDirectionImages(data,data);pendingStorageDeletes.clear();pendingBackup=null;clean();renderBackup();toast('Сайт восстановлен и опубликован')}catch(err){toast('Ошибка восстановления: '+err.message);button.disabled=false}}

  function plural(n,forms){const value=Math.abs(Number(n)||0)%100,last=value%10;return forms[value>10&&value<20?2:last===1?0:last>=2&&last<=4?1:2]}
  function formatStatDate(value){const parts=String(value||'').split('-');return parts.length===3?`${parts[2]}.${parts[1]}`:String(value||'')}
  function statBars(rows,labelKey,valueKey,formatLabel=v=>v){const max=Math.max(1,...rows.map(x=>Number(x[valueKey])||0));return rows.length?`<div class="stat-bars">${rows.map(x=>{const value=Number(x[valueKey])||0,pct=Math.max(3,Math.round(value/max*100)),label=formatLabel(x[labelKey]);return `<div class="stat-row"><span title="${esc(label)}">${esc(label)}</span><div class="stat-track"><i style="width:${pct}%"></i></div><strong>${value}</strong></div>`}).join('')}</div>`:'<p class="muted">Данных пока нет.</p>'}
  function pageInfo(path){
    const raw=String(path||'home'),parts=raw.split('/').filter(Boolean);
    if(raw==='home')return{title:'Главная страница',detail:'#home'};
    if(raw==='about')return{title:data.about?.title||data.labels?.navAbout||'Обо мне',detail:'#about'};
    if(raw==='contacts')return{title:data.contacts?.title||data.labels?.navContacts||'Контакты',detail:'#contacts'};
    if(parts[0]==='direction'){
      const dir=parts[1]||'school',section=parts[2]||'albums',direction=data.directions?.[dir],dirTitle=direction?.title||dir,sectionTitle=direction?.menuLabels?.[section]||section;
      if(section==='albums'&&parts[3]){
        const album=direction?.albums?.find(a=>String(a.id)===parts[3]);
        return{title:`${dirTitle} → Альбом «${album?.title||'без названия'}»`,detail:`#${raw}`};
      }
      return{title:`${dirTitle} → ${sectionTitle}`,detail:`#${raw}`};
    }
    return{title:'Другая страница',detail:`#${raw}`};
  }
  function sourceInfo(value){const raw=String(value||'').trim();if(!raw||raw==='Прямые переходы')return{title:'Прямые переходы',detail:'Адрес сайта введён вручную, открыт из закладки или источник не передан браузером.'};const host=raw.toLowerCase().replace(/^www\./,'');let title='Другой сайт';if(/(^|\.)vk\.com$/.test(host))title='ВКонтакте';else if(/(^|\.)max\.ru$/.test(host))title='MAX';else if(/(^|\.)yandex\./.test(host))title='Яндекс';else if(/(^|\.)google\./.test(host))title='Google';else if(/(^|\.)mail\.ru$/.test(host))title='Mail.ru';else if(/(^|\.)instagram\.com$/.test(host))title='Instagram';else if(host==='t.me'||/(^|\.)telegram\./.test(host))title='Telegram';else if(/(^|\.)ok\.ru$/.test(host))title='Одноклассники';return{title,detail:raw}}
  function detailStats(rows,kind){if(!rows.length)return '<p class="muted">Данных пока нет.</p>';const max=Math.max(1,...rows.map(x=>Number(x.pageviews)||0));return `<div class="stat-detail-list">${rows.map(x=>{const value=Number(x.pageviews)||0,pct=Math.max(3,Math.round(value/max*100)),info=kind==='page'?pageInfo(x.path):sourceInfo(x.referrer),sessions=Number(x.sessions)||0;return `<div class="stat-detail-row"><div class="stat-detail-top"><div class="stat-detail-label"><strong>${esc(info.title)}</strong><small>${esc(info.detail)}</small></div><div class="stat-detail-number"><strong>${value}</strong><span>${plural(value,['просмотр','просмотра','просмотров'])}</span></div></div><div class="stat-track"><i style="width:${pct}%"></i></div>${kind==='page'?`<div class="stat-detail-meta">${sessions} ${plural(sessions,['сеанс','сеанса','сеансов'])}</div>`:''}</div>`}).join('')}</div>`}
  function uniqueVisitorsChart(rows){
    if(!rows.length)return '<p class="muted">Данных пока нет.</p>';
    const values=rows.map(x=>Math.max(0,Number(x.unique_visitors)||0)),max=Math.max(1,...values),width=960,height=300,left=48,right=18,top=22,bottom=48,plotW=width-left-right,plotH=height-top-bottom,step=plotW/Math.max(1,rows.length),barW=Math.max(3,Math.min(34,step*.64)),labelEvery=Math.max(1,Math.ceil(rows.length/7)),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Novosibirsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const grid=[0,.25,.5,.75,1].map(k=>{const value=Math.round(max*k),y=top+plotH-(value/max)*plotH;return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" class="visitor-grid-line"></line><text x="${left-9}" y="${y+4}" text-anchor="end" class="visitor-axis-label">${value}</text>`}).join('');
    const bars=rows.map((x,i)=>{const value=values[i],h=(value/max)*plotH,xPos=left+i*step+(step-barW)/2,y=top+plotH-h,label=(i%labelEvery===0||i===rows.length-1)?`<text x="${xPos+barW/2}" y="${height-18}" text-anchor="middle" class="visitor-axis-label">${esc(formatStatDate(x.date))}</text>`:'';return `<rect x="${xPos}" y="${y}" width="${barW}" height="${Math.max(1,h)}" rx="3" class="visitor-bar ${String(x.date)===today?'today':''}"><title>${esc(formatStatDate(x.date))}: ${value} ${plural(value,['посетитель','посетителя','посетителей'])}</title></rect>${label}`}).join('');
    return `<div class="visitor-chart-wrap"><svg class="visitor-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="График уникальных посетителей по дням">${grid}${bars}</svg></div>`
  }
  function statsPeriodButtons(period){return `<div class="section-select stats-periods"><button data-period="today" class="${period==='today'?'active':''}">Сегодня</button><button data-period="7" class="${period===7?'active':''}">7 дней</button><button data-period="30" class="${period===30?'active':''}">30 дней</button><button data-period="90" class="${period===90?'active':''}">90 дней</button></div>`}
  async function renderStats(requestedPeriod=30){const p=$('#panel-stats'),period=requestedPeriod==='today'||Number(requestedPeriod)===0?'today':([7,30,90].includes(Number(requestedPeriod))?Number(requestedPeriod):30),days=period==='today'?0:period;p.innerHTML=`<h2>Статистика посещений</h2>${statsPeriodButtons(period)}<div class="card loading-card">Загрузка статистики…</div>`;try{const s=await SiteBackend.getSiteStats(days),daily=s.daily||[],pages=s.pages||[],devices=s.devices||[],refs=s.referrers||[],sec=s.security||{},today=Number(s.today_pageviews)||0,todaySessions=Number(s.today_sessions)||0,todayUnique=Number(s.today_unique_visitors)||0,periodUnique=Number(s.unique_visitors)||0,isToday=period==='today',periodText=isToday?'за сегодняшний день':`за ${period} дней`,summary=isToday?`<div class="stats-grid stats-grid-today stats-grid-three"><div class="stat-card"><span>Просмотры сегодня</span><strong>${today}</strong></div><div class="stat-card"><span>Сеансы сегодня</span><strong>${todaySessions}</strong></div><div class="stat-card"><span>Уникальные посетители сегодня</span><strong>${todayUnique}</strong></div></div>`:`<div class="stats-grid stats-grid-six"><div class="stat-card"><span>Просмотры ${periodText}</span><strong>${Number(s.pageviews)||0}</strong></div><div class="stat-card"><span>Сеансы ${periodText}</span><strong>${Number(s.sessions)||0}</strong></div><div class="stat-card"><span>Уникальные посетители ${periodText}</span><strong>${periodUnique}</strong></div><div class="stat-card"><span>Просмотры сегодня</span><strong>${today}</strong></div><div class="stat-card"><span>Сеансы сегодня</span><strong>${todaySessions}</strong></div><div class="stat-card"><span>Уникальные сегодня</span><strong>${todayUnique}</strong></div></div>`;p.innerHTML=`<h2>Статистика посещений</h2>${statsPeriodButtons(period)}<p class="stats-period-note">Показаны данные ${periodText}. Сегодня рассчитывается по времени Новосибирска.</p>${summary}<div class="card visitor-chart-card"><div class="visitor-chart-head"><div><h3>Уникальные посетители</h3><p class="muted">Каждый браузер учитывается один раз за выбранный период. График показывает количество уникальных посетителей по дням.</p></div><strong>${periodUnique}</strong></div>${uniqueVisitorsChart(daily)}<p class="muted visitor-chart-note">Используется анонимный случайный идентификатор браузера. IP-адреса, ФИО и контактные данные не сохраняются. Исторические данные до обновления рассчитаны по сеансам.</p></div><div class="card"><h3>Популярные страницы</h3><p class="muted stats-help">Показано понятное название раздела, а ниже — его точный технический адрес.</p>${detailStats(pages,'page')}</div><div class="card"><h3>Источники переходов</h3><p class="muted stats-help">Название источника и полный домен отображаются без обрезки.</p>${detailStats(refs,'source')}</div><div class="grid-2"><div class="card"><h3>Динамика просмотров по дням</h3>${statBars(daily,'date','pageviews',formatStatDate)}</div><div class="card"><h3>Устройства</h3>${statBars(devices,'device','pageviews',v=>({mobile:'Смартфоны',tablet:'Планшеты',desktop:'Компьютеры'}[v]||v))}</div></div><div class="card"><h3>Безопасность входа</h3><div class="stats-grid compact"><div class="stat-card"><span>Неудачные входы, 24 часа</span><strong>${Number(sec.failed_24h)||0}</strong></div><div class="stat-card"><span>Локальные блокировки, 24 часа</span><strong>${Number(sec.locked_24h)||0}</strong></div><div class="stat-card"><span>Успешные входы, 7 дней</span><strong>${Number(sec.success_7d)||0}</strong></div></div><p class="muted">Статистика не хранит IP-адреса, пароли, ФИО и другие персональные данные.</p></div>`}catch(e){p.innerHTML=`<h2>Статистика посещений</h2>${statsPeriodButtons(period)}<div class="card"><p class="error">Не удалось загрузить статистику: ${esc(e.message)}</p><p class="muted">Выполните файл <code>supabase/unique_visitors_v22.sql</code> в SQL Editor.</p></div>`}$$('[data-period]',p).forEach(b=>b.onclick=()=>renderStats(b.dataset.period==='today'?'today':Number(b.dataset.period)))}
  const loginStateKey='lena-admin-login-guard-v1';
  function readLoginState(){try{return JSON.parse(localStorage.getItem(loginStateKey)||'{}')}catch(_){return {}}}
  function writeLoginState(v){try{localStorage.setItem(loginStateKey,JSON.stringify(v))}catch(_){}}
  function lockRemaining(){return Math.max(0,Number(readLoginState().blockedUntil||0)-Date.now())}
  function updateLoginGuard(){const ms=lockRemaining(),button=$('#loginForm button[type="submit"]'),hint=$('#loginGuard');if(!button||!hint)return;if(ms>0){button.disabled=true;hint.textContent=`Слишком много попыток. Повторите через ${Math.ceil(ms/1000)} сек.`}else{button.disabled=false;hint.textContent='После 5 ошибок вход временно блокируется.';clearInterval(lockTimer);lockTimer=null}}
  function registerLoginFailure(){const st=readLoginState(),fails=Number(st.fails||0)+1,level=Number(st.level||0);if(fails>=5){const delays=[30000,120000,600000,1800000],blockedUntil=Date.now()+delays[Math.min(level,delays.length-1)];writeLoginState({fails:0,level:level+1,blockedUntil});SiteBackend.recordSecurityEvent('login_locked');if(!lockTimer)lockTimer=setInterval(updateLoginGuard,1000)}else writeLoginState({fails,level,blockedUntil:0});updateLoginGuard()}
  function clearLoginGuard(){try{localStorage.removeItem(loginStateKey)}catch(_){}clearInterval(lockTimer);lockTimer=null;updateLoginGuard()}
  function resetCaptcha(){captchaToken='';if(window.turnstile&&captchaWidgetId!==null)window.turnstile.reset(captchaWidgetId)}
  function initCaptcha(){const key=String(window.APP_CONFIG?.CAPTCHA_SITE_KEY||'').trim(),wrap=$('#captchaWrap');if(!key){if(window.APP_CONFIG?.REQUIRE_CAPTCHA){$('#setupWarning').classList.remove('hidden');$('#setupWarning').textContent='Для входа требуется CAPTCHA. Укажите CAPTCHA_SITE_KEY в assets/js/config.js.';$('#loginForm button').disabled=true}return}wrap.classList.remove('hidden');const draw=()=>{if(!window.turnstile)return setTimeout(draw,150);captchaWidgetId=window.turnstile.render('#captchaWidget',{sitekey:key,callback:t=>captchaToken=t,'expired-callback':()=>captchaToken='','error-callback':()=>captchaToken=''})};draw()}


  function showPanel(name){
    $$('#adminNav button').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
    $$('.panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${name}`));
    ({general:renderGeneral,labels:renderLabels,directions:renderDirections,about:renderAbout,contacts:renderContacts,design:renderDesign,stats:renderStats,backup:renderBackup}[name])();
  }
  async function save(){try{$('#saveBtn').disabled=true;await SiteBackend.saveContent(data);const cleanupErrors=await cleanupQueuedImages();clean();toast(cleanupErrors.length?'Сайт сохранён, но часть файлов не удалена из Storage':'Изменения опубликованы')}catch(e){toast('Ошибка сохранения: '+e.message)}finally{$('#saveBtn').disabled=false}}
  async function login(e){e.preventDefault();$('#loginError').textContent='';if(lockRemaining()>0){updateLoginGuard();return}if(window.APP_CONFIG?.REQUIRE_CAPTCHA&&!captchaToken){$('#loginError').textContent='Подтвердите CAPTCHA.';return}const button=$('#loginForm button[type="submit"]');button.disabled=true;try{const {error}=await SiteBackend.login($('#password').value,captchaToken);if(error)throw error;const ok=await SiteBackend.isAdmin();if(!ok){await SiteBackend.logout();throw new Error('access_denied')}clearLoginGuard();await SiteBackend.recordSecurityEvent('login_success');await enter()}catch(err){await SiteBackend.recordSecurityEvent('login_failed');registerLoginFailure();resetCaptcha();$('#loginError').textContent='Неверный пароль или вход временно заблокирован.'}finally{if(lockRemaining()===0)button.disabled=false}}
  async function enter(){const s=await SiteBackend.session();if(!s)return;if(!await SiteBackend.isAdmin()){await SiteBackend.logout();$('#loginError').textContent='Доступ запрещён.';return}$('#loginScreen').classList.add('hidden');$('#adminApp').classList.remove('hidden');const res=await SiteBackend.getContent(),raw=res.data||{};data=deepMerge(window.DEFAULT_SITE_CONTENT,raw);normalizeDirectionImages(data,raw);pendingStorageDeletes.clear();$('#adminLoading').classList.add('hidden');$('#panel-general').classList.add('active');$('#savebar').classList.remove('hidden');clean();showPanel('general')}
  async function init(){updateLoginGuard();if(lockRemaining()>0&&!lockTimer)lockTimer=setInterval(updateLoginGuard,1000);initCaptcha();if(!SiteBackend.configured){$('#setupWarning').classList.remove('hidden');$('#loginForm button').disabled=true;return}$('#loginForm').onsubmit=login;$('#logoutBtn').onclick=async()=>{await SiteBackend.logout();location.reload()};$('#saveBtn').onclick=save;$$('#adminNav button').forEach(b=>b.onclick=()=>showPanel(b.dataset.panel));if(await SiteBackend.session())await enter();window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}})}
  document.addEventListener('DOMContentLoaded',init,{once:true});
})();
