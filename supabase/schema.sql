-- Обновление безопасности и статистики для существующего проекта Supabase.
-- Запускайте целиком в SQL Editor ПОСЛЕ создания пользователя lena.foto@mail.ru в Authentication > Users.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);
revoke all on private.site_admins from public, anon, authenticated;

insert into private.site_admins (user_id, email)
select id, lower(email) from auth.users where lower(email) = 'lena.foto@mail.ru'
on conflict (user_id) do update set email = excluded.email;

create or replace function private.is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.site_admins a
    where a.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_site_admin() from public, anon, authenticated;

create table if not exists public.site_content (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint site_content_size check (octet_length(data::text) <= 2097152)
);
alter table public.site_content drop constraint if exists site_content_size;
alter table public.site_content add constraint site_content_size check (octet_length(data::text) <= 2097152);
alter table public.site_content enable row level security;
revoke insert, update, delete on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;

drop policy if exists "public can read site content" on public.site_content;
create policy "public can read site content" on public.site_content
for select to anon, authenticated using (true);

drop policy if exists "admin can insert site content" on public.site_content;
drop policy if exists "admin can update site content" on public.site_content;
drop policy if exists "admin can delete site content" on public.site_content;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select private.is_site_admin(); $$;
revoke all on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

create or replace function public.save_site_content(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_site_admin() then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid content';
  end if;
  if octet_length(p_data::text) > 2097152 then
    raise exception 'content is too large';
  end if;
  insert into public.site_content(id, data, updated_at)
  values ('main', p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.save_site_content(jsonb) from public, anon;
grant execute on function public.save_site_content(jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=10485760, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "public can read site media" on storage.objects;
create policy "public can read site media" on storage.objects
for select to anon, authenticated using (bucket_id = 'site-media');

drop policy if exists "admin can upload site media" on storage.objects;
create policy "admin can upload site media" on storage.objects
for insert to authenticated
with check (bucket_id = 'site-media' and (select private.is_site_admin()));

drop policy if exists "admin can update site media" on storage.objects;
create policy "admin can update site media" on storage.objects
for update to authenticated
using (bucket_id = 'site-media' and (select private.is_site_admin()))
with check (bucket_id = 'site-media' and (select private.is_site_admin()));

drop policy if exists "admin can delete site media" on storage.objects;
create policy "admin can delete site media" on storage.objects
for delete to authenticated
using (bucket_id = 'site-media' and (select private.is_site_admin()));

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null,
  path text not null check (char_length(path) between 1 and 160),
  referrer_host text not null default '' check (char_length(referrer_host) <= 160),
  device text not null check (device in ('mobile','tablet','desktop')),
  screen_width integer not null default 0 check (screen_width between 0 and 10000)
);
create index if not exists site_visits_created_at_idx on public.site_visits(created_at desc);
create index if not exists site_visits_session_idx on public.site_visits(session_id, created_at desc);
alter table public.site_visits enable row level security;
revoke all on public.site_visits from public, anon, authenticated;

create table if not exists public.admin_security_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null,
  event_type text not null check (event_type in ('login_failed','login_locked','login_success'))
);
create index if not exists admin_security_events_created_idx on public.admin_security_events(created_at desc);
alter table public.admin_security_events enable row level security;
revoke all on public.admin_security_events from public, anon, authenticated;

create or replace function public.track_page_view(
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
  if p_session_id is null or p_path is null or char_length(p_path) not between 1 and 160 then return; end if;
  if p_path !~ '^[a-zA-Z0-9/_-]+$' then return; end if;
  if p_device not in ('mobile','tablet','desktop') then return; end if;
  if coalesce(p_screen_width,0) not between 0 and 10000 then return; end if;
  if char_length(coalesce(p_referrer_host,'')) > 160 then return; end if;
  if (select count(*) from public.site_visits where created_at > now() - interval '1 minute') > 1000 then return; end if;
  if exists (select 1 from public.site_visits where session_id=p_session_id and path=p_path and created_at > now()-interval '2 seconds') then return; end if;
  insert into public.site_visits(session_id,path,referrer_host,device,screen_width)
  values (p_session_id,p_path,lower(coalesce(p_referrer_host,'')),p_device,coalesce(p_screen_width,0));
  if random() < 0.005 then delete from public.site_visits where created_at < now()-interval '400 days'; end if;
end;
$$;
revoke all on function public.track_page_view(uuid,text,text,text,integer) from public;
grant execute on function public.track_page_view(uuid,text,text,text,integer) to anon, authenticated;

create or replace function public.record_security_event(p_event_type text, p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_event_type not in ('login_failed','login_locked','login_success') then return; end if;
  if p_event_type='login_success' and not private.is_site_admin() then return; end if;
  if (select count(*) from public.admin_security_events where created_at > now()-interval '1 minute') > 300 then return; end if;
  if exists (select 1 from public.admin_security_events where session_id=p_session_id and event_type=p_event_type and created_at > now()-interval '5 seconds') then return; end if;
  insert into public.admin_security_events(session_id,event_type) values(p_session_id,p_event_type);
  if random() < 0.02 then delete from public.admin_security_events where created_at < now()-interval '90 days'; end if;
end;
$$;
revoke all on function public.record_security_event(text,uuid) from public;
grant execute on function public.record_security_event(text,uuid) to anon, authenticated;

create or replace function public.get_site_stats(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d integer := greatest(1,least(coalesce(p_days,30),365));
  result jsonb;
begin
  if not private.is_site_admin() then raise exception 'access denied' using errcode='42501'; end if;
  select jsonb_build_object(
    'pageviews', (select count(*) from public.site_visits where created_at >= now()-(d||' days')::interval),
    'sessions', (select count(distinct session_id) from public.site_visits where created_at >= now()-(d||' days')::interval),
    'today_pageviews', (select count(*) from public.site_visits where created_at >= date_trunc('day',now())),
    'today_sessions', (select count(distinct session_id) from public.site_visits where created_at >= date_trunc('day',now())),
    'daily', coalesce((select jsonb_agg(to_jsonb(x) order by x.date) from (
      select to_char(day,'YYYY-MM-DD') date,
             count(v.id)::int pageviews,
             count(distinct v.session_id)::int sessions
      from generate_series(current_date-(d-1),current_date,interval '1 day') day
      left join public.site_visits v on v.created_at >= day and v.created_at < day+interval '1 day'
      group by day
    ) x),'[]'::jsonb),
    'pages', coalesce((select jsonb_agg(to_jsonb(x) order by x.pageviews desc) from (
      select path, count(*)::int pageviews, count(distinct session_id)::int sessions
      from public.site_visits where created_at >= now()-(d||' days')::interval
      group by path order by pageviews desc limit 12
    ) x),'[]'::jsonb),
    'devices', coalesce((select jsonb_agg(to_jsonb(x) order by x.pageviews desc) from (
      select device, count(*)::int pageviews from public.site_visits
      where created_at >= now()-(d||' days')::interval group by device
    ) x),'[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(to_jsonb(x) order by x.pageviews desc) from (
      select case when referrer_host='' then 'Прямые переходы' else referrer_host end referrer,
             count(*)::int pageviews
      from public.site_visits where created_at >= now()-(d||' days')::interval
      group by referrer order by pageviews desc limit 10
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
