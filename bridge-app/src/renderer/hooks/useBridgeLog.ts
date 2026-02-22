import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import type { LogLevel } from '../../shared/types.js';

export interface LogEntry {
  readonly id: number;
  readonly timestamp: number;
  readonly message: string;
  readonly level: LogLevel;
}

const MAX_LOG_ENTRIES = 500;

export function useBridgeLog() {
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const entriesRef = useRef<readonly LogEntry[]>([]);
  const nextIdRef = useRef(1);

  useEffect(() => {
    const unsubscribe = api.onBridgeLog((logMessage) => {
      const entry: LogEntry = {
        id: nextIdRef.current++,
        timestamp: Date.now(),
        message: logMessage.message,
        level: logMessage.level,
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
