-- Выполните в Supabase SQL Editor.
-- ВАЖНО: замените lena.foto@mail.ru на фактический email администратора,
-- который также указан в assets/js/config.js.

create table if not exists public.site_content (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

drop policy if exists "public can read site content" on public.site_content;
create policy "public can read site content"
on public.site_content for select
to anon, authenticated
using (true);

drop policy if exists "admin can insert site content" on public.site_content;
create policy "admin can insert site content"
on public.site_content for insert
to authenticated
with check ((auth.jwt() ->> 'email') = 'lena.foto@mail.ru');

drop policy if exists "admin can update site content" on public.site_content;
create policy "admin can update site content"
on public.site_content for update
to authenticated
using ((auth.jwt() ->> 'email') = 'lena.foto@mail.ru')
with check ((auth.jwt() ->> 'email') = 'lena.foto@mail.ru');

drop policy if exists "admin can delete site content" on public.site_content;
create policy "admin can delete site content"
on public.site_content for delete
to authenticated
using ((auth.jwt() ->> 'email') = 'lena.foto@mail.ru');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 15728640, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true;

drop policy if exists "public can read site media" on storage.objects;
create policy "public can read site media"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'site-media');

drop policy if exists "admin can upload site media" on storage.objects;
create policy "admin can upload site media"
on storage.objects for insert
to authenticated
with check (bucket_id = 'site-media' and (auth.jwt() ->> 'email') = 'lena.foto@mail.ru');

drop policy if exists "admin can update site media" on storage.objects;
create policy "admin can update site media"
on storage.objects for update
to authenticated
using (bucket_id = 'site-media' and (auth.jwt() ->> 'email') = 'lena.foto@mail.ru')
with check (bucket_id = 'site-media' and (auth.jwt() ->> 'email') = 'lena.foto@mail.ru');

drop policy if exists "admin can delete site media" on storage.objects;
create policy "admin can delete site media"
on storage.objects for delete
to authenticated
using (bucket_id = 'site-media' and (auth.jwt() ->> 'email') = 'lena.foto@mail.ru');
