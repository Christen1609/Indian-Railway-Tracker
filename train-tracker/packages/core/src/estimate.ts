// Features: sections, section pace, recent pace, section caps, arrival windows, position and zone

import { timetableMinuteToUtc, utcToTimetableMinute } from './time.js';
import { assert } from './types.js';
import type {
  ArrivalWindow,
  Estimate,
  IsoDate,
  IsoUtc,
  ResolvedEvent,
  TimetableStop,
} from './types.js';

const ETA_MIN_PER_100KM = 8;
const SPARE_BLOCK_KM = 100;
const LATEST_WEIGHT = 0.6;
const PREVIOUS_WEIGHT = 0.4;
const RECENT_SECTIONS = 2;
const TIMETABLE_PACE = 1;
const MIN_PER_HOUR = 60;
const BUFFER_MIN = 5;
const BUFFER_SHARE = 0.05;
const HOLD_SHARE = 0.98;
const ORIGIN_KM = 0;

export type Section = {
  fromSeq: number;
  toSeq: number;
  distanceKm: number;
  timetabledMin: number;
};

/** The sections of a timetable, one between each pair of stops it can measure */
export function sections(stops: readonly TimetableStop[]): Section[] {
  const built: Section[] = [];
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (from?.schedDepMin == null || to?.schedArrMin == null) {
      continue;
    }
    built.push({
      fromSeq: from.seq,
      toSeq: to.seq,
      distanceKm: to.km - from.km,
      timetabledMin: to.schedArrMin - from.schedDepMin,
    });
  }
  return built;
}

/** Pace of one finished section: below 1 ran fast, above 1 ran slow */
export function sectionPace(actualMin: number, timetabledMin: number): number {
  assert(timetabledMin > 0, `a timetabled run time above zero, got ${timetabledMin}`);
  assert(actualMin >= 0, `a run time of zero or more, got ${actualMin}`);
  return actualMin / timetabledMin;
}

/** Recent pace, leaning on the latest of the last two finished sections */
export function recentPace(finished: readonly number[]): number {
  const recent = finished.slice(-RECENT_SECTIONS);
  const latest = recent[recent.length - 1];
  const previous = recent.length < RECENT_SECTIONS ? undefined : recent[0];
  if (latest === undefined) {
    return TIMETABLE_PACE;
  }
  return previous === undefined ? latest : latest * LATEST_WEIGHT + previous * PREVIOUS_WEIGHT;
}

/** The fastest pace allowed on a section, with a learned cap taking over when it is faster */
export function sectionCap(
  section: Section,
  topSpeedKmh: number | null,
  learnedFastestPace?: number,
): number {
  const { distanceKm, timetabledMin } = section;
  assert(timetabledMin > 0, `a timetabled run time above zero, got ${timetabledMin}`);

  const spareMin = (ETA_MIN_PER_100KM * distanceKm) / SPARE_BLOCK_KM;
  const spareCap = (timetabledMin - spareMin) / timetabledMin;
  const speedCap =
    topSpeedKmh === null ? spareCap : ((distanceKm / topSpeedKmh) * MIN_PER_HOUR) / timetabledMin;
  const cap = Math.max(spareCap, speedCap);

  return learnedFastestPace !== undefined && learnedFastestPace < cap ? learnedFastestPace : cap;
}

/** A pace held back to its section cap, since nothing may run faster than the cap allows */
export function capPace(pace: number, cap: number): number {
  const capped = Math.max(pace, cap);
  assert(capped >= cap, `a pace at or above the section cap ${cap}, got ${pace}`);
  return capped;
}

export type MinuteWindow = { startMin: number; endMin: number };

export type EstimateInput = {
  journeyDate: IsoDate;
  stops: readonly TimetableStop[];
  confirmed: readonly ResolvedEvent[];
  topSpeedKmh: number | null;
  learnedCaps?: ReadonlyMap<number, number>;
  now: IsoUtc;
};

/** Minutes a train may lose on a section without the window closing early */
function bufferMin(timetabledMin: number): number {
  return Math.max(BUFFER_MIN, BUFFER_SHARE * timetabledMin);
}

