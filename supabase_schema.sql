create table if not exists public.review_progress (
  profile_id text not null,
  term text not null,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  review_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (profile_id, term)
);

create table if not exists public.review_events (
  event_id uuid primary key,
  profile_id text not null,
  term text not null,
  result text not null check (result in ('correct', 'incorrect')),
  user_answer text not null default '',
  mode text not null default 'spelling',
  session_id text not null default '',
  session_started_at timestamptz,
  answered_at timestamptz not null default now()
);

create index if not exists review_events_profile_answered_idx
on public.review_events (profile_id, answered_at desc);

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

create table if not exists public.personal_vocabulary (
  profile_id text not null,
  term text not null,
  payload jsonb not null,
  added_at timestamptz not null default now(),
  primary key (profile_id, term)
);

alter table public.review_progress enable row level security;
alter table public.review_events enable row level security;
alter table public.vocabulary_words enable row level security;
alter table public.dictionary_entries enable row level security;
alter table public.personal_vocabulary enable row level security;

drop policy if exists "public read review progress" on public.review_progress;
drop policy if exists "public write review progress" on public.review_progress;
drop policy if exists "public update review progress" on public.review_progress;
drop policy if exists "public read vocabulary words" on public.vocabulary_words;
drop policy if exists "public write vocabulary words" on public.vocabulary_words;
drop policy if exists "public update vocabulary words" on public.vocabulary_words;
drop policy if exists "public read dictionary entries" on public.dictionary_entries;
drop policy if exists "public read personal vocabulary" on public.personal_vocabulary;
drop policy if exists "public write personal vocabulary" on public.personal_vocabulary;
drop policy if exists "public update personal vocabulary" on public.personal_vocabulary;
drop policy if exists "public delete personal vocabulary" on public.personal_vocabulary;

-- Personal deployment mode: profile ids act as private sync keys. The frontend no
-- longer enumerates them, but Supabase Auth should replace these demo policies if
-- the project becomes multi-user or publicly promoted.
create policy "public read vocabulary words"
on public.vocabulary_words for select to anon using (true);

create policy "public read dictionary entries"
on public.dictionary_entries for select to anon using (true);

create or replace function public.record_review_event(
  p_event_id uuid,
  p_profile_id text,
  p_term text,
  p_result text,
  p_user_answer text,
  p_mode text,
  p_session_id text,
  p_session_started_at timestamptz,
  p_answered_at timestamptz
)
returns public.review_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  answer_event jsonb;
  progress_row public.review_progress;
begin
  if coalesce(trim(p_profile_id), '') = '' or coalesce(trim(p_term), '') = '' then
    raise exception 'profile_id and term are required';
  end if;
  if p_result not in ('correct', 'incorrect') then
    raise exception 'invalid review result';
  end if;

  insert into public.review_events (
    event_id, profile_id, term, result, user_answer, mode,
    session_id, session_started_at, answered_at
  ) values (
    p_event_id, trim(p_profile_id), trim(p_term), p_result,
    coalesce(p_user_answer, ''), coalesce(p_mode, 'spelling'),
    coalesce(p_session_id, ''), p_session_started_at, coalesce(p_answered_at, now())
  ) on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    answer_event := jsonb_build_object(
      'event_id', p_event_id,
      'answered_at', coalesce(p_answered_at, now()),
      'result', p_result,
      'user_answer', coalesce(p_user_answer, ''),
      'mode', coalesce(p_mode, 'spelling'),
      'session_id', coalesce(p_session_id, ''),
      'session_started_at', p_session_started_at
    );

    insert into public.review_progress (
      profile_id, term, correct_count, incorrect_count, review_history, updated_at
    ) values (
      trim(p_profile_id), trim(p_term),
      case when p_result = 'correct' then 1 else 0 end,
      case when p_result = 'incorrect' then 1 else 0 end,
      jsonb_build_array(answer_event),
      now()
    )
    on conflict (profile_id, term) do update set
      correct_count = public.review_progress.correct_count + excluded.correct_count,
      incorrect_count = public.review_progress.incorrect_count + excluded.incorrect_count,
      review_history = public.review_progress.review_history || excluded.review_history,
      updated_at = now();
  end if;

  select * into progress_row
  from public.review_progress
  where profile_id = trim(p_profile_id) and term = trim(p_term);
  return progress_row;
end;
$$;

revoke all on function public.record_review_event(uuid, text, text, text, text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.record_review_event(uuid, text, text, text, text, text, text, timestamptz, timestamptz) to anon, authenticated;

create or replace function public.get_review_progress(p_profile_id text)
returns table (
  term text,
  correct_count integer,
  incorrect_count integer,
  review_history jsonb,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select item.term, item.correct_count, item.incorrect_count, item.review_history, item.updated_at
  from public.review_progress as item
  where item.profile_id = trim(p_profile_id)
  order by item.term;
$$;

create or replace function public.get_personal_vocabulary(p_profile_id text)
returns table (term text, payload jsonb, added_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select item.term, item.payload, item.added_at
  from public.personal_vocabulary as item
  where item.profile_id = trim(p_profile_id)
  order by item.added_at desc;
$$;

create or replace function public.save_personal_vocabulary(
  p_profile_id text,
  p_term text,
  p_payload jsonb
)
returns public.personal_vocabulary
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.personal_vocabulary;
begin
  if coalesce(trim(p_profile_id), '') = '' or coalesce(trim(p_term), '') = '' then
    raise exception 'profile_id and term are required';
  end if;
  insert into public.personal_vocabulary (profile_id, term, payload, added_at)
  values (trim(p_profile_id), trim(p_term), p_payload, now())
  on conflict (profile_id, term) do update set payload = excluded.payload
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.get_personal_vocabulary(text) from public;
revoke all on function public.save_personal_vocabulary(text, text, jsonb) from public;
revoke all on function public.get_review_progress(text) from public;
grant execute on function public.get_review_progress(text) to anon, authenticated;
grant execute on function public.get_personal_vocabulary(text) to anon, authenticated;
grant execute on function public.save_personal_vocabulary(text, text, jsonb) to anon, authenticated;
