const clone = (value) => JSON.parse(JSON.stringify(value));
const $ = (selector) => document.querySelector(selector);
const ws = $('#workspace');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function mergeDefaults(defaultValue, storedValue) {
  if (Array.isArray(defaultValue)) return Array.isArray(storedValue) ? clone(storedValue) : clone(defaultValue);
  if (defaultValue && typeof defaultValue === 'object') {
    const source = storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue) ? storedValue : {};
    const result = {};
    Object.keys(defaultValue).forEach((key) => { result[key] = mergeDefaults(defaultValue[key], source[key]); });
    Object.keys(source).forEach((key) => { if (!(key in result)) result[key] = clone(source[key]); });
    return result;
  }
  return storedValue === undefined || storedValue === null ? defaultValue : storedValue;
}

let data = clone(window.DEFAULT_CONTENT);
let tab = 'dashboard';
let db = null;
let currentUser = null;
let currentDirection = 'school';
let currentTextPage = 'landing';

function isConfigured() {
  const cfg = window.SITE_CONFIG || {};
  return /^https:\/\/.+\.supabase\.co$/.test(cfg.SUPABASE_URL || '')
    && cfg.SUPABASE_PUBLISHABLE_KEY
    && !cfg.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_');
}

function showLoginMessage(message, isError = false) {
  const node = $('#loginStatus');
  node.textContent = message;
  node.style.color = isError ? '#a03f3f' : '';
}

function toast(text) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.append(node);
  setTimeout(() => node.remove(), 2800);
}

function setSavingState(text) { $('#saveStatus').textContent = text; }

function assetUrl(url) {
  const value = String(url || '');
  if (!value || /^(https?:|data:|blob:|\/)/i.test(value)) return value;
  return `../${value.replace(/^\.\//, '')}`;
}

async function verifyAdmin(userId) {
  const { data: membership, error } = await db.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(membership);
}


function adaptLegacyContent(storedContent) {
  const stored = clone(storedContent || {});
  if (!stored.pages) stored.pages = {};
  if (!stored.pages.school && (stored.hero || stored.albums || stored.process || stored.faq || stored.reviews)) {
    const school = clone(window.DEFAULT_CONTENT.pages.school);
    if (stored.hero) school.hero = mergeDefaults(school.hero, stored.hero);
    if (Array.isArray(stored.albums)) school.albums = clone(stored.albums);
    if (Array.isArray(stored.process)) school.process = clone(stored.process);
    if (Array.isArray(stored.faq)) school.faq = clone(stored.faq);
    if (Array.isArray(stored.reviews)) school.reviews = clone(stored.reviews);
    if (Array.isArray(stored.albums)) {
      school.portfolio = stored.albums.flatMap((album) =>
        (album.gallery || []).map((image, index) => ({
          image,
          label: `${album.name || 'Альбом'} · ${String(index + 1).padStart(2, '0')}`
        }))
      );
    }
    stored.pages.school = school;
  }
  return stored;
}


const CONTENT_SCHEMA_VERSION = 4;
const LEGACY_TEXT_REPLACEMENTS = [
  ['НОВЫЕ ГРАНИ', 'Лена Сибирская'],
  ['Новые грани', 'Лена Сибирская'],
  ['Напишите нам — подскажем формат и рассчитаем стоимость.', 'Напишите мне — подскажу формат и рассчитаю стоимость.'],
  ['Как мы получим фотографии?', 'Как родители получат фотографии?'],
  ['Создаём персонализированные фотокниги', 'Я создаю персонализированные фотокниги'],
  ['Берём организацию проекта на себя и сопровождаем', 'Я беру организацию проекта на себя и сопровождаю'],
  ['Сохраняем портреты, игры, занятия, друзей и любимых воспитателей', 'Я сохраняю портреты, игры, занятия, друзей и любимых воспитателей'],
  ['Учитываем режим группы и проводим', 'Я учитываю режим группы и провожу'],
  ['О нас говорят', 'О моей работе говорят'],
  ['Обсуждаем класс,', 'Обсуждаю класс,'],
  ['Обсуждаем группу,', 'Обсуждаю группу,'],
  ['Помогаем выбрать', 'Помогаю выбрать'],
  ['Согласовываем одежду,', 'Согласовываю одежду,'],
  ['Снимаем индивидуальные', 'Снимаю индивидуальные'],
  ['Снимаем каждого ребёнка', 'Снимаю каждого ребёнка'],
  ['Фотографируем игры,', 'Фотографирую игры,'],
  ['Создаём макеты,', 'Создаю макеты,'],
  ['Создаём персональные макеты', 'Создаю персональные макеты'],
  ['Печатаем, проверяем каждый экземпляр и передаём', 'Печатаю, проверяю каждый экземпляр и передаю'],
  ['Печатаем и передаём', 'Печатаю и передаю'],
  ['Предоставляем памятки', 'Я предоставляю памятки'],
  ['Заранее согласовываем', 'Я заранее согласовываю'],
  ['Помогаю выбрать одежду, согласовываем', 'Помогаю выбрать одежду, согласовываю'],
  ['Создаю макеты, проверяем', 'Создаю макеты, проверяю'],
  ['Создаю персональные макеты и проверяем', 'Создаю персональные макеты и проверяю']
];
function migrateTextValue(value) {
  if (Array.isArray(value)) return value.map(migrateTextValue);
  if (value && typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, item]) => { result[key] = migrateTextValue(item); });
    return result;
  }
  if (typeof value !== 'string') return value;
  return LEGACY_TEXT_REPLACEMENTS.reduce((text, [from, to]) => text.split(from).join(to), value);
}
function migrateContent(storedContent) {
  let stored = migrateTextValue(adaptLegacyContent(storedContent));
  stored.brand = stored.brand || {};
  stored.brand.logo = stored.brand.logo || {};
  if (!stored.brand.name || /новые грани/i.test(stored.brand.name)) stored.brand.name = 'Лена Сибирская';
  if (!stored.brand.logo.mark || stored.brand.logo.mark === 'НГ') stored.brand.logo.mark = 'ЛС';
  if (!stored.brand.logo.header) stored.brand.logo.header = 'assets/images/lena-sibirskaya-mark.webp';
  if (!stored.brand.logo.footer) stored.brand.logo.footer = 'assets/images/lena-sibirskaya-logo.webp';
  if (!stored.brand.logo.favicon) stored.brand.logo.favicon = 'assets/images/favicon-lena.png';
  if (!stored.brand.logo.alt || /новые грани/i.test(stored.brand.logo.alt)) stored.brand.logo.alt = 'Логотип Лены Сибирской — выпускные альбомы';
  if (!['image', 'mark', 'both'].includes(stored.brand.logo.displayMode)) stored.brand.logo.displayMode = 'image';
  stored.schemaVersion = CONTENT_SCHEMA_VERSION;
  return stored;
}

