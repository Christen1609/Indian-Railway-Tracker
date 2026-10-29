// Features: when the card is awaiting news, which word it shows

import { z } from 'zod';
import type { IsoUtc, TrainState } from '@train-tracker/core/types';
import wordsFile from './searching-words.json';

const WORD_STEP_MS = 3000;
const SearchingWords = z.object({ words: z.array(z.string().min(1)).min(1) });
const WORDS = SearchingWords.parse(wordsFile).words;

/** Whether the train is due to be heard from, so the card should say it is listening */
export function isAwaitingNews(state: TrainState, now: IsoUtc): boolean {
  if (state.state === 'scheduled' || state.state === 'arrived') {
    return false;
  }
  if (state.nextStation === null || state.window === null) {
    return false;
  }
  return Date.parse(now) >= Date.parse(state.window.windowStart);
}

/** The word for this instant, changing every few seconds */
export function pickSearchingWord(now: IsoUtc, words: readonly string[] = WORDS): string {
  const step = Math.floor(Date.parse(now) / WORD_STEP_MS);
  return words[step % words.length] ?? '';
}
