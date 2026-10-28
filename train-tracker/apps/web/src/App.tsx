import type { IsoDate, IsoUtc } from '@train-tracker/core/types';
import { RouteMap } from './features/route/route-map';
import { StatusCard } from './features/status/status-card';
import { StopList } from './features/stops/stop-list';
import { formatAgo, formatJourneyDate, formatKm, formatStamp } from './lib/format';
import { useLiveJourney, useNow } from './lib/live';
import type { JourneyView, Load } from './lib/live';

const DEFAULT_TRAIN_NUMBER = '12951';
const TRAIN_NUMBER =
  new URLSearchParams(window.location.search).get('train') || DEFAULT_TRAIN_NUMBER;

function UpdatedLine({ updatedAt }: { updatedAt: IsoUtc | null }) {
  const now = useNow();
  if (updatedAt === null) {
    return <>No update recorded yet.</>;
  }
  return (
    <>
      Updated {formatStamp(updatedAt)} IST, {formatAgo(updatedAt, now)}.
    </>
  );
}

function Header({ view, journeyDate }: { view: JourneyView; journeyDate: IsoDate }) {
  const { train, stops, stations, state } = view;
  const distanceKm = stops.at(-1)?.km;
  return (
    <header className="hdr">
      <p className="eyebrow">Indian Railway Tracker</p>
      <div className="title">
        <div className="no">{train.number}</div>
        <div className="nm">
          <h1>{train.name}</h1>
        </div>
      </div>
      <div className="route">
        <b>{train.origin}</b> {stations.get(train.origin)?.name} → <b>{train.destination}</b>{' '}
        {stations.get(train.destination)?.name}
        {distanceKm === undefined ? '' : ` · ${formatKm(distanceKm)}`}
      </div>
      <p className="note">
        <strong>Latest journey, {formatJourneyDate(journeyDate)}.</strong>{' '}
        <UpdatedLine updatedAt={state?.updatedAt ?? null} />
      </p>
    </header>
  );
}

function Page({ load }: { load: Load }) {
  if (load.kind === 'loading') {
    return <p className="notice">Loading train {TRAIN_NUMBER}.</p>;
  }
  if (load.kind === 'error') {
    return (
      <p className="notice" role="alert">
        {load.message}
      </p>
    );
  }
  const { view } = load;
  if (view.journey === null) {
    return (
      <p className="notice">
        No journey is recorded for {view.train.number} {view.train.name} yet.
      </p>
    );
  }
  const { journeyDate } = view.journey;
  return (
    <>
      <Header view={view} journeyDate={journeyDate} />
      <div className="main">
        <RouteMap stops={view.stops} stations={view.stations} state={view.state} />
        <div className="side">
          <StatusCard state={view.state} journeyDate={journeyDate} stations={view.stations} />
          <StopList
            stops={view.stops}
            stations={view.stations}
            events={view.events}
            state={view.state}
            journeyDate={journeyDate}
          />
        </div>
      </div>
      <p className="foot">
        Unofficial. Not affiliated with Indian Railways.{' '}
        <a
          href="https://github.com/Christen1609/Indian-Railway-Tracker"
          target="_blank"
          rel="noopener"
        >
          Source on GitHub
        </a>
        .
      </p>
    </>
  );
}

export function App() {
  const load = useLiveJourney(TRAIN_NUMBER);
  return (
    <div className="wrap">
      <Page load={load} />
    </div>
  );
}
