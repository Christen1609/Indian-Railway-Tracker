// Features: the log line

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** One structured line on stdout, with the fields that apply to it */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line: LogFields = { level, event, at: new Date().toISOString(), ...fields };
  for (const [key, value] of Object.entries(line)) {
    if (value === undefined) {
      delete line[key];
    }
  }
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
