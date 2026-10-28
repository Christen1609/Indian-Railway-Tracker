import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import { groundHeightM } from './elevation';
import {
  alongKmOf,
  cutBetween,
  headingAt,
  lampFeatures,
  lineCollection,
  pointAt,
  pointCollection,
  renderScale,
  shadowFeatures,
  totalAlongKm,
  trainFeatures,
} from './geometry';
import type { FeatureCollection, Track, TrackPoint } from './geometry';
import { dawnGlowOf, daylightOf, mixHex, smoothStep } from './lighting';
import type { Sun } from './lighting';
import { BOARD_MIN_ZOOM, INITIAL_EXAGGERATION, PAINT, PALETTE, SKY, mapStyle } from './map-style';

export type ViewMode = 'follow' | 'over' | 'free';

type Props = {
  track: Track;
  km: number;
  loKm: number;
  hiKm: number;
  sun: Sun;
  mode: ViewMode;
  isTerrainOn: boolean;
  onModeChange: (mode: ViewMode) => void;
};

type Scene = {
  setKm: (km: number) => void;
  setZone: (loKm: number, hiKm: number) => void;
  setSun: (sun: Sun) => void;
  setMode: (mode: ViewMode) => void;
  setTerrain: (isOn: boolean) => void;
};

const MOBILE_MAX_WIDTH_PX = 760;
const LOOK_AHEAD_KM = 0.2;
const SIDE_DEG = -28;
const TWEEN_MS = 1000;
const DRAW_GAP_MS = 50;
const LINES_GAP_MS = 250;
const FLY_MS = 1800;
const BOARD_RANGE_KM = 45;
const BEACON_MAX_ZOOM = 12;
const MIN_ZONE_KM = 0.05;
const RELIEF_OFFSETS_KM = [-10, -4, 0, 4, 8, 12, 16, 20, 25];
const RELIEF_PROBE_KM = 1.5;
const TERRAIN_STEP_S = 0.25;
const NIGHT_LIGHT_DIRECTION = 315;

/** Whether the screen is phone-sized */
function isNarrow(): boolean {
  return window.innerWidth <= MOBILE_MAX_WIDTH_PX;
}

/** Map padding that keeps the camera centre in the open area between the panels */
function mapPadding() {
  if (isNarrow()) {
    return { top: 250, bottom: Math.round(window.innerHeight * 0.3) + 20, left: 0, right: 0 };
  }
  const isWide = window.innerWidth > 1100;
  return { top: 60, bottom: 90, left: isWide ? 366 : 344, right: isWide ? 360 : 320 };
}

/** A div with a class and optional text */
function element(tag: string, className: string, text?: string): HTMLElement {
  const created = document.createElement(tag);
  created.className = className;
  if (text !== undefined) {
    created.textContent = text;
  }
  return created;
}

/** Station board shown on the map */
function boardElement(point: TrackPoint): HTMLElement {
  const board = element(
    'div',
    `board ${point.isStop ? 'halt' : point.isMajor ? 'major' : 'minor'}`,
  );
  const inner = element('div', 'b');
  const plate = element('div', 'plate');
  if (point.nameHi !== '') {
    const hindi = element('span', 'hi', point.nameHi);
    hindi.lang = 'hi';
    plate.append(hindi);
  }
  const height = element('span', 'msl');
  plate.append(element('span', 'en', point.name), height);
  inner.append(plate, element('div', 'legs'));
  board.append(inner);
  groundHeightM(point.lon, point.lat).then((metres) => {
    if (metres !== null) {
      height.textContent = `MSL ${Math.round(metres)} m`;
    }
  });
  return board;
}

/** Angle difference taken the short way round, from -180 to 180 */
function shortestTurn(degrees: number): number {
  return (((degrees % 360) + 540) % 360) - 180;
}

