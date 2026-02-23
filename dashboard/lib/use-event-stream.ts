import { useEffect, useRef, useState, useCallback } from 'react';

interface EventStreamHandlers {
  onRequestCreated?: (data: { request_id: number; title: string; artist: string }) => void;
  onRequestStatusChanged?: (data: { request_id: number; status: string }) => void;
  onNowPlayingChanged?: (data: { title: string; artist: string; source: string }) => void;
  onRequestsBulkUpdate?: (data: { action: string; count: number }) => void;
  onBridgeStatusChanged?: (data: { connected: boolean; device_name: string | null }) => void;
}

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export function useEventStream(
  eventCode: string | null,
  handlers: EventStreamHandlers,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const retryCount = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!eventCode) return;
    if (typeof EventSource === 'undefined') return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${apiBase}/api/public/events/${eventCode}/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      retryCount.current = 0;
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);

      // Exponential backoff capped at MAX_RETRY_MS, retries indefinitely
      const delay = Math.min(
        INITIAL_RETRY_MS * Math.pow(2, retryCount.current),
        MAX_RETRY_MS,
      );
      retryCount.current++;
      retryTimerRef.current = setTimeout(connect, delay);
    };

    es.addEventListener('request_created', (e) => {
      handlersRef.current.onRequestCreated?.(JSON.parse(e.data));
    });
    es.addEventListener('request_status_changed', (e) => {
      handlersRef.current.onRequestStatusChanged?.(JSON.parse(e.data));
    });
    es.addEventListener('now_playing_changed', (e) => {
      handlersRef.current.onNowPlayingChanged?.(JSON.parse(e.data));
    });
    es.addEventListener('requests_bulk_update', (e) => {
      handlersRef.current.onRequestsBulkUpdate?.(JSON.parse(e.data));
    });
    es.addEventListener('bridge_status_changed', (e) => {
      handlersRef.current.onBridgeStatusChanged?.(JSON.parse(e.data));
    });
  }, [eventCode]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  return { connected };
}
