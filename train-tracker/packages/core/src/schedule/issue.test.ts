import { describe, expect, it } from 'vitest';
import { issueFor } from './issue.js';
import type { IssueInput } from './issue.js';

const READ: IssueInput = {
  outcome: 'failed',
  source: 'goibibo_scrape',
  url: 'https://www.goibibo.com/trains/live-train-status/12951-running-status/',
  status: 200,
  hasError: false,
  rawFetchId: '42',
  parseErrors: ['stations: expected array, received undefined'],
  unknownHalts: 0,
};

describe('issueFor, which reads open an issue', () => {
  it.each(['ok', 'wrong_run', 'unavailable'] as const)('opens nothing for a %s read', (outcome) => {
    expect(issueFor({ ...READ, outcome })).toBeNull();
  });

  it.each([
    ['a request that never completed', { status: 0, hasError: true }],
    ['a server error', { status: 503 }],
  ])('opens nothing for %s, which the circuit already handles', (_name, over) => {
    expect(issueFor({ ...READ, ...over })).toBeNull();
  });
});

describe('issueFor, a failed read', () => {
  const draft = issueFor(READ);

  it('names the source and the kind in the title, so one open issue holds each pair', () => {
    expect(draft?.title).toBe('Parser fix: goibibo_scrape failed read');
    expect(issueFor({ ...READ, rawFetchId: '43' })?.title).toBe(draft?.title);
  });

  it('is labelled for the worker and for an agent to fix', () => {
    expect(draft?.labels).toEqual(['worker', 'parser-fix']);
  });

  it('gives the ids, the error text and the SQL that reads the page', () => {
    expect(draft?.body).toContain('raw_fetches id: 42');
    expect(draft?.body).toContain('stations: expected array, received undefined');
    expect(draft?.body).toContain("select body from raw_fetches where id = '42';");
  });

  it('counts unknown stations as a failed read too', () => {
    const unknown = issueFor({ ...READ, parseErrors: [], unknownHalts: 2 });
    expect(unknown?.body).toContain('Unknown station codes: 2');
  });

  it('keeps long error text short, and no more than five errors', () => {
    const many = issueFor({
      ...READ,
      parseErrors: Array.from({ length: 8 }, (_one, index) => `${index}${'x'.repeat(500)}`),
    });
    expect(many?.body.length).toBeLessThan(1500);
    expect(many?.body).not.toContain('5xxx');
  });

  it('cannot put anything but an id in the SQL', () => {
    const odd = issueFor({ ...READ, rawFetchId: "1'; drop table raw_fetches; --" });
    expect(odd?.body).not.toContain('drop table');
  });
});

describe('issueFor, a block', () => {
  const draft = issueFor({ ...READ, outcome: 'blocked', status: 403 });

  it('opens one issue per source, for the worker only', () => {
    expect(draft?.title).toBe('Source blocked: goibibo_scrape');
    expect(draft?.labels).toEqual(['worker']);
  });

  it('gives the status and the id of the reply', () => {
    expect(draft?.body).toContain('HTTP status: 403');
    expect(draft?.body).toContain('raw_fetches id: 42');
  });
});
