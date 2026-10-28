import type {
  IsoDate,
  IsoUtc,
  Station,
  TimetableStop,
  TrainState,
} from '@train-tracker/core/types';
import { formatJourneyClock, formatTimetableMinute, formatWindow } from '../../lib/format';
import type { StopEvent } from '../../lib/rows';

type Props = {
  stops: TimetableStop[];
  stations: Map<string, Station>;
  events: StopEvent[];
  state: TrainState | null;
  journeyDate: IsoDate;
};

type TimeCellProps = {
  label: string;
  emptyText: string;
  schedMin: number | null;
  actualAt: IsoUtc | undefined;
  expected: string | null;
  journeyDate: IsoDate;
};

function TimeCell({ label, emptyText, schedMin, actualAt, expected, journeyDate }: TimeCellProps) {
  if (schedMin === null) {
    return (
      <div className="tm">
        <span className="s">{emptyText}</span>
      </div>
    );
  }
  return (
    <div className="tm">
      <span className="s" data-k={label}>
        {formatTimetableMinute(schedMin)}
      </span>
      {actualAt !== undefined && (
        <span className="a">{formatJourneyClock(journeyDate, actualAt)}</span>
      )}
      {actualAt === undefined && expected !== null && (
        <span className="a exp" title="Expected arrival window">
          {expected}
        </span>
      )}
    </div>
  );
}

export function StopList({ stops, stations, events, state, journeyDate }: Props) {
  const actual = new Map(events.map((event) => [`${event.stationCode}:${event.type}`, event.at]));
  return (
    <section className="card" aria-label="Stops">
      <h2>Stops</h2>
      <div className="stops-head">
        <span></span>
        <span>Station</span>
        <span>Arr</span>
        <span>Dep</span>
      </div>
      <ol className="stops">
        {stops.map((stop) => {
          const station = stations.get(stop.stationCode);
          const arrAt = actual.get(`${stop.stationCode}:ARR`);
          const depAt = actual.get(`${stop.stationCode}:DEP`);
          const isNext = state?.nextStation === stop.stationCode;
          const hasEvent = arrAt !== undefined || depAt !== undefined;
          const position = isNext ? 'here' : hasEvent ? 'passed' : 'ahead';
          const expected =
            isNext && state.window !== null ? formatWindow(journeyDate, state.window) : null;
          return (
            <li key={stop.seq} className={`row ${position}`}>
              <div className="c-rail">
                <span className="dot"></span>
              </div>
              <div className="c-stn">
                <div className="l1">
                  <span className="code">{stop.stationCode}</span>
                  <span className="nmx">{station?.name}</span>
                </div>
                {station?.nameHi && (
                  <div className="hi" lang="hi">
                    {station.nameHi}
                  </div>
                )}
              </div>
              <div className="c-arr">
                <TimeCell
                  label="Arr"
                  emptyText="Starts"
                  schedMin={stop.schedArrMin}
                  actualAt={arrAt}
                  expected={expected}
                  journeyDate={journeyDate}
                />
              </div>
              <div className="c-dep">
                <TimeCell
                  label="Dep"
                  emptyText="Ends"
                  schedMin={stop.schedDepMin}
                  actualAt={depAt}
                  expected={null}
                  journeyDate={journeyDate}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
