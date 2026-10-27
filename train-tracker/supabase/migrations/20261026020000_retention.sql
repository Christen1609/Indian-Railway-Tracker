create table journey_scores (
  journey_id                 uuid primary key references journeys (id),
  in_window_pct              real not null,
  median_window_min          real not null,
  at_station_within_10km_pct real not null,
  scored_at                  timestamptz not null
);

alter table journeys add column cleaned_at timestamptz;

create index journeys_uncleaned on journeys (cleaned_at) where cleaned_at is null;

alter table journey_scores enable row level security;