async function loadContent() {
  const rowId = Number(window.SITE_CONFIG.CONTENT_ROW_ID || 1);
  const { data: row, error } = await db.from('site_content').select('content').eq('id', rowId).maybeSingle();
  if (error) throw error;
  if (row?.content) {
    data = mergeDefaults(window.DEFAULT_CONTENT, migrateContent(row.content));
    return;
  }
  const { error: insertError } = await db.from('site_content').upsert({ id: rowId, content: data, updated_by: currentUser.id });
  if (insertError) throw insertError;
}

async function openPanel(user) {
  const isAdmin = await verifyAdmin(user.id);
  if (!isAdmin) {
    await db.auth.signOut();
    throw new Error('Учётная запись не включена в таблицу admin_users.');
  }
  currentUser = user;
  await loadContent();
  $('#login').classList.add('hidden');
  $('#panel').classList.remove('hidden');
  render();
}

async function initialize() {
  if (!isConfigured() || !window.supabase) {
    showLoginMessage('Сначала заполните SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY в файле config.js.', true);
    $('#loginBtn').disabled = true;
    return;
  }
  db = window.supabase.createClient(
    window.SITE_CONFIG.SUPABASE_URL,
    window.SITE_CONFIG.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    try { await openPanel(session.user); } catch (error) { showLoginMessage(error.message, true); }
  }
}

$('#loginForm').onsubmit = async (event) => {
  event.preventDefault();
  if (!db) return;
  const button = $('#loginBtn');
  button.disabled = true;
  showLoginMessage('Проверяем учётную запись…');
  try {
    const { data: authData, error } = await db.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    if (error) throw error;
    await openPanel(authData.user);
  } catch (error) {
    showLoginMessage(error.message || 'Не удалось войти.', true);
  } finally {
    button.disabled = false;
  }
};

$('#logoutBtn').onclick = async () => { await db.auth.signOut(); location.reload(); };
$('#saveBtn').onclick = save;

document.querySelectorAll('aside nav button').forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll('aside nav button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    tab = button.dataset.tab;
    render();
  };
});

async function save() {
  if (!db || !currentUser) return;
  setSavingState('Сохранение…');
  $('#saveBtn').disabled = true;
  const rowId = Number(window.SITE_CONFIG.CONTENT_ROW_ID || 1);
  try {
    const { error } = await db.from('site_content').upsert({ id: rowId, content: data, updated_by: currentUser.id });
    if (error) throw error;
    setSavingState('Данные синхронизированы');
    toast('Изменения опубликованы для всех посетителей');
  } catch (error) {
    setSavingState('Ошибка сохранения');
    alert(`Не удалось сохранить: ${error.message}`);
  } finally {
    $('#saveBtn').disabled = false;
  }
}

function field(label, path, value, options = {}) {
  const { type = 'text', min, max, step, help = '', list = '', placeholder = '', maxlength } = options;
  const attrs = [
    `data-path="${esc(path)}"`,
    type === 'number' ? 'data-value-type="number"' : '',
    min !== undefined ? `min="${min}"` : '',
    max !== undefined ? `max="${max}"` : '',
    step !== undefined ? `step="${step}"` : '',
    list ? `list="${esc(list)}"` : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '',
    maxlength !== undefined ? `maxlength="${maxlength}"` : ''
  ].filter(Boolean).join(' ');
  const control = type === 'textarea'
    ? `<textarea ${attrs}>${esc(value)}</textarea>`
    : `<input type="${type}" ${attrs} value="${esc(value)}">`;
  return `<label>${label}${control}${help ? `<small class="field-help">${help}</small>` : ''}</label>`;
}

function colorField(label, path, value) {
  const color = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#000000';
  return `<label>${label}<div class="color-control"><input type="color" data-path="${esc(path)}" value="${esc(color)}"><code>${esc(color)}</code></div></label>`;
}

function selectField(label, path, value, options, help = '') {
  return `<label>${label}<select data-path="${esc(path)}">${options.map(([optionValue, text]) => `<option value="${esc(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>${help ? `<small class="field-help">${help}</small>` : ''}</label>`;
}

function checkboxField(label, path, checked, help = '') {
  return `<label class="check-field"><input type="checkbox" data-path="${esc(path)}" data-value-type="boolean" ${checked ? 'checked' : ''}><span>${label}${help ? `<small class="field-help">${help}</small>` : ''}</span></label>`;
}

function bind() {
  ws.querySelectorAll('[data-path]').forEach((element) => {
    const eventName = element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input';
    element.addEventListener(eventName, () => {
      let value = element.type === 'checkbox' ? element.checked : element.value;
      if (element.dataset.valueType === 'number') value = element.value === '' ? 0 : Number(element.value);
      setPath(element.dataset.path, value);
      if (element.type === 'color') element.nextElementSibling.textContent = element.value;
      if (tab === 'design') refreshDesignPreview();
      if (tab === 'brand') refreshLogoPreview();
    });
  });
  ws.querySelectorAll('[data-upload]').forEach((input) => { input.onchange = () => uploadToPath(input); });
  ws.querySelectorAll('[data-clear-path]').forEach((button) => {
    button.onclick = () => {
      setPath(button.dataset.clearPath, '');
      render();
      toast('Изображение удалено из настроек. Нажмите «Сохранить».');
    };
  });
}

function setPath(path, value) {
  const parts = path.split('.');
  let object = data;
  for (let index = 0; index < parts.length - 1; index += 1) object = object[parts[index]];
  object[parts.at(-1)] = value;
  setSavingState('Есть несохранённые изменения');
}

