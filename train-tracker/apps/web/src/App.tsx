import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Journey, TrainState } from '@train-tracker/core/types';
import { Brand } from './features/brand/brand';
import { Landing } from './features/landing/landing';
import { alongKmOf, buildTrack, pointAt } from './features/map/geometry';
import { isDarkPanels, sunAt, sunPhase } from './features/map/lighting';
import { routeFor } from './features/map/route';
import type { ViewMode } from './features/map/train-map';
import { SearchField } from './features/search/search-field';
import { pageMessage, pageStateOf } from './features/status/page-state';
import { StatusCard } from './features/status/status-card';
import { StopSheet } from './features/stops/stop-sheet';
import { TimetableList } from './features/stops/timetable-list';
import { formatClock } from './lib/format';
import { useLiveJourney, useNow } from './lib/live';
import type { JourneyView } from './lib/live';
import { useTrainParam } from './lib/navigation';

const TrainMap = lazy(() =>
  import('./features/map/train-map').then((module) => ({ default: module.TrainMap })),
);

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
            <span className="muted">where the train is</span>
            <span className="mono">{chip.clock} IST</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Notice({
  trainNumber,
  children,
  extra,
}: {
  trainNumber: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <Frame chip={null} trainNumber={trainNumber}>
      <div className="panel notice">
        <p role="status">{children}</p>
        {extra}
      </div>
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
  const track = useMemo(() => {
    const route = routeFor(view.train.number, view.stops, view.stations); // route points and names, from routeFor
    return buildTrack(route.points, view.stops, view.stations, route.detail);
  }, [view.train.number, view.stops, view.stations]);
  const spot = track === null ? null : pointAt(track, alongKmOf(track, state.km));
  const sun = spot === null ? null : sunAt(now, spot.lon, spot.lat);
  const isDark = sun !== null && isDarkPanels(sun);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  if (track === null || sun === null) {
    return (
      <Notice trainNumber={view.train.number}>
        We can’t draw a route for {view.train.name} yet.
      </Notice>
    );
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
            <div className="seg" role="group" aria-label="Camera">
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
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={isTerrainOn}
              onClick={() => setIsTerrainOn(!isTerrainOn)}
            >
              <span className="knob" aria-hidden="true"></span>
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
  const { load, watch } = useLiveJourney(trainNumber);
  if (load.kind === 'loading') {
    return <Notice trainNumber={trainNumber}>Loading train {trainNumber}.</Notice>;
  }
  if (load.kind === 'error') {
    return <Notice trainNumber={trainNumber}>{load.message}</Notice>;
  }
  const { view } = load;
  const page = pageStateOf({
    stopCount: view.stops.length,
    hasJourney: view.journey !== null,
    hasState: view.state !== null,
    watch,
  }); // which page this train gets, from pageStateOf
  if (page === 'live' && view.journey !== null && view.state !== null) {
    return <Live view={view} journey={view.journey} state={view.state} />;
  }
  return (
    <Notice
      trainNumber={trainNumber}
      extra={
        page === 'watching' ? <TimetableList stops={view.stops} stations={view.stations} /> : null
      }
    >
      {pageMessage(page, `${view.train.number} ${view.train.name}`)}
    </Notice>
  );
}

export function App() {
  const trainNumber = useTrainParam();
  return trainNumber === null ? <Landing /> : <TrainView trainNumber={trainNumber} />;
}
