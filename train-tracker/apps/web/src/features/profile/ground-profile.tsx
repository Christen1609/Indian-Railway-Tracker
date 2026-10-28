import { useEffect, useRef, useState } from 'react';
import { groundHeightM } from '../map/elevation';
import { alongKmOf, nextIndex, pointAt } from '../map/geometry';
import type { Track } from '../map/geometry';
import { hexToRgb } from '../map/lighting';

type Props = {
  track: Track;
  km: number;
  loKm: number;
  hiKm: number;
  theme: 'light' | 'dark';
};

type Profile = { alongKm: number; offsetsKm: number[]; heights: (number | null)[] };

const SAMPLE_FROM_KM = -12;
const SAMPLE_TO_KM = 28;
const SAMPLE_STEP_KM = 0.25;
const VIEW_FROM_KM = -10;
const VIEW_TO_KM = 25;
const AXIS_TICKS_KM = [-10, 0, 10, 20];
const HEIGHT_STEPS_M = [25, 50, 100, 200, 500, 1000];
const MIN_LINE_GAP_PX = 22;
const MAX_PIXEL_RATIO = 2;
const MARGIN = { left: 44, right: 10, top: 16, bottom: 18 };

/** Ground heights around a distance along the route */
async function sampleProfile(track: Track, alongKm: number): Promise<Profile> {
  const count = Math.floor((SAMPLE_TO_KM - SAMPLE_FROM_KM) / SAMPLE_STEP_KM) + 1;
  const offsetsKm = Array.from({ length: count }, (_, i) => SAMPLE_FROM_KM + i * SAMPLE_STEP_KM);
  const heights = await Promise.all(
    offsetsKm.map((offsetKm) => {
      const spot = pointAt(track, alongKm + offsetKm); // sample position, from pointAt
      return groundHeightM(spot.lon, spot.lat);
    }),
  );
  return { alongKm, offsetsKm, heights };
}

/** A CSS hex colour with an alpha */
function withAlpha(hex: string, alpha: number): string {
  return `rgba(${hexToRgb(hex).join(',')},${alpha})`;
}

