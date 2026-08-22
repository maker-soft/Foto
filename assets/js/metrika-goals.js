(function(){
  'use strict';

  const COUNTER_ID = 111851028;
  let lastRoute = '';

  function sendGoal(name, params){
    if(typeof window.ym !== 'function') return;
    try{
      window.ym(COUNTER_ID, 'reachGoal', name, params || {});
    }catch(_){/* analytics must never break the site */}
  }

  function sendOncePerSession(name, params){
    const key = `metrika-goal:${name}`;
    try{
      if(sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
    }catch(_){/* fall through when storage is unavailable */}
    sendGoal(name, params);
  }

  function currentRoute(){
    const hash = (location.hash || '').replace(/^#/, '');
    const parts = hash.split('/').filter(Boolean);
    const path = location.pathname.replace(/\/+$/, '') || '/';

    if(parts[0] === 'contacts') return {view:'contacts'};
    if(parts[0] === 'direction'){
      return {
        view:'direction',
        dir:parts[1] || '',
        section:parts[2] || '',
        item:parts[3] || ''
      };
    }
    if(path.endsWith('/school')) return {view:'direction', dir:'school', section:'albums', item:''};
    if(path.endsWith('/kindergarten')) return {view:'direction', dir:'kindergarten', section:'albums', item:''};
    return {view:'home'};
  }

  function routeKey(route){
    return [route.view, route.dir, route.section, route.item].filter(Boolean).join('/');
  }

  function trackCurrentRoute(){
    const route = currentRoute();
    const key = routeKey(route);
    if(key === lastRoute) return;
    lastRoute = key;

    if(route.view === 'contacts'){
      sendOncePerSession('view_contacts');
      return;
    }

    if(route.view === 'direction'){
      if(route.dir === 'school') sendOncePerSession('view_school');
      if(route.dir === 'kindergarten') sendOncePerSession('view_kindergarten');

      if(route.section === 'albums' && route.item){
        sendGoal('view_album', {
          direction: route.dir,
          album_id: route.item
        });
      }
    }
  }

  function clickTarget(event){
    const node = event.target;
    return node && node.closest ? node.closest('[data-go], a[href]') : null;
  }

  document.addEventListener('click', function(event){
    const el = clickTarget(event);
    if(!el) return;

    const go = String(el.getAttribute('data-go') || '');
    const label = String(el.textContent || '').trim();

    if(go === 'contacts' && /обсудить\s+съ[её]мку/i.test(label)){
      const route = currentRoute();
      sendGoal('lead_discuss', {direction: route.dir || 'general'});
    }

    if(el.matches('.video-button')){
      sendGoal('view_video');
    }

    if(el.matches('.contacts-actions a')){
      let channel = 'external';
      try{
        const url = new URL(el.href, location.href);
        if(/(^|\.)vk\.com$/i.test(url.hostname)) channel = 'vk';
        else if(/(^|\.)max\.ru$/i.test(url.hostname)) channel = 'max';
      }catch(_){/* keep external */}
      sendGoal('lead_contact', {channel: channel});
    }
  }, true);

  window.addEventListener('hashchange', function(){
    setTimeout(trackCurrentRoute, 0);
  });
  window.addEventListener('popstate', function(){
    setTimeout(trackCurrentRoute, 0);
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', trackCurrentRoute, {once:true});
  }else{
    trackCurrentRoute();
  }
})();
