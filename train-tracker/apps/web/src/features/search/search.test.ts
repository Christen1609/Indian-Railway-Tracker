import { describe, expect, it } from 'vitest';
import {
  cleanQuery,
  nextActiveIndex,
  noMatchMessage,
  planSearch,
  rankTrains,
  toCandidates,
} from './search';

const RAJDHANI = { number: '12951', name: 'Mumbai Rajdhani' };
const SHATABDI = { number: '12009', name: 'Shatabdi Express' };
const MUMBAI_MAIL = { number: '12321', name: 'Howrah Mumbai Mail' };

describe('nextActiveIndex', () => {
  it.each([
    ['down from nothing to the only match', -1, 1, 1, 0],
    ['down from nothing to the first of three', -1, 1, 3, 0],
    ['down to the middle', 0, 1, 3, 1],
    ['down off the end to nothing', 2, 1, 3, -1],
    ['up from nothing to the last of three', -1, -1, 3, 2],
    ['up to the middle', 2, -1, 3, 1],
    ['up off the top to nothing', 0, -1, 3, -1],
    ['nowhere to go with no matches', -1, 1, 0, -1],
  ] as const)('%s', (_name, activeIndex, step, count, expected) => {
    expect(nextActiveIndex(activeIndex, step, count)).toBe(expected);
  });
});

describe('cleanQuery', () => {
  it.each([
    ['tidies spaces', '  mumbai   rajdhani ', 'mumbai rajdhani'],
    ['removes pattern characters', '12%_95*1', '12 95 1'],
    ['removes list syntax', 'a,b(c)', 'a b c'],
    ['blank stays blank', '  ', ''],
  ])('%s', (_name, query, expected) => {
    expect(cleanQuery(query)).toBe(expected);
  });
});

describe('planSearch', () => {
  it.each([
    ['digits match a number prefix', '129', { column: 'number', pattern: '129%' }],
    ['digits around spaces', ' 12951 ', { column: 'number', pattern: '12951%' }],
    ['words match anywhere in a name', 'rajdhani', { column: 'name', pattern: '%rajdhani%' }],
    ['digits with words match a name', '12 express', { column: 'name', pattern: '%12 express%' }],
    ['blank text has no plan', '   ', null],
    ['only pattern characters has no plan', '%%', null],
  ])('%s', (_name, query, expected) => {
    expect(planSearch(query)).toEqual(expected);
  });
});

describe('rankTrains', () => {
  it('puts the exact number first', () => {
    const longer = { number: '129510', name: 'Other' };
    expect(rankTrains('12951', [longer, RAJDHANI])).toEqual([RAJDHANI, longer]);
  });

  it('puts names that start with the text before names that contain it', () => {
    expect(rankTrains('mumbai', [MUMBAI_MAIL, RAJDHANI])).toEqual([RAJDHANI, MUMBAI_MAIL]);
  });

  it('keeps the given order among equals', () => {
    expect(rankTrains('12', [SHATABDI, RAJDHANI])).toEqual([SHATABDI, RAJDHANI]);
  });
});

describe('toCandidates', () => {
  it('keeps number and name', () => {
    const train = {
      ...RAJDHANI,
      origin: 'BCT',
      destination: 'NDLS',
      runsOn: null,
      topSpeedKmh: null,
    };
    expect(toCandidates([train])).toEqual([RAJDHANI]);
  });
});

describe('noMatchMessage', () => {
  it('names the query', () => {
    expect(noMatchMessage(' 9999 ')).toBe('No train matches “9999”.');
  });
});
