import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Journey, TrainState } from '@train-tracker/core/types';
import { GroundProfile } from './features/profile/ground-profile';
import { alongKmOf, buildTrack, pointAt } from './features/map/geometry';
import { isDarkPanels, sunAt, sunPhase } from './features/map/lighting';
import { ROUTES } from './features/map/route-12951';
import type { ViewMode } from './features/map/train-map';
import { StatusCard } from './features/status/status-card';
import { StopSheet } from './features/stops/stop-sheet';
import { formatClock } from './lib/format';
import { useLiveJourney, useNow } from './lib/live';
import type { JourneyView } from './lib/live';

const TrainMap = lazy(() =>
  import('./features/map/train-map').then((module) => ({ default: module.TrainMap })),
);

const DEFAULT_TRAIN_NUMBER = '12951';
const TRAIN_NUMBER =
  new URLSearchParams(window.location.search).get('train') || DEFAULT_TRAIN_NUMBER;
const UNTRACKED_MESSAGE = 'Only 12951 is tracked so far.';

type Chip = { phase: string; clock: string };

function SearchForm() {
  const [message, setMessage] = useState('');
  const [value, setValue] = useState(TRAIN_NUMBER);

  /** Open a tracked train, or say it is not tracked */
  function submit(event: FormEvent) {
    event.preventDefault();
    const number = value.trim();
    if (!Object.hasOwn(ROUTES, number)) {
      setMessage(UNTRACKED_MESSAGE);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('train', number);
    window.location.assign(url);
  }

  return (
    <>
      <form className="panel search" role="search" onSubmit={submit}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          name="q"
          value={value}
          placeholder="Train number"
          aria-label="Train number"
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit">Track</button>
      </form>
      <span className="search-msg" role="status">
        {message}
      </span>
    </>
  );
}

function Frame({ chip, children }: { chip: Chip | null; children: ReactNode }) {
  return (
    <div className="ui">
      <div className="bar">
        <div className="panel brand">
          <span className="mark" aria-hidden="true">
            क
          </span>
          <span className="word">kahan</span>
          <span className="word-hi" lang="hi">
            कहाँ
          </span>
        </div>
        <SearchForm />
        <span className="spacer"></span>
        {chip !== null && (
          <div className="panel chip-sun">
            <b>{chip.phase}</b>
            <span className="muted">at the train</span>
            <span className="mono">{chip.clock} IST</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <Frame chip={null}>
      <p className="panel notice" role="status">
        {children}
      </p>
    </Frame>
  );
}

function Live({
  view,
  journey,
  state,
}: {
  view: JourneyView;
  journey: Journey;
  state: TrainState;
}) {
  const now = useNow();
  const [mode, setMode] = useState<ViewMode>('follow');
  const [isTerrainOn, setIsTerrainOn] = useState(true);
  const route = ROUTES[view.train.number];
  const track = useMemo(
    () => (route === undefined ? null : buildTrack(route, view.stops, view.stations)),
    [route, view.stops, view.stations],
  );
  const spot = track === null ? null : pointAt(track, alongKmOf(track, state.km));
  const sun = spot === null ? null : sunAt(now, spot.lon, spot.lat);
  const isDark = sun !== null && isDarkPanels(sun);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  if (track === null || sun === null) {
    return <Notice>{UNTRACKED_MESSAGE}</Notice>;
  }
  return (
    <>
      <Suspense fallback={null}>
        <TrainMap
          track={track}
          km={state.km}
          loKm={state.loKm}
          hiKm={state.hiKm}
          sun={sun}
          mode={mode}
          isTerrainOn={isTerrainOn}
          onModeChange={setMode}
        />
      </Suspense>
      <Frame chip={{ phase: sunPhase(sun), clock: formatClock(now) }}>
        <div className="left">
          <StatusCard
            train={view.train}
            stops={view.stops}
            stations={view.stations}
            state={state}
            track={track}
            journeyDate={journey.journeyDate}
            now={now}
          />
          <div className="panel cam" role="toolbar" aria-label="Map view">
            <button
              type="button"
              aria-pressed={mode === 'follow'}
              onClick={() => setMode('follow')}
            >
              Follow train
            </button>
            <button type="button" aria-pressed={mode === 'over'} onClick={() => setMode('over')}>
              Whole route
            </button>
            <button
              type="button"
              aria-pressed={isTerrainOn}
              onClick={() => setIsTerrainOn(!isTerrainOn)}
            >
              3D terrain
            </button>
          </div>
        </div>
        <StopSheet
          train={view.train}
          stops={view.stops}
          stations={view.stations}
          events={view.events}
          state={state}
          track={track}
          journeyDate={journey.journeyDate}
        />
        <div className="bottom">
          <GroundProfile
            track={track}
            km={state.km}
            loKm={state.loKm}
            hiKm={state.hiKm}
            theme={isDark ? 'dark' : 'light'}
          />
          <div className="attrib">
            ©{' '}
            <a href="https://openfreemap.org" target="_blank" rel="noopener">
              OpenFreeMap
            </a>{' '}
            ©{' '}
            <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">
              OpenMapTiles
            </a>{' '}
            <span className="wordy">Data from </span>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
              OpenStreetMap
            </a>{' '}
            · <span className="wordy">Terrain © </span>
            <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">
              Mapterhorn
            </a>
          </div>
        </div>
      </Frame>
    </>
  );
}

export function App() {
  const load = useLiveJourney(TRAIN_NUMBER);
  if (load.kind === 'loading') {
    return <Notice>Loading train {TRAIN_NUMBER}.</Notice>;
  }
  if (load.kind === 'error') {
    return <Notice>{load.message}</Notice>;
  }
  const { view } = load;
  if (view.journey === null) {
    return (
      <Notice>
        No journey is recorded for {view.train.number} {view.train.name} yet.
      </Notice>
    );
  }
  if (view.state === null) {
    return (
      <Notice>
        No position is recorded for {view.train.number} {view.train.name} yet.
      </Notice>
    );
  }
  return <Live view={view} journey={view.journey} state={view.state} />;
}
