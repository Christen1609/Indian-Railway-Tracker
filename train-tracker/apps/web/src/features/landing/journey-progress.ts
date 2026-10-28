import type { TimetableStop, TrainState } from '@train-tracker/core/types';

export type Progress = {
  fraction: number;
  doneKm: number;
  totalKm: number;
  ticks: number[];
  hasDot: boolean;
};

export const RUNNING_STATES: TrainState['state'][] = ['running', 'halted', 'late'];

/** How far along the journey a train is, with a tick at each stop between the ends */
export function journeyProgress(stops: TimetableStop[], state: TrainState | null): Progress {
  const first = stops[0];
  const last = stops.at(-1);
  if (first === undefined || last === undefined || last.km <= first.km) {
    return { fraction: 0, doneKm: 0, totalKm: 0, ticks: [], hasDot: false };
  }
  const totalKm = last.km - first.km;
  const isRunning = state !== null && RUNNING_STATES.includes(state.state);
  const doneKm =
    state?.state === 'arrived'
      ? totalKm
      : isRunning
        ? Math.min(totalKm, Math.max(0, state.km - first.km))
        : 0;
  return {
    fraction: doneKm / totalKm,
    doneKm,
    totalKm,
    ticks: stops.slice(1, -1).map((stop) => (stop.km - first.km) / totalKm),
    hasDot: isRunning,
  };
}
