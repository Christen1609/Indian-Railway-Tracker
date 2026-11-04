// Features: which page a train gets, and the words for the waiting pages

import type { WatchStatus } from '../../lib/rows';

export type PageState =
  'live' | 'no-position' | 'watching' | 'getting-timetable' | 'timetable-failed';

/** What we know about the timetable request: its status, or null before the first answer */
export type Watch = WatchStatus | 'unavailable' | null;

/** Which page a train gets from what is loaded */
export function pageStateOf(input: {
  stopCount: number;
  hasJourney: boolean;
  hasState: boolean;
  watch: Watch;
}): PageState {
  if (input.stopCount === 0) {
    return input.watch === 'failed' || input.watch === 'unavailable'
      ? 'timetable-failed'
      : 'getting-timetable';
  }
  if (!input.hasJourney) {
    return 'watching';
  }
  return input.hasState ? 'live' : 'no-position';
}

/** The sentence for a page that is not the live view */
export function pageMessage(state: PageState, trainName: string): string {
  switch (state) {
    case 'getting-timetable':
      return `Getting the timetable for ${trainName}. This usually takes a couple of minutes.`;
    case 'timetable-failed':
      return 'We couldn’t get this train’s timetable right now. Try again later.';
    case 'watching':
      return `Watching for ${trainName}’s next run. Its timetable is below, and the map appears once it sets off.`;
    case 'no-position':
      return `No position is recorded for ${trainName} yet.`;
    case 'live':
      return '';
  }
}
