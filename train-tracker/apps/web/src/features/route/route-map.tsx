import { assert } from '@train-tracker/core/types';
import type { Station, TimetableStop, TrainState } from '@train-tracker/core/types';

type Props = {
  stops: TimetableStop[];
  stations: Map<string, Station>;
  state: TrainState | null;
};

type Located = { stop: TimetableStop; station: Station; lat: number; lon: number };
type Position = { x: number; y: number };
type Point = Position & { code: string; name: string; km: number };
type Label = Point & { labelY: number };

const WIDTH = 400;
const HEIGHT = 640;
const MARGIN_X = 40;
const MARGIN_Y = 24;
const PAD_DEG = 0.3;
const GRID_STEP_DEG = 2;
const LABEL_GAP = 19;
const LABEL_OFFSET = 10;
const CHIP_CHAR_WIDTH = 7.6;
const CHIP_PADDING = 10;

/** A coordinate rounded for SVG attributes */
function round(value: number): number {
  return Number(value.toFixed(1));
}

/** Stops whose station has a position */
function locate(stops: TimetableStop[], stations: Map<string, Station>): Located[] {
  return stops.flatMap((stop) => {
    const station = stations.get(stop.stationCode);
    return station !== undefined && station.lat !== null && station.lon !== null
      ? [{ stop, station, lat: station.lat, lon: station.lon }]
      : [];
  });
}

/** Where a distance along the route falls on the map, between its two nearest stops */
function pointAt(points: Point[], km: number): Position {
  const found = points.findIndex((point) => point.km >= km);
  const index = found === -1 ? points.length - 1 : Math.max(found, 1);
  const from = points[index - 1];
  const to = points[index];
  assert(from !== undefined && to !== undefined, 'a route of at least two points');
  const fraction = Math.min(1, Math.max(0, (km - from.km) / (to.km - from.km || 1)));
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

/** SVG path along the route between two distances */
function pathBetween(points: Point[], loKm: number, hiKm: number): string {
  const inside = points.filter((point) => point.km > loKm && point.km < hiKm);
  const corners = [pointAt(points, loKm), ...inside, pointAt(points, hiKm)];
  return `M${corners.map((corner) => `${round(corner.x)} ${round(corner.y)}`).join(' L')}`;
}

/** Labels pushed down until none overlap */
function spreadLabels(points: Point[]): Label[] {
  let previousY = -Infinity;
  return [...points]
    .sort((a, b) => a.y - b.y)
    .map((point) => {
      previousY = Math.max(point.y, previousY + LABEL_GAP);
      return { ...point, labelY: previousY };
    });
}

/** Grid values from the first multiple of the step at or above the range start */
function gridValues(min: number, max: number): number[] {
  const first = Math.ceil(min / GRID_STEP_DEG) * GRID_STEP_DEG;
  return Array.from(
    { length: Math.max(0, Math.floor((max - first) / GRID_STEP_DEG) + 1) },
    (_, i) => first + i * GRID_STEP_DEG,
  );
}

export function RouteMap({ stops, stations, state }: Props) {
  const located = locate(stops, stations); // stops with a station position, from locate
  if (located.length < 2) {
    return (
      <section className="card map" aria-label="Route map">
        <h2>Route</h2>
        <p className="fine">The route cannot be drawn without station positions.</p>
      </section>
    );
  }

  const lats = located.map((item) => item.lat);
  const lons = located.map((item) => item.lon);
  const latMin = Math.min(...lats) - PAD_DEG;
  const latMax = Math.max(...lats) + PAD_DEG;
  const lonMin = Math.min(...lons) - PAD_DEG;
  const lonMax = Math.max(...lons) + PAD_DEG;
  const lonScale = Math.cos((((latMax + latMin) / 2) * Math.PI) / 180);
  const scale = Math.min(
    (WIDTH - 2 * MARGIN_X) / ((lonMax - lonMin) * lonScale),
    (HEIGHT - 2 * MARGIN_Y) / (latMax - latMin),
  );
  const projectX = (lon: number) => MARGIN_X + (lon - lonMin) * lonScale * scale;
  const projectY = (lat: number) => MARGIN_Y + (latMax - lat) * scale;

  const points: Point[] = located.map(({ stop, station, lat, lon }) => ({
    code: station.code,
    name: station.name,
    km: stop.km,
    x: projectX(lon),
    y: projectY(lat),
  }));
  const startKm = points[0]?.km ?? 0;
  const endKm = points.at(-1)?.km ?? 0;
  const fullPath = pathBetween(points, startKm, endKm);
  const train = state === null ? null : pointAt(points, state.km);

  return (
    <section className="card map" aria-label="Route map">
      <h2>Route</h2>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Map of the route with the train's estimated position"
      >
        {gridValues(latMin, latMax).map((lat) => (
          <g key={`lat-${lat}`}>
            <line
              className="g-line"
              x1={0}
              x2={WIDTH}
              y1={round(projectY(lat))}
              y2={round(projectY(lat))}
            />
            <text className="g-lbl" x={WIDTH - 4} y={round(projectY(lat) - 4)} textAnchor="end">
              {lat}°N
            </text>
          </g>
        ))}
        {gridValues(lonMin, lonMax).map((lon) => (
          <g key={`lon-${lon}`}>
            <line
              className="g-line"
              y1={0}
              y2={HEIGHT}
              x1={round(projectX(lon))}
              x2={round(projectX(lon))}
            />
            <text className="g-lbl" x={round(projectX(lon) + 4)} y={HEIGHT - 6}>
              {lon}°E
            </text>
          </g>
        ))}
        <path className="rail-a" d={fullPath} />
        <path className="rail-b" d={fullPath} />
        {state !== null && (
          <path
            className="band"
            d={pathBetween(points, state.loKm, Math.max(state.hiKm, state.loKm + 0.01))}
          />
        )}
        {spreadLabels(points).map((point) => {
          const chipWidth = point.code.length * CHIP_CHAR_WIDTH + CHIP_PADDING;
          const isLeft = point.x > WIDTH / 2;
          const chipX = isLeft ? point.x - LABEL_OFFSET - chipWidth : point.x + LABEL_OFFSET;
          const nameX = isLeft ? chipX - 5 : chipX + chipWidth + 5;
          return (
            <g key={point.code}>
              <rect
                className="stn"
                x={round(point.x - 4.5)}
                y={round(point.y - 4.5)}
                width={9}
                height={9}
              />
              <rect
                className="chip"
                x={round(chipX)}
                y={round(point.labelY - 8.5)}
                width={round(chipWidth)}
                height={17}
                rx={1.5}
              />
              <text
                className="chip-t"
                x={round(chipX + chipWidth / 2)}
                y={round(point.labelY + 4.6)}
                textAnchor="middle"
              >
                {point.code}
              </text>
              <text
                className="stn-n"
                x={round(nameX)}
                y={round(point.labelY + 4)}
                textAnchor={isLeft ? 'end' : 'start'}
              >
                {point.name}
              </text>
            </g>
          );
        })}
        {train !== null && (
          <g transform={`translate(${round(train.x)} ${round(train.y)})`}>
            <circle className="mk" r={8.5} />
            <circle className="mk-dot" r={2.6} />
          </g>
        )}
      </svg>
      <div className="legend">
        <span>
          <i className="sw est"></i>Estimated position
        </span>
        <span>
          <i className="sw bd"></i>Possible range
        </span>
      </div>
      <p className="fine">Station positions are approximate. Lines between stops are straight.</p>
    </section>
  );
}
