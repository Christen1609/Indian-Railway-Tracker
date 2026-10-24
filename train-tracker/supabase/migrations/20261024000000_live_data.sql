create table journeys (
  id           uuid primary key default gen_random_uuid(),
  train_number text references trains (number),
  journey_date date not null,
  status       text not null,
  is_scored    boolean not null default false,
  unique (train_number, journey_date)
);

create table raw_fetches (
  id         uuid primary key default gen_random_uuid(),
  journey_id uuid references journeys (id),
  source     text not null,
  url        text not null,
  status     smallint not null,
  body       text,
  error      text,
  fetched_at timestamptz not null,
  latency_ms integer
);

create index raw_fetches_journey on raw_fetches (journey_id, fetched_at);

alter table journeys enable row level security;
alter table raw_fetches enable row level security;

create policy journeys_read on journeys for select to anon, authenticated using (true);
