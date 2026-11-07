-- Alliance multiplayer schema for Supabase/Postgres
-- This file is the database contract for the next online implementation.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null,
  display_name text not null,
  icon text not null default '⚔️',
  color text not null default '#4a7ae8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(auth_user_id)
);

create table if not exists lobbies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'queue' check (status in ('queue', 'active', 'finished')),
  share_code text not null unique,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  ended_at timestamptz null,
  winner_profile_id uuid null references profiles(id)
);

create table if not exists lobby_players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references lobbies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  is_host boolean not null default false,
  is_ready boolean not null default false,
  seat_name text null,
  last_seen_at timestamptz not null default now(),
  unique(lobby_id, profile_id)
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null unique references lobbies(id) on delete cascade,
  grid_size integer not null,
  status text not null default 'started' check (status in ('started', 'refreshing', 'finished')),
  started_at timestamptz not null default now(),
  next_refresh_at timestamptz not null,
  round_number integer not null default 0,
  refresh_mode text not null default 'standard' check (refresh_mode in ('standard', 'quick')),
  refresh_time_pst text not null default '20:00',
  quick_refresh_minutes integer not null default 720,
  allow_zone_shrink boolean not null default false,
  zone_shrink_interval integer not null default 1,
  zone_bounds jsonb not null default '{"minX":0,"maxX":11,"minY":0,"maxY":11}',
  zone_preview jsonb not null default '[]',
  danger_zone jsonb not null default '[]',
  winner_profile_id uuid null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  display_name text not null,
  icon text not null,
  color text not null,
  x integer not null,
  y integer not null,
  health integer not null default 3,
  max_health integer not null default 3,
  range integer not null default 3,
  ap integer not null default 1,
  is_downed boolean not null default false,
  alive boolean not null default true,
  last_action_at timestamptz null,
  last_refresh_at timestamptz null,
  total_votes_received integer not null default 0,
  revived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_id, profile_id)
);

create table if not exists game_actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  actor_profile_id uuid not null references profiles(id) on delete cascade,
  action_type text not null check (
    action_type in (
      'move',
      'attack',
      'gift_ap',
      'gift_heart',
      'upgrade_range',
      'forfeit',
      'declare_victory',
      'vote',
      'refresh'
    )
  ),
  target_profile_id uuid null references profiles(id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  validated boolean not null default false,
  validation_error text null
);

create table if not exists jury_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  juror_profile_id uuid not null references profiles(id) on delete cascade,
  voted_for_profile_id uuid not null references profiles(id) on delete cascade,
  round_number integer not null,
  created_at timestamptz not null default now(),
  unique(game_id, juror_profile_id, round_number)
);

create index if not exists idx_lobby_players_lobby on lobby_players(lobby_id);
create index if not exists idx_lobby_players_profile on lobby_players(profile_id);
create index if not exists idx_games_lobby on games(lobby_id);
create index if not exists idx_game_players_game on game_players(game_id);
create index if not exists idx_game_actions_game on game_actions(game_id, created_at desc);
create index if not exists idx_jury_votes_game_round on jury_votes(game_id, round_number);

create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated
before update on profiles
for each row execute procedure update_updated_at_column();

create trigger trg_games_updated
before update on games
for each row execute procedure update_updated_at_column();

create trigger trg_game_players_updated
before update on game_players
for each row execute procedure update_updated_at_column();
