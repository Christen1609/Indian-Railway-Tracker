create table watch_requests (
  train_number     text primary key references trains (number),
  requested_at     timestamptz not null default now(),
  timetable_status text not null default 'pending' check (timetable_status in ('pending', 'ready', 'failed')),
  timetable_error  text,
  updated_at       timestamptz not null default now()
);

alter table watch_requests enable row level security;

create policy watch_requests_read on watch_requests for select to anon, authenticated using (true);

revoke insert, update, delete on watch_requests from anon, authenticated;

create function request_train(p_train_number text)
returns watch_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  result watch_requests;
begin
  if not exists (select 1 from trains where number = p_train_number) then
    raise exception 'Train % is not in trains.', p_train_number;
  end if;

  insert into watch_requests (train_number)
  values (p_train_number)
  on conflict (train_number) do update set
    requested_at = now(),
    timetable_status = case
      when watch_requests.timetable_status = 'failed' and watch_requests.updated_at < now() - interval '6 hours'
        then 'pending'
      else watch_requests.timetable_status
    end,
    timetable_error = case
      when watch_requests.timetable_status = 'failed' and watch_requests.updated_at < now() - interval '6 hours'
        then null
      else watch_requests.timetable_error
    end,
    updated_at = case
      when watch_requests.timetable_status = 'failed' and watch_requests.updated_at < now() - interval '6 hours'
        then now()
      else watch_requests.updated_at
    end
  where watch_requests.requested_at < now() - interval '10 minutes'
  returning * into result;

  if not found then
    select * into result from watch_requests where train_number = p_train_number;
  end if;

  return result;
end;
$$;

revoke all on function request_train(text) from public;
grant execute on function request_train(text) to anon, authenticated;

alter publication supabase_realtime add table watch_requests, timetable_stops;