export function TrainMap({ track, km, loKm, hiKm, sun, mode, isTerrainOn, onModeChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const total = totalAlongKm(track);
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let viewMode = mode;
    let alongKm = alongKmOf(track, km);
    let zone = { lo: alongKmOf(track, loKm), hi: alongKmOf(track, hiKm) };
    let tween: { from: number; to: number; startedAt: number } | null = null;
    let currentSun = sun;
    let daylight = 0;
    let dawn = 0;
    let bearing = headingAt(track, alongKm) + SIDE_DEG;
    let zoom = isNarrow() ? 14.9 : 15.3;
    let pitch = isNarrow() ? 60 : 68;
    let isLoaded = false;
    let isFlying = false;
    let isDestroyed = false;
    let isCameraDirty = true;
    let lastDrawAt = 0;
    let lastLinesAt = 0;
    let lastFrameAt = performance.now();
    let terrainClock = 0;
    let exaggeration = INITIAL_EXAGGERATION;
    let exaggerationTarget = INITIAL_EXAGGERATION;
    let isTerrain = isTerrainOn;
    let isProbing = false;
    let lastProbeKm = -Infinity;
    let frameId = 0;
    const boards = new Map<string, Marker>();

    const start = pointAt(track, alongKm + LOOK_AHEAD_KM);
    const map = new MapLibreMap({
      container,
      style: mapStyle(track),
      center: [start.lon, start.lat],
      zoom,
      pitch,
      bearing,
      maxPitch: 80,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    });

    /** Replace the data of a GeoJSON source */
    const setData = (id: string, data: FeatureCollection) => {
      map.getSource<GeoJSONSource>(id)?.setData(data as Parameters<GeoJSONSource['setData']>[0]);
    };

    /** The terrain setting for the current height and toggle */
    const applyTerrain = () => map.setTerrain(isTerrain ? { source: 'dem', exaggeration } : null);

    /** Train, shadow, lamps, beacon and the route lines at the shown position */
    const draw = (isForced: boolean) => {
      const now = performance.now();
      if (!isForced && now - lastDrawAt < DRAW_GAP_MS) {
        return;
      }
      lastDrawAt = now;
      const spot = pointAt(track, alongKm); // shown position, from pointAt
      const scale = renderScale(spot.lat, map.getZoom()); // drawn size, from renderScale
      setData('beacon', pointCollection([{ at: spot }]));
      setData('train', trainFeatures(track, alongKm, map.getZoom(), scale, daylight));
      setData('tshadow', shadowFeatures(track, alongKm, scale, currentSun));
      setData('lamp', lampFeatures(track, alongKm, scale));
      if (isForced || now - lastLinesAt > LINES_GAP_MS) {
        lastLinesAt = now;
        setData('done', lineCollection(cutBetween(track, 0, alongKm)));
        setData('ahead', lineCollection(cutBetween(track, alongKm, total)));
      }
    };

    /** The shaded window from its low to its high distance */
    const drawZone = () => {
      const lo = Math.max(0, zone.lo);
      const hi = Math.min(total, Math.max(zone.hi, lo + MIN_ZONE_KM));
      setData('win', lineCollection(cutBetween(track, lo, hi)));
      setData('zend', pointCollection([{ at: pointAt(track, lo) }, { at: pointAt(track, hi) }]));
    };

    /** Keep boards for halts and nearby stations */
    const syncBoards = () => {
      const isNear = map.getZoom() >= BOARD_MIN_ZOOM;
      for (const point of track.points) {
        const isWanted =
          isNear && (point.isStop || Math.abs(point.alongKm - alongKm) < BOARD_RANGE_KM);
        const board = boards.get(point.code);
        if (isWanted && board === undefined) {
          boards.set(
            point.code,
            new Marker({ element: boardElement(point), anchor: 'bottom' })
              .setLngLat([point.lon, point.lat])
              .addTo(map),
          );
        } else if (!isWanted && board !== undefined) {
          board.remove();
          boards.delete(point.code);
        }
      }
    };

    /** Probe the ground ahead so the terrain height matches the relief */
    const probeRelief = async () => {
      if (isProbing) {
        return;
      }
      isProbing = true;
      const at = alongKm;
      const heights = await Promise.all(
        RELIEF_OFFSETS_KM.map((offsetKm) => {
          const spot = pointAt(track, at + offsetKm); // probe position, from pointAt
          return groundHeightM(spot.lon, spot.lat);
        }),
      );
      const known = heights.filter((height) => height !== null);
      if (known.length > 1) {
        const spread = Math.max(...known) - Math.min(...known);
        exaggerationTarget = Math.min(1.9, Math.max(1.1, 180 / Math.max(spread, 95)));
      }
      lastProbeKm = at;
      isProbing = false;
    };

    /** Board, relief and lines brought up to date once the train has settled */
    const settle = () => {
      syncBoards();
      if (!isDestroyed && Math.abs(alongKm - lastProbeKm) > RELIEF_PROBE_KM) {
        void probeRelief();
      }
    };

    /** Recolour the map and panels from the sun */
    const light = (next: Sun, isForced: boolean) => {
      const nextDaylight = daylightOf(next); // 0 night to 1 day, from daylightOf
      const nextDawn = dawnGlowOf(next); // dawn glow, from dawnGlowOf
      if (
        !isForced &&
        Math.abs(nextDaylight - daylight) < 0.01 &&
        Math.abs(nextDawn - dawn) < 0.01 &&
        Math.abs(next.az - currentSun.az) < 2
      ) {
        return;
      }
      daylight = nextDaylight;
      dawn = nextDawn;
      currentSun = next;
      for (const [layer, property, key] of PAINT) {
        map.setPaintProperty(
          layer,
          property,
          mixHex(PALETTE.night[key], PALETTE.day[key], daylight),
        );
      }
      const sky = (key: 'sky' | 'hor' | 'fog') =>
        mixHex(mixHex(SKY.night[key], SKY.day[key], daylight), SKY.dawn[key], dawn);
      map.setSky({
        'sky-color': sky('sky'),
        'horizon-color': sky('hor'),
        'fog-color': sky('fog'),
        'sky-horizon-blend': 0.62,
        'horizon-fog-blend': 0.72,
        'fog-ground-blend': 0.42,
        'atmosphere-blend': 0,
      });
      const direction = next.alt > -6 ? next.az : NIGHT_LIGHT_DIRECTION;
      map.setPaintProperty(
        'shade',
        'hillshade-illumination-direction',
        Math.round(direction) % 360,
      );
      map.setPaintProperty('shade', 'hillshade-exaggeration', 0.85 - 0.3 * daylight);
      map.setPaintProperty('pool', 'circle-opacity', 0.55 * (1 - daylight));
      map.setPaintProperty('lamp', 'circle-opacity', 0.95 - 0.45 * daylight);
      map.setPaintProperty('tshadow', 'fill-opacity', 0.3 * daylight);
      map.setLight({
        anchor: 'map',
        position: [1.4, direction, Math.min(80, Math.max(25, 90 - Math.max(next.alt, 10)))],
        color: daylight > 0.5 ? '#ffffff' : '#c5d0ea',
        intensity: 0.25 + 0.3 * daylight,
      });
      draw(true);
    };

    /** Camera behind the train, turned to the route heading */
    const follow = (dt: number) => {
      if (viewMode !== 'follow' || isFlying || !isLoaded) {
        return;
      }
      const turn = shortestTurn(headingAt(track, alongKm) + SIDE_DEG - bearing);
      if (!isCameraDirty && Math.abs(turn) < 0.05) {
        return;
      }
      isCameraDirty = false;
      bearing += turn * Math.min(1, dt * 1.5);
      const ahead = pointAt(track, alongKm + LOOK_AHEAD_KM); // spot ahead of the train, from pointAt
      map.jumpTo({ center: [ahead.lon, ahead.lat], bearing, pitch, zoom });
    };

    /** One animation frame: tween, beacon pulse, camera, terrain height */
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      if (isLoaded && tween !== null) {
        const progress = Math.min(1, (now - tween.startedAt) / TWEEN_MS);
        alongKm = tween.from + (tween.to - tween.from) * smoothStep(0, 1, progress);
        isCameraDirty = true;
        if (progress === 1) {
          tween = null;
          draw(true);
          settle();
        } else {
          draw(false);
        }
      }
      if (isLoaded && !isReduced && map.getZoom() < BEACON_MAX_ZOOM) {
        map.setPaintProperty('halo', 'circle-radius', 12 + 6 * Math.sin(now / 400));
      }
      follow(dt);
      terrainClock += dt;
      if (isLoaded && terrainClock > TERRAIN_STEP_S) {
        terrainClock = 0;
        const gap = exaggerationTarget - exaggeration;
        if (Math.abs(gap) >= 0.02) {
          exaggeration += gap * 0.25;
          if (isTerrain) {
            applyTerrain();
          }
        }
      }
      frameId = requestAnimationFrame(frame);
    };

    /** Hand the camera to the user */
    const release = () => {
      viewMode = 'free';
      onModeChange('free');
    };

    map.on('load', () => {
      isLoaded = true;
      map.setPadding(mapPadding());
      light(currentSun, true);
      drawZone();
      draw(true);
      syncBoards();
      settle();
      frameId = requestAnimationFrame(frame);
    });
    map.on('zoom', (event) => {
      map
        .getContainer()
        .style.setProperty(
          '--bs',
          Math.min(1.05, Math.max(0.42, 0.5 + (map.getZoom() - 10) * 0.1)).toFixed(2),
        );
      if (event.originalEvent && viewMode === 'follow') {
        zoom = map.getZoom();
        isCameraDirty = true;
      }
    });
    map.on('pitch', (event) => {
      if (event.originalEvent && viewMode === 'follow') {
        pitch = map.getPitch();
        isCameraDirty = true;
      }
    });
    map.on('dragstart', (event) => event.originalEvent && release());
    map.on('rotatestart', (event) => event.originalEvent && release());
    map.on('moveend', () => {
      if (isFlying) {
        isFlying = false;
        isCameraDirty = true;
      }
    });
    map.on('zoomend', () => {
      syncBoards();
      if (isLoaded) {
        draw(true);
      }
    });
    const onResize = () => map.setPadding(mapPadding());
    window.addEventListener('resize', onResize);

    sceneRef.current = {
      setKm: (nextKm) => {
        const to = alongKmOf(track, nextKm);
        if (!isLoaded || isReduced) {
          alongKm = to;
          isCameraDirty = true;
          if (isLoaded) {
            draw(true);
            settle();
          }
          return;
        }
        tween = { from: alongKm, to, startedAt: performance.now() };
      },
      setZone: (nextLoKm, nextHiKm) => {
        zone = { lo: alongKmOf(track, nextLoKm), hi: alongKmOf(track, nextHiKm) };
        if (isLoaded) {
          drawZone();
        }
      },
      setSun: (next) => {
        if (isLoaded) {
          light(next, false);
        } else {
          currentSun = next;
        }
      },
      setMode: (next) => {
        const previous = viewMode;
        viewMode = next;
        if (!isLoaded || next === previous) {
          return;
        }
        if (next === 'follow') {
          bearing = headingAt(track, alongKm) + SIDE_DEG;
          const ahead = pointAt(track, alongKm + LOOK_AHEAD_KM); // spot ahead of the train, from pointAt
          isFlying = true;
          map.flyTo({
            center: [ahead.lon, ahead.lat],
            zoom,
            pitch,
            bearing,
            duration: FLY_MS,
            essential: true,
          });
        } else if (next === 'over') {
          const bounds = new LngLatBounds();
          track.points.forEach((point) => bounds.extend([point.lon, point.lat]));
          map.fitBounds(bounds, { padding: 30, pitch: 35, bearing: -8, duration: 1600 });
        }
      },
      setTerrain: (isOn) => {
        isTerrain = isOn;
        if (isLoaded) {
          applyTerrain();
        }
      },
    };

    return () => {
      isDestroyed = true;
      sceneRef.current = null;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      map.remove();
    };
  }, [track]);

  useEffect(() => sceneRef.current?.setKm(km), [km]);
  useEffect(() => sceneRef.current?.setZone(loKm, hiKm), [loKm, hiKm]);
  useEffect(() => sceneRef.current?.setSun(sun), [sun.alt, sun.az]);
  useEffect(() => sceneRef.current?.setMode(mode), [mode]);
  useEffect(() => sceneRef.current?.setTerrain(isTerrainOn), [isTerrainOn]);

  return (
    <div
      ref={containerRef}
      className="map"
      role="region"
      aria-label="3D map of the train's route"
    />
  );
}
