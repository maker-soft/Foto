
(function(){
  const cfg=window.APP_CONFIG||{};
  const configured=Boolean(cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_URL.includes('YOUR_PROJECT')&&!cfg.SUPABASE_ANON_KEY.includes('YOUR_'));
  let client=null;
  if(configured&&window.supabase){client=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})}
  const clone=o=>JSON.parse(JSON.stringify(o));
  async function getContent(){
    if(!client)return {data:clone(window.DEFAULT_SITE_CONTENT),source:'default',configured:false};
    const {data,error}=await client.from('site_content').select('data').eq('id',cfg.CONTENT_ROW_ID||'main').maybeSingle();
    if(error)throw error;
    return {data:data?.data||clone(window.DEFAULT_SITE_CONTENT),source:data?'supabase':'default',configured:true};
  }
  async function saveContent(data){
    if(!client)throw new Error('Supabase не настроен');
    const {error}=await client.from('site_content').upsert({id:cfg.CONTENT_ROW_ID||'main',data,updated_at:new Date().toISOString()},{onConflict:'id'});
    if(error)throw error;
  }
  function safeName(name){return String(name||'image').toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(-80)||'image'}
  async function uploadImage(file,folder='uploads'){
    if(!client)throw new Error('Supabase не настроен');
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=`${folder}/${Date.now()}-${Math.random().toString(36).slice(2,9)}-${safeName(file.name.replace(/\.[^.]+$/,''))}.${ext}`;
    const {error}=await client.storage.from(cfg.STORAGE_BUCKET||'site-media').upload(path,file,{cacheControl:'31536000',upsert:false,contentType:file.type||undefined});
    if(error)throw error;
    const {data}=client.storage.from(cfg.STORAGE_BUCKET||'site-media').getPublicUrl(path);
    return data.publicUrl;
  }
  function storagePath(url){
    if(!url||!cfg.SUPABASE_URL)return null;
    const marker=`/storage/v1/object/public/${cfg.STORAGE_BUCKET||'site-media'}/`;
    const i=url.indexOf(marker);return i<0?null:decodeURIComponent(url.slice(i+marker.length));
  }
  async function deleteImage(url){const path=storagePath(url);if(!path||!client)return;const {error}=await client.storage.from(cfg.STORAGE_BUCKET||'site-media').remove([path]);if(error)throw error}
  async function login(password){if(!client)throw new Error('Supabase не настроен');return client.auth.signInWithPassword({email:cfg.ADMIN_EMAIL,password})}
  async function logout(){if(client)await client.auth.signOut()}
  async function session(){if(!client)return null;const {data}=await client.auth.getSession();return data.session}
  window.SiteBackend={configured,client,getContent,saveContent,uploadImage,deleteImage,login,logout,session};
})();
