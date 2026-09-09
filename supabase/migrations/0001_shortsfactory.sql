-- =====================================================================
-- ShortsFactory — initial schema
-- Run with:  supabase db push
--        or paste into the Supabase SQL editor and execute once.
-- =====================================================================

-- ------------------------------- table -------------------------------
create table if not exists public.renders (
  id                  uuid        primary key default gen_random_uuid(),
  batch_id            uuid        not null,
  idea_index          int         not null check (idea_index between 0 and 9),
  story_text          text,
  shotstack_render_id text,
  status              text        not null default 'script'
                        check (status in ('script', 'voice', 'rendering', 'done', 'error')),
  video_url           text,
  error_message       text,
  created_at          timestamptz not null default now()
);

create index  if not exists renders_batch_id_idx     on public.renders (batch_id);
create unique index if not exists renders_batch_idea_uq on public.renders (batch_id, idea_index);

-- Lock the table down: the browser never touches it directly — reads and
-- writes happen inside Edge Functions through the service role key,
-- which bypasses RLS by design.
alter table public.renders enable row level security;

-- ------------------------------ buckets ------------------------------
-- Public buckets so Shotstack can fetch assets over HTTPS.
insert into storage.buckets (id, name, public)
values
  ('backgrounds', 'backgrounds', true),
  ('music',       'music',       true),
  ('audio',       'audio',       true)
on conflict (id) do nothing;

-- The React client uploads with the anon key → needs insert/update rights
-- on the two "materials" buckets. The "audio" bucket is written only by
-- Edge Functions (service role), so no anon policy is required there.
drop policy if exists "anon insert backgrounds" on storage.objects;
create policy "anon insert backgrounds"
  on storage.objects for insert to anon
  with check (bucket_id = 'backgrounds');

drop policy if exists "anon update backgrounds" on storage.objects;
create policy "anon update backgrounds"
  on storage.objects for update to anon
  using (bucket_id = 'backgrounds');

drop policy if exists "anon insert music" on storage.objects;
create policy "anon insert music"
  on storage.objects for insert to anon
  with check (bucket_id = 'music');

drop policy if exists "anon update music" on storage.objects;
create policy "anon update music"
  on storage.objects for update to anon
  using (bucket_id = 'music');

-- Optional housekeeping: list rights make debugging easier from the dashboard
-- (the app itself never lists buckets).
drop policy if exists "anon read backgrounds" on storage.objects;
create policy "anon read backgrounds"
  on storage.objects for select to anon
  using (bucket_id = 'backgrounds');

drop policy if exists "anon read music" on storage.objects;
create policy "anon read music"
  on storage.objects for select to anon
  using (bucket_id = 'music');
