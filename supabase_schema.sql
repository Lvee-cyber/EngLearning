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

-- Small-group deployment mode: profile ids are intentionally discoverable so the
-- frontend can offer a convenient selector. Use Supabase Auth and auth.uid()-based
-- RLS before expanding this project to untrusted public users.
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

create or replace function public.list_profile_ids()
returns table (profile_id text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct profiles.profile_id
  from (
    select item.profile_id from public.review_progress as item
    union
    select item.profile_id from public.personal_vocabulary as item
  ) as profiles
  where coalesce(trim(profiles.profile_id), '') <> ''
  order by profiles.profile_id;
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
revoke all on function public.list_profile_ids() from public;
grant execute on function public.get_review_progress(text) to anon, authenticated;
grant execute on function public.list_profile_ids() to anon, authenticated;
grant execute on function public.get_personal_vocabulary(text) to anon, authenticated;
grant execute on function public.save_personal_vocabulary(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lightweight application users (2026-08)
-- This project intentionally uses short PIN-style passwords for a small,
-- trusted group. Passwords are still hashed and browser sessions use random
-- tokens. Learning data remains keyed by the user's immutable username.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  user_id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  last_login_at timestamptz
);

create unique index if not exists app_users_username_lower_idx
on public.app_users (lower(username));

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id uuid not null references public.app_users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists app_sessions_user_idx on public.app_sessions (user_id);
create index if not exists app_sessions_expiry_idx on public.app_sessions (expires_at);

create table if not exists public.app_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now()
);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_migrations enable row level security;

insert into public.app_users (username, password_hash, role, status, approved_at)
select 'LvE', extensions.crypt('523', extensions.gen_salt('bf')), 'admin', 'active', now()
where not exists (
  select 1 from public.app_users where lower(username) = 'lve'
);

update public.app_users
set role = 'admin', status = 'active', approved_at = coalesce(approved_at, now())
where lower(username) = 'lve';

-- One-time cleanup: legacy identifiers other than LvE start with empty data.
do $$
begin
  if not exists (
    select 1 from public.app_migrations where migration_key = 'legacy_profiles_to_lve_v1'
  ) then
    delete from public.review_events where lower(trim(profile_id)) <> 'lve';
    delete from public.review_progress where lower(trim(profile_id)) <> 'lve';
    delete from public.personal_vocabulary where lower(trim(profile_id)) <> 'lve';
    insert into public.app_migrations (migration_key) values ('legacy_profiles_to_lve_v1');
  end if;
end;
$$;

create or replace function public.app_user_json(p_user public.app_users)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', p_user.user_id,
    'username', p_user.username,
    'role', p_user.role,
    'status', p_user.status,
    'created_at', p_user.created_at,
    'approved_at', p_user.approved_at,
    'last_login_at', p_user.last_login_at
  );
$$;

create or replace function public.app_require_user(p_token text, p_require_admin boolean default false)
returns public.app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
begin
  select * into v_auth_user
  from public.app_users
  where user_id = (
    select user_id
    from public.app_sessions
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and expires_at > now()
    limit 1
  )
    and status = 'active';

  if v_auth_user.user_id is null then
    raise exception '登录已失效，请重新登录';
  end if;
  if p_require_admin and v_auth_user.role <> 'admin' then
    raise exception '仅 LvE 可以执行此操作';
  end if;
  return v_auth_user;
end;
$$;

create or replace function public.register_app_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text := trim(coalesce(p_username, ''));
  created_user public.app_users%rowtype;
begin
  if char_length(normalized_username) < 2 or char_length(normalized_username) > 24 then
    raise exception '用户名需要 2 到 24 个字符';
  end if;
  if normalized_username ~ '[[:space:]]' then
    raise exception '用户名不能包含空格';
  end if;
  if lower(normalized_username) = 'lve' then
    raise exception '该用户名不可注册';
  end if;
  if char_length(coalesce(p_password, '')) < 3 or char_length(p_password) > 32 then
    raise exception '密码需要 3 到 32 个字符';
  end if;

  insert into public.app_users (username, password_hash, role, status)
  values (normalized_username, extensions.crypt(p_password, extensions.gen_salt('bf')), 'user', 'pending')
  returning * into created_user;

  return public.app_user_json(created_user);
exception
  when unique_violation then
    raise exception '用户名已存在';
end;
$$;

create or replace function public.login_app_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user public.app_users%rowtype;
  raw_token text := gen_random_uuid()::text || gen_random_uuid()::text;
begin
  select * into matched_user
  from public.app_users
  where lower(username) = lower(trim(coalesce(p_username, '')))
    and password_hash = extensions.crypt(coalesce(p_password, ''), password_hash);

  if matched_user.user_id is null then
    raise exception '用户名或密码不正确';
  end if;
  if matched_user.status = 'disabled' then
    raise exception '账号已禁用，请联系 LvE';
  end if;

  delete from public.app_sessions where expires_at <= now();
  insert into public.app_sessions (token_hash, user_id, expires_at)
  values (encode(extensions.digest(raw_token, 'sha256'), 'hex'), matched_user.user_id, now() + interval '30 days');

  update public.app_users set last_login_at = now() where user_id = matched_user.user_id
  returning * into matched_user;

  return jsonb_build_object('token', raw_token, 'user', public.app_user_json(matched_user));
