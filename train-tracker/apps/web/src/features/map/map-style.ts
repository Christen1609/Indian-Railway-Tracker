// Features: night and day palettes, recolouring list, 3D map style, landing map style

import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl';
import { TERRAIN_TILES_URL } from './elevation';
import { pointCollection } from './geometry';
import type { FeatureCollection, Track } from './geometry';

type PaletteKey = keyof typeof PALETTE.night;
type Stop = number | ExpressionSpecification;

const OPEN_FREE_MAP_URL = 'https://tiles.openfreemap.org';
const EARTH_TILES_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
export const INITIAL_EXAGGERATION = 1.8;
export const BOARD_MIN_ZOOM = 9.5;

export const PALETTE = {
  night: {
    bg: '#0a0e16',
    wood: '#0f1918',
    farm: '#0d1218',
    res: '#151b26',
    bld: '#141a25',
    water: '#0b1a2b',
    river: '#1a4570',
    road: '#262d3b',
    rail: '#5d6575',
    bound: '#3c3756',
    label: '#9aa5b8',
    halo: '#06080d',
    shade: '#000000',
    lightc: '#6f85b3',
    route: '#d3d8e2',
    done: '#5c6474',
    dot: '#d3d8e2',
    glow: '#f2c230',
  },
  day: {
    bg: '#e8e6da',
    wood: '#c3d3b2',
    farm: '#dedfc6',
    res: '#d9d3c5',
    bld: '#d7d2c4',
    water: '#9ec5df',
    river: '#7fb0d4',
    road: '#fbfaf6',
    rail: '#5f636c',
    bound: '#a596b9',
    label: '#39404d',
    halo: '#ffffff',
    shade: '#3a3127',
    lightc: '#fff8e6',
    route: '#1e222a',
    done: '#8b909a',
    dot: '#1e222a',
    glow: '#c99400',
  },
};
export const SKY = {
  night: { sky: '#04060b', hor: '#162037', fog: '#0a0e16' },
  dawn: { sky: '#2a375f', hor: '#f0a46c', fog: '#bf9585' },
  day: { sky: '#86b6e6', hor: '#d9e8f4', fog: '#e7e9e1' },
};
export const PAINT: [layer: string, property: string, key: PaletteKey][] = [
  ['bg', 'background-color', 'bg'],
  ['farm', 'fill-color', 'farm'],
  ['wood', 'fill-color', 'wood'],
  ['res', 'fill-color', 'res'],
  ['bld', 'fill-extrusion-color', 'bld'],
  ['water', 'fill-color', 'water'],
  ['river', 'line-color', 'river'],
  ['road', 'line-color', 'road'],
  ['rail', 'line-color', 'rail'],
  ['railt', 'line-color', 'rail'],
  ['bound', 'line-color', 'bound'],
  ['place', 'text-color', 'label'],
  ['place', 'text-halo-color', 'halo'],
  ['shade', 'hillshade-shadow-color', 'shade'],
  ['shade', 'hillshade-accent-color', 'shade'],
  ['shade', 'hillshade-highlight-color', 'lightc'],
  ['ahead', 'line-color', 'route'],
  ['done', 'line-color', 'done'],
  ['stn', 'circle-stroke-color', 'dot'],
  ['stn', 'circle-color', 'bg'],
  ['wglow', 'line-color', 'glow'],
  ['tshadow', 'fill-color', 'shade'],
  ['aheadc', 'line-color', 'halo'],
  ['zend', 'circle-color', 'glow'],
  ['zend', 'circle-stroke-color', 'halo'],
  ['haltdot', 'circle-color', 'bg'],
  ['haltdot', 'circle-stroke-color', 'dot'],
  ['haltlbl', 'text-color', 'route'],
  ['haltlbl', 'text-halo-color', 'halo'],
];

/** A GeoJSON source holding data */
function geojson(data: FeatureCollection = EMPTY) {
  return { type: 'geojson' as const, data };
}

/** Filter for features whose class is one of these */
function classIn(classes: string[]): ExpressionSpecification {
  return ['in', ['get', 'class'], ['literal', classes]];
}

/** Value that eases from one zoom stop to another */
function byZoom(z0: number, v0: Stop, z1: number, v1: Stop): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], z0, v0, z1, v1];
}