/** Draw the profile on its canvas, in the panel colours */
function drawProfile(
  canvas: HTMLCanvasElement,
  profile: Profile | null,
  track: Track,
  zone: { alongKm: number; loKm: number; hiKm: number },
): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) {
    return;
  }
  const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
  const width = rect.width;
  const height = rect.height;
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const g = canvas.getContext('2d');
  if (g === null) {
    return;
  }
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, width, height);
  g.font = `11px ${color('--f-mono')}`;
  g.fillStyle = color('--muted');
  const points = profile
    ? profile.offsetsKm
        .map(
          (offsetKm, i) =>
            [offsetKm + profile.alongKm - zone.alongKm, profile.heights[i] ?? null] as const,
        )
        .filter(
          (point): point is readonly [number, number] =>
            point[1] !== null && point[0] >= VIEW_FROM_KM - 1 && point[0] <= VIEW_TO_KM + 1,
        )
    : [];
  if (points.length < 2) {
    g.fillText(
      profile
        ? 'Ground heights unavailable. Terrain tiles did not load.'
        : 'Loading ground heights…',
      40,
      height / 2,
    );
    return;
  }
  const { left, right, top, bottom } = MARGIN;
  const x = (offsetKm: number) =>
    left + ((offsetKm - VIEW_FROM_KM) / (VIEW_TO_KM - VIEW_FROM_KM)) * (width - left - right);
  const heights = points.map((point) => point[1]);
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  const plotHeight = height - top - bottom;
  const step =
    HEIGHT_STEPS_M.find((s) => (plotHeight * s) / Math.max(high - low + s, 1) >= MIN_LINE_GAP_PX) ??
    1000;
  const floor = Math.floor((low - step / 2) / step) * step;
  const ceiling = Math.max(floor + 2 * step, Math.ceil((high + step / 2) / step) * step);
  const y = (metres: number) => top + (1 - (metres - floor) / (ceiling - floor)) * plotHeight;
  g.strokeStyle = color('--hair');
  g.lineWidth = 1;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let metres = floor; metres <= ceiling; metres += step) {
    g.beginPath();
    g.moveTo(left, y(metres) + 0.5);
    g.lineTo(width - right, y(metres) + 0.5);
    g.stroke();
    g.fillText(`${metres} m`, left - 6, y(metres));
  }
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  AXIS_TICKS_KM.forEach((tick) =>
    g.fillText(
      tick === 0 ? 'now' : `${tick > 0 ? '+' : '−'}${Math.abs(tick)} km`,
      x(tick),
      height - 3,
    ),
  );
  g.save();
  g.beginPath();
  g.rect(left, 0, width - left - right, height);
  g.clip();
  g.fillStyle = color('--win');
  g.fillRect(
    x(zone.loKm - zone.alongKm),
    top,
    x(zone.hiKm - zone.alongKm) - x(zone.loKm - zone.alongKm),
    plotHeight,
  );
  const ink = color('--fg');
  const fill = g.createLinearGradient(0, top, 0, height - bottom);
  fill.addColorStop(0, withAlpha(ink, 0.22));
  fill.addColorStop(1, withAlpha(ink, 0.02));
  const outline = () => {
    g.beginPath();
    points.forEach(([offsetKm, metres], i) =>
      i ? g.lineTo(x(offsetKm), y(metres)) : g.moveTo(x(offsetKm), y(metres)),
    );
  };
  outline();
  g.lineTo(x(points[points.length - 1]?.[0] ?? 0), height - bottom);
  g.lineTo(x(points[0]?.[0] ?? 0), height - bottom);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  outline();
  g.strokeStyle = ink;
  g.globalAlpha = 0.75;
  g.lineWidth = 1.5;
  g.stroke();
  g.globalAlpha = 1;
  const nextIdx = nextIndex(track, zone.alongKm); // route point just ahead, from nextIndex
  track.points.forEach((point, i) => {
    const offsetKm = point.alongKm - zone.alongKm;
    if (offsetKm < VIEW_FROM_KM || offsetKm > VIEW_TO_KM) {
      return;
    }
    g.setLineDash([2, 3]);
    g.strokeStyle = color('--hair');
    g.beginPath();
    g.moveTo(x(offsetKm) + 0.5, top);
    g.lineTo(x(offsetKm) + 0.5, height - bottom);
    g.stroke();
    g.setLineDash([]);
    const chipWidth = g.measureText(point.code).width + 8;
    if (i === nextIdx) {
      g.fillStyle = color('--sig');
      g.fillRect(x(offsetKm) - chipWidth / 2, 1, chipWidth, 13);
      g.fillStyle = color('--sig-ink');
    } else {
      g.fillStyle = color('--muted');
    }
    g.fillText(point.code, x(offsetKm), 11);
  });
  const nearest = points.reduce((a, b) => (Math.abs(b[0]) < Math.abs(a[0]) ? b : a));
  g.strokeStyle = color('--raj');
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x(0) + 0.5, top);
  g.lineTo(x(0) + 0.5, height - bottom);
  g.stroke();
  g.beginPath();
  g.arc(x(0), y(nearest[1]), 5, 0, Math.PI * 2);
  g.fillStyle = color('--raj');
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = color('--solid');
  g.stroke();
  g.restore();
}

export function GroundProfile({ track, km, loKm, hiKm, theme }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const alongKm = alongKmOf(track, km);
  const zone = { alongKm, loKm: alongKmOf(track, loKm), hiKm: alongKmOf(track, hiKm) };

  useEffect(() => {
    let isCurrent = true;
    sampleProfile(track, alongKm).then((sampled) => {
      if (isCurrent) {
        setProfile(sampled);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [track, alongKm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const redraw = () => drawProfile(canvas, profile, track, zone);
    redraw();
    window.addEventListener('resize', redraw);
    return () => window.removeEventListener('resize', redraw);
  }, [profile, track, alongKm, zone.loKm, zone.hiKm, theme]);

  return (
    <section className="panel prof" aria-label="The land it is crossing">
      <div className="phead">
        <div>
          <div className="eyebrow">The land it is crossing</div>
          <span className="sub muted">Metres above sea level, 10 km behind to 25 km ahead</span>
        </div>
        <div className="legend">
          <span>
            <i className="lg-win"></i>Where the train could be
          </span>
          <span>
            <i className="lg-train"></i>Best estimate
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} id="pcv" role="img" aria-label="Ground height along the track" />
    </section>
  );
}
