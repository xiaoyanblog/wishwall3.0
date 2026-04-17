-- Wish Wall 2.0 fresh database schema
-- This script resets the related tables. Existing wish/security/log data will be deleted.

create extension if not exists pgcrypto;

drop table if exists public.wish_submission_logs cascade;
drop table if exists public.security_settings cascade;
drop table if exists public.wishes cascade;

create table public.wishes (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) between 1 and 200),
  nickname text not null default '匿名' check (char_length(nickname) between 1 and 20),
  type text not null default 'love' check (type in ('love', 'wish', 'feedback')),
  color text not null default 'green' check (color in ('green', 'yellow', 'purple', 'pink', 'blue', 'orange')),
  status text not null default '' check (status in ('', 'doing', 'done')),
  done_note text not null default '' check (char_length(done_note) <= 300),
  done_image text not null default '' check (char_length(done_image) <= 500),
  ai_reply text not null default '' check (char_length(ai_reply) <= 500),
  position_left double precision,
  position_top double precision,
  position_rotate double precision,
  z_index integer not null default 200,
  approved boolean not null default true,
  ip_address text not null default '' check (char_length(ip_address) <= 64),
  ip_recorded boolean not null default false,
  created_at timestamptz not null default now()
);

create index wishes_approved_created_at_idx
  on public.wishes (approved, created_at desc);

create index wishes_created_at_idx
  on public.wishes (created_at desc);

alter table public.wishes enable row level security;

create policy "Service role only"
  on public.wishes
  for all
  using (false)
  with check (false);

create table public.security_settings (
  id integer primary key default 1 check (id = 1),
  record_ip boolean not null default false,
  daily_limit_enabled boolean not null default false,
  daily_limit_count integer not null default 5 check (daily_limit_count between 1 and 1000),
  captcha_enabled boolean not null default false,
  captcha_site_key text not null default '' check (char_length(captcha_site_key) <= 300),
  captcha_secret text not null default '' check (char_length(captcha_secret) <= 500),
  captcha_verify_url text not null default '' check (char_length(captcha_verify_url) <= 500),
  captcha_help text not null default '' check (char_length(captcha_help) <= 300),
  updated_at timestamptz not null default now()
);

insert into public.security_settings (id)
values (1);

alter table public.security_settings enable row level security;

create policy "Service role only"
  on public.security_settings
  for all
  using (false)
  with check (false);

create table public.wish_submission_logs (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null check (char_length(ip_address) between 1 and 64),
  created_at timestamptz not null default now()
);

create index wish_submission_logs_ip_created_at_idx
  on public.wish_submission_logs (ip_address, created_at desc);

alter table public.wish_submission_logs enable row level security;

create policy "Service role only"
  on public.wish_submission_logs
  for all
  using (false)
  with check (false);
