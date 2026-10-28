import { describe, expect, it } from 'vitest';
import {
  JourneyRow,
  StationRow,
  StopEventRow,
  TimetableStopRow,
  TrainRow,
  TrainStateRow,
} from './rows';

const TRAIN = {
  number: '12951',
  name: 'Mumbai Central-New Delhi Rajdhani Express',
  origin: 'BCT',
  destination: 'NDLS',
  runs_on: 127,
  top_speed_kmh: 130,
};

const STATE = {
  journey_id: '1beca425-b123-4705-b6ac-fd91960ae37b',
  state: 'running',
  km: 1276.98,
  lo_km: 1234.69,
  hi_km: 1276.98,
  pace: 0.8796,
  delay_min: 17,
  next_station: 'NDLS',
  window_start: '2026-10-28T02:42:00+00:00',
  window_end: '2026-10-28T03:35:00+00:00',
  next_check_at: '2026-10-28T02:42:00+00:00',
  updated_at: '2026-10-28T01:36:21.426+00:00',
};

describe('row mappers', () => {
  it('maps a station row to a Station', () => {
    const row = {
      code: 'BVI',
      name: 'BORIVALI',
      name_hi: null,
      lat: 19.228739,
      lon: 72.856412,
      zone: 'WR',
    };
    expect(StationRow.parse(row)).toEqual({
      code: 'BVI',
      name: 'BORIVALI',
      nameHi: null,
      lat: 19.228739,
      lon: 72.856412,
      zone: 'WR',
    });
  });

  it('maps a train row to a Train', () => {
    expect(TrainRow.parse(TRAIN)).toEqual({
      number: '12951',
      name: 'Mumbai Central-New Delhi Rajdhani Express',
      origin: 'BCT',
      destination: 'NDLS',
      runsOn: 127,
      topSpeedKmh: 130,
    });
  });

  it('maps a timetable row with a missing arrival to a TimetableStop', () => {
    const row = {
      train_number: '12951',
      seq: 0,
      station_code: 'BCT',
      sched_arr: null,
      sched_dep: 1020,
      km: 0,
    };
    expect(TimetableStopRow.parse(row)).toEqual({
      trainNumber: '12951',
      seq: 0,
      stationCode: 'BCT',
      schedArrMin: null,
      schedDepMin: 1020,
      km: 0,
    });
  });

  it('maps a journey row to a Journey and ignores columns it does not use', () => {
    const row = {
      id: '1beca425-b123-4705-b6ac-fd91960ae37b',
      train_number: '12951',
      journey_date: '2026-10-27',
      status: 'scheduled',
      is_scored: false,
      cleaned_at: null,
    };
    expect(JourneyRow.parse(row)).toEqual({
      id: '1beca425-b123-4705-b6ac-fd91960ae37b',
      trainNumber: '12951',
      journeyDate: '2026-10-27',
      status: 'scheduled',
      isScored: false,
    });
  });

  it('maps a train state row, turning timestamps to UTC and the window pair to a window', () => {
    expect(TrainStateRow.parse(STATE)).toEqual({
      journeyId: '1beca425-b123-4705-b6ac-fd91960ae37b',
      state: 'running',
      km: 1276.98,
      loKm: 1234.69,
      hiKm: 1276.98,
      pace: 0.8796,
      delayMin: 17,
      nextStation: 'NDLS',
      window: { windowStart: '2026-10-28T02:42:00.000Z', windowEnd: '2026-10-28T03:35:00.000Z' },
      nextCheckAt: '2026-10-28T02:42:00.000Z',
      updatedAt: '2026-10-28T01:36:21.426Z',
    });
  });

  it('maps a train state with no window to a null window', () => {
    const row = { ...STATE, window_start: null, window_end: null, next_check_at: null };
    const state = TrainStateRow.parse(row);
    expect(state.window).toBeNull();
    expect(state.nextCheckAt).toBeNull();
  });

  it('maps a stop time row to a StopEvent', () => {
    const row = { station_code: 'BVI', type: 'ARR', at: '2026-10-27T12:01:12+00:00' };
    expect(StopEventRow.parse(row)).toEqual({
      stationCode: 'BVI',
      type: 'ARR',
      at: '2026-10-27T12:01:12.000Z',
    });
  });

  it.each([
    ['a state the app does not know', TrainStateRow, { ...STATE, state: 'flying' }],
    [
      'a timestamp without an offset',
      TrainStateRow,
      { ...STATE, updated_at: '2026-10-28T01:36:21' },
    ],
    ['a number sent as text', TrainStateRow, { ...STATE, km: '1276.98' }],
    [
      'a journey date that is not a date',
      JourneyRow,
      {
        id: 'x',
        train_number: '12951',
        journey_date: '27/10/2026',
        status: 'running',
        is_scored: false,
      },
    ],
    [
      'an event type the app does not know',
      StopEventRow,
      { station_code: 'BVI', type: 'LATE', at: '2026-10-27T12:01:12+00:00' },
    ],
  ])('rejects %s', (_name, schema, row) => {
    expect(schema.safeParse(row).success).toBe(false);
  });
});
