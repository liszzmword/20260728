create extension if not exists pgcrypto;

create table if not exists public.lotto_draws (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  birthdate date not null,
  zodiac_key text not null,
  zodiac_ko text not null,
  zodiac_en text not null,
  numbers integer[] not null,
  bonus integer not null,
  explanation text not null default '',
  chat_reply text not null default '',
  model text not null default 'gpt-5.4-mini',
  source text not null default 'openai',
  constraint lotto_draws_numbers_length check (cardinality(numbers) = 6),
  constraint lotto_draws_bonus_range check (bonus between 1 and 45),
  constraint lotto_draws_bonus_unique check (bonus <> all(numbers))
);

alter table public.lotto_draws enable row level security;

comment on table public.lotto_draws is '별자리 로또 챗봇이 생성한 추첨 결과를 저장하는 테이블';
