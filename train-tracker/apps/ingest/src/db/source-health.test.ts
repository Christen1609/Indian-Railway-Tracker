import { describe, expect, it } from 'vitest';
import { NOT_BLOCKED, afterBlock } from '@train-tracker/core/schedule/scrape-gate';
import { blockRow } from './source-health.js';

const NOW = '2026-11-02T10:00:00.000Z';

describe('blockRow', () => {
  it('records when a source was blocked and how many times', () => {
    expect(blockRow('goibibo_scrape', afterBlock(NOT_BLOCKED, NOW), NOW)).toEqual({
      source: 'goibibo_scrape',
      blocked_at: NOW,
      block_count: 1,
      updated_at: NOW,
    });
  });

  it('clears the block with a null time and a zero count, never leaving a column out', () => {
    const row = blockRow('goibibo_scrape', NOT_BLOCKED, NOW);
    expect(row.blocked_at).toBeNull();
    expect(row.block_count).toBe(0);
  });
});
