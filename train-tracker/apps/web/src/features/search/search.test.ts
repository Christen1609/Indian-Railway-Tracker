import { describe, expect, it } from 'vitest';
import { matchTrains, noMatchMessage, trackedSummary } from './search';

const RAJDHANI = { number: '12951', name: 'Mumbai Rajdhani' };
const SHATABDI = { number: '12009', name: 'Shatabdi Express' };

describe('matchTrains', () => {
  it.each([
    ['a full number', '12951', [RAJDHANI], [RAJDHANI]],
    ['part of a number', '129', [RAJDHANI, SHATABDI], [RAJDHANI]],
    ['a name in any case', 'rAjDhAnI', [RAJDHANI, SHATABDI], [RAJDHANI]],
    ['part of a name', 'express', [RAJDHANI, SHATABDI], [SHATABDI]],
    ['a number that is not tracked', '9999', [RAJDHANI], []],
    ['blank text', '   ', [RAJDHANI], []],
    ['text around spaces', ' 12951 ', [RAJDHANI], [RAJDHANI]],
    ['two matches', '12', [RAJDHANI, SHATABDI], [RAJDHANI, SHATABDI]],
  ])('%s', (_name, query, candidates, expected) => {
    expect(matchTrains(query, candidates)).toEqual(expected);
  });
});

describe('trackedSummary', () => {
  it.each([
    ['no trains', [], 'No trains are tracked yet.'],
    ['one train', [RAJDHANI], 'Only 12951 is tracked so far.'],
    ['two trains', [RAJDHANI, SHATABDI], 'Only 12951, 12009 are tracked so far.'],
  ])('%s', (_name, candidates, expected) => {
    expect(trackedSummary(candidates)).toBe(expected);
  });
});

describe('noMatchMessage', () => {
  it('names the query and the tracked trains', () => {
    expect(noMatchMessage(' 9999 ', [RAJDHANI])).toBe(
      'No tracked train matches “9999”. Only 12951 is tracked so far.',
    );
  });

  it('says only that nothing is tracked when the list is empty', () => {
    expect(noMatchMessage('9999', [])).toBe('No trains are tracked yet.');
  });
});
