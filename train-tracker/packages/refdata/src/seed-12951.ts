// Features: the 12951 timetable, and the facts datameet does not carry

import type { TimetableStopRow } from './rows.ts';

export const TRAIN_12951 = { number: '12951', runs_on: 127, top_speed_kmh: 130 } as const;

export const STOPS_12951: readonly TimetableStopRow[] = [
  { train_number: '12951', seq: 0, station_code: 'BCT', sched_arr: null, sched_dep: 1020, km: 0 },
  { train_number: '12951', seq: 1, station_code: 'BVI', sched_arr: 1040, sched_dep: 1042, km: 30 },
  { train_number: '12951', seq: 2, station_code: 'ST', sched_arr: 1183, sched_dep: 1188, km: 263 },
  { train_number: '12951', seq: 3, station_code: 'BRC', sched_arr: 1266, sched_dep: 1276, km: 392 },
  { train_number: '12951', seq: 4, station_code: 'RTM', sched_arr: 1465, sched_dep: 1468, km: 653 },
  { train_number: '12951', seq: 5, station_code: 'NAD', sched_arr: 1508, sched_dep: 1510, km: 695 },
  {
    train_number: '12951',
    seq: 6,
    station_code: 'KOTA',
    sched_arr: 1635,
    sched_dep: 1640,
    km: 920,
  },
  {
    train_number: '12951',
    seq: 7,
    station_code: 'NDLS',
    sched_arr: 1952,
    sched_dep: null,
    km: 1384,
  },
];