end;
$$;

create or replace function public.get_app_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_row public.app_users%rowtype;
begin
  select * into current_user_row
  from public.app_users
  where user_id = (
    select user_id
    from public.app_sessions
    where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and expires_at > now()
    limit 1
  );

  if current_user_row.user_id is null then
    raise exception '登录已失效，请重新登录';
  end if;
  if current_user_row.status = 'disabled' then
    raise exception '账号已禁用，请联系 LvE';
  end if;

  update public.app_sessions
  set last_seen_at = now()
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  return public.app_user_json(current_user_row);
end;
$$;

create or replace function public.logout_app_user(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.app_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return true;
end;
$$;

create or replace function public.get_my_personal_vocabulary(p_token text)
returns table (term text, payload jsonb, added_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
begin
  select * into v_auth_user from public.app_require_user(p_token);
  return query
  select item.term, item.payload, item.added_at
  from public.personal_vocabulary as item
  where lower(item.profile_id) = lower(v_auth_user.username)
  order by item.added_at desc;
end;
$$;

create or replace function public.save_my_personal_vocabulary(p_token text, p_term text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
  saved public.personal_vocabulary;
begin
  select * into v_auth_user from public.app_require_user(p_token);
  if coalesce(trim(p_term), '') = '' then raise exception 'term is required'; end if;
  insert into public.personal_vocabulary (profile_id, term, payload, added_at)
  values (v_auth_user.username, trim(p_term), p_payload, now())
  on conflict (profile_id, term) do update set payload = excluded.payload
  returning * into saved;
  return to_jsonb(saved);
end;
$$;

create or replace function public.get_my_review_progress(p_token text)
returns table (term text, correct_count integer, incorrect_count integer, review_history jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
begin
  select * into v_auth_user from public.app_require_user(p_token);
  return query
  select item.term, item.correct_count, item.incorrect_count, item.review_history, item.updated_at
  from public.review_progress as item
  where lower(item.profile_id) = lower(v_auth_user.username)
  order by item.term;
end;
$$;

create or replace function public.record_my_review_event(
  p_token text,
  p_event_id uuid,
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
  v_auth_user public.app_users%rowtype;
  inserted_count integer := 0;
  answer_event jsonb;
  progress_row public.review_progress;
begin
  select * into v_auth_user from public.app_require_user(p_token);
  if coalesce(trim(p_term), '') = '' then raise exception 'term is required'; end if;
  if p_result not in ('correct', 'incorrect') then raise exception 'invalid review result'; end if;

  insert into public.review_events (
    event_id, profile_id, term, result, user_answer, mode,
    session_id, session_started_at, answered_at
  ) values (
    p_event_id, v_auth_user.username, trim(p_term), p_result,
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
      v_auth_user.username, trim(p_term),
      case when p_result = 'correct' then 1 else 0 end,
      case when p_result = 'incorrect' then 1 else 0 end,
      jsonb_build_array(answer_event), now()
    )
    on conflict (profile_id, term) do update set
      correct_count = public.review_progress.correct_count + excluded.correct_count,
      incorrect_count = public.review_progress.incorrect_count + excluded.incorrect_count,
      review_history = public.review_progress.review_history || excluded.review_history,
      updated_at = now();
  end if;

  select * into progress_row from public.review_progress
  where lower(profile_id) = lower(v_auth_user.username) and term = trim(p_term);
  return progress_row;
end;
$$;

create or replace function public.get_my_dashboard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
  vocabulary_count integer := 0;
  mastered_count integer := 0;
  correct_count integer := 0;
  incorrect_count integer := 0;
  last_review_at timestamptz;
begin
  select * into v_auth_user from public.app_require_user(p_token);
  select count(*)::integer into vocabulary_count
  from (
    select lower(term) from public.personal_vocabulary where lower(profile_id) = lower(v_auth_user.username)
    union
    select lower(term) from public.vocabulary_words where v_auth_user.role = 'admin'
  ) as vocabulary;
  select count(*) filter (where item.correct_count >= 10)::integer,
         coalesce(sum(item.correct_count), 0)::integer,
         coalesce(sum(item.incorrect_count), 0)::integer,
         max(item.updated_at)
  into mastered_count, correct_count, incorrect_count, last_review_at
  from public.review_progress as item
  where lower(item.profile_id) = lower(v_auth_user.username);

  return jsonb_build_object(
    'vocabulary_count', vocabulary_count,
    'mastered_count', mastered_count,
    'reviewable_count', greatest(vocabulary_count - mastered_count, 0),
    'correct_count', correct_count,
    'incorrect_count', incorrect_count,
    'review_count', correct_count + incorrect_count,
    'last_review_at', last_review_at
  );
end;
$$;

create or replace function public.admin_list_app_users(p_token text)
returns table (
  user_id uuid, username text, role text, status text, created_at timestamptz,
  approved_at timestamptz, last_login_at timestamptz, vocabulary_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
begin
  select * into v_auth_user from public.app_require_user(p_token, true);
  return query
  select u.user_id, u.username, u.role, u.status, u.created_at,
    u.approved_at, u.last_login_at,
    case when u.role = 'admin' then
      (select count(*) from (
        select lower(term) from public.vocabulary_words
        union
        select lower(term) from public.personal_vocabulary where lower(profile_id) = lower(u.username)
      ) as admin_vocabulary)
    else
      (select count(*) from public.personal_vocabulary where lower(profile_id) = lower(u.username))
    end as vocabulary_count
  from public.app_users as u
  order by case u.status when 'pending' then 0 when 'active' then 1 else 2 end, u.created_at desc;
end;
$$;

create or replace function public.admin_set_app_user_status(p_token text, p_user_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
  v_target_user public.app_users%rowtype;
begin
  select * into v_auth_user from public.app_require_user(p_token, true);
  if p_status not in ('active', 'disabled') then raise exception '无效的账号状态'; end if;
  select * into v_target_user from public.app_users where user_id = p_user_id;
  if v_target_user.user_id is null then raise exception '用户不存在'; end if;
  if v_target_user.role = 'admin' then raise exception '不能修改 LvE 管理员状态'; end if;
  update public.app_users
  set status = p_status, approved_at = case when p_status = 'active' then coalesce(approved_at, now()) else approved_at end
  where user_id = p_user_id returning * into v_target_user;
  if p_status = 'disabled' then delete from public.app_sessions where user_id = p_user_id; end if;
  return public.app_user_json(v_target_user);
end;
$$;

create or replace function public.admin_reset_app_password(p_token text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
  v_target_user public.app_users%rowtype;
begin
  select * into v_auth_user from public.app_require_user(p_token, true);
  select * into v_target_user from public.app_users where user_id = p_user_id;
  if v_target_user.user_id is null then raise exception '用户不存在'; end if;
  if v_target_user.role = 'admin' then raise exception '不能在这里重置 LvE 密码'; end if;
  update public.app_users set password_hash = extensions.crypt('123', extensions.gen_salt('bf')) where user_id = p_user_id;
  delete from public.app_sessions where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.admin_delete_app_user(p_token text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user public.app_users%rowtype;
  v_target_user public.app_users%rowtype;
begin
  select * into v_auth_user from public.app_require_user(p_token, true);
  select * into v_target_user from public.app_users where user_id = p_user_id;
  if v_target_user.user_id is null then raise exception '用户不存在'; end if;
  if v_target_user.role = 'admin' then raise exception '不能删除 LvE 管理员'; end if;
  delete from public.review_events where lower(profile_id) = lower(v_target_user.username);
  delete from public.review_progress where lower(profile_id) = lower(v_target_user.username);
  delete from public.personal_vocabulary where lower(profile_id) = lower(v_target_user.username);
  delete from public.app_users where user_id = p_user_id;
  return true;
end;
$$;

-- Legacy identifier-based functions are no longer callable from the browser.
revoke all on function public.record_review_event(uuid, text, text, text, text, text, text, timestamptz, timestamptz) from anon, authenticated;
revoke all on function public.get_review_progress(text) from anon, authenticated;
revoke all on function public.list_profile_ids() from anon, authenticated;
revoke all on function public.get_personal_vocabulary(text) from anon, authenticated;
revoke all on function public.save_personal_vocabulary(text, text, jsonb) from anon, authenticated;

revoke all on function public.app_user_json(public.app_users) from public;
revoke all on function public.app_require_user(text, boolean) from public;
revoke all on function public.register_app_user(text, text) from public;
revoke all on function public.login_app_user(text, text) from public;
revoke all on function public.get_app_session(text) from public;
revoke all on function public.logout_app_user(text) from public;
revoke all on function public.get_my_personal_vocabulary(text) from public;
revoke all on function public.save_my_personal_vocabulary(text, text, jsonb) from public;
revoke all on function public.get_my_review_progress(text) from public;
revoke all on function public.record_my_review_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.get_my_dashboard(text) from public;
revoke all on function public.admin_list_app_users(text) from public;
revoke all on function public.admin_set_app_user_status(text, uuid, text) from public;
revoke all on function public.admin_reset_app_password(text, uuid) from public;
revoke all on function public.admin_delete_app_user(text, uuid) from public;

grant execute on function public.register_app_user(text, text) to anon, authenticated;
grant execute on function public.login_app_user(text, text) to anon, authenticated;
grant execute on function public.get_app_session(text) to anon, authenticated;
grant execute on function public.logout_app_user(text) to anon, authenticated;
grant execute on function public.get_my_personal_vocabulary(text) to anon, authenticated;
grant execute on function public.save_my_personal_vocabulary(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_my_review_progress(text) to anon, authenticated;
grant execute on function public.record_my_review_event(text, uuid, text, text, text, text, text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.get_my_dashboard(text) to anon, authenticated;
grant execute on function public.admin_list_app_users(text) to anon, authenticated;
grant execute on function public.admin_set_app_user_status(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_reset_app_password(text, uuid) to anon, authenticated;
grant execute on function public.admin_delete_app_user(text, uuid) to anon, authenticated;
