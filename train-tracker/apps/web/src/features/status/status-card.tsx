import { useEffect, useRef } from 'react';
import type {
  IsoDate,
  IsoUtc,
  Station,
  TimetableStop,
  Train,
  TrainState,
  TrainStateKind,
} from '@train-tracker/core/types';
import { alongKmOf, nextIndex } from '../map/geometry';
import type { Track } from '../map/geometry';
import { TRAIN_NAMES_HI } from '../map/route-12951';
import {
  delayTone,
  formatAgo,
  formatClock,
  formatDelay,
  formatPace,
  formatTimetableMinute,
  formatWindow,
} from '../../lib/format';
import { hasMovedPages } from '../../lib/navigation';

type Props = {
  train: Train;
  stops: TimetableStop[];
  stations: Map<string, Station>;
  state: TrainState;
  track: Track;
  journeyDate: IsoDate;
  now: IsoUtc;
};

const STATE_LABELS: Record<TrainStateKind, string> = {
  scheduled: 'Not yet running',
  running: 'Running',
  halted: 'Halted',
  late: 'Running',
  arrived: 'Arrived',
};

export function StatusCard({ train, stops, stations, state, track, journeyDate, now }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameHi = TRAIN_NAMES_HI[train.number];
  const nameOf = (code: string) => stations.get(code)?.name ?? code;
  const nextIdx = nextIndex(track, alongKmOf(track, state.km)); // route point just ahead, from nextIndex
  const before = track.points[nextIdx - 1];
  const after = track.points[nextIdx];
  const destination = stops.at(-1);
  useEffect(() => {
    if (hasMovedPages()) {
      headingRef.current?.focus();
    }
  }, []);
  const isDue =
    destination !== undefined &&
    state.state !== 'arrived' &&
    state.nextStation !== destination.stationCode;
  const tone = state.delayMin === null ? 'ok' : delayTone(state.delayMin);
  const pillText =
    state.delayMin !== null && state.delayMin > 0
      ? `${STATE_LABELS[state.state]}, ${formatDelay(state.delayMin)}`
      : STATE_LABELS[state.state];
  return (
    <section className="panel card" aria-label="Train status">
      <div className="cardtop">
        <span className="tno">{train.number}</span>
        <h1 ref={headingRef} tabIndex={-1}>
          {train.name} {nameHi !== undefined && <span lang="hi">{nameHi}</span>}
        </h1>
      </div>
      <div className="status" aria-live="polite">
        <span className={`pill ${tone}`}>{pillText}</span>
        <span className="muted">
          Updated {formatClock(state.updatedAt)} IST, {formatAgo(state.updatedAt, now)}
        </span>
      </div>
      {state.nextStation !== null && (
        <div className="nextbox">
          <div className="nrow">
            <span className="nlab">Next station</span>
            <span className="nname">{nameOf(state.nextStation)}</span>
            <span className="code-chip">{state.nextStation}</span>
          </div>
          {state.window !== null && (
            <div className="nwin mono">{formatWindow(journeyDate, state.window)}</div>
          )}
        </div>
      )}
      <div className="wherebox">
        <div className="kmpost" aria-hidden="true">
          <b>{Math.round(state.km)}</b>
          <span>km</span>
        </div>
        <div className="wheretext">
          {before !== undefined && after !== undefined && (
            <p className="wherelead">
              Between {before.name} and {after.name}
            </p>
          )}
          <p className="wheremeta">
            somewhere along{' '}
            <span className="nb mono">
              km {Math.round(state.loKm)}–{Math.round(state.hiKm)}
            </span>
            , {formatPace(state.pace).toLowerCase()}
          </p>
        </div>
      </div>
      {isDue && destination.schedArrMin !== null && (
        <p className="duerow">
          <span>Due</span> <b>{nameOf(destination.stationCode)}</b>
          <span className="mono">{formatTimetableMinute(destination.schedArrMin)}</span>
          <span>scheduled</span>
          {state.delayMin !== null && <span>, {formatDelay(state.delayMin)}</span>}
        </p>
      )}
    </section>
  );
}
