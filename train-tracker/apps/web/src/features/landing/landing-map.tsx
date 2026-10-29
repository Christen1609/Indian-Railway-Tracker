import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { landingStyle } from '../map/map-style';

const INDIA: [number, number] = [80, 22];
const SPIN_DEG_PER_S = 4;
const MS_PER_S = 1000;
const HALF_TURN_DEG = 180;
const FULL_TURN_DEG = 360;
const MOBILE_MAX_WIDTH_PX = 760;
const DESKTOP_COLUMN_PX = 600;
const SCHEME_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** Zoom and padding that put the globe beside the column on wide screens and below the text on phones */
function framing() {
  if (window.innerWidth <= MOBILE_MAX_WIDTH_PX) {
    return {
      zoom: 1.6,
      padding: { top: Math.round(window.innerHeight * 0.5), bottom: 0, left: 0, right: 0 },
    };
  }
  return {
    zoom: 2.6,
    padding: {
      top: Math.round(window.innerHeight * 0.22),
      bottom: 0,
      left: Math.min(DESKTOP_COLUMN_PX, Math.round(window.innerWidth * 0.42)),
      right: 0,
    },
  };
}

export function LandingMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const scheme = window.matchMedia(SCHEME_QUERY);
    const reduced = window.matchMedia(REDUCED_QUERY);
    const { zoom, padding } = framing();
    const map = new MapLibreMap({
      container,
      style: landingStyle(scheme.matches),
      center: INDIA,
      zoom,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    map.setPadding(padding);
    let frameId = 0;
    let startedAt: number | null = null;

    /** Turn the globe west to east from India, one frame at a time */
    const spin = (now: number) => {
      startedAt ??= now;
      const turned = (SPIN_DEG_PER_S * (now - startedAt)) / MS_PER_S;
      const lon =
        ((((INDIA[0] - turned + HALF_TURN_DEG) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG) -
        HALF_TURN_DEG;
      map.jumpTo({ center: [lon, INDIA[1]] });
      frameId = requestAnimationFrame(spin);
    };

    /** Spin unless the visitor prefers reduced motion */
    const applyMotion = () => {
      cancelAnimationFrame(frameId);
      if (reduced.matches) {
        map.jumpTo({ center: INDIA });
      } else {
        startedAt = null;
        frameId = requestAnimationFrame(spin);
      }
    };
    applyMotion();
    reduced.addEventListener('change', applyMotion);
    const recolour = () => {
      map.setStyle(landingStyle(scheme.matches));
    };
    scheme.addEventListener('change', recolour);
    return () => {
      cancelAnimationFrame(frameId);
      reduced.removeEventListener('change', applyMotion);
      scheme.removeEventListener('change', recolour);
      map.remove();
    };
  }, []);

  return <div className="landing-map" ref={containerRef} aria-hidden="true" inert></div>;
}
