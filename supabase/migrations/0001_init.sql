-- The goals and the check-ins written under them.
--
-- Reconstructed from the live database: these tables were created by hand in
-- the SQL editor and never committed, so this is the schema as it stood before
-- the day-counting work in 0002. Table definitions came out of the dashboard
-- and are exact; the policies are reconstructed from how the app behaves and
-- want a read-through against the real ones before anyone rebuilds from this.

-- ------------------------------------------------------------------- goals --
-- user_id defaults to auth.uid(), so the browser never gets to say whose row
-- this is — and the insert policy would reject it if it tried. That is why no
-- code in lib/goal.ts mentions user_id anywhere.

create table public.goals (
  id         uuid not null default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  text       text not null,
  why        text not null default ''::text,
  created_at timestamptz not null default now(),
  constraint goals_pkey primary key (id),
  constraint goals_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

create index if not exists goals_user_created_idx on public.goals (user_id, created_at);

alter table public.goals enable row level security;

create policy "own goals read"   on public.goals for select using (auth.uid() = user_id);
create policy "own goals insert" on public.goals for insert with check (auth.uid() = user_id);
create policy "own goals update" on public.goals for update using (auth.uid() = user_id);
create policy "own goals delete" on public.goals for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- checkins --
-- `result` is the whole parsed card. Nothing reads inside it in SQL except the
-- tone, via result->>'tone'.
--
-- on delete cascade: deleting a goal takes every check-in written under it.
-- That is why the UI asks twice.

create table public.checkins (
  id      uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  goal_id uuid not null,
  note    text not null,
  result  jsonb not null,
  at      timestamptz not null default now(),
  constraint checkins_pkey primary key (id),
  constraint checkins_goal_id_fkey foreign key (goal_id) references public.goals (id) on delete cascade,
  constraint checkins_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);

create index if not exists checkins_goal_at_idx on public.checkins (goal_id, at);

alter table public.checkins enable row level security;

-- No update policy, on purpose: a check-in is a record of a moment. Editing one
-- would let you rewrite how a day went, which is the opposite of what this is
-- for. See the same note in lib/history.ts.
create policy "own checkins read"   on public.checkins for select using (auth.uid() = user_id);
create policy "own checkins insert" on public.checkins for insert with check (auth.uid() = user_id);
create policy "own checkins delete" on public.checkins for delete using (auth.uid() = user_id);
