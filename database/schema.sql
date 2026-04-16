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
  created_at timestamptz not null default now()
);

create index if not exists wishes_approved_created_at_idx
  on public.wishes (approved, created_at desc);

alter table public.wishes enable row level security;

drop policy if exists "No public direct access" on public.wishes;

create policy "No public direct access"
  on public.wishes
  for all
  using (false)
  with check (false);
