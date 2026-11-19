-- =========================================================
-- セカンドハウス管理アプリ  データベース定義
-- Supabase の「SQL Editor」にこのファイルの中身を全部貼り付けて「Run」してください。
-- 何度実行しても壊れないように書いてあります。
-- =========================================================

-- ---------------------------------------------------------
-- アクセスを許可するアカウント
-- アプリでは全員が同じ1つのアカウント（合言葉＝パスワード）でログインします。
-- js/config.js の SHARED_EMAIL と同じメールアドレスにしてください。
-- ---------------------------------------------------------
create or replace function public.is_house_user()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'house@example.com'
$$;

-- ---------------------------------------------------------
-- メンバー（一緒に借りている人）
-- ---------------------------------------------------------
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 30),
  color       text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 利用予約
-- ---------------------------------------------------------
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists reservations_dates_idx on public.reservations (start_date, end_date);

-- ---------------------------------------------------------
-- 全体設定（1行だけ）
-- ---------------------------------------------------------
create table if not exists public.settings (
  id                integer primary key default 1 check (id = 1),
  house_name        text not null default 'セカンドハウス',
  default_rent      integer not null default 0 check (default_rent >= 0),
  default_payer_id  uuid references public.members(id) on delete set null
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------
-- 月ごとの費用（家賃・光熱費）
--   items の例: [{"label":"電気","amount":5200},{"label":"ガス","amount":3100}]
-- ---------------------------------------------------------
create table if not exists public.bills (
  month        text primary key check (month ~ '^\d{4}-\d{2}$'),
  rent         integer not null default 0 check (rent >= 0),
  items        jsonb not null default '[]'::jsonb,
  payer_id     uuid references public.members(id) on delete set null,
  split_count  integer not null default 1 check (split_count between 1 and 50),
  updated_at   timestamptz not null default now()
);

-- 支払い済みチェック
create table if not exists public.payments (
  month      text not null references public.bills(month) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  paid_at    timestamptz not null default now(),
  primary key (month, member_id)
);

-- ---------------------------------------------------------
-- 掲示板
-- ---------------------------------------------------------
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid references public.members(id) on delete set null,
  title       text not null check (char_length(title) between 1 and 100),
  body        text not null default '' check (char_length(body) <= 5000),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index if not exists posts_order_idx on public.posts (pinned desc, created_at desc);

-- ---------------------------------------------------------
-- セキュリティ（RLS）
-- 共有アカウントでログインした人だけが読み書きできます。
-- ---------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['members','reservations','settings','bills','payments','posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "house access" on public.%I', t);
    execute format(
      'create policy "house access" on public.%I for all to authenticated
         using (public.is_house_user()) with check (public.is_house_user())', t);
  end loop;
end $$;
