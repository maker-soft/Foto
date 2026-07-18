(function () {
  'use strict';

  const FORMAT = 'lena-sibirskaya-portable-backup';
  const VERSION = 1;
  const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;
  const MAX_ENTRIES = 5000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function readU16(view, offset) { return view.getUint16(offset, true); }
  function readU32(view, offset) { return view.getUint32(offset, true); }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
      time: ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((Math.floor(date.getSeconds() / 2)) & 31),
      date: (((year - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
    };
  }

  function safeZipPath(name) {
    const value = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!value || value.length > 500 || value.includes('\0') || value.split('/').some((part) => part === '..')) {
      throw new Error('В архиве найдено небезопасное имя файла');
    }
    return value;
  }

  function concatUint8(parts, total) {
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  class StoreZipWriter {
    constructor() {
      this.parts = [];
      this.central = [];
      this.offset = 0;
    }

    add(name, input, date = new Date()) {
      const path = safeZipPath(name);
      const nameBytes = encoder.encode(path);
      const bytes = input instanceof Uint8Array ? input : encoder.encode(String(input));
      if (bytes.length > 0xffffffff) throw new Error(`Файл ${path} слишком большой для ZIP`);
      const checksum = crc32(bytes);
      const stamp = dosDateTime(date);
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      writeU32(view, 0, 0x04034b50);
      writeU16(view, 4, 20);
      writeU16(view, 6, 0x0800);
      writeU16(view, 8, 0);
      writeU16(view, 10, stamp.time);
      writeU16(view, 12, stamp.date);
      writeU32(view, 14, checksum);
      writeU32(view, 18, bytes.length);
      writeU32(view, 22, bytes.length);
      writeU16(view, 26, nameBytes.length);
      writeU16(view, 28, 0);
      header.set(nameBytes, 30);
      this.parts.push(header, bytes);
      this.central.push({ path, nameBytes, checksum, size: bytes.length, offset: this.offset, stamp });
      this.offset += header.length + bytes.length;
    }

    finish() {
      if (this.central.length > 0xffff) throw new Error('Слишком много файлов для ZIP');
      const centralParts = [];
      let centralSize = 0;
      for (const entry of this.central) {
        const header = new Uint8Array(46 + entry.nameBytes.length);
        const view = new DataView(header.buffer);
        writeU32(view, 0, 0x02014b50);
        writeU16(view, 4, 20);
        writeU16(view, 6, 20);
        writeU16(view, 8, 0x0800);
        writeU16(view, 10, 0);
        writeU16(view, 12, entry.stamp.time);
        writeU16(view, 14, entry.stamp.date);
        writeU32(view, 16, entry.checksum);
        writeU32(view, 20, entry.size);
        writeU32(view, 24, entry.size);
        writeU16(view, 28, entry.nameBytes.length);
        writeU16(view, 30, 0);
        writeU16(view, 32, 0);
        writeU16(view, 34, 0);
        writeU16(view, 36, 0);
        writeU32(view, 38, 0);
        writeU32(view, 42, entry.offset);
        header.set(entry.nameBytes, 46);
        centralParts.push(header);
        centralSize += header.length;
      }
      if (this.offset > 0xffffffff || centralSize > 0xffffffff) throw new Error('Архив превышает допустимый размер ZIP');
      const end = new Uint8Array(22);
      const endView = new DataView(end.buffer);
      writeU32(endView, 0, 0x06054b50);
      writeU16(endView, 4, 0);
      writeU16(endView, 6, 0);
      writeU16(endView, 8, this.central.length);
      writeU16(endView, 10, this.central.length);
      writeU32(endView, 12, centralSize);
      writeU32(endView, 16, this.offset);
      writeU16(endView, 20, 0);
      return new Blob([...this.parts, ...centralParts, end], { type: 'application/zip' });
    }
  }

  function parseStoreZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const lowerBound = Math.max(0, bytes.length - 65557);
    let endOffset = -1;
    for (let i = bytes.length - 22; i >= lowerBound; i -= 1) {
      if (readU32(view, i) === 0x06054b50) { endOffset = i; break; }
    }
    if (endOffset < 0) throw new Error('Файл не является поддерживаемым ZIP-архивом');
    const count = readU16(view, endOffset + 10);
    const centralSize = readU32(view, endOffset + 12);
    const centralOffset = readU32(view, endOffset + 16);
    if (count > MAX_ENTRIES || centralOffset + centralSize > bytes.length) throw new Error('Повреждена таблица файлов ZIP');

    const files = new Map();
    let cursor = centralOffset;
    let totalSize = 0;
    for (let index = 0; index < count; index += 1) {
      if (cursor + 46 > bytes.length || readU32(view, cursor) !== 0x02014b50) throw new Error('Повреждён каталог ZIP');
      const flags = readU16(view, cursor + 8);
      const method = readU16(view, cursor + 10);
      const checksum = readU32(view, cursor + 16);
      const compressedSize = readU32(view, cursor + 20);
      const size = readU32(view, cursor + 24);
      const nameLength = readU16(view, cursor + 28);
      const extraLength = readU16(view, cursor + 30);
      const commentLength = readU16(view, cursor + 32);
      const localOffset = readU32(view, cursor + 42);
      const nameStart = cursor + 46;
      const next = nameStart + nameLength + extraLength + commentLength;
      if (next > bytes.length) throw new Error('Повреждено имя файла ZIP');
      if (method !== 0 || compressedSize !== size) throw new Error('Архив использует неподдерживаемое сжатие. Выберите архив, созданный этой админкой.');
      if ((flags & 1) !== 0) throw new Error('Зашифрованные ZIP-файлы не поддерживаются');
      const name = safeZipPath(decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)));
      if (files.has(name)) throw new Error(`В ZIP повторяется файл ${name}`);
      if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== 0x04034b50) throw new Error(`Повреждён файл ${name}`);
      const localNameLength = readU16(view, localOffset + 26);
      const localExtraLength = readU16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + size;
      if (dataEnd > bytes.length) throw new Error(`Файл ${name} выходит за границы ZIP`);
      const data = bytes.subarray(dataStart, dataEnd);
      if (crc32(data) !== checksum) throw new Error(`Контрольная сумма файла ${name} не совпала`);
      files.set(name, data);
      totalSize += size;
      if (totalSize > MAX_ZIP_BYTES) throw new Error('Распакованный архив слишком большой');
      cursor = next;
    }
    return files;
  }

  function isImageReference(value) {
    const text = String(value || '').trim();
    return /^data:image\/(?:jpeg|png|webp);base64,/i.test(text) ||
      /\/storage\/v1\/object\/public\//i.test(text) ||
      /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(text);
  }

  function collectImageReferences(content) {
    const rawValues = new Set();
    const walk = (value, depth = 0) => {
      if (depth > 80 || value == null) return;
      if (typeof value === 'string') {
        if (isImageReference(value)) rawValues.add(value.trim());
        return;
      }
      if (Array.isArray(value)) { value.forEach((item) => walk(item, depth + 1)); return; }
      if (typeof value === 'object') Object.values(value).forEach((item) => walk(item, depth + 1));
    };
    walk(content);

    const groups = new Map();
    for (const raw of rawValues) {
      let resolved = raw;
      if (!/^data:/i.test(raw)) {
        if (/^assets\//i.test(raw)) resolved = new URL(`../${raw.replace(/^\.\//, '')}`, location.href).href;
        else resolved = new URL(raw, new URL('../', location.href)).href;
      }
      const key = resolved;
      if (!groups.has(key)) groups.set(key, { resolved, references: [] });
      groups.get(key).references.push(raw);
    }
    return [...groups.values()];
  }

  function sanitizeFileName(value) {
    return String(value || 'image')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || 'image';
  }

  function extensionFor(mime, url) {
    const byMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
    if (byMime[mime]) return byMime[mime];
    try {
      const match = new URL(url, location.href).pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (match && /^(jpe?g|png|webp|svg)$/i.test(match[1])) return match[1].toLowerCase().replace('jpeg', 'jpg');
    } catch (_) {}
    return 'bin';
  }

  function nameFromUrl(url, fallback) {
    try {
      const tail = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || '');
      return sanitizeFileName(tail || fallback);
    } catch (_) { return sanitizeFileName(fallback); }
  }

  async function dataUrlBytes(url) {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(url);
    if (!match) throw new Error('Некорректное изображение data URL');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime: match[1].toLowerCase() };
  }

  async function fetchBytes(url) {
    if (/^data:/i.test(url)) return dataUrlBytes(url);
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return { bytes, mime };
  }

  function replaceReferences(value, replacements, depth = 0) {
    if (depth > 80 || value == null) return value;
    if (typeof value === 'string') return replacements.has(value) ? replacements.get(value) : value;
    if (Array.isArray(value)) return value.map((item) => replaceReferences(item, replacements, depth + 1));
    if (typeof value === 'object') {
      const output = {};
      for (const [key, item] of Object.entries(value)) output[key] = replaceReferences(item, replacements, depth + 1);
      return output;
    }
    return value;
  }

  const PROJECT_FILES = [
    'index.html', '404.html', '.nojekyll', '.gitignore', 'README.md',
    'admin/index.html', 'admin/admin.js',
    'assets/css/site.css', 'assets/css/admin.css',
    'assets/js/config.js', 'assets/js/default-content.js', 'assets/js/backend.js', 'assets/js/site.js', 'assets/js/portable-backup.js',
    'assets/images/favicon.svg', 'assets/images/school-hero.webp', 'assets/images/kindergarten-hero.webp',
    'supabase/schema.sql', 'supabase/security_analytics_upgrade.sql', 'supabase/statistics_ui_upgrade_v7.sql', 'supabase/fix_storage_permissions_v8.sql', 'supabase/unique_visitors_v22.sql',
    'БЕЗОПАСНОСТЬ_И_СТАТИСТИКА.md', 'ИНСТРУКЦИЯ_РАЗВЕРТЫВАНИЯ.md', 'ПОЛНЫЙ_БЕКАП_С_ФО_V12.txt'
  ];

  const configExample = `window.APP_CONFIG = {\n  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",\n  SUPABASE_ANON_KEY: "YOUR_ANON_KEY",\n  ADMIN_EMAIL: "lena.foto@mail.ru",\n  STORAGE_BUCKET: "site-media",\n  CONTENT_ROW_ID: "main",\n  MAX_UPLOAD_BYTES: 10485760,\n  CAPTCHA_SITE_KEY: "",\n  REQUIRE_CAPTCHA: false\n};\n`;

  function migrationReadme(manifest) {
    return `ПОЛНАЯ ПЕРЕНОСИМАЯ КОПИЯ САЙТА «ЛЕНА СИБИРСКАЯ»\n\n` +
      `Дата создания: ${manifest.createdAt}\n` +
      `Исходный сайт: ${manifest.sourceUrl}\n` +
      `Фотографий: ${manifest.mediaCount}\n\n` +
      `СОДЕРЖИМОЕ АРХИВА\n` +
      `project/ — файлы сайта, админки и SQL-схемы.\n` +
      `backup/site-content.json — тексты, настройки и структура сайта.\n` +
      `backup/media-manifest.json — соответствие фотографий исходным адресам.\n` +
      `media/ — все фотографии, использованные в контенте.\n\n` +
      `ПЕРЕНОС НА ДРУГОЙ РЕСУРС\n` +
      `1. Разместите папку project на новом GitHub Pages или другом статическом хостинге.\n` +
      `2. Создайте новый проект Supabase и выполните SQL-файлы из project/supabase.\n` +
      `3. Создайте пользователя-администратора lena.foto@mail.ru.\n` +
      `4. Заполните project/assets/js/config.js данными нового Supabase. Пример находится в config.example.js.\n` +
      `5. Откройте /admin/ на новом сайте, войдите и выберите «Резервные копии» → «Восстановить полную ZIP-копию».\n` +
      `6. Выберите этот ZIP-файл. Админка загрузит все фотографии в новый Supabase Storage, заменит адреса и опубликует контент.\n\n` +
      `ВАЖНО\n` +
      `Пароль администратора, service_role и секрет CAPTCHA в архив не включаются. Файл config.js содержит только публичный anon key текущего проекта; при переносе замените его.\n`;
  }

  function fileName(prefix = 'full-backup') {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `lena-sibirskaya-${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.zip`;
  }

  async function create(content, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const writer = new StoreZipWriter();
    const groups = collectImageReferences(content);
    const media = [];
    const localReplacements = new Map();
    let mediaBytes = 0;

    onProgress({ stage: 'media', current: 0, total: groups.length, text: 'Подготовка списка фотографий' });
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      onProgress({ stage: 'media', current: i, total: groups.length, text: `Скачивание фотографии ${i + 1} из ${groups.length}` });
      let result;
      try { result = await fetchBytes(group.resolved); }
      catch (error) { throw new Error(`Не удалось скачать фотографию ${group.references[0]}: ${error.message}`); }
      const detectedMime = result.mime || '';
      if (!/^image\/(?:jpeg|png|webp)$/i.test(detectedMime) && !/\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(group.resolved)) {
        throw new Error(`Файл ${group.references[0]} не распознан как JPG, PNG или WEBP`);
      }
      const ext = extensionFor(detectedMime, group.resolved);
      const mime = /^image\/(?:jpeg|png|webp)$/i.test(detectedMime)
        ? detectedMime.toLowerCase()
        : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const original = nameFromUrl(group.resolved, `image-${i + 1}.${ext}`);
      const base = original.replace(/\.[^.]+$/, '') || `image-${i + 1}`;
      const path = `media/${String(i + 1).padStart(4, '0')}-${base}.${ext}`;
      writer.add(path, result.bytes);
      const entry = {
        file: path,
        mime: mime || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        size: result.bytes.length,
        crc32: crc32(result.bytes).toString(16).padStart(8, '0'),
        references: group.references
      };
      media.push(entry);
      mediaBytes += result.bytes.length;
      for (const ref of group.references) localReplacements.set(ref, path);
    }

    const projectIncluded = [];
    const projectMissing = [];
    const root = new URL('../', location.href);
    for (let i = 0; i < PROJECT_FILES.length; i += 1) {
      const path = PROJECT_FILES[i];
      onProgress({ stage: 'project', current: i, total: PROJECT_FILES.length, text: `Копирование файлов сайта: ${path}` });
      try {
        const response = await fetch(new URL(path, root).href, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        writer.add(`project/${path}`, bytes);
        projectIncluded.push(path);
      } catch (_) { projectMissing.push(path); }
    }
    writer.add('project/assets/js/config.example.js', configExample);

    const contentText = JSON.stringify(content, null, 2);
    const portableContent = replaceReferences(content, localReplacements);
    const manifest = {
      format: FORMAT,
      version: VERSION,
      createdAt: new Date().toISOString(),
      site: 'Лена Сибирская',
      sourceUrl: new URL('../', location.href).href,
      contentFile: 'backup/site-content.json',
      portableContentFile: 'backup/portable-content.json',
      mediaManifestFile: 'backup/media-manifest.json',
      mediaCount: media.length,
      mediaBytes,
      contentCrc32: crc32(encoder.encode(contentText)).toString(16).padStart(8, '0'),
      projectFilesIncluded: projectIncluded,
      projectFilesMissing: projectMissing
    };
    writer.add('backup/site-content.json', contentText);
    writer.add('backup/portable-content.json', JSON.stringify(portableContent, null, 2));
    writer.add('backup/media-manifest.json', JSON.stringify(media, null, 2));
    writer.add('backup/manifest.json', JSON.stringify(manifest, null, 2));
    writer.add('README_TRANSFER.txt', migrationReadme(manifest));

    onProgress({ stage: 'zip', current: 1, total: 1, text: 'Формирование ZIP-архива' });
    const blob = writer.finish();
    if (blob.size > MAX_ZIP_BYTES) throw new Error('Итоговый архив превышает 2 ГБ');
    return {
      blob,
      fileName: fileName(),
      summary: { mediaCount: media.length, mediaBytes, projectFiles: projectIncluded.length, missingProjectFiles: projectMissing.length, zipBytes: blob.size }
    };
  }

  function decodeJson(files, path) {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`В архиве отсутствует ${path}`);
    try { return JSON.parse(decoder.decode(bytes)); }
    catch (_) { throw new Error(`Не удалось прочитать ${path}`); }
  }

  async function parse(file, options = {}) {
    if (!(file instanceof File)) throw new Error('Файл не выбран');
    if (!/\.zip$/i.test(file.name)) throw new Error('Выберите полную резервную копию в формате ZIP');
    if (!file.size || file.size > MAX_ZIP_BYTES) throw new Error('Размер ZIP должен быть меньше 2 ГБ');
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    onProgress({ stage: 'parse', current: 0, total: 1, text: 'Проверка структуры ZIP-архива' });
    const files = parseStoreZip(await file.arrayBuffer());
    const manifest = decodeJson(files, 'backup/manifest.json');
    if (manifest.format !== FORMAT || Number(manifest.version) !== VERSION) throw new Error('Это не полная резервная копия данного сайта');
    const contentBytes = files.get(manifest.contentFile || 'backup/site-content.json');
    if (!contentBytes) throw new Error('В архиве отсутствуют данные сайта');
    const contentText = decoder.decode(contentBytes);
    if (manifest.contentCrc32 && crc32(encoder.encode(contentText)).toString(16).padStart(8, '0') !== manifest.contentCrc32) {
      throw new Error('Контрольная сумма данных сайта не совпала');
    }
    let content;
    try { content = JSON.parse(contentText); }
    catch (_) { throw new Error('Данные сайта в архиве повреждены'); }
    const mediaManifest = decodeJson(files, manifest.mediaManifestFile || 'backup/media-manifest.json');
    if (!Array.isArray(mediaManifest)) throw new Error('Повреждён список фотографий');
    const media = [];
    let mediaBytes = 0;
    for (let i = 0; i < mediaManifest.length; i += 1) {
      const entry = mediaManifest[i];
      const path = safeZipPath(entry.file);
      const bytes = files.get(path);
      if (!bytes) throw new Error(`В архиве отсутствует фотография ${path}`);
      if (Number(entry.size) !== bytes.length || String(entry.crc32 || '').toLowerCase() !== crc32(bytes).toString(16).padStart(8, '0')) {
        throw new Error(`Фотография ${path} повреждена`);
      }
      if (!Array.isArray(entry.references) || !entry.references.length) throw new Error(`Для ${path} отсутствует список ссылок`);
      media.push({ file: path, mime: String(entry.mime || 'image/jpeg'), bytes, references: entry.references.map(String) });
      mediaBytes += bytes.length;
      onProgress({ stage: 'parse', current: i + 1, total: mediaManifest.length, text: `Проверка фотографии ${i + 1} из ${mediaManifest.length}` });
    }
    return {
      fileName: file.name,
      manifest,
      content,
      media,
      summary: {
        mediaCount: media.length,
        mediaBytes,
        projectFiles: Array.isArray(manifest.projectFilesIncluded) ? manifest.projectFilesIncluded.length : 0,
        zipBytes: file.size
      }
    };
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  window.PortableBackup = { FORMAT, VERSION, create, parse, download, replaceReferences };
})();