async function uploadFile(file) {
  if (!file.type.startsWith('image/')) throw new Error('Разрешены только изображения.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Максимальный размер изображения — 10 МБ.');
  const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const unique = window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filePath = `uploads/${new Date().toISOString().slice(0, 10)}/${unique}.${extension}`;
  const bucket = window.SITE_CONFIG.STORAGE_BUCKET || 'site-images';
  const { error } = await db.storage.from(bucket).upload(filePath, file, { cacheControl: '31536000', upsert: false, contentType: file.type });
  if (error) throw error;
  const { data: publicData } = db.storage.from(bucket).getPublicUrl(filePath);
  return publicData.publicUrl;
}

async function uploadToPath(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  setSavingState('Загрузка изображения…');
  try {
    const url = await uploadFile(file);
    setPath(input.dataset.upload, url);
    render();
    toast('Изображение загружено. Нажмите «Сохранить».');
  } catch (error) {
    alert(`Не удалось загрузить изображение: ${error.message}`);
  } finally {
    input.disabled = false;
  }
}

function render() {
  const titles = {
    dashboard: 'Обзор',
    brand: 'Основное и логотипы',
    design: 'Дизайн и шрифты',
    pages: 'Тексты страниц',
    albums: 'Альбомы',
    portfolio: 'Портфолио',
    process: 'Этапы работы',
    faq: 'Частые вопросы',
    reviews: 'Отзывы',
    data: 'Резервная копия'
  };
  $('#pageTitle').textContent = titles[tab];
  if (tab === 'dashboard') dashboard();
  if (tab === 'brand') brand();
  if (tab === 'design') designEditor();
  if (tab === 'pages') pageTextEditor();
  if (tab === 'albums') albums();
  if (tab === 'portfolio') portfolioEditor();
  if (tab === 'process') repeatEditor('process');
  if (tab === 'faq') repeatEditor('faq');
  if (tab === 'reviews') repeatEditor('reviews');
  if (tab === 'data') dataTools();
  bind();
  bindPageSelectors();
  if (tab === 'design') refreshDesignPreview();
  if (tab === 'brand') refreshLogoPreview();
}

function directionSwitcher() {
  return `<div class="content-switcher">
    <button type="button" data-direction="school" class="${currentDirection === 'school' ? 'active' : ''}">Школа</button>
    <button type="button" data-direction="kindergarten" class="${currentDirection === 'kindergarten' ? 'active' : ''}">Детский сад</button>
  </div>`;
}

function textPageSwitcher() {
  return `<div class="content-switcher">
    <button type="button" data-text-page="landing" class="${currentTextPage === 'landing' ? 'active' : ''}">Главная</button>
    <button type="button" data-text-page="school" class="${currentTextPage === 'school' ? 'active' : ''}">Школа</button>
    <button type="button" data-text-page="kindergarten" class="${currentTextPage === 'kindergarten' ? 'active' : ''}">Детский сад</button>
  </div>`;
}

function bindPageSelectors() {
  ws.querySelectorAll('[data-direction]').forEach((button) => {
    button.onclick = () => {
      currentDirection = button.dataset.direction;
      render();
    };
  });
  ws.querySelectorAll('[data-text-page]').forEach((button) => {
    button.onclick = () => {
      currentTextPage = button.dataset.textPage;
      render();
    };
  });
}

