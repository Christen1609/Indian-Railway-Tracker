import { describe, expect, it } from 'vitest';
import { scrapeUrl } from './scrape-sites.js';
import type { ScrapeSource, SiteUrl } from './scrape-sites.js';

const TODAY = '2026-11-02';
const YESTERDAY = '2026-11-01';
const SLUGS = {
  travelkhana: 'Mumbai-Central---New-Delhi-Tejas-Rajdhani-Express',
  railmitra: 'mumbai-rajdhani',
};

/** The address a site gives for 12951 on a date */
function urlFor(source: ScrapeSource, journeyDate: string, slugs = SLUGS): SiteUrl {
  return scrapeUrl(source, '12951', journeyDate, slugs, TODAY);
}

describe('scrapeUrl', () => {
  it('builds the Goibibo address, which takes no date', () => {
    expect(urlFor('goibibo_scrape', YESTERDAY)).toEqual({
      url: 'https://www.goibibo.com/trains/live-train-status/12951-running-status/',
    });
  });

  it('puts the run date in the ConfirmTkt address, as DD-Mon-YYYY', () => {
    expect(urlFor('confirmtkt_scrape', YESTERDAY)).toEqual({
      url: 'https://www.confirmtkt.com/train-running-status/12951?Date=01-Nov-2026',
    });
  });

  it('builds the RailYatri address, which takes no date', () => {
    expect(urlFor('railyatri_scrape', YESTERDAY)).toEqual({
      url: 'https://www.railyatri.in/live-train-status/12951',
    });
  });

  it('builds the Travelkhana address from the train slug', () => {
    expect(urlFor('travelkhana_scrape', YESTERDAY)).toEqual({
      url: 'https://www.travelkhana.com/travelkhana/track-train/12951-Mumbai-Central---New-Delhi-Tejas-Rajdhani-Express',
    });
  });

  it("asks Railmitra for yesterday's run with ?day=yesterday, and for today's by its today address", () => {
    expect(urlFor('railmitra_scrape', YESTERDAY)).toEqual({
      url: 'https://www.railmitra.com/live-train-running-status/mumbai-rajdhani-12951?day=yesterday',
    });
    expect(urlFor('railmitra_scrape', TODAY)).toEqual({
      url: 'https://www.railmitra.com/train-running-status/12951',
    });
  });

  it('skips Railmitra for a run it has no proven address for', () => {
    expect(urlFor('railmitra_scrape', '2026-10-30')).toEqual({ skip: 'date_unsupported' });
    expect(urlFor('railmitra_scrape', '2026-11-03')).toEqual({ skip: 'date_unsupported' });
  });

  it('skips Travelkhana and Railmitra for a train with no slug, and no one else', () => {
    expect(scrapeUrl('travelkhana_scrape', '12017', TODAY, undefined, TODAY)).toEqual({
      skip: 'no_slug',
    });
    expect(scrapeUrl('railmitra_scrape', '12017', TODAY, undefined, TODAY)).toEqual({
      skip: 'no_slug',
    });
    expect(scrapeUrl('goibibo_scrape', '12017', TODAY, undefined, TODAY)).toHaveProperty('url');
  });
});
