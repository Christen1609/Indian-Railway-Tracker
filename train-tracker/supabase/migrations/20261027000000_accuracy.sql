create table estimate_log (
  journey_id   uuid references journeys (id),
  at           timestamptz not null,
  km           real not null,
  lo_km        real not null,
  hi_km        real not null,
  next_station text,
  window_start timestamptz,
  window_end   timestamptz,
  primary key (journey_id, at)
);

create index estimate_log_stop on estimate_log (journey_id, next_station, at);

create table window_hits (
  journey_id   uuid references journeys (id),
  station_code text not null,
  published_at timestamptz not null,
  arrived_at   timestamptz not null,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  hit          boolean not null,
  width_min    integer not null,
  lead_min     integer not null,
  primary key (journey_id, station_code, published_at)
);

create index window_hits_recent on window_hits (arrived_at desc);

alter table estimate_log enable row level security;
alter table window_hits enable row level security;
