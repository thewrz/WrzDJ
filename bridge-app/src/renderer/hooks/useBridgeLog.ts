import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';

export interface LogEntry {
  readonly id: number;
  readonly timestamp: number;
  readonly message: string;
}

const MAX_LOG_ENTRIES = 500;

export function useBridgeLog() {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const entriesRef = useRef<readonly LogEntry[]>([]);
  const nextIdRef = useRef(1);

  useEffect(() => {
    const unsubscribe = api.onBridgeLog((message) => {
      const entry: LogEntry = {
        id: nextIdRef.current++,
        timestamp: Date.now(),
        message,
      };

      const updated = [...entriesRef.current, entry];
      const trimmed = updated.length > MAX_LOG_ENTRIES
        ? updated.slice(updated.length - MAX_LOG_ENTRIES)
        : updated;

      entriesRef.current = trimmed;
      setEntries(trimmed);
    });

    return unsubscribe;
  }, []);

  const clear = useCallback(() => {
    entriesRef.current = [];
    setEntries([]);
  }, []);

  return { entries, clear };
}
