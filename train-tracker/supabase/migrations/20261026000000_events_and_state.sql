create table source_events (
  id           uuid primary key default gen_random_uuid(),
  journey_id   uuid references journeys (id),
  source       text not null,
  station_code text not null,
  type         text not null,
  at           timestamptz not null,
  fetched_at   timestamptz not null,
  raw_fetch_id uuid references raw_fetches (id),
  rejected     text
);

create index source_events_journey on source_events (journey_id, station_code, type);

create table resolved_events (
  journey_id       uuid not null references journeys (id),
  station_code     text not null,
  type             text not null,
  at               timestamptz not null,
  confidence_score real not null,
  confidence       text not null,
  chosen_source    text not null,
  sources          text[] not null,
  resolved_at      timestamptz not null,
  primary key (journey_id, station_code, type)
);

create table train_state (
  journey_id    uuid primary key references journeys (id),
  state         text not null,
  km            real not null,
  lo_km         real not null,
  hi_km         real not null,
  pace          real not null,
  delay_min     integer,
  next_station  text,
  window_start  timestamptz,
  window_end    timestamptz,
  next_check_at timestamptz,
  updated_at    timestamptz not null
);

create index train_state_due on train_state (next_check_at);

create view stop_times as
select
  journey_id,
  station_code,
  type,
  at,
  confidence
from resolved_events;

alter table source_events enable row level security;
alter table resolved_events enable row level security;
alter table train_state enable row level security;

create policy train_state_read on train_state for select to anon, authenticated using (true);

grant select on stop_times to anon, authenticated;

alter publication supabase_realtime add table train_state;