async function dashboard() {
  ws.innerHTML = '<div class="notice">Загружаем общую статистику сайта…</div>';
  const { data: stats, error } = await db.rpc('get_site_stats');
  if (error) {
    ws.innerHTML = `<div class="notice">Не удалось получить статистику: ${esc(error.message)}</div>`;
    return;
  }
  const events = Object.entries(stats.by_event || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  ws.innerHTML = `
    <div class="notice">Это общая статистика со всех устройств. Для расширенных отчётов используйте Яндекс Метрику.</div>
    <div class="stats">
      <div class="stat"><b>${stats.pageviews || 0}</b><span>Просмотров сайта</span></div>
      <div class="stat"><b>${stats.events_total || 0}</b><span>Всего событий</span></div>
      <div class="stat"><b>${stats.vk_click || 0}</b><span>Переходов во VK</span></div>
      <div class="stat"><b>${stats.photo_open || 0}</b><span>Открытий фотографий</span></div>
    </div>
    <div class="card"><h3>События</h3><div class="event-list">${events.length
      ? events.map(([name, count]) => `<div class="event-row"><span>${esc(name)}</span><b>${count}</b></div>`).join('')
      : '<p>Пока нет данных.</p>'}</div></div>`;
}

function imageEditor(title, path, value, hint, compact = false) {
  const src = assetUrl(value);
  return `<div class="logo-editor ${compact ? 'compact' : ''}">
    <h4>${title}</h4>
    <div class="logo-preview ${value ? '' : 'empty'}">${value ? `<img src="${esc(src)}" alt="${esc(title)}">` : '<span>Изображение не загружено</span>'}</div>
    <div class="inline-actions"><label class="upload-btn">${value ? 'Заменить' : 'Загрузить'}<input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" data-upload="${path}"></label>${value ? `<button type="button" class="danger small" data-clear-path="${path}">Убрать</button>` : ''}</div>
    <small class="field-help">${hint}</small>
  </div>`;
}

function brand() {
  const nav = data.global.navigation;
  const footer = data.global.footer;
  ws.innerHTML = `
    <div class="card"><h3>Бренд и контакты</h3><div class="grid">
      ${field('Название', 'brand.name', data.brand.name)}
      ${field('Подпись бренда', 'brand.tagline', data.brand.tagline)}
      ${field('Город', 'brand.city', data.brand.city)}
      ${field('Ссылка VK', 'brand.vk', data.brand.vk, { type: 'url' })}
      ${field('Телефон', 'brand.phone', data.brand.phone)}
      ${field('Текст в круглом знаке', 'brand.logo.mark', data.brand.logo.mark, { help: 'Знак обновляется сразу в предпросмотре. Для отображения выберите режим «Круглый знак» или «Логотип + знак».', maxlength: 8 })}
      ${selectField('Режим отображения логотипа', 'brand.logo.displayMode', data.brand.logo.displayMode || 'image', [['image','Графический логотип'],['mark','Круглый текстовый знак'],['both','Логотип + круглый знак']])}
      ${field('Описание логотипа', 'brand.logo.alt', data.brand.logo.alt, { help: 'Текст для поисковых систем и программ чтения с экрана.' })}
    </div><div class="check-row">${checkboxField('Показывать название рядом с логотипом', 'brand.logo.showName', data.brand.logo.showName)}${checkboxField('Показывать подпись или город', 'brand.logo.showTagline', data.brand.logo.showTagline)}</div></div>
    <div class="card"><h3>Логотипы и значок сайта</h3><div class="logo-grid">
      ${imageEditor('Логотип в шапке', 'brand.logo.header', data.brand.logo.header, 'Рекомендуется PNG или WebP с прозрачным фоном. Оптимальная ширина 400–1000 px.')}
      ${imageEditor('Логотип в подвале', 'brand.logo.footer', data.brand.logo.footer, 'Если не загрузить, будет использован логотип из шапки.')}
      ${imageEditor('Favicon', 'brand.logo.favicon', data.brand.logo.favicon, 'Квадратное изображение 256×256 или 512×512 px.', true)}
    </div><div id="logoLivePreview" class="logo-live-preview"></div></div>
    <div class="card"><h3>Меню и общие подписи</h3><div class="grid three">
      ${field('Главная', 'global.navigation.home', nav.home)}
      ${field('Школа', 'global.navigation.school', nav.school)}
      ${field('Детский сад', 'global.navigation.kindergarten', nav.kindergarten)}
      ${field('Альбомы', 'global.navigation.albums', nav.albums)}
      ${field('Портфолио', 'global.navigation.portfolio', nav.portfolio)}
      ${field('Как проходит съёмка', 'global.navigation.process', nav.process)}
      ${field('FAQ', 'global.navigation.faq', nav.faq)}
      ${field('Кнопка обсуждения', 'global.navigation.discuss', nav.discuss)}
      ${field('Подпись ссылки VK', 'global.footer.vkLabel', footer.vkLabel)}
      ${field('Общий текст подвала', 'global.footer.description', footer.description, { type: 'textarea' })}
    </div></div>`;
}

function refreshLogoPreview() {
  const node = $('#logoLivePreview');
  if (!node) return;
  const logo = data.brand.logo;
  const headerUrl = assetUrl(logo.header);
  const mode = ['image','mark','both'].includes(logo.displayMode) ? logo.displayMode : (headerUrl ? 'image' : 'mark');
  const imageHtml = headerUrl && mode !== 'mark' ? `<img src="${esc(headerUrl)}" alt="">` : '';
  const markHtml = mode !== 'image' || !headerUrl ? `<span class="logo-mark-demo" data-chars="${String((logo.mark || 'ЛС').length)}">${esc(logo.mark || 'ЛС')}</span>` : '';
  node.innerHTML = `<div class="logo-preview-line">${imageHtml}${markHtml}<span class="logo-copy-demo">${logo.showName ? `<b>${esc(data.brand.name)}</b>` : ''}${logo.showTagline ? `<small>${esc(data.brand.tagline)}</small>` : ''}</span></div>`;
}

function designEditor() {
  const d = data.design;
  const weights = [[100, '100 — тонкий'], [200, '200'], [300, '300 — лёгкий'], [400, '400 — обычный'], [500, '500'], [600, '600'], [700, '700 — жирный'], [800, '800'], [900, '900 — максимально жирный']];
  ws.innerHTML = `
    <div class="notice">Настройки применяются ко всему публичному сайту после нажатия «Сохранить». Для нестандартного шрифта вставьте URL CSS-файла шрифта и укажите его точное семейство.</div>
    <div class="card"><h3>Типы шрифтов</h3><div class="grid">
      ${field('CSS-ссылка на внешний шрифт', 'design.fonts.stylesheetUrl', d.fonts.stylesheetUrl, { type: 'url', placeholder: 'https://fonts.googleapis.com/css2?...', help: 'Необязательно. Поддерживается Google Fonts и другой HTTPS CDN.' })}
      ${field('Основной текст', 'design.fonts.body', d.fonts.body, { list: 'fontPresets', help: 'Например: Arial, Helvetica, sans-serif' })}
      ${field('Заголовки', 'design.fonts.heading', d.fonts.heading, { list: 'fontPresets' })}
      ${field('Меню, кнопки и интерфейс', 'design.fonts.interface', d.fonts.interface, { list: 'fontPresets' })}
      ${field('Название бренда и знак', 'design.fonts.brand', d.fonts.brand, { list: 'fontPresets' })}
    </div></div>
    <div class="card"><h3>Размеры текста</h3><div class="grid three">
      ${field('Основной текст, px', 'design.typography.baseSize', d.typography.baseSize, { type: 'number', min: 10, max: 28, step: 1 })}
      ${field('Навигация, px', 'design.typography.navSize', d.typography.navSize, { type: 'number', min: 8, max: 30, step: 1 })}
      ${field('Кнопки, px', 'design.typography.buttonSize', d.typography.buttonSize, { type: 'number', min: 8, max: 32, step: 1 })}
      ${field('Надзаголовки, px', 'design.typography.eyebrowSize', d.typography.eyebrowSize, { type: 'number', min: 7, max: 28, step: 1 })}
      ${field('Главный заголовок, px', 'design.typography.heroTitleSize', d.typography.heroTitleSize, { type: 'number', min: 36, max: 180, step: 1 })}
      ${field('Текст первого экрана, px', 'design.typography.heroTextSize', d.typography.heroTextSize, { type: 'number', min: 12, max: 40, step: 1 })}
      ${field('Заголовки разделов, px', 'design.typography.sectionTitleSize', d.typography.sectionTitleSize, { type: 'number', min: 30, max: 140, step: 1 })}
      ${field('Названия альбомов, px', 'design.typography.albumTitleSize', d.typography.albumTitleSize, { type: 'number', min: 18, max: 70, step: 1 })}
      ${field('Текст карточек, px', 'design.typography.cardTextSize', d.typography.cardTextSize, { type: 'number', min: 10, max: 32, step: 1 })}
      ${field('Вопросы FAQ, px', 'design.typography.faqSize', d.typography.faqSize, { type: 'number', min: 14, max: 54, step: 1 })}
      ${field('Цена, px', 'design.typography.priceSize', d.typography.priceSize, { type: 'number', min: 10, max: 40, step: 1 })}
      ${field('Название бренда, px', 'design.typography.brandNameSize', d.typography.brandNameSize, { type: 'number', min: 8, max: 34, step: 1 })}
      ${field('Подпись бренда, px', 'design.typography.brandTaglineSize', d.typography.brandTaglineSize, { type: 'number', min: 6, max: 24, step: 1 })}
      ${field('Заголовки этапов, px', 'design.typography.processTitleSize', d.typography.processTitleSize, { type: 'number', min: 14, max: 60, step: 1 })}
      ${field('Текст отзывов, px', 'design.typography.reviewTextSize', d.typography.reviewTextSize, { type: 'number', min: 12, max: 48, step: 1 })}
      ${field('Заголовки блоков родителей/учителей, px', 'design.typography.audienceTitleSize', d.typography.audienceTitleSize, { type: 'number', min: 24, max: 110, step: 1 })}
      ${field('Подвал сайта, px', 'design.typography.footerSize', d.typography.footerSize, { type: 'number', min: 8, max: 28, step: 1 })}
      ${field('Бегущая строка, px', 'design.typography.tickerSize', d.typography.tickerSize, { type: 'number', min: 7, max: 24, step: 1 })}
      ${field('Подпись первого экрана, px', 'design.typography.heroNoteSize', d.typography.heroNoteSize, { type: 'number', min: 8, max: 28, step: 1 })}
      ${field('Заголовок плавающей карточки, px', 'design.typography.floatingTitleSize', d.typography.floatingTitleSize, { type: 'number', min: 14, max: 46, step: 1 })}
      ${field('Подписи фотографий, px', 'design.typography.portfolioLabelSize', d.typography.portfolioLabelSize, { type: 'number', min: 8, max: 28, step: 1 })}
      ${field('Характеристики альбомов, px', 'design.typography.detailSize', d.typography.detailSize, { type: 'number', min: 9, max: 28, step: 1 })}
    </div></div>
    <div class="card"><h3>Начертание и интервалы</h3><div class="grid three">
      ${selectField('Толщина основного текста', 'design.typography.bodyWeight', d.typography.bodyWeight, weights)}
      ${selectField('Толщина заголовков', 'design.typography.headingWeight', d.typography.headingWeight, weights)}
      ${selectField('Толщина кнопок и меню', 'design.typography.interfaceWeight', d.typography.interfaceWeight, weights)}
      ${selectField('Толщина названия бренда', 'design.typography.brandWeight', d.typography.brandWeight, weights)}
      ${selectField('Стиль заголовков', 'design.typography.headingStyle', d.typography.headingStyle, [['normal', 'Обычный'], ['italic', 'Курсив']])}
      ${selectField('Регистр заголовков', 'design.typography.headingTransform', d.typography.headingTransform, [['none', 'Как введено'], ['uppercase', 'ПРОПИСНЫЕ'], ['lowercase', 'строчные'], ['capitalize', 'Каждое Слово']])}
      ${field('Межстрочный интервал текста', 'design.typography.bodyLineHeight', d.typography.bodyLineHeight, { type: 'number', min: .8, max: 3, step: .05 })}
      ${field('Межстрочный интервал заголовков', 'design.typography.headingLineHeight', d.typography.headingLineHeight, { type: 'number', min: .7, max: 2, step: .01 })}
      ${field('Разрядка текста, em', 'design.typography.bodyLetterSpacing', d.typography.bodyLetterSpacing, { type: 'number', min: -.2, max: .5, step: .005 })}
      ${field('Разрядка заголовков, em', 'design.typography.headingLetterSpacing', d.typography.headingLetterSpacing, { type: 'number', min: -.2, max: .5, step: .005 })}
      ${field('Разрядка надзаголовков, em', 'design.typography.eyebrowLetterSpacing', d.typography.eyebrowLetterSpacing, { type: 'number', min: 0, max: .8, step: .01 })}
    </div></div>
    <div class="card"><h3>Цветовая палитра</h3><div class="grid three">
      ${colorField('Фон сайта', 'design.colors.background', d.colors.background)}
      ${colorField('Основной текст', 'design.colors.text', d.colors.text)}
      ${colorField('Вторичный текст', 'design.colors.muted', d.colors.muted)}
      ${colorField('Акцент', 'design.colors.accent', d.colors.accent)}
      ${colorField('Тёмный акцент', 'design.colors.accentDark', d.colors.accentDark)}
      ${colorField('Тёмные секции', 'design.colors.dark', d.colors.dark)}
      ${colorField('Текст на тёмном фоне', 'design.colors.darkText', d.colors.darkText)}
      ${colorField('Карточки', 'design.colors.surface', d.colors.surface)}
      ${colorField('Линии и границы', 'design.colors.border', d.colors.border)}
      ${colorField('Фон блока для родителей', 'design.colors.audience', d.colors.audience)}
      ${colorField('Фон буквенного логотипа', 'design.colors.logoBackground', d.colors.logoBackground)}
      ${colorField('Текст буквенного логотипа', 'design.colors.logoText', d.colors.logoText)}
    </div></div>
    <div class="card"><h3>Форма и компоновка</h3><div class="grid three">
      ${field('Высота шапки, px', 'design.layout.headerHeight', d.layout.headerHeight, { type: 'number', min: 56, max: 150, step: 1 })}
      ${field('Вертикальные отступы разделов, px', 'design.layout.sectionSpacing', d.layout.sectionSpacing, { type: 'number', min: 30, max: 240, step: 1 })}
      ${field('Боковые поля, px', 'design.layout.contentSidePadding', d.layout.contentSidePadding, { type: 'number', min: 16, max: 180, step: 1 })}
      ${field('Скругление кнопок, px', 'design.layout.buttonRadius', d.layout.buttonRadius, { type: 'number', min: 0, max: 999, step: 1 })}
      ${field('Скругление карточек, px', 'design.layout.cardRadius', d.layout.cardRadius, { type: 'number', min: 0, max: 80, step: 1 })}
      ${field('Скругление фотографий, px', 'design.layout.imageRadius', d.layout.imageRadius, { type: 'number', min: 0, max: 100, step: 1 })}
      ${field('Размер буквенного знака, px', 'design.layout.logoMarkSize', d.layout.logoMarkSize, { type: 'number', min: 24, max: 100, step: 1 })}
      ${field('Ширина графического логотипа, px', 'design.layout.logoImageWidth', d.layout.logoImageWidth, { type: 'number', min: 50, max: 420, step: 1 })}
      ${field('Прозрачность шапки', 'design.layout.headerOpacity', d.layout.headerOpacity, { type: 'number', min: 0, max: 1, step: .01 })}
      ${field('Размытие фона шапки, px', 'design.layout.headerBlur', d.layout.headerBlur, { type: 'number', min: 0, max: 50, step: 1 })}
    </div></div>
    <div class="card"><div class="card-title-row"><h3>Предварительный просмотр</h3><a href="../" target="_blank" class="secondary link-button">Открыть полный сайт ↗</a></div><div id="designPreview" class="design-preview"><p class="preview-eyebrow">Премиальная школьная фотография</p><h4>История класса остаётся навсегда</h4><p>Пример основного текста, карточки и акцентной кнопки.</p><button>Выбрать альбом</button></div></div>`;
}

function refreshDesignPreview() {
  const node = $('#designPreview');
  if (!node) return;
  const d = data.design;
  const fontLink = $('#adminCustomFontStylesheet');
  const fontUrl = String(d.fonts.stylesheetUrl || '').trim();
  if (/^https:\/\//i.test(fontUrl)) {
    fontLink.href = fontUrl;
    fontLink.disabled = false;
  } else {
    fontLink.removeAttribute('href');
    fontLink.disabled = true;
  }
  node.style.setProperty('--p-body', d.fonts.body);
  node.style.setProperty('--p-heading', d.fonts.heading);
  node.style.setProperty('--p-ui', d.fonts.interface);
  node.style.setProperty('--p-bg', d.colors.background);
  node.style.setProperty('--p-text', d.colors.text);
  node.style.setProperty('--p-muted', d.colors.muted);
  node.style.setProperty('--p-accent', d.colors.accent);
  node.style.setProperty('--p-surface', d.colors.surface);
  node.style.setProperty('--p-radius', `${d.layout.cardRadius}px`);
  node.style.setProperty('--p-button-radius', `${d.layout.buttonRadius}px`);
  node.style.setProperty('--p-title-size', `${Math.min(Number(d.typography.sectionTitleSize) || 60, 72)}px`);
  node.style.setProperty('--p-body-size', `${d.typography.baseSize}px`);
  node.style.setProperty('--p-weight', d.typography.headingWeight);
  node.style.setProperty('--p-letter', `${d.typography.headingLetterSpacing}em`);
  node.style.setProperty('--p-line', d.typography.headingLineHeight);
  node.style.setProperty('--p-style', d.typography.headingStyle);
  node.style.setProperty('--p-transform', d.typography.headingTransform);
}

function pageTextEditor() {
  if (currentTextPage === 'landing') {
    const p = data.landing;
    ws.innerHTML = `${textPageSwitcher()}
      <div class="notice">Здесь редактируются все тексты главной страницы выбора направления.</div>
      <div class="card"><h3>SEO и первый экран</h3><div class="grid">
        ${field('Заголовок страницы браузера', 'landing.seoTitle', p.seoTitle)}
        ${field('Описание для поисковых систем', 'landing.seoDescription', p.seoDescription, { type: 'textarea' })}
        ${field('Надзаголовок', 'landing.eyebrow', p.eyebrow)}
        ${field('Главный заголовок', 'landing.title', p.title, { type: 'textarea' })}
        ${field('Вводный текст', 'landing.text', p.text, { type: 'textarea' })}
      </div></div>
      <div class="card"><h3>Карточка «Школа»</h3><div class="page-image-editor">
        <div><div class="preview"><img src="${esc(assetUrl(p.schoolCard.image))}"></div><label class="upload-btn">Заменить изображение<input type="file" accept="image/*" data-upload="landing.schoolCard.image"></label></div>
        <div class="grid">
          ${field('Метка', 'landing.schoolCard.label', p.schoolCard.label)}
          ${field('Заголовок', 'landing.schoolCard.title', p.schoolCard.title)}
          ${field('Описание', 'landing.schoolCard.text', p.schoolCard.text, { type: 'textarea' })}
          ${field('Текст кнопки', 'landing.schoolCard.button', p.schoolCard.button)}
        </div>
      </div></div>
      <div class="card"><h3>Карточка «Детский сад»</h3><div class="page-image-editor">
        <div><div class="preview"><img src="${esc(assetUrl(p.kindergartenCard.image))}"></div><label class="upload-btn">Заменить изображение<input type="file" accept="image/*" data-upload="landing.kindergartenCard.image"></label></div>
        <div class="grid">
          ${field('Метка', 'landing.kindergartenCard.label', p.kindergartenCard.label)}
          ${field('Заголовок', 'landing.kindergartenCard.title', p.kindergartenCard.title)}
          ${field('Описание', 'landing.kindergartenCard.text', p.kindergartenCard.text, { type: 'textarea' })}
          ${field('Текст кнопки', 'landing.kindergartenCard.button', p.kindergartenCard.button)}
        </div>
      </div></div>
      <div class="card"><h3>Финальный призыв</h3><div class="grid">
        ${field('Надзаголовок', 'landing.ctaEyebrow', p.ctaEyebrow)}
        ${field('Заголовок', 'landing.ctaTitle', p.ctaTitle, { type: 'textarea' })}
        ${field('Текст кнопки', 'landing.ctaButton', p.ctaButton)}
      </div></div>`;
    return;
  }

  const key = currentTextPage;
  const p = data.pages[key];
  const path = `pages.${key}`;
  ws.innerHTML = `${textPageSwitcher()}
    <div class="notice">Редактируется страница «${esc(p.label)}». Все тексты ниже публикуются только на выбранной странице.</div>
    <div class="card"><h3>SEO и название направления</h3><div class="grid">
      ${field('Название направления', `${path}.label`, p.label)}
      ${field('Заголовок страницы браузера', `${path}.seoTitle`, p.seoTitle)}
      ${field('Описание для поисковых систем', `${path}.seoDescription`, p.seoDescription, { type: 'textarea' })}
      ${field('Текст подвала страницы', `${path}.footerDescription`, p.footerDescription, { type: 'textarea' })}
    </div></div>
    <div class="card"><h3>Первый экран</h3><div class="page-image-editor">
      <div><div class="preview"><img src="${esc(assetUrl(p.hero.image))}"></div><label class="upload-btn">Заменить главное изображение<input type="file" accept="image/*" data-upload="${path}.hero.image"></label></div>
      <div class="grid">
        ${field('Надзаголовок', `${path}.hero.eyebrow`, p.hero.eyebrow)}
        ${field('Главный заголовок', `${path}.hero.title`, p.hero.title, { type: 'textarea' })}
        ${field('Описание', `${path}.hero.text`, p.hero.text, { type: 'textarea' })}
        ${field('Основная кнопка', `${path}.hero.primaryButton`, p.hero.primaryButton)}
        ${field('Вторая ссылка', `${path}.hero.secondaryButton`, p.hero.secondaryButton)}
        ${field('Номер заметки', `${path}.hero.noteNumber`, p.hero.noteNumber)}
        ${field('Текст заметки', `${path}.hero.noteText`, p.hero.noteText, { type: 'textarea' })}
        ${field('Заголовок плашки на фото', `${path}.hero.floatingTitle`, p.hero.floatingTitle)}
        ${field('Подпись плашки на фото', `${path}.hero.floatingText`, p.hero.floatingText)}
        ${field('Бегущая строка', `${path}.ticker`, p.ticker, { type: 'textarea' })}
      </div>
    </div></div>
    <div class="card"><h3>Заголовки разделов</h3><div class="section-copy-grid">
      ${sectionTextFields('Альбомы', `${path}.sections.albums`, p.sections.albums, true)}
      ${sectionTextFields('Портфолио', `${path}.sections.portfolio`, p.sections.portfolio, true)}
      ${sectionTextFields('Процесс', `${path}.sections.process`, p.sections.process, true)}
      ${sectionTextFields('Отзывы', `${path}.sections.reviews`, p.sections.reviews, false)}
      ${sectionTextFields('FAQ', `${path}.sections.faq`, p.sections.faq, false)}
    </div></div>
    <div class="card"><h3>Блоки для взрослых</h3><div class="grid">
      ${field('Надзаголовок: родители', `${path}.audience.parents.eyebrow`, p.audience.parents.eyebrow)}
      ${field('Заголовок: родители', `${path}.audience.parents.title`, p.audience.parents.title, { type: 'textarea' })}
      ${field('Текст: родители', `${path}.audience.parents.text`, p.audience.parents.text, { type: 'textarea' })}
      ${field('Надзаголовок: учителя / воспитатели', `${path}.audience.teachers.eyebrow`, p.audience.teachers.eyebrow)}
      ${field('Заголовок: учителя / воспитатели', `${path}.audience.teachers.title`, p.audience.teachers.title, { type: 'textarea' })}
      ${field('Текст: учителя / воспитатели', `${path}.audience.teachers.text`, p.audience.teachers.text, { type: 'textarea' })}
    </div></div>
    <div class="card"><h3>Финальный призыв</h3><div class="grid">
      ${field('Надзаголовок', `${path}.cta.eyebrow`, p.cta.eyebrow)}
      ${field('Заголовок', `${path}.cta.title`, p.cta.title, { type: 'textarea' })}
      ${field('Текст кнопки', `${path}.cta.button`, p.cta.button)}
    </div></div>`;
}

function sectionTextFields(title, path, section, withIntro) {
  return `<div class="section-copy-card"><h4>${title}</h4>
    ${field('Надзаголовок', `${path}.eyebrow`, section.eyebrow)}
    ${field('Заголовок', `${path}.title`, section.title, { type: 'textarea' })}
    ${withIntro ? field('Вводный текст', `${path}.intro`, section.intro, { type: 'textarea' }) : ''}
  </div>`;
}

function albums() {
  const page = data.pages[currentDirection];
  const basePath = `pages.${currentDirection}.albums`;
  ws.innerHTML = `${directionSwitcher()}<div class="notice">Альбомы редактируются отдельно для школы и детского сада.</div>` + page.albums.map((album, albumIndex) => `
    <div class="card"><h3>${esc(album.name)}</h3><div class="album-editor">
      <div><div class="preview"><img src="${esc(assetUrl(album.cover))}"></div><label class="upload-btn">Заменить обложку<input type="file" accept="image/*" data-upload="${basePath}.${albumIndex}.cover"></label></div>
      <div><div class="grid">
        ${field('Название', `${basePath}.${albumIndex}.name`, album.name)}
        ${field('Цена', `${basePath}.${albumIndex}.price`, album.price)}
        ${field('Метка', `${basePath}.${albumIndex}.badge`, album.badge)}
        ${field('Короткое описание', `${basePath}.${albumIndex}.lead`, album.lead, { type: 'textarea' })}
      </div>
      <h4>Характеристики</h4>
      ${(album.details || []).map((detail, detailIndex) => field(`Строка ${detailIndex + 1}`, `${basePath}.${albumIndex}.details.${detailIndex}`, detail)).join('')}
      <h4>Дополнительная галерея альбома</h4>
      <div class="gallery-grid">${(album.gallery || []).map((image, imageIndex) => `<div class="gallery-item"><img src="${esc(assetUrl(image))}"><button data-remove-gallery="${albumIndex}.${imageIndex}">×</button></div>`).join('')}</div>
      <label class="upload-btn">Добавить фото<input type="file" accept="image/*" data-gallery-add="${albumIndex}"></label>
      </div></div></div>`).join('');

  ws.querySelectorAll('[data-remove-gallery]').forEach((button) => {
    button.onclick = () => {
      const [albumIndex, imageIndex] = button.dataset.removeGallery.split('.').map(Number);
      page.albums[albumIndex].gallery.splice(imageIndex, 1);
      setSavingState('Есть несохранённые изменения');
      render();
    };
  });
  ws.querySelectorAll('[data-gallery-add]').forEach((input) => {
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.disabled = true;
      setSavingState('Загрузка фотографии…');
      try {
        const url = await uploadFile(file);
        page.albums[Number(input.dataset.galleryAdd)].gallery.push(url);
        setSavingState('Есть несохранённые изменения');
        render();
        toast('Фотография добавлена. Нажмите «Сохранить».');
      } catch (error) { alert(`Не удалось загрузить изображение: ${error.message}`); }
      finally { input.disabled = false; }
    };
  });
}

