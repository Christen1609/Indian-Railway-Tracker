import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimetableHaltRead } from '@train-tracker/core/sources/goibibo';
import { answerRequest, pendingRequests, requestedSince, saveTimetable } from './watch-requests.js';

const CONFIG = { url: 'http://db', serviceRoleKey: 'k' };
const NOW = '2026-11-04T05:30:00.000Z';

const HALTS: TimetableHaltRead[] = [
  {
    seq: 0,
    stationCode: 'SBC',
    name: 'KSR BENGALURU',
    lat: 12.9,
    lon: 77.5,
    schedArrMin: null,
    schedDepMin: 1160,
    km: 0,
  },
  {
    seq: 1,
    stationCode: 'NDLS',
    name: 'NEW DELHI',
    lat: 28.6,
    lon: 77.2,
    schedArrMin: 3420,
    schedDepMin: null,
    km: 2395,
  },
];

/** Replies in order, one per call */
function serves(...replies: Response[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const reply of replies) {
    fetchMock.mockResolvedValueOnce(reply);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const rows = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const done = () => new Response(null, { status: 204 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pendingRequests and requestedSince', () => {
  it('asks for pending requests oldest first', async () => {
    const fetchMock = serves(rows([{ train_number: '12627' }]));
    expect(await pendingRequests(CONFIG)).toEqual(['12627']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://db/rest/v1/watch_requests?timetable_status=eq.pending&select=train_number&order=requested_at.asc',
    );
  });

  it('asks for ready requests since a time, newest first, up to the limit', async () => {
    const fetchMock = serves(rows([{ train_number: '11077' }, { train_number: '12627' }]));
    expect(await requestedSince(NOW, 25, CONFIG)).toEqual(['11077', '12627']);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('timetable_status=eq.ready');
    expect(url).toContain(`requested_at=gte.${encodeURIComponent(NOW)}`);
    expect(url).toContain('order=requested_at.desc&limit=25');
  });
});

describe('answerRequest', () => {
  it('patches the status, the error and the time of one request only', async () => {
    const fetchMock = serves(done());
    await answerRequest('12627', 'failed', 'no timetable', NOW, CONFIG);
    const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('http://db/rest/v1/watch_requests?train_number=eq.12627');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({
      timetable_status: 'failed',
      timetable_error: 'no timetable',
      updated_at: NOW,
    });
  });
});

describe('saveTimetable', () => {
  it('adds only the stations we lack, deletes the old stops, writes the new ones, then sets the run days', async () => {
    const fetchMock = serves(
      rows([{ code: 'SBC', lat: 12.97, lon: 77.57 }]),
      rows([{ code: 'NDLS' }]),
      done(),
      rows([{ seq: 0 }, { seq: 1 }]),
      done(),
    );
    await saveTimetable('12627', HALTS, 127, CONFIG);

    const calls = fetchMock.mock.calls as [string, { method?: string; body?: string }][];
    expect(
      calls.map(([url, options]) => `${options.method ?? 'GET'} ${url.split('/rest/v1/')[1]}`),
    ).toEqual([
      'GET stations?code=in.(SBC,NDLS)&select=code,lat,lon',
      'POST stations?select=code',
      'DELETE timetable_stops?train_number=eq.12627',
      'POST timetable_stops?select=seq',
      'PATCH trains?number=eq.12627',
    ]);
    expect(JSON.parse(calls[1]?.[1].body ?? '')).toEqual([
      { code: 'NDLS', name: 'NEW DELHI', lat: 28.6, lon: 77.2 },
    ]);
    expect(JSON.parse(calls[3]?.[1].body ?? '')[1]).toEqual({
      train_number: '12627',
      seq: 1,
      station_code: 'NDLS',
      sched_arr: 3420,
      sched_dep: null,
      km: 2395,
    });
    expect(JSON.parse(calls[4]?.[1].body ?? '')).toEqual({ runs_on: 127 });
  });

  it('writes no station and leaves runs_on alone when nothing is missing or known', async () => {
    const fetchMock = serves(
      rows([
        { code: 'SBC', lat: null, lon: null },
        { code: 'NDLS', lat: null, lon: null },
      ]),
      done(),
      rows([]),
    );
    await saveTimetable('12627', HALTS, null, CONFIG);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