/** The map style in night colours, with the track's stations and halts */
export function mapStyle(track: Track): StyleSpecification {
  const P = PALETTE.night;
  const lampKind = (kind: number): ExpressionSpecification => ['==', ['get', 'kind'], kind];
  const stations = pointCollection(
    track.points.map((point) => ({ at: point, properties: { code: point.code } })),
  );
  const halts = pointCollection(
    track.points
      .filter((point) => point.isStop)
      .map((point) => ({ at: point, properties: { name: point.name } })),
  );
  return {
    version: 8,
    glyphs: `${OPEN_FREE_MAP_URL}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      omt: { type: 'vector', url: `${OPEN_FREE_MAP_URL}/planet` },
      dem: {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES_URL],
        tileSize: 512,
        maxzoom: 12,
        encoding: 'terrarium',
        attribution: '© Mapterhorn',
      },
      hs: {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES_URL],
        tileSize: 512,
        maxzoom: 12,
        encoding: 'terrarium',
      },
      done: geojson(),
      ahead: geojson(),
      win: { ...geojson(), lineMetrics: true },
      train: { ...geojson(), maxzoom: 18 },
      tshadow: geojson(),
      lamp: geojson(),
      beacon: geojson(),
      zend: geojson(),
      stn: geojson(stations),
      halts: geojson(halts),
    },
    terrain: { source: 'dem', exaggeration: INITIAL_EXAGGERATION },
    sky: {
      'sky-color': SKY.night.sky,
      'horizon-color': SKY.night.hor,
      'fog-color': SKY.night.fog,
      'atmosphere-blend': 0,
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': P.bg } },
      {
        id: 'farm',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: classIn(['farmland', 'grass']),
        paint: { 'fill-color': P.farm, 'fill-opacity': 0.6 },
      },
      {
        id: 'wood',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landcover',
        filter: classIn(['wood', 'forest']),
        paint: { 'fill-color': P.wood, 'fill-opacity': 0.75 },
      },
      {
        id: 'res',
        type: 'fill',
        source: 'omt',
        'source-layer': 'landuse',
        filter: classIn(['residential', 'suburb', 'neighbourhood', 'industrial']),
        paint: { 'fill-color': P.res, 'fill-opacity': 0.6 },
      },
      {
        id: 'shade',
        type: 'hillshade',
        source: 'hs',
        paint: {
          'hillshade-exaggeration': 0.85,
          'hillshade-shadow-color': P.shade,
          'hillshade-highlight-color': P.lightc,
          'hillshade-accent-color': P.shade,
          'hillshade-illumination-anchor': 'map',
          'hillshade-illumination-direction': 315,
        },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'omt',
        'source-layer': 'water',
        paint: { 'fill-color': P.water },
      },
      {
        id: 'river',
        type: 'line',
        source: 'omt',
        'source-layer': 'waterway',
        paint: { 'line-color': P.river, 'line-width': byZoom(8, 0.5, 14, 2.2) },
      },
      {
        id: 'bound',
        type: 'line',
        source: 'omt',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': P.bound, 'line-width': 1, 'line-dasharray': [3, 2] },
      },
      {
        id: 'road',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: classIn(['motorway', 'trunk', 'primary', 'secondary']),
        paint: { 'line-color': P.road, 'line-width': byZoom(6, 0.4, 15, 3), 'line-opacity': 0.7 },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
        paint: { 'line-color': P.rail, 'line-width': byZoom(8, 0.6, 15, 2) },
      },
      {
        id: 'railt',
        type: 'line',
        source: 'omt',
        'source-layer': 'transportation',
        filter: ['all', ['==', ['get', 'class'], 'rail'], ['==', ['get', 'brunnel'], 'tunnel']],
        paint: {
          'line-color': P.rail,
          'line-width': byZoom(8, 0.6, 15, 2),
          'line-dasharray': [2, 2],
          'line-opacity': 0.7,
        },
      },
      {
        id: 'bld',
        type: 'fill-extrusion',
        source: 'omt',
        'source-layer': 'building',
        minzoom: 13.5,
        paint: {
          'fill-extrusion-color': P.bld,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.88,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'done',
        type: 'line',
        source: 'done',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.done, 'line-width': byZoom(5, 1.7, 15, 3), 'line-opacity': 0.8 },
      },
      {
        id: 'aheadc',
        type: 'line',
        source: 'ahead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.halo,
          'line-width': byZoom(5, 3.4, 15, 9),
          'line-opacity': 0.45,
          'line-blur': 1.5,
        },
      },
      {
        id: 'ahead',
        type: 'line',
        source: 'ahead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': P.route, 'line-width': byZoom(5, 1.8, 15, 5), 'line-opacity': 0.95 },
      },
      {
        id: 'stn',
        type: 'circle',
        source: 'stn',
        minzoom: 7,
        paint: {
          'circle-radius': byZoom(7, 1.5, 15, 5),
          'circle-color': P.bg,
          'circle-stroke-color': P.dot,
          'circle-stroke-width': 1.5,
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'wglow',
        type: 'line',
        source: 'win',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': P.glow,
          'line-width': byZoom(6, 10, 15, 30),
          'line-blur': byZoom(6, 8, 15, 20),
          'line-opacity': 0.3,
        },
      },
      {
        id: 'win',
        type: 'line',
        source: 'win',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-width': byZoom(6, 3.5, 15, 10),
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            'rgba(242,194,48,0.5)',
            0.12,
            'rgba(242,194,48,0.85)',
            0.88,
            'rgba(242,194,48,0.85)',
            1,
            'rgba(242,194,48,0.5)',
          ],
        },
      },
      {
        id: 'zend',
        type: 'circle',
        source: 'zend',
        minzoom: 9,
        paint: {
          'circle-radius': byZoom(9, 2.6, 15, 5.5),
          'circle-color': P.glow,
          'circle-stroke-color': P.halo,
          'circle-stroke-width': 1.3,
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'tshadow',
        type: 'fill',
        source: 'tshadow',
        minzoom: 11,
        paint: { 'fill-color': P.shade, 'fill-opacity': 0 },
      },
      {
        id: 'pool',
        type: 'circle',
        source: 'lamp',
        filter: lampKind(0),
        minzoom: 11,
        paint: {
          'circle-radius': byZoom(11, ['+', 1, ['get', 'radius']], 16, [
            '+',
            2,
            ['*', ['get', 'radius'], 3.4],
          ]),
          'circle-color': '#ffeab0',
          'circle-blur': 1,
          'circle-opacity': 0.5,
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
        },
      },
      {
        id: 'train',
        type: 'fill-extrusion',
        source: 'train',
        minzoom: 10.5,
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'lamp',
        type: 'circle',
        source: 'lamp',
        filter: lampKind(1),
        minzoom: 12,
        paint: {
          'circle-radius': byZoom(12, 2.5, 16, 6),
          'circle-color': '#fffdf0',
          'circle-blur': 0.35,
          'circle-opacity': 0.9,
        },
      },
      {
        id: 'tail',
        type: 'circle',
        source: 'lamp',
        filter: lampKind(2),
        minzoom: 12,
        paint: {
          'circle-radius': byZoom(12, 2, 16, 5),
          'circle-color': '#ff3b45',
          'circle-blur': 0.3,
          'circle-opacity': 0.85,
        },
      },
      {
        id: 'halo',
        type: 'circle',
        source: 'beacon',
        maxzoom: 12,
        paint: {
          'circle-radius': 14,
          'circle-color': '#e5505a',
          'circle-opacity': 0.25,
          'circle-blur': 0.4,
        },
      },
      {
        id: 'beacon',
        type: 'circle',
        source: 'beacon',
        maxzoom: 12,
        paint: {
          'circle-radius': 6.5,
          'circle-color': '#c8313a',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      {
        id: 'haltdot',
        type: 'circle',
        source: 'halts',
        maxzoom: BOARD_MIN_ZOOM,
        paint: {
          'circle-radius': 4.5,
          'circle-color': P.bg,
          'circle-stroke-color': P.dot,
          'circle-stroke-width': 2.5,
        },
      },
      {
        id: 'haltlbl',
        type: 'symbol',
        source: 'halts',
        maxzoom: BOARD_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 12,
          'text-anchor': 'left',
          'text-offset': [0.9, 0],
          'text-letter-spacing': 0.03,
        },
        paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
      },
      {
        id: 'place',
        type: 'symbol',
        source: 'omt',
        'source-layer': 'place',
        filter: classIn(['city', 'town']),
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': byZoom(5, 10, 12, 14),
          'text-letter-spacing': 0.04,
        },
        paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
      },
    ],
  };
}

/** A globe of satellite imagery with a soft atmosphere and one marker per live train */
export function landingStyle(
  isDark: boolean,
  marker: { fill: string; ring: string },
  dots: FeatureCollection,
): StyleSpecification {
  const space = isDark ? PALETTE.night.bg : PALETTE.day.bg;
  const halo = isDark ? '#1b2a44' : '#bcd6ec';
  return {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      earth: {
        type: 'raster',
        tiles: [EARTH_TILES_URL],
        tileSize: 256,
        maxzoom: 8,
      },
      dots: geojson(dots),
    },
    sky: {
      'sky-color': space,
      'horizon-color': halo,
      'fog-color': space,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.8,
      'fog-ground-blend': 0.9,
      'atmosphere-blend': 1,
    },
    layers: [
      {
        id: 'earth',
        type: 'raster',
        source: 'earth',
        paint: {
          'raster-opacity': isDark ? 0.8 : 0.92,
          'raster-brightness-max': isDark ? 0.65 : 1,
          'raster-saturation': -0.2,
        },
      },
      {
        id: 'dot',
        type: 'circle',
        source: 'dots',
        paint: {
          'circle-radius': 5,
          'circle-color': marker.fill,
          'circle-stroke-color': marker.ring,
          'circle-stroke-width': 1.5,
        },
      },
    ],
  };
}
