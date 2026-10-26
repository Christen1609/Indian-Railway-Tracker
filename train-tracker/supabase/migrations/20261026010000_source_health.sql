create table source_health (
  source          text primary key,
  failures        integer not null default 0,
  last_failure_at timestamptz,
  opened_at       timestamptz,
  updated_at      timestamptz not null
);

alter table source_health enable row level security;
