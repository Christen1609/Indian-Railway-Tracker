alter table source_health
  add column blocked_at timestamptz,
  add column block_count integer not null default 0;

create index raw_fetches_source_time on raw_fetches (source, fetched_at);
