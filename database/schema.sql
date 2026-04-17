create extension if not exists pgcrypto;

create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) <= 200),
  nickname text not null default '匿名' check (char_length(nickname) <= 20),
  type text not null default 'love' check (type in ('love', 'wish', 'feedback')),
  color text not null default 'green' check (color in ('green', 'yellow', 'purple', 'pink', 'blue', 'orange')),
  status text not null default '' check (status in ('', 'doing', 'done')),
  done_note text not null default '',
  done_image text not null default '',
  ai_reply text not null default '',
  position_left double precision,
  position_top double precision,
  position_rotate double precision,
  z_index integer not null default 200,
  approved boolean not null default true,
  ip_hash text not null default '',
  ip_recorded boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.wishes
  add column if not exists ip_hash text not null default '',
  add column if not exists ip_recorded boolean not null default false;

create index if not exists wishes_approved_created_at_idx
  on public.wishes (approved, created_at desc);

alter table public.wishes enable row level security;

drop policy if exists "No public direct access" on public.wishes;

create policy "No public direct access"
  on public.wishes
  for all
  using (false)
  with check (false);

create table if not exists public.security_settings (
  id integer primary key default 1 check (id = 1),
  record_ip boolean not null default false,
  daily_limit_enabled boolean not null default false,
  daily_limit_count integer not null default 5 check (daily_limit_count between 1 and 1000),
  captcha_enabled boolean not null default false,
  captcha_site_key text not null default '',
  captcha_secret text not null default '',
  captcha_verify_url text not null default '',
  captcha_help text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.security_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.security_settings enable row level security;

drop policy if exists "No public direct access" on public.security_settings;

create policy "No public direct access"
  on public.security_settings
  for all
  using (false)
  with check (false);

create table if not exists public.wish_submission_logs (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists wish_submission_logs_ip_created_at_idx
  on public.wish_submission_logs (ip_hash, created_at desc);

alter table public.wish_submission_logs enable row level security;

drop policy if exists "No public direct access" on public.wish_submission_logs;

create policy "No public direct access"
  on public.wish_submission_logs
  for all
  using (false)
  with check (false);