/** The fastest pace a section allows, never beating the cap nor the timetable */
function fastPace(pace: number, cap: number): number {
  return capPace(Math.min(pace, TIMETABLE_PACE), cap); // pace held to the cap, from capPace
}

/** The slowest pace worth assuming, never faster than the timetable */
function slowPace(pace: number): number {
  return Math.max(pace, TIMETABLE_PACE);
}

/** When the next stop may be reached, from the minute the train left the one before */
export function arrivalWindow(
  departedAtMin: number,
  section: Section,
  pace: number,
  cap: number,
): MinuteWindow {
  const { timetabledMin } = section;
  const startMin = Math.round(departedAtMin + timetabledMin * fastPace(pace, cap));
  const endMin = Math.round(
    departedAtMin + timetabledMin * slowPace(pace) + bufferMin(timetabledMin),
  );
  assert(startMin <= endMin, `a window that opens before it closes, got ${startMin} to ${endMin}`);
  return { startMin, endMin };
}

/** When a train may leave a stop, which is never before the timetable */
export function expectedDepartureMin(
  arrivedAtMin: number,
  stop: TimetableStop | undefined,
): number {
  if (stop?.schedDepMin == null) {
    return arrivedAtMin;
  }
  const haltMin = stop.schedArrMin == null ? 0 : stop.schedDepMin - stop.schedArrMin;
  return Math.max(arrivedAtMin + haltMin, stop.schedDepMin);
}

/** How far along a section a train has come at one pace, held short of an unconfirmed stop */
function kmAtPace(
  section: Section,
  fromKm: number,
  elapsedMin: number,
  pace: number,
  reachedNext: boolean,
): number {
  const share = elapsedMin / (section.timetabledMin * pace);
  const ceiling = reachedNext ? 1 : HOLD_SHARE;
  return fromKm + Math.min(Math.max(share, 0), ceiling) * section.distanceKm;
}

/** The latest event of one type, or undefined when none was confirmed */
function latestOf(
  confirmed: readonly ResolvedEvent[],
  journeyDate: IsoDate,
  seqByStation: ReadonlyMap<string, number>,
  types: readonly string[],
): { seq: number; minute: number } | undefined {
  let found: { seq: number; minute: number } | undefined;
  for (const event of confirmed) {
    const seq = seqByStation.get(event.stationCode);
    if (seq === undefined || !types.includes(event.type)) {
      continue;
    }
    if (found === undefined || seq > found.seq) {
      found = { seq, minute: utcToTimetableMinute(journeyDate, event.at) };
    }
  }
  return found;
}

/** Paces of the sections the train has finished, oldest first */
function finishedPaces(
  built: readonly Section[],
  confirmed: readonly ResolvedEvent[],
  journeyDate: IsoDate,
  seqByStation: ReadonlyMap<string, number>,
): number[] {
  const departed = new Map<number, number>();
  const arrived = new Map<number, number>();
  for (const event of confirmed) {
    const seq = seqByStation.get(event.stationCode);
    if (seq === undefined) {
      continue;
    }
    const minute = utcToTimetableMinute(journeyDate, event.at);
    if (event.type === 'DEP') {
      departed.set(seq, minute);
    } else {
      arrived.set(seq, minute);
    }
  }

  const paces: number[] = [];
  for (const section of built) {
    const left = departed.get(section.fromSeq);
    const reached = arrived.get(section.toSeq);
    if (left !== undefined && reached !== undefined && reached > left) {
      paces.push(sectionPace(reached - left, section.timetabledMin)); // pace, from sectionPace
    }
  }
  return paces;
}

