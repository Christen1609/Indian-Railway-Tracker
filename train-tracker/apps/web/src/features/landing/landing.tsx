import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Brand } from '../brand/brand';
import { ROUTES } from '../map/route-12951';
import { SearchField } from '../search/search-field';
import { formatClock } from '../../lib/format';
import { useNow, useTrackedTrains } from '../../lib/live';
import { hasMovedPages } from '../../lib/navigation';

const LandingMap = lazy(() =>
  import('./landing-map').then((module) => ({ default: module.LandingMap })),
);

const TRACKED_NUMBERS = Object.keys(ROUTES);
const SEARCH_ID = 'train-search';

export function Landing() {
  const load = useTrackedTrains(TRACKED_NUMBERS);
  const now = useNow();
  const inputRef = useRef<HTMLInputElement>(null);
  const candidates = useMemo(
    () =>
      load.kind === 'ready'
        ? load.trains.map((train) => ({ number: train.number, name: train.name }))
        : [],
    [load],
  );
  useEffect(() => {
    delete document.documentElement.dataset.theme;
    if (hasMovedPages()) {
      inputRef.current?.focus();
    }
  }, []);

  return (
    <>
      <div className="landing">
        <Suspense fallback={null}>
          <LandingMap />
        </Suspense>
        <main className="landing-col">
          <Brand />
          <section className="sign">
            <h1>
              <span className="sign-hi" lang="hi">
                कौन सी गाड़ी?
              </span>
              <label className="sign-en" htmlFor={SEARCH_ID}>
                Which train?
              </label>
            </h1>
            <SearchField
              candidates={candidates}
              inputId={SEARCH_ID}
              formClass="sign-form"
              inputRef={inputRef}
            />
            <p className="sign-clock">
              <span className="mono">IST {formatClock(now)}</span>
            </p>
            <div className="sign-legs" aria-hidden="true">
              <i></i>
              <i></i>
            </div>
          </section>
          {load.kind === 'error' && <p role="status">{load.message}</p>}
          <p className="landing-attrib">
            Imagery{' '}
            <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">
              NASA GIBS
            </a>
            , Blue Marble
          </p>
        </main>
      </div>
    </>
  );
}
