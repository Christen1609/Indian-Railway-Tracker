import type { ResolvedEvent, TimetableStop } from '../types.js';

const HALF = 2;

/** How many of the timetabled arrivals are confirmed, as an arrival or a pass */
export function arrivalsConfirmed(
  stops: readonly TimetableStop[],
  confirmed: readonly ResolvedEvent[],
): { confirmed: number; expected: number } {
  const due = stops.filter((stop) => stop.schedArrMin !== null);
  const done = due.filter((stop) =>
    confirmed.some(
      (event) =>
        event.stationCode === stop.stationCode && (event.type === 'ARR' || event.type === 'PASS'),
    ),
  );
  return { confirmed: done.length, expected: due.length };
}

/** Whether fewer than half of the timetabled arrivals were confirmed */
export function isThinTrip(
  stops: readonly TimetableStop[],
  confirmed: readonly ResolvedEvent[],
): boolean {
  const counts = arrivalsConfirmed(stops, confirmed); // the arrivals confirmed, from arrivalsConfirmed
  return counts.confirmed * HALF < counts.expected;
}