function portfolioEditor() {
  const page = data.pages[currentDirection];
  const basePath = `pages.${currentDirection}.portfolio`;
  ws.innerHTML = `${directionSwitcher()}
    <div class="notice">Фотографии и подписи портфолио независимы от галерей альбомов. Их можно добавлять, удалять и менять местами вручную через удаление и повторное добавление.</div>
    <div class="portfolio-admin-grid">${page.portfolio.map((item, index) => `
      <div class="card portfolio-admin-card">
        <div class="preview"><img src="${esc(assetUrl(item.image))}"></div>
        <label class="upload-btn">Заменить фотографию<input type="file" accept="image/*" data-upload="${basePath}.${index}.image"></label>
        ${field('Подпись', `${basePath}.${index}.label`, item.label)}
        <div class="row-actions"><button class="danger" data-remove-portfolio="${index}">Удалить</button></div>
      </div>`).join('')}</div>
    <button id="addPortfolio" class="secondary">Добавить фотографию</button>`;

  ws.querySelectorAll('[data-remove-portfolio]').forEach((button) => {
    button.onclick = () => {
      page.portfolio.splice(Number(button.dataset.removePortfolio), 1);
      setSavingState('Есть несохранённые изменения');
      render();
    };
  });
  $('#addPortfolio').onclick = () => {
    page.portfolio.push({ image: 'assets/images/demo-01.svg', label: 'Новая фотография' });
    setSavingState('Есть несохранённые изменения');
    render();
  };
}

