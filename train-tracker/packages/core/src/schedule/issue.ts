const OK = 200;
const MOST_ERRORS = 5;
const MOST_ERROR_CHARS = 200;
const ID_CHARS = /[^\w-]/g;

const MOST_CODES = 20;

export type ReadIssueInput = {
  outcome: 'ok' | 'wrong_run' | 'unavailable' | 'blocked' | 'failed';
  source: string;
  url: string;
  status: number;
  hasError: boolean;
  rawFetchId: string;
  parseErrors: readonly string[];
  unknownCodes: readonly string[];
};

export type ThinTripInput = {
  outcome: 'thin_trip';
  trainNumber: string;
  journeyDate: string;
  confirmed: number;
  expected: number;
};

export type IssueInput = ReadIssueInput | ThinTripInput;

export type IssueDraft = { title: string; body: string; labels: string[] };

/** How the page can be read back, as SQL */
function readSql(rawFetchId: string): string {
  return `select body from raw_fetches where id = '${rawFetchId.replace(ID_CHARS, '')}';`;
}

/** The station codes a source used that we do not know, as plain codes */
function codesLine(codes: readonly string[]): string {
  const plain = codes.slice(0, MOST_CODES).map((code) => code.replace(ID_CHARS, ''));
  return `Unknown station codes: ${plain.join(', ')}`;
}

/** The issue a read calls for, or null when it calls for none */
export function issueFor(read: IssueInput): IssueDraft | null {
  if (read.outcome === 'thin_trip') {
    return {
      title: `Thin trip: ${read.trainNumber} ${read.journeyDate}`,
      body: `Arrivals confirmed: ${read.confirmed} of ${read.expected}`,
      labels: ['worker'],
    };
  }
  const facts = [
    `Source: ${read.source}`,
    `URL: ${read.url}`,
    `HTTP status: ${read.status}`,
    `raw_fetches id: ${read.rawFetchId.replace(ID_CHARS, '')}`,
  ];
  const readIt = [
    'Read the page with:',
    '```sql',
    readSql(read.rawFetchId),
    '```',
    'The page itself is not in this issue.',
  ];

  if (read.outcome === 'blocked') {
    const body = [
      ...facts,
      '',
      'The source stopped answering us. The worker retries after 1, 3, then 7 days.',
    ];
    return {
      title: `Source blocked: ${read.source}`,
      body: [...body, '', ...readIt].join('\n'),
      labels: ['worker'],
    };
  }

  if (read.outcome !== 'failed' || read.hasError || read.status !== OK) {
    return null;
  }
  const errors = read.parseErrors
    .slice(0, MOST_ERRORS)
    .map((one) => `- ${one.slice(0, MOST_ERROR_CHARS)}`);
  const body = [
    ...facts,
    codesLine(read.unknownCodes),
    '',
    'Parse errors:',
    ...errors,
    '',
    ...readIt,
    'Save the page as a fixture first, then fix the parser and add a test.',
  ];
  return {
    title: `Parser fix: ${read.source} failed read`,
    body: body.join('\n'),
    labels: ['worker', 'parser-fix'],
  };
}
