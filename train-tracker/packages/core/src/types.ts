// Features: ids, reference data, live data, estimates, scores, assert

export type IsoDate = string;
export type IsoUtc = string;

export type SourceId = 'railradar' | 'railyatri_scrape';
export type EventType = 'ARR' | 'DEP' | 'PASS';
export type Confidence = 'high' | 'medium' | 'low';
export type JourneyStatus = 'scheduled' | 'running' | 'arrived' | 'cancelled';
export type TrainStateKind = 'scheduled' | 'running' | 'halted' | 'late' | 'arrived';

export type RejectReason =
  | 'off_route'
  | 'future_time'
  | 'before_start'
  | 'dep_before_arr'
  | 'backwards'
  | 'too_fast'
  | 'bad_format';

export type Station = {
  code: string;
  name: string;
  nameHi: string | null;
  lat: number | null;
  lon: number | null;
  zone: string | null;
};

export type Train = {
  number: string;
  name: string;
  origin: string;
  destination: string;
  runsOn: number | null;
  topSpeedKmh: number | null;
};

export type TimetableStop = {
  trainNumber: string;
  seq: number;
  stationCode: string;
  schedArrMin: number | null;
  schedDepMin: number | null;
  km: number;
};

export type SectionCap = {
  trainNumber: string;
  fromSeq: number;
  fastestPace: number;
  tripsSeen: number;
  updatedAt: IsoUtc;
};

export type RawFetch = {
  source: SourceId;
  url: string;
  status: number;
  body: string;
  fetchedAt: IsoUtc;
  latencyMs: number;
  error?: string;
};

export type SourceEvent = {
  source: SourceId;
  trainNumber: string;
  journeyDate: IsoDate;
  stationCode: string;
  type: EventType;
  at: IsoUtc;
  fetchedAt: IsoUtc;
  rawFetchId: string;
  rejected?: RejectReason;
};

export type ResolvedEvent = {
  journeyId: string;
  stationCode: string;
  type: EventType;
  at: IsoUtc;
  confidenceScore: number;
  confidence: Confidence;
  chosenSource: SourceId;
  sources: SourceId[];
  resolvedAt: IsoUtc;
};

export type Journey = {
  id: string;
  trainNumber: string;
  journeyDate: IsoDate;
  status: JourneyStatus;
  isScored: boolean;
};

export type ArrivalWindow = {
  windowStart: IsoUtc;
  windowEnd: IsoUtc;
};

export type Estimate = {
  state: TrainStateKind;
  km: number;
  loKm: number;
  hiKm: number;
  pace: number;
  delayMin: number | null;
  nextStation: string | null;
  window: ArrivalWindow | null;
};

export type TrainState = Estimate & {
  journeyId: string;
  nextCheckAt: IsoUtc | null;
  updatedAt: IsoUtc;
};

export type StopTime = {
  seq: number;
  stationCode: string;
  km: number;
  schedArrMin: number | null;
  schedDepMin: number | null;
  arrAt: IsoUtc | null;
  depAt: IsoUtc | null;
  delayMin: number | null;
  window: ArrivalWindow | null;
};

export type JourneyScore = {
  journeyId: string;
  inWindowPct: number;
  medianWindowMin: number;
  atStationWithin10kmPct: number;
  scoredAt: IsoUtc;
};

export type SourceScore = {
  source: SourceId;
  journeyId: string;
  coverage: number | null;
  errorMin: number | null;
  lagMin: number | null;
  scoredAt: IsoUtc;
};

/** Throws when an invariant is broken */
export function assert(condition: unknown, expected: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant broken. Expected ${expected}`);
  }
}
