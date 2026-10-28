import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Journey, TrainState } from '@train-tracker/core/types';
import { Brand } from './features/brand/brand';
import { Landing } from './features/landing/landing';
import { alongKmOf, buildTrack, pointAt } from './features/map/geometry';
import { isDarkPanels, sunAt, sunPhase } from './features/map/lighting';
import { ROUTES } from './features/map/route-12951';
import type { ViewMode } from './features/map/train-map';
import { trackedSummary } from './features/search/search';
import { SearchField } from './features/search/search-field';
import { StatusCard } from './features/status/status-card';
import { StopSheet } from './features/stops/stop-sheet';
import { formatClock } from './lib/format';
import { useLiveJourney, useNow } from './lib/live';
import type { JourneyView } from './lib/live';
import { useTrainParam } from './lib/navigation';

const TrainMap = lazy(() =>
  import('./features/map/train-map').then((module) => ({ default: module.TrainMap })),
);

const TRACKED_CANDIDATES = Object.keys(ROUTES).map((number) => ({ number, name: '' }));

type Chip = { phase: string; clock: string };

function Frame({
  chip,
  trainNumber,
  children,
}: {
  chip: Chip | null;
  trainNumber: string;
  children: ReactNode;
}) {
  return (
    <div className="ui">
      <div className="bar">
        <Brand />
        <SearchField
          candidates={TRACKED_CANDIDATES}
          inputId="train-search"
          initial={trainNumber}
          ariaLabel="Train number or name"
          hasIcon
          formClass="panel search"
        />
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

function Notice({ trainNumber, children }: { trainNumber: string; children: ReactNode }) {
  return (
    <Frame chip={null} trainNumber={trainNumber}>
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
    return <Notice trainNumber={view.train.number}>{trackedSummary(TRACKED_CANDIDATES)}</Notice>;
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
      <Frame
        chip={{ phase: sunPhase(sun), clock: formatClock(now) }}
        trainNumber={view.train.number}
      >
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

/** The 3D view of one train, or why it cannot be shown */
function TrainView({ trainNumber }: { trainNumber: string }) {
  const load = useLiveJourney(trainNumber);
  if (load.kind === 'loading') {
    return <Notice trainNumber={trainNumber}>Loading train {trainNumber}.</Notice>;
  }
  if (load.kind === 'error') {
    return <Notice trainNumber={trainNumber}>{load.message}</Notice>;
  }
  const { view } = load;
  if (view.journey === null) {
    return (
      <Notice trainNumber={trainNumber}>
        No journey is recorded for {view.train.number} {view.train.name} yet.
      </Notice>
    );
  }
  if (view.state === null) {
    return (
      <Notice trainNumber={trainNumber}>
        No position is recorded for {view.train.number} {view.train.name} yet.
      </Notice>
    );
  }
  return <Live view={view} journey={view.journey} state={view.state} />;
}

export function App() {
  const trainNumber = useTrainParam();
  return trainNumber === null ? <Landing /> : <TrainView trainNumber={trainNumber} />;
}
