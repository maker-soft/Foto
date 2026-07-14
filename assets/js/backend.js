(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const configured = Boolean(
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes('YOUR_PROJECT') &&
    !cfg.SUPABASE_ANON_KEY.includes('YOUR_')
  );

  let client = null;
  if (configured && window.supabase) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'lena-sibirskaya-admin-session'
      }
    });
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const allowedImageTypes = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
  ]);
  const maxUploadBytes = Number(cfg.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024;

  function randomId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto?.getRandomValues?.(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function safeFolder(folder) {
    return String(folder || 'uploads')
      .split('/')
      .map((part) => part.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48))
      .filter(Boolean)
      .slice(0, 6)
      .join('/') || 'uploads';
  }

  async function validateImageFile(file) {
    if (!(file instanceof File)) throw new Error('Некорректный файл');
    const extension = allowedImageTypes.get(file.type);
    if (!extension) throw new Error('Разрешены только JPG, PNG и WEBP');
    if (!file.size || file.size > maxUploadBytes) {
      throw new Error(`Максимальный размер файла — ${Math.round(maxUploadBytes / 1024 / 1024)} МБ`);
    }

    if ('createImageBitmap' in window) {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file);
        if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 12000 || bitmap.height > 12000) {
          throw new Error('Недопустимые размеры изображения');
        }
      } catch (error) {
        if (error?.message === 'Недопустимые размеры изображения') throw error;
        throw new Error('Файл не распознан как корректное изображение');
      } finally {
        bitmap?.close?.();
      }
    }
    return extension;
  }

  async function getContent() {
    if (!client) return { data: clone(window.DEFAULT_SITE_CONTENT), source: 'default', configured: false };
    const { data, error } = await client
      .from('site_content')
      .select('data')
      .eq('id', cfg.CONTENT_ROW_ID || 'main')
      .maybeSingle();
    if (error) throw error;
    return {
      data: data?.data || clone(window.DEFAULT_SITE_CONTENT),
      source: data ? 'supabase' : 'default',
      configured: true
    };
  }

  async function saveContent(data) {
    if (!client) throw new Error('Supabase не настроен');
    const { error } = await client.rpc('save_site_content', { p_data: data });
    if (error) throw error;
  }

  async function uploadImage(file, folder = 'uploads') {
    if (!client) throw new Error('Supabase не настроен');
    const extension = await validateImageFile(file);
    const path = `${safeFolder(folder)}/${Date.now()}-${randomId()}.${extension}`;
    const { error } = await client.storage
      .from(cfg.STORAGE_BUCKET || 'site-media')
      .upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type
      });
    if (error) {
      if (/permission denied for function is_site_admin/i.test(String(error.message || ''))) {
        throw new Error('В Supabase не применено исправление прав загрузки. Выполните файл supabase/fix_storage_permissions_v8.sql в SQL Editor.');
      }
      throw error;
    }
    const { data } = client.storage.from(cfg.STORAGE_BUCKET || 'site-media').getPublicUrl(path);
    return data.publicUrl;
  }

  function storagePath(url) {
    if (!url || !cfg.SUPABASE_URL) return null;
    const marker = `/storage/v1/object/public/${cfg.STORAGE_BUCKET || 'site-media'}/`;
    const index = String(url).indexOf(marker);
    if (index < 0) return null;
    const path = decodeURIComponent(String(url).slice(index + marker.length));
    return path.includes('..') ? null : path;
  }

  async function deleteImage(url) {
    const path = storagePath(url);
    if (!path || !client) return;
    const { error } = await client.storage.from(cfg.STORAGE_BUCKET || 'site-media').remove([path]);
    if (error) {
      if (/permission denied for function is_site_admin/i.test(String(error.message || ''))) {
        throw new Error('В Supabase не применено исправление прав удаления. Выполните файл supabase/fix_storage_permissions_v8.sql в SQL Editor.');
      }
      throw error;
    }
  }

  async function login(password, captchaToken = '') {
    if (!client) throw new Error('Supabase не настроен');
    const credentials = { email: cfg.ADMIN_EMAIL, password };
    if (captchaToken) credentials.options = { captchaToken };
    return client.auth.signInWithPassword(credentials);
  }

  async function logout() {
    if (client) await client.auth.signOut({ scope: 'local' });
  }

  async function session() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function isAdmin() {
    if (!client) return false;
    const { data, error } = await client.rpc('is_current_user_admin');
    if (error) return false;
    return data === true;
  }

  function analyticsSessionId() {
    const key = 'lena-site-analytics-session';
    try {
      let value = sessionStorage.getItem(key);
      if (!value) {
        value = randomId();
        sessionStorage.setItem(key, value);
      }
      return value;
    } catch (_) {
      return randomId();
    }
  }

  function deviceType() {
    const width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    if (width < 600) return 'mobile';
    if (width < 1100) return 'tablet';
    return 'desktop';
  }

  function referrerHost() {
    if (!document.referrer) return '';
    try {
      const url = new URL(document.referrer);
      return url.hostname === location.hostname ? '' : url.hostname.slice(0, 160);
    } catch (_) {
      return '';
    }
  }

  async function trackPageView(path) {
    if (!client || navigator.doNotTrack === '1') return;
    const cleanPath = String(path || 'home').replace(/[^a-z0-9/_-]/gi, '').slice(0, 160) || 'home';
    try {
      await client.rpc('track_page_view', {
        p_session_id: analyticsSessionId(),
        p_path: cleanPath,
        p_referrer_host: referrerHost(),
        p_device: deviceType(),
        p_screen_width: Math.min(10000, Math.max(0, Math.round(window.screen?.width || window.innerWidth || 0)))
      });
    } catch (_) {
      // Аналитика не должна мешать работе сайта.
    }
  }

  async function getSiteStats(days = 30) {
    if (!client) throw new Error('Supabase не настроен');
    const parsed = Number(days);
    const normalizedDays = Number.isFinite(parsed) ? Math.max(0, Math.min(365, Math.trunc(parsed))) : 30;
    const { data, error } = await client.rpc('get_site_stats', { p_days: normalizedDays });
    if (error) throw error;
    return data || {};
  }

  async function recordSecurityEvent(type) {
    if (!client) return;
    try {
      await client.rpc('record_security_event', {
        p_event_type: String(type || '').slice(0, 32),
        p_session_id: analyticsSessionId()
      });
    } catch (_) {
      // Журналирование не должно раскрывать детали ошибки входа.
    }
  }

  window.SiteBackend = {
    configured,
    client,
    getContent,
    saveContent,
    uploadImage,
    deleteImage,
    login,
    logout,
    session,
    isAdmin,
    trackPageView,
    getSiteStats,
    recordSecurityEvent
  };
})();
