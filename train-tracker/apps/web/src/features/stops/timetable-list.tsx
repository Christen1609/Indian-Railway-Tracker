import type { Station, TimetableStop } from '@train-tracker/core/types';
import { displayName, formatTimetableMinute } from '../../lib/format';

type Props = { stops: TimetableStop[]; stations: Map<string, Station> };

/** A train's scheduled stops, for a train with no journey yet */
export function TimetableList({ stops, stations }: Props) {
  return (
    <ol className="timetable-list" aria-label="Timetable">
      {stops.map((stop) => {
        const minute = stop.schedDepMin ?? stop.schedArrMin;
        return (
          <li key={stop.seq}>
            <span>{displayName(stations.get(stop.stationCode)?.name ?? stop.stationCode)}</span>
            <span className="mono">{minute === null ? '' : formatTimetableMinute(minute)}</span>
          </li>
        );
      })}
    </ol>
  );
}
