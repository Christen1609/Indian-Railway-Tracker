// Test data only. Excluded from the build in tsconfig.json, so it never ships in dist.
// The 12951 Mumbai Rajdhani: the eight halts, their exact km and their timetable minutes.
// Source: the first real RailRadar response, fixtures/railradar/12951-live.json.

import type { TimetableStop } from '../types.js';

/** 12951's rated top speed, the blunt ceiling every pace check falls back to */
export const TOP_SPEED_KMH = 130;

/** The journey date every 12951 test runs on */
export const JOURNEY_DATE = '2026-10-21';

/** The eight halts of 12951, BCT to NDLS */
export const STOPS_12951: TimetableStop[] = [
  { seq: 0, stationCode: 'BCT', km: 0, schedArrMin: null, schedDepMin: 1020 },
  { seq: 1, stationCode: 'BVI', km: 30, schedArrMin: 1040, schedDepMin: 1042 },
  { seq: 2, stationCode: 'ST', km: 263.6, schedArrMin: 1183, schedDepMin: 1188 },
  { seq: 3, stationCode: 'BRC', km: 393.2, schedArrMin: 1266, schedDepMin: 1276 },
  { seq: 4, stationCode: 'RTM', km: 653.6, schedArrMin: 1465, schedDepMin: 1468 },
  { seq: 5, stationCode: 'NAD', km: 697.4, schedArrMin: 1508, schedDepMin: 1510 },
  { seq: 6, stationCode: 'KOTA', km: 922.8, schedArrMin: 1635, schedDepMin: 1640 },
  { seq: 7, stationCode: 'NDLS', km: 1388.4, schedArrMin: 1952, schedDepMin: null },
].map((stop) => ({ ...stop, trainNumber: '12951' }));
