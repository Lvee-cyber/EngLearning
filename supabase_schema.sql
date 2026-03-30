create table if not exists public.review_progress (
  profile_id text not null,
  term text not null,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  review_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (profile_id, term)
);

alter table public.review_progress enable row level security;

create policy "public read review progress"
on public.review_progress
for select
to anon
using (true);

create policy "public write review progress"
on public.review_progress
for insert
to anon
with check (true);

create policy "public update review progress"
on public.review_progress
for update
to anon
using (true)
with check (true);

create table if not exists public.vocabulary_words (
  term text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.dictionary_entries (
  term text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.vocabulary_words enable row level security;
alter table public.dictionary_entries enable row level security;

create policy "public read vocabulary words"
on public.vocabulary_words
for select
to anon
using (true);

create policy "public write vocabulary words"
on public.vocabulary_words
for insert
to anon
with check (true);

create policy "public update vocabulary words"
on public.vocabulary_words
for update
to anon
using (true)
with check (true);

create policy "public read dictionary entries"
on public.dictionary_entries
for select
to anon
using (true);
