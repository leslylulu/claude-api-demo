-- Day-based counting, cut by the user's own timezone.
--
-- The card's two anchors are "which day is this" and "how many of those days
-- did they show up". Both used to be derived at read time from the timezone in
-- the request. Vercel and Postgres both run on UTC, so a check-in written at
-- 20:00 in Toronto landed on tomorrow — and evening is when people write about
-- their day. Deriving at read time also meant a trip to another timezone would
-- have rewritten history: same rows, different day boundaries, numbers moving
-- on their own.
--
-- So the day is decided once, at write time, and frozen. Nothing downstream
-- converts anything.

-- ---------------------------------------------------------------- profiles --
-- auth.users belongs to Supabase and cannot be altered, so the timezone lives
-- in a table of our own. The browser is the only place that knows where the
-- user actually is; it refreshes this on every app open, and the server reads
-- it back out rather than trusting whatever the request body claims.

create table public.profiles (
  id         uuid not null,
  timezone   text not null default 'UTC'::text,
  updated_at timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade
);

alter table public.profiles enable row level security;

create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Two separate gates, and RLS is only the second one. GRANT decides whether the
-- role may touch the table at all; policies decide which rows it then sees. A
-- table created here in the SQL editor does not get the grants that the Table
-- Editor adds for you, so without this line every request fails with 42501
-- "permission denied" — which reads like a login problem and is not one.
--
-- No `anon`: a signed-out visitor has no profile. No `delete`: nothing in the
-- app deletes one.
grant select, insert, update on public.profiles to authenticated;

-- security definer because the trigger runs inside the insert into auth.users,
-- where auth.uid() is not set yet and the insert policy above would reject it.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Everyone who signed up before the trigger existed.
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- -------------------------------------------------------- the frozen days --
-- `at` and `created_at` stay as they are: an instant, in UTC, which is what a
-- timestamptz is for. These columns answer a different question — which day it
-- was *for them* — and that answer is only knowable at the moment of writing.
--
-- Counting is distinct `day` per goal, which is also why two check-ins on the
-- same day (a note, and an answer to the card's question) count as one day and
-- not two.

alter table public.goals    add column created_day date;
alter table public.checkins add column day date;

-- Kept for audit, not for arithmetic: when a count looks wrong, this says which
-- timezone the row was written from. An IANA name, never an offset — an offset
-- would be wrong twice a year, on the DST switches.
alter table public.checkins add column tz text;

-- Backfill at the timezone these rows were actually written in.
update public.goals
   set created_day = (created_at at time zone 'America/Toronto')::date
 where created_day is null;

update public.checkins
   set day = (at at time zone 'America/Toronto')::date,
       tz  = 'America/Toronto'
 where day is null;

alter table public.goals    alter column created_day set not null;
alter table public.checkins alter column day        set not null;

create index if not exists checkins_goal_day_idx on public.checkins (goal_id, day);
