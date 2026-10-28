// Features: address-bar train, in-page navigation, link

import { useSyncExternalStore } from 'react';
import type { MouseEvent, ReactNode } from 'react';

let hasNavigated = false;

/** Tell listeners the address changed */
function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

window.addEventListener('popstate', () => {
  hasNavigated = true;
});

/** The address bar's query text */
function readSearch(): string {
  return window.location.search;
}

/** Query text that opens a train */
export function trainSearch(trainNumber: string): string {
  return `?train=${encodeURIComponent(trainNumber)}`;
}

/** Whether the visitor has moved between pages since loading */
export function hasMovedPages(): boolean {
  return hasNavigated;
}

/** The train number in the address bar, or null on the landing page */
export function useTrainParam(): string | null {
  const search = useSyncExternalStore(subscribe, readSearch);
  const trainNumber = new URLSearchParams(search).get('train')?.trim();
  return trainNumber === undefined || trainNumber === '' ? null : trainNumber;
}

/** Go to a query on this page without reloading */
export function navigate(search: string): void {
  window.history.pushState(null, '', `${window.location.pathname}${search}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** A link that navigates in the page and keeps normal link behaviour for new tabs */
export function NavLink({
  search,
  className,
  labelledBy,
  describedBy,
  children,
}: {
  search: string;
  className?: string;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
}) {
  /** Navigate in the page on a plain click */
  function open(event: MouseEvent<HTMLAnchorElement>) {
    const isPlain =
      event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (isPlain) {
      event.preventDefault();
      navigate(search);
    }
  }
  return (
    <a
      className={className}
      href={`${window.location.pathname}${search}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={open}
    >
      {children}
    </a>
  );
}
