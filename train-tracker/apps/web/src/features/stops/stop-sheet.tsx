import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { IsoDate, Station, TimetableStop, Train, TrainState } from '@train-tracker/core/types';
import { alongKmOf, nextIndex } from '../map/geometry';
import type { Track } from '../map/geometry';
import {
  formatJourneyClock,
  formatJourneyDate,
  formatKm,
  formatPace,
  formatTimetableMinute,
  formatWindow,
} from '../../lib/format';
import type { StopEvent } from '../../lib/rows';

type Props = {
  train: Train;
  stops: TimetableStop[];
  stations: Map<string, Station>;
  events: StopEvent[];
  state: TrainState;
  track: Track;
  journeyDate: IsoDate;
};

const SHEET_OFFSET_SHARE = 0.3;
const PHONE_QUERY = '(max-width: 760px)';

/** Scheduled arrival and departure as short lines */
function scheduleLines(stop: TimetableStop): string[] {
  const arr = stop.schedArrMin === null ? null : formatTimetableMinute(stop.schedArrMin);
  const dep = stop.schedDepMin === null ? null : formatTimetableMinute(stop.schedDepMin);
  return [
    arr === null ? null : `Sched ${arr}`,
    dep === null ? null : `${arr === null ? 'Sched' : 'dep'} ${dep}`,
  ].filter((line) => line !== null);
}

export function StopSheet({ train, stops, stations, events, state, track, journeyDate }: Props) {
  const [isAll, setIsAll] = useState(false);
  const [isOpen, setIsOpen] = useState(() => !window.matchMedia(PHONE_QUERY).matches);
  const listRef = useRef<HTMLOListElement>(null);
  const hereRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const here = hereRef.current;
    if (list !== null && here !== null) {
      list.scrollTop = here.offsetTop - list.clientHeight * SHEET_OFFSET_SHARE;
    }
  }, [isAll]);

  const stopOf = new Map(stops.map((stop) => [stop.stationCode, stop]));
  const actual = new Map(events.map((event) => [`${event.stationCode}:${event.type}`, event.at]));
  const nameOf = (code: string) => stations.get(code)?.name ?? code;
  const alongKm = alongKmOf(track, state.km);
  const nextIdx = nextIndex(track, alongKm); // route point just ahead, from nextIndex
  const first = stops[0];
  const last = stops.at(-1);
  const haltsLeft = stops.filter((stop) => stop.km > state.km).length;
  const toGoKm = Math.max(0, (last?.km ?? 0) - state.km);

  const isArrived = state.state === 'arrived';
  const rows: ReactNode[] = [];
  let hiddenCount = 0;
  let hiddenFromKm = 0;
  let lastKm = 0;
  /** A collapsed row standing in for the hidden stretch of track */
  const flushHidden = (toKm: number, isPast: boolean) => {
    if (hiddenCount > 0) {
      rows.push(
        <li key={`more-${rows.length}`} className="row more">
          <i aria-hidden="true"></i>
          <button type="button" onClick={() => setIsAll(true)}>
            {hiddenCount} {isPast ? 'stations passed' : 'more stations'}
          </button>
          <span className="gap">{Math.round(toKm - hiddenFromKm)} km</span>
        </li>,
      );
    }
    hiddenCount = 0;
  };

  track.points.forEach((point, i) => {
    if (i === nextIdx && !isArrived) {
      flushHidden(state.km, true);
      rows.push(
        <li key="here" ref={hereRef} className="row here">
          <i className="zone" aria-hidden="true"></i>
          <div className="nm">
            <span className="n">{train.number} is somewhere here</span>
            <span className="sub">
              km {Math.round(state.loKm)}–{Math.round(state.hiKm)} · {formatPace(state.pace)}
            </span>
          </div>
        </li>,
      );
      lastKm = state.km;
    }
    const stop = stopOf.get(point.code);
    if (!isAll && stop === undefined) {
      if (hiddenCount === 0) {
        hiddenFromKm = lastKm;
      }
      hiddenCount++;
      return;
    }
    const isPast = isArrived || i < nextIdx;
    flushHidden(point.km, isPast);
    lastKm = point.km;
    const isNext = state.nextStation === point.code;
    const arrAt = actual.get(`${point.code}:ARR`);
    const depAt = actual.get(`${point.code}:DEP`);
    const doneAt = arrAt ?? depAt;
    const className = [
      'row',
      stop === undefined ? 'pass' : 'halt',
      isPast ? 'past' : '',
      isNext ? 'next' : '',
    ].join(' ');
    rows.push(
      <li key={point.code} className={className}>
        <i className="node" aria-hidden="true"></i>
        <div className="nm">
          <span className="n">{point.name}</span>
          <span className="meta">
            <span className="code">{point.code}</span>
            {!isPast && (
              <span className="dist">{Math.max(1, Math.round(point.km - state.km))} km</span>
            )}
          </span>
        </div>
        {stop !== undefined && (
          <div className="tm">
            {doneAt !== undefined && <span>{formatJourneyClock(journeyDate, doneAt)}</span>}
            {doneAt === undefined && isNext && state.window !== null && (
              <span className="w">{formatWindow(journeyDate, state.window)}</span>
            )}
            {arrAt !== undefined && depAt !== undefined && (
              <span className="dl">dep {formatJourneyClock(journeyDate, depAt)}</span>
            )}
            {scheduleLines(stop).map((line) => (
              <span key={line} className="sch">
                {line}
              </span>
            ))}
          </div>
        )}
      </li>,
    );
  });
  flushHidden(last?.km ?? lastKm, false);

  return (
    <aside className={`panel stops${isOpen ? ' open' : ' shut'}`} aria-label="Journey">
      <header>
        <h2>
          {first ? nameOf(first.stationCode) : ''} to {last ? nameOf(last.stationCode) : ''}
        </h2>
        <p className="muted">
          {formatJourneyDate(journeyDate)}. {formatKm(toGoKm)} still to run,{' '}
          {haltsLeft === 1 ? '1 halt' : `${haltsLeft} halts`} to come
        </p>
        <button
          type="button"
          className="sheet-btn"
          aria-expanded={isOpen}
          aria-controls="journey-list"
          aria-label={isOpen ? 'Collapse journey' : 'Expand journey'}
          onClick={() => setIsOpen(!isOpen)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </header>
      <ol className="list" id="journey-list" ref={listRef}>
        {rows}
      </ol>
      <footer>
        <button type="button" onClick={() => setIsAll(!isAll)}>
          {isAll ? 'Show halts only' : `Show all ${track.points.length} stations`}
        </button>
      </footer>
    </aside>
  );
}
