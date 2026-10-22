create extension if not exists pg_trgm;

create table stations (
  code    text primary key,
  name    text not null,
  name_hi text,
  lat     double precision,
  lon     double precision,
  zone    text
);

create table trains (
  number        text primary key,
  name          text not null,
  origin        text references stations (code),
  destination   text references stations (code),
  runs_on       smallint not null,
  top_speed_kmh smallint not null
);

create table timetable_stops (
  train_number text references trains (number),
  seq          smallint,
  station_code text references stations (code),
  sched_arr    smallint,
  sched_dep    smallint,
  km           integer not null,
  primary key (train_number, seq)
);

create table section_caps (
  train_number text references trains (number),
  from_seq     smallint,
  fastest_pace real not null,
  trips_seen   integer not null,
  updated_at   timestamptz not null,
  primary key (train_number, from_seq)
);

create index trains_name_trgm on trains using gin (name gin_trgm_ops);
create index trains_number_prefix on trains (number text_pattern_ops);
create index timetable_stops_station on timetable_stops (station_code);

alter table stations enable row level security;
alter table trains enable row level security;
alter table timetable_stops enable row level security;
alter table section_caps enable row level security;

create policy stations_read on stations for select to anon, authenticated using (true);
create policy trains_read on trains for select to anon, authenticated using (true);
create policy timetable_stops_read on timetable_stops for select to anon, authenticated using (true);
