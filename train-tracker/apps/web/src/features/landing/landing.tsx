import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { dayOffset, formatIstClock, istDateOf } from '@train-tracker/core/time';
import type { IsoUtc } from '@train-tracker/core/types';
import { Brand } from '../brand/brand';
import { alongKmOf, buildTrack, pointAt } from '../map/geometry';
import type { Coord } from '../map/geometry';
import { ROUTES, TRAIN_NAMES_HI } from '../map/route-12951';
import { journeyProgress, RUNNING_STATES } from './journey-progress';
import { SearchField } from '../search/search-field';
import {
  describeTrainStatus,
  formatAgo,
  formatClock,
  formatJourneyDate,
  formatKmOf,
  formatStationName,
} from '../../lib/format';
import { useNow, useTrackedTrains } from '../../lib/live';
import type { TrackedTrain } from '../../lib/live';
import { hasMovedPages, NavLink, trainSearch } from '../../lib/navigation';

const LandingMap = lazy(() =>
  import('./landing-map').then((module) => ({ default: module.LandingMap })),
);

const TRACKED_NUMBERS = Object.keys(ROUTES);
const SEARCH_ID = 'train-search';
const NO_MARKS: Coord[] = [];

/** Station's clock and any later day, such as "08:32" and "+1" */
function StopTime({ minute }: { minute: number | null }) {
  if (minute === null) {
    return null;
  }
  const laterDays = dayOffset(minute) - 1; // days after the first, from dayOffset
  return (
    <span className="jc-time">
      <span className="mono">{formatIstClock(minute)}</span> IST
      {laterDays > 0 && <span className="mono"> +{laterDays}</span>}
    </span>
  );
}

/** One tracked train as a live journey card that links to its 3D view */
function JourneyCard({ tracked, now }: { tracked: TrackedTrain; now: IsoUtc }) {
  const { train, stops, stations, journey, state } = tracked;
  const nameOf = (code: string) => formatStationName(stations.get(code)?.name ?? code); // title-case name, from formatStationName
  const first = stops[0];
  const last = stops.at(-1);
  const nextStop = stops.find((stop) => stop.stationCode === state?.nextStation);
  const status = describeTrainStatus({
    state: journey === null ? null : state,
    nextName: state?.nextStation == null ? null : nameOf(state.nextStation),
    nextDueMin: nextStop?.schedArrMin ?? nextStop?.schedDepMin ?? null,
    originName: nameOf(train.origin),
    destinationName: nameOf(train.destination),
    departMin: first?.schedDepMin ?? null,
  });
  const progress = journeyProgress(stops, journey === null ? null : state); // fill, ticks and dot, from journeyProgress
  const nameHi = TRAIN_NAMES_HI[train.number];
  const isToday = journey === null || journey.journeyDate === istDateOf(now);
  const numberId = `tno-${train.number}`;
  const nameId = `name-${train.number}`;
  const statusId = `status-${train.number}`;
  return (
    <li>
      <NavLink
        search={trainSearch(train.number)}
        className="panel jcard"
        labelledBy={`${numberId} ${nameId}`}
        describedBy={statusId}
      >
        <span className="jc-head">
          <span className="tno" id={numberId}>
            {train.number}
          </span>
          <span className="run-name" id={nameId}>
            {train.name}
            {nameHi !== undefined && (
              <span className="run-hi" lang="hi">
                {nameHi}
              </span>
            )}
          </span>
        </span>
        <span className="jc-ends">
          <span className="jc-end">
            <b>{nameOf(train.origin)}</b>
            <StopTime minute={first?.schedDepMin ?? null} />
          </span>
          <span className="jc-end jc-dest">
            <b>{nameOf(train.destination)}</b>
            <StopTime minute={last?.schedArrMin ?? null} />
          </span>
        </span>
        <span className="jc-bar" aria-hidden="true">
          <span className="jc-fill" style={{ width: `${progress.fraction * 100}%` }}></span>
          {progress.ticks.map((tick) => (
            <i className="jc-tick" key={tick} style={{ left: `${tick * 100}%` }}></i>
          ))}
          {progress.hasDot && (
            <span className="jc-dot" style={{ left: `${progress.fraction * 100}%` }}></span>
          )}
        </span>
        <span className="jc-km mono" aria-hidden="true">
          {formatKmOf(progress.doneKm, progress.totalKm)}
        </span>
        <span className="jc-status" id={statusId}>
          <span className={`run-status ${status.tone}`}>{status.text}</span>
          {status.delayText !== null && (
            <span className={`run-status ${status.tone}`}>{status.delayText}</span>
          )}
        </span>
        <span className="jc-foot">
          {state !== null && <span>Updated {formatAgo(state.updatedAt, now)}</span>}
          {!isToday && journey !== null && (
            <span>{formatJourneyDate(journey.journeyDate)} run</span>
          )}
        </span>
      </NavLink>
    </li>
  );
}

export function Landing() {
  const load = useTrackedTrains(TRACKED_NUMBERS);
  const now = useNow();
  const inputRef = useRef<HTMLInputElement>(null);
  const trains = load.kind === 'ready' ? load.trains : null;
  const candidates = useMemo(
    () => (trains ?? []).map(({ train }) => ({ number: train.number, name: train.name })),
    [trains],
  );
  const marks = useMemo(
    () =>
      (trains ?? []).flatMap(({ train, stops, stations, state }) => {
        const route = ROUTES[train.number];
        const track = route === undefined ? null : buildTrack(route, stops, stations);
        if (track === null || state === null || !RUNNING_STATES.includes(state.state)) {
          return [];
        }
        const { lon, lat } = pointAt(track, alongKmOf(track, state.km)); // train position on the route, from pointAt
        return [{ lon, lat }];
      }),
    [trains],
  );

  useEffect(() => {
    delete document.documentElement.dataset.theme;
    if (hasMovedPages()) {
      inputRef.current?.focus();
    }
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <LandingMap marks={trains === null ? NO_MARKS : marks} />
      </Suspense>
      <div className="landing">
        <main className="landing-col">
          <Brand />
          <section className="sign">
            <h1>
              <span className="sign-hi" lang="hi">
                कौन सी गाड़ी?
              </span>
              <label className="sign-en" htmlFor={SEARCH_ID}>
                Which train?
              </label>
            </h1>
            <SearchField
              candidates={candidates}
              inputId={SEARCH_ID}
              formClass="sign-form"
              inputRef={inputRef}
            />
            <p className="sign-clock">
              <span className="mono">IST {formatClock(now)}</span>
            </p>
            <div className="sign-legs" aria-hidden="true">
              <i></i>
              <i></i>
            </div>
          </section>
          <section aria-labelledby="tracked-heading">
            <h2 id="tracked-heading">Tracked now</h2>
            {load.kind === 'loading' && <p role="status">Loading tracked trains.</p>}
            {load.kind === 'error' && <p role="status">{load.message}</p>}
            {trains !== null && trains.length === 0 && (
              <p role="status">No trains are tracked yet.</p>
            )}
            {trains !== null && trains.length > 0 && (
              <ul className="runs">
                {trains.map((tracked) => (
                  <JourneyCard key={tracked.train.number} tracked={tracked} now={now} />
                ))}
              </ul>
            )}
          </section>
          <p className="landing-attrib">
            Imagery{' '}
            <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">
              NASA GIBS
            </a>
            , Blue Marble
          </p>
        </main>
      </div>
    </>
  );
}
