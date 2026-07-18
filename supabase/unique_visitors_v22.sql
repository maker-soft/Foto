-- График уникальных посетителей v22.
-- Выполните файл целиком в Supabase SQL Editor после загрузки файлов сайта.
-- Обновление совместимо со старой и новой версией фронтенда.

alter table public.site_visits
  add column if not exists visitor_id uuid;

-- Для старых записей точный постоянный идентификатор восстановить невозможно,
-- поэтому исторические данные временно считаются по идентификатору сеанса.
update public.site_visits
set visitor_id = session_id
where visitor_id is null;

alter table public.site_visits
  alter column visitor_id set not null;

create index if not exists site_visits_visitor_idx
  on public.site_visits(visitor_id, created_at desc);

create or replace function public.track_page_view(
  p_visitor_id uuid,
  p_session_id uuid,
  p_path text,
  p_referrer_host text default '',
  p_device text default 'desktop',
  p_screen_width integer default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visitor_id is null or p_session_id is null or p_path is null or char_length(p_path) not between 1 and 160 then return; end if;
  if p_path !~ '^[a-zA-Z0-9/_-]+$' then return; end if;
  if p_device not in ('mobile','tablet','desktop') then return; end if;
  if coalesce(p_screen_width,0) not between 0 and 10000 then return; end if;
  if char_length(coalesce(p_referrer_host,'')) > 160 then return; end if;
  if (select count(*) from public.site_visits where created_at > now() - interval '1 minute') > 1000 then return; end if;
  if exists (
    select 1 from public.site_visits
    where session_id=p_session_id and path=p_path and created_at > now()-interval '2 seconds'
  ) then return; end if;

  insert into public.site_visits(visitor_id,session_id,path,referrer_host,device,screen_width)
  values (p_visitor_id,p_session_id,p_path,lower(coalesce(p_referrer_host,'')),p_device,coalesce(p_screen_width,0));

  if random() < 0.005 then
    delete from public.site_visits where created_at < now()-interval '400 days';
  end if;
end;
$$;

revoke all on function public.track_page_view(uuid,uuid,text,text,text,integer) from public;
grant execute on function public.track_page_view(uuid,uuid,text,text,text,integer) to anon, authenticated;

-- Совместимость: старая версия сайта продолжит записывать статистику,
-- используя идентификатор сеанса как временный идентификатор посетителя.
create or replace function public.track_page_view(
  p_session_id uuid,
  p_path text,
  p_referrer_host text default '',
  p_device text default 'desktop',
  p_screen_width integer default 0
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.track_page_view(
    p_session_id,
    p_session_id,
    p_path,
    p_referrer_host,
    p_device,
    p_screen_width
  );
$$;

revoke all on function public.track_page_view(uuid,text,text,text,integer) from public;
grant execute on function public.track_page_view(uuid,text,text,text,integer) to anon, authenticated;

create or replace function public.get_site_stats(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_days integer := coalesce(p_days,30);
  d integer;
  site_tz text := 'Asia/Novosibirsk';
  today_start timestamptz;
  period_start timestamptz;
  result jsonb;
begin
  if not private.is_site_admin() then
    raise exception 'access denied' using errcode='42501';
  end if;

  d := case when requested_days = 0 then 1 else greatest(1,least(requested_days,365)) end;
  today_start := date_trunc('day', now() at time zone site_tz) at time zone site_tz;
  period_start := case
    when requested_days = 0 then today_start
    else today_start - make_interval(days => d - 1)
  end;

  select jsonb_build_object(
    'period_mode', case when requested_days = 0 then 'today' else 'days' end,
    'timezone', site_tz,
    'pageviews', (select count(*) from public.site_visits where created_at >= period_start),
    'sessions', (select count(distinct session_id) from public.site_visits where created_at >= period_start),
    'unique_visitors', (select count(distinct visitor_id) from public.site_visits where created_at >= period_start),
    'today_pageviews', (select count(*) from public.site_visits where created_at >= today_start),
    'today_sessions', (select count(distinct session_id) from public.site_visits where created_at >= today_start),
    'today_unique_visitors', (select count(distinct visitor_id) from public.site_visits where created_at >= today_start),
    'daily', coalesce((select jsonb_agg(to_jsonb(x) order by x.date) from (
      select to_char(g.day_local,'YYYY-MM-DD') date,
             count(v.id)::int pageviews,
             count(distinct v.session_id)::int sessions,
             count(distinct v.visitor_id)::int unique_visitors
      from generate_series(
        ((now() at time zone site_tz)::date - (d - 1))::timestamp,
        ((now() at time zone site_tz)::date)::timestamp,
        interval '1 day'
      ) as g(day_local)
      left join public.site_visits v
        on v.created_at >= (g.day_local at time zone site_tz)
       and v.created_at < ((g.day_local + interval '1 day') at time zone site_tz)
      group by g.day_local
    ) x),'[]'::jsonb),
    'pages', coalesce((select jsonb_agg(to_jsonb(x) order by x.pageviews desc, x.path) from (
      select path, count(*)::int pageviews, count(distinct session_id)::int sessions
      from public.site_visits
      where created_at >= period_start
      group by path
      order by pageviews desc, path
      limit 20
    ) x),'[]'::jsonb),
    'devices', coalesce((select jsonb_agg(to_jsonb(x) order by x.pageviews desc) from (
      select device, count(*)::int pageviews
      from public.site_visits
      where created_at >= period_start
      group by device
    ) x),'[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(to_jsonb(x) order by x.pageviews desc, x.referrer) from (
      select case when referrer_host='' then 'Прямые переходы' else referrer_host end referrer,
             count(*)::int pageviews
      from public.site_visits
      where created_at >= period_start
      group by referrer
      order by pageviews desc, referrer
      limit 20
    ) x),'[]'::jsonb),
    'security', jsonb_build_object(
      'failed_24h',(select count(*) from public.admin_security_events where event_type='login_failed' and created_at>now()-interval '24 hours'),
      'locked_24h',(select count(*) from public.admin_security_events where event_type='login_locked' and created_at>now()-interval '24 hours'),
      'success_7d',(select count(*) from public.admin_security_events where event_type='login_success' and created_at>now()-interval '7 days')
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_site_stats(integer) from public, anon;
grant execute on function public.get_site_stats(integer) to authenticated;