function repeatEditor(kind) {
  const page = data.pages[currentDirection];
  const basePath = `pages.${currentDirection}.${kind}`;
  const config = {
    process: { title: 'Этапы', first: 'title', second: 'text' },
    faq: { title: 'Вопросы и ответы', first: 'q', second: 'a' },
    reviews: { title: 'Отзывы', first: 'name', second: 'text' }
  }[kind];
  ws.innerHTML = `${directionSwitcher()}<div class="notice">Раздел редактируется отдельно для направления «${esc(page.label)}».</div>
    <div class="card"><h3>${config.title}</h3>${page[kind].map((item, index) => `
      <div class="repeat"><div class="grid">
        ${field(kind === 'faq' ? 'Вопрос' : kind === 'reviews' ? 'Автор' : 'Название', `${basePath}.${index}.${config.first}`, item[config.first])}
        ${field(kind === 'faq' ? 'Ответ' : kind === 'reviews' ? 'Текст отзыва' : 'Описание', `${basePath}.${index}.${config.second}`, item[config.second], { type: 'textarea' })}
      </div><div class="row-actions"><button class="danger" data-remove="${index}">Удалить</button></div></div>`).join('')}
      <button id="addItem" class="secondary">Добавить</button></div>`;
  ws.querySelectorAll('[data-remove]').forEach((button) => {
    button.onclick = () => {
      page[kind].splice(Number(button.dataset.remove), 1);
      setSavingState('Есть несохранённые изменения');
      render();
    };
  });
  $('#addItem').onclick = () => {
    page[kind].push(kind === 'faq'
      ? { q: 'Новый вопрос', a: 'Ответ' }
      : kind === 'reviews'
        ? { name: 'Имя', text: 'Текст отзыва' }
        : { title: 'Новый этап', text: 'Описание' });
    setSavingState('Есть несохранённые изменения');
    render();
  };
}

