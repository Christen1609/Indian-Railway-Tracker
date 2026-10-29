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
const CURSOR_QUERY = '(hover: hover) and (pointer: fine)';
const FOLLOW_LNG_DEG = 25;
const FOLLOW_LAT_DEG = 12;
const FOLLOW_TAU_S = 0.3;
const FLING_TAU_S = 0.7;
const MAX_FLING_DEG_PER_S = 300;
const DRAG_TURN_DEG = 180;
const MAX_LAT_DEG = 80;
const MAX_FRAME_S = 0.1;
const MIN_MOVE_S = 0.001;
const STILL_MS = 80;
const VELOCITY_BLEND = 0.5;
const GLOBE_CIRCUMFERENCE_PX = 512;

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

/** Longitude wrapped into -180 to 180 */
function wrapLng(lng: number): number {
  return (
    ((((lng + HALF_TURN_DEG) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG) - HALF_TURN_DEG
  );
}

/** A value kept between two limits */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
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
    const cursor = window.matchMedia(CURSOR_QUERY);
    const { zoom, padding } = framing();
    const degPerPx = DRAG_TURN_DEG / ((GLOBE_CIRCUMFERENCE_PX * 2 ** zoom) / Math.PI);
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
    let lastFrameAt: number | null = null;
    let spinLng = INDIA[0];
    let followLng = 0;
    let followLat = 0;
    let targetLng = 0;
    let targetLat = 0;
    let dragLng = 0;
    let velocity = 0;
    let isDragging = false;
    let dragPointer = -1;
    let lastX = 0;
    let lastMoveAt = 0;

    /** Put the camera where the spin, cursor and drag offsets say */
    const render = () => {
      map.jumpTo({
        center: [
          wrapLng(spinLng + followLng + dragLng),
          clamp(INDIA[1] + followLat, -MAX_LAT_DEG, MAX_LAT_DEG),
        ],
      });
    };

    /** Advance spin, cursor easing and fling by the time since the last frame */
    const frame = (now: number) => {
      const seconds =
        lastFrameAt === null ? 0 : Math.min((now - lastFrameAt) / MS_PER_S, MAX_FRAME_S);
      lastFrameAt = now;
      const ease = 1 - Math.exp(-seconds / FOLLOW_TAU_S);
      followLng += (targetLng - followLng) * ease;
      followLat += (targetLat - followLat) * ease;
      if (!isDragging) {
        spinLng -= SPIN_DEG_PER_S * seconds;
        dragLng += velocity * seconds;
        velocity *= Math.exp(-seconds / FLING_TAU_S);
      }
      render();
      frameId = requestAnimationFrame(frame);
    };

    /** Reset to India, then spin unless the visitor prefers reduced motion */
    const applyMotion = () => {
      cancelAnimationFrame(frameId);
      spinLng = INDIA[0];
      followLng = 0;
      followLat = 0;
      targetLng = 0;
      targetLat = 0;
      dragLng = 0;
      velocity = 0;
      lastFrameAt = null;
      render();
      if (!reduced.matches) {
        frameId = requestAnimationFrame(frame);
      }
    };

    /** Aim the globe toward the cursor */
    const follow = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !cursor.matches || reduced.matches) {
        return;
      }
      const width = window.innerWidth;
      const height = window.innerHeight;
      const centreX = padding.left + (width - padding.left - padding.right) / 2;
      const centreY = padding.top + (height - padding.top - padding.bottom) / 2;
      targetLng = -clamp((event.clientX - centreX) / (width / 2), -1, 1) * FOLLOW_LNG_DEG;
      targetLat = clamp((event.clientY - centreY) / (height / 2), -1, 1) * FOLLOW_LAT_DEG;
    };

    /** Ease the globe back when the cursor leaves the page */
    const release = () => {
      targetLng = 0;
      targetLat = 0;
    };

    /** Start a drag with a finger or pen */
    const dragStart = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        return;
      }
      isDragging = true;
      dragPointer = event.pointerId;
      lastX = event.clientX;
      lastMoveAt = event.timeStamp;
      velocity = 0;
      container.setPointerCapture(event.pointerId);
    };

    /** Turn the globe with the finger and track its speed */
    const dragMove = (event: PointerEvent) => {
      if (!isDragging || event.pointerId !== dragPointer) {
        return;
      }
      const turned = -(event.clientX - lastX) * degPerPx;
      const seconds = Math.max((event.timeStamp - lastMoveAt) / MS_PER_S, MIN_MOVE_S);
      dragLng += turned;
      velocity += (turned / seconds - velocity) * VELOCITY_BLEND;
      lastX = event.clientX;
      lastMoveAt = event.timeStamp;
      if (reduced.matches) {
        render();
      }
    };

    /** Let go: fling at the release speed unless motion is reduced */
    const dragEnd = (event: PointerEvent) => {
      if (!isDragging || event.pointerId !== dragPointer) {
        return;
      }
      isDragging = false;
      const isStill = event.type === 'pointercancel' || event.timeStamp - lastMoveAt > STILL_MS;
      velocity =
        reduced.matches || isStill ? 0 : clamp(velocity, -MAX_FLING_DEG_PER_S, MAX_FLING_DEG_PER_S);
    };

    applyMotion();
    reduced.addEventListener('change', applyMotion);
    window.addEventListener('pointermove', follow);
    window.addEventListener('blur', release);
    document.documentElement.addEventListener('pointerleave', release);
    container.addEventListener('pointerdown', dragStart);
    container.addEventListener('pointermove', dragMove);
    container.addEventListener('pointerup', dragEnd);
    container.addEventListener('pointercancel', dragEnd);
    const recolour = () => {
      map.setStyle(landingStyle(scheme.matches));
    };
    scheme.addEventListener('change', recolour);
    return () => {
      cancelAnimationFrame(frameId);
      reduced.removeEventListener('change', applyMotion);
      scheme.removeEventListener('change', recolour);
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('blur', release);
      document.documentElement.removeEventListener('pointerleave', release);
      container.removeEventListener('pointerdown', dragStart);
      container.removeEventListener('pointermove', dragMove);
      container.removeEventListener('pointerup', dragEnd);
      container.removeEventListener('pointercancel', dragEnd);
      map.remove();
    };
  }, []);

  return <div className="landing-map" ref={containerRef} aria-hidden="true"></div>;
}