/** Where the train is, how late it is, and when it may reach the next stop */
export function estimate(input: EstimateInput): Estimate {
  const { journeyDate, stops, confirmed, topSpeedKmh, now } = input;
  const built = sections(stops); // one section per measurable pair, from sections
  const seqByStation = new Map(stops.map((stop) => [stop.stationCode, stop.seq]));
  const bySeq = new Map(stops.map((stop) => [stop.seq, stop]));
  const nowMin = utcToTimetableMinute(journeyDate, now);
  const last = stops[stops.length - 1];

  const pace = recentPace(finishedPaces(built, confirmed, journeyDate, seqByStation)); // recent pace, from recentPace
  const reached = latestOf(confirmed, journeyDate, seqByStation, ['ARR', 'PASS']);
  const left = latestOf(confirmed, journeyDate, seqByStation, ['DEP']);

  const delayAt = (seq: number, minute: number): number | null => {
    const scheduled = bySeq.get(seq)?.schedArrMin;
    return scheduled == null ? null : minute - scheduled;
  };

  if (reached !== undefined && last !== undefined && reached.seq === last.seq) {
    return {
      state: 'arrived',
      km: last.km,
      loKm: last.km,
      hiKm: last.km,
      pace,
      delayMin: delayAt(reached.seq, reached.minute),
      nextStation: null,
      window: null,
    };
  }

  const standingAt =
    reached !== undefined && (left === undefined || left.seq < reached.seq) ? reached : undefined;
  const fromSeq = standingAt?.seq ?? left?.seq;
  const section = fromSeq === undefined ? built[0] : built.find((one) => one.fromSeq === fromSeq);
  const from = bySeq.get(section?.fromSeq ?? ORIGIN_KM);
  const to = bySeq.get(section?.toSeq ?? ORIGIN_KM);

  if (section === undefined || from === undefined || to === undefined) {
    return {
      state: 'scheduled',
      km: ORIGIN_KM,
      loKm: ORIGIN_KM,
      hiKm: ORIGIN_KM,
      pace,
      delayMin: null,
      nextStation: null,
      window: null,
    };
  }

  const cap = sectionCap(section, topSpeedKmh, input.learnedCaps?.get(section.fromSeq)); // fastest allowed pace, from sectionCap

  if (standingAt !== undefined) {
    const departsAt = expectedDepartureMin(standingAt.minute, from); // earliest departure, from expectedDepartureMin
    if (nowMin < departsAt) {
      const window = arrivalWindow(departsAt, section, pace, cap); // minutes, from arrivalWindow
      return {
        state: 'halted',
        km: from.km,
        loKm: from.km,
        hiKm: from.km,
        pace,
        delayMin: delayAt(standingAt.seq, standingAt.minute),
        nextStation: to.stationCode,
        window: toWindow(journeyDate, window),
      };
    }
  }

  const departedAtMin =
    standingAt === undefined
      ? (left?.minute ?? from.schedDepMin ?? ORIGIN_KM)
      : expectedDepartureMin(standingAt.minute, from);
  const window = arrivalWindow(departedAtMin, section, pace, cap); // minutes, from arrivalWindow
  const scheduledStart = from.schedDepMin ?? departedAtMin;

  if (nowMin < scheduledStart && confirmed.length === 0) {
    return {
      state: 'scheduled',
      km: from.km,
      loKm: from.km,
      hiKm: from.km,
      pace,
      delayMin: null,
      nextStation: to.stationCode,
      window: toWindow(journeyDate, window),
    };
  }

  const elapsedMin = nowMin - departedAtMin;
  const km = kmAtPace(section, from.km, elapsedMin, capPace(pace, cap), false); // best guess km, from kmAtPace
  const loKm = kmAtPace(section, from.km, elapsedMin, slowPace(pace), false);
  const hiKm = kmAtPace(section, from.km, elapsedMin, fastPace(pace, cap), false);
  const isLate = nowMin > window.endMin;
  const lateBy = to.schedArrMin == null ? null : nowMin - to.schedArrMin;
  const carried = reached === undefined ? null : delayAt(reached.seq, reached.minute);

  return {
    state: isLate ? 'late' : 'running',
    km,
    loKm,
    hiKm,
    pace,
    delayMin: isLate ? Math.max(lateBy ?? 0, carried ?? 0) : carried,
    nextStation: to.stationCode,
    window: toWindow(journeyDate, window),
  };
}

/** A minute window as the UTC instants the app stores */
function toWindow(journeyDate: IsoDate, window: MinuteWindow): ArrivalWindow {
  return {
    windowStart: timetableMinuteToUtc(journeyDate, window.startMin),
    windowEnd: timetableMinuteToUtc(journeyDate, window.endMin),
  };
}