function dataTools() {
  ws.innerHTML = `
    <div class="notice">Экспорт сохраняет тексты, настройки дизайна и ссылки на изображения. Сами файлы продолжают храниться в Supabase Storage.</div>
    <div class="card"><h3>Управление данными</h3><div class="data-actions">
      <button id="exportBtn">Экспортировать JSON</button>
      <label class="secondary">Импортировать JSON<input id="importInput" type="file" accept="application/json" hidden></label>
      <button id="resetStats">Очистить базовую статистику</button>
      <button id="resetDesign">Вернуть стандартный дизайн</button>
      <button id="resetAll" class="danger">Вернуть весь тестовый контент</button>
    </div></div>`;
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'school-album-content.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  $('#importInput').onchange = (event) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        data = mergeDefaults(window.DEFAULT_CONTENT, JSON.parse(reader.result));
        setSavingState('Импортирован контент — нажмите «Сохранить»');
        render();
      } catch { alert('Некорректный JSON-файл.'); }
    };
    reader.readAsText(event.target.files[0]);
  };
  $('#resetStats').onclick = async () => {
    if (!confirm('Удалить всю базовую статистику сайта?')) return;
    const { error } = await db.from('site_events').delete().gte('id', 0);
    if (error) alert(`Не удалось очистить статистику: ${error.message}`);
    else { toast('Статистика очищена'); render(); }
  };
  $('#resetDesign').onclick = () => {
    if (!confirm('Вернуть стандартные шрифты, цвета и размеры? Контент и фотографии останутся без изменений.')) return;
    data.design = clone(window.DEFAULT_CONTENT.design);
    setSavingState('Стандартный дизайн восстановлен — нажмите «Сохранить»');
    render();
  };
  $('#resetAll').onclick = () => {
    if (!confirm('Вернуть все тестовые тексты, настройки и тестовые изображения?')) return;
    data = clone(window.DEFAULT_CONTENT);
    setSavingState('Тестовый контент восстановлен — нажмите «Сохранить»');
    render();
  };
}

initialize().catch((error) => showLoginMessage(error.message || 'Ошибка инициализации.', true));
