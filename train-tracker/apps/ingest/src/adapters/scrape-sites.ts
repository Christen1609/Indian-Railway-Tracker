// Features: the page address of each scrape site for a train and a run date

import { dayMonthYearOf, plusDays } from '@train-tracker/core/time';
import type { IsoDate, SourceId } from '@train-tracker/core/types';

const YESTERDAY = -1;
const TODAY = 0;

export type ScrapeSource = Exclude<SourceId, 'railradar'>;

export type TrainSlugs = { travelkhana: string; railmitra: string };

export type SkipReason = 'no_slug' | 'date_unsupported';

export type SiteUrl = { url: string } | { skip: SkipReason };

/** Where a site shows a train's run on a date, or why it cannot be asked for that run */
export function scrapeUrl(
  source: ScrapeSource,
  trainNumber: string,
  journeyDate: IsoDate,
  slugs: TrainSlugs | undefined,
  today: IsoDate,
): SiteUrl {
  switch (source) {
    case 'goibibo_scrape':
      return {
        url: `https://www.goibibo.com/trains/live-train-status/${trainNumber}-running-status/`,
      };
    case 'confirmtkt_scrape':
      return {
        url: `https://www.confirmtkt.com/train-running-status/${trainNumber}?Date=${dayMonthYearOf(journeyDate)}`,
      };
    case 'railyatri_scrape':
      return { url: `https://www.railyatri.in/live-train-status/${trainNumber}` };
    case 'travelkhana_scrape':
      return slugs === undefined
        ? { skip: 'no_slug' }
        : {
            url: `https://www.travelkhana.com/travelkhana/track-train/${trainNumber}-${slugs.travelkhana}`,
          };
    case 'railmitra_scrape':
      if (slugs === undefined) {
        return { skip: 'no_slug' };
      }
      if (journeyDate === plusDays(today, YESTERDAY)) {
        return {
          url: `https://www.railmitra.com/live-train-running-status/${slugs.railmitra}-${trainNumber}?day=yesterday`,
        };
      }
      return journeyDate === plusDays(today, TODAY)
        ? { url: `https://www.railmitra.com/train-running-status/${trainNumber}` }
        : { skip: 'date_unsupported' };
  }
}
