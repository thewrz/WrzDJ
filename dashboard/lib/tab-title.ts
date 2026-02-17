/**
 * Tab title badge utility.
 * Shows unread NEW request count in the browser tab: "(3) Event Name - WrzDJ"
 * Helps DJs see new requests even when the tab is backgrounded behind DJ software.
 */

import { useEffect } from 'react';

const MAX_NAME_LENGTH = 30;
const DEFAULT_TITLE = 'WrzDJ Dashboard';

export function formatTabTitle(eventName: string, newCount: number): string {
  const count = Math.max(0, newCount);
  const name =
    eventName.length > MAX_NAME_LENGTH
      ? eventName.slice(0, MAX_NAME_LENGTH) + '...'
      : eventName;

  return count > 0 ? `(${count}) ${name} - WrzDJ` : `${name} - WrzDJ`;
}

export function useTabTitle(eventName: string | null, newRequestCount: number): void {
  useEffect(() => {
    if (eventName === null) return;

    document.title = formatTabTitle(eventName, newRequestCount);

    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [eventName, newRequestCount]);
}
