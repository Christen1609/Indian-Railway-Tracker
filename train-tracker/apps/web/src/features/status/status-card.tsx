import type { IsoDate, Station, TrainState, TrainStateKind } from '@train-tracker/core/types';
import {
  delayTone,
  formatDelay,
  formatJourneyClock,
  formatPace,
  formatWindow,
} from '../../lib/format';

type Props = {
  state: TrainState | null;
  journeyDate: IsoDate;
  stations: Map<string, Station>;
};

const STATE_LINES: Record<TrainStateKind, string> = {
  scheduled: 'Scheduled, not yet running',
  running: 'Running',
  halted: 'Halted at a station',
  late: 'Running late. Updating soon.',
  arrived: 'Arrived',
};

export function StatusCard({ state, journeyDate, stations }: Props) {
  if (state === null) {
    return (
      <section className="card status" aria-label="Current status">
        <h2 className="st-line">No status recorded yet</h2>
      </section>
    );
  }
  const { nextStation, window, nextCheckAt, delayMin } = state;
  return (
    <section className="card status" aria-live="polite" aria-label="Current status">
      <div className="st-top">
        <h2 className="st-line">{STATE_LINES[state.state]}</h2>
        {delayMin !== null && (
          <span className={`pill ${delayTone(delayMin)}`}>{formatDelay(delayMin)}</span>
        )}
      </div>
      <dl className="facts">
        <div>
          <dt>Next station</dt>
          <dd>
            {nextStation === null ? (
              'None'
            ) : (
              <>
                <span className="code">{nextStation}</span> {stations.get(nextStation)?.name}
              </>
            )}
            {window !== null && <small>Window {formatWindow(journeyDate, window)} IST</small>}
          </dd>
        </div>
        <div>
          <dt>Pace</dt>
          <dd>{formatPace(state.pace)}</dd>
        </div>
        <div>
          <dt>Next check</dt>
          <dd>
            {nextCheckAt === null
              ? 'None scheduled'
              : `${formatJourneyClock(journeyDate, nextCheckAt)} IST`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
