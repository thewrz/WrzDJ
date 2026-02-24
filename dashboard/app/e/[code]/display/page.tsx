'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError, KioskDisplay, NowPlayingInfo, PlayHistoryItem } from '@/lib/api';
import { useEventStream } from '@/lib/use-event-stream';
import { RequestModal } from './components/RequestModal';
const AUTO_SCROLL_INTERVAL = 5000; // 5 seconds between auto-scrolls
const SESSION_CHECK_INTERVAL = 10_000; // 10 seconds between kiosk session checks
const SESSION_TOKEN_KEY = 'kiosk_session_token';
const PAIR_CODE_KEY = 'kiosk_pair_code';
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
function safeColor(c: string | undefined, fallback: string): string {
  return c && HEX_COLOR_RE.test(c) ? c : fallback;
}

export default function KioskDisplayPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [display, setDisplay] = useState<KioskDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  // StageLinQ data
  const [stagelinqNowPlaying, setStagelinqNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [playHistory, setPlayHistory] = useState<PlayHistoryItem[]>([]);

  // Sticky now-playing: keep showing last track for 10s after it goes null
  const [lastKnownNowPlaying, setLastKnownNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [nowPlayingFading, setNowPlayingFading] = useState(false);
  const staleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Track previous accepted queue IDs for animation
  const prevAcceptedIdsRef = useRef<Set<number>>(new Set());
  const [newItemIds, setNewItemIds] = useState<Set<number>>(new Set());

  // Auto-scroll ref for display-only mode
  const queueListRef = useRef<HTMLDivElement>(null);

  // Request modal state
  const [showRequestModal, setShowRequestModal] = useState(false);

  // Track whether initial load succeeded (ref avoids stale closure in useCallback)
  const hasLoadedRef = useRef(false);

  // Load kiosk display data and StageLinQ data
  const loadDisplay = useCallback(async (): Promise<boolean> => {
    try {
      const [kioskData, nowPlayingData, historyData] = await Promise.all([
        api.getKioskDisplay(code),
        api.getNowPlaying(code).catch((): undefined => undefined),
        api.getPlayHistory(code).catch((): undefined => undefined),
      ]);
      setDisplay(kioskData);
      // Only update stagelinq now-playing when the fetch succeeded;
      // on transient network errors (undefined), preserve the previous value
      if (nowPlayingData !== undefined) {
        setStagelinqNowPlaying(nowPlayingData);
      }
      if (historyData !== undefined) {
        setPlayHistory(historyData.items);
      }
      setError(null);
      hasLoadedRef.current = true;
      return true; // Continue polling
    } catch (err) {
      if (err instanceof ApiError) {
        // Only show error UI on terminal errors or if we have no display data yet;
        // on transient errors with existing data, silently retry to avoid flickering
        if (err.status === 404 || err.status === 410) {
          setError({ message: err.message, status: err.status });
          return false;
        }
      }
      // For transient errors: only set error if this is the initial load (no data yet)
      if (!hasLoadedRef.current) {
        setError({ message: 'Event not found or expired', status: 0 });
      }
      return true; // Continue polling for transient errors
    } finally {
      setLoading(false);
    }
  }, [code]);

  // Poll for updates every 3 seconds
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let stopped = false;

    const poll = async () => {
      const shouldContinue = await loadDisplay();
      if (!shouldContinue) {
        stopped = true;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    poll();

    // Poll every 10s as fallback (SSE handles real-time updates)
    intervalId = setInterval(() => {
      if (!stopped) {
        poll();
      }
    }, 10_000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [loadDisplay]);

  // SSE: trigger immediate refresh on any real-time event
  const loadDisplayRef = useRef(loadDisplay);
  loadDisplayRef.current = loadDisplay;
  useEventStream(code, {
    onRequestCreated: () => { loadDisplayRef.current(); },
    onRequestStatusChanged: () => { loadDisplayRef.current(); },
    onNowPlayingChanged: () => { loadDisplayRef.current(); },
    onRequestsBulkUpdate: () => { loadDisplayRef.current(); },
    onBridgeStatusChanged: () => { loadDisplayRef.current(); },
  });

  // Check kiosk session validity — detect unpair
  useEffect(() => {
    const token = typeof window !== 'undefined'
      ? localStorage.getItem(SESSION_TOKEN_KEY)
      : null;
    if (!token) return;

    const checkSession = async () => {
      try {
        await api.getKioskAssignment(token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          localStorage.removeItem(SESSION_TOKEN_KEY);
          localStorage.removeItem(PAIR_CODE_KEY);
          router.push('/kiosk-pair');
        }
        // Other errors (network, 500, etc.) — silently ignore
      }
    };

    const intervalId = setInterval(checkSession, SESSION_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [router]);

  // Sticky now-playing effect
  useEffect(() => {
    if (stagelinqNowPlaying) {
      // New data arrived — show it immediately, cancel any pending fade
      if (staleTimerRef.current) {
        clearTimeout(staleTimerRef.current);
        staleTimerRef.current = null;
      }
      setLastKnownNowPlaying(stagelinqNowPlaying);
      setNowPlayingFading(false);
    } else if (lastKnownNowPlaying) {
      // Data went null — start 10s grace, then clear
      if (!staleTimerRef.current) {
        setNowPlayingFading(true);
        staleTimerRef.current = setTimeout(() => {
          staleTimerRef.current = null;
          setLastKnownNowPlaying(null);
          setNowPlayingFading(false);
        }, 10_000);
      }
    }
  }, [stagelinqNowPlaying, lastKnownNowPlaying]);

  // Cleanup stale timer on unmount
  useEffect(() => {
    return () => {
      if (staleTimerRef.current) {
        clearTimeout(staleTimerRef.current);
      }
    };
  }, []);

  // Kiosk mode protections
  useEffect(() => {
    const preventDefaults = (e: Event) => {
      e.preventDefault();
      return false;
    };
    document.addEventListener('contextmenu', preventDefaults);
    document.addEventListener('selectstart', preventDefaults);
    document.addEventListener('dragstart', preventDefaults);
    return () => {
      document.removeEventListener('contextmenu', preventDefaults);
      document.removeEventListener('selectstart', preventDefaults);
      document.removeEventListener('dragstart', preventDefaults);
    };
  }, []);

  // Detect newly accepted items for animation
  useEffect(() => {
    if (!display) return;
    const currentIds = new Set(display.accepted_queue.map((item) => item.id));
    const prev = prevAcceptedIdsRef.current;

    // Find IDs that are in current but not in previous
    const fresh = new Set<number>();
    for (const id of currentIds) {
      if (!prev.has(id)) fresh.add(id);
    }

    if (fresh.size > 0) {
      setNewItemIds(fresh);
      // Remove animation class after animation completes
      const timer = setTimeout(() => setNewItemIds(new Set()), 800);
      prevAcceptedIdsRef.current = currentIds;
      return () => clearTimeout(timer);
    }

    prevAcceptedIdsRef.current = currentIds;
  }, [display?.accepted_queue]);

  // Auto-scroll queue list in display-only mode
  useEffect(() => {
    if (!display?.kiosk_display_only) return;

    const interval = setInterval(() => {
      const el = queueListRef.current;
      if (!el) return;

      // If near the bottom, scroll back to top
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        // Scroll by one item height (~73px for a queue-item + gap)
        el.scrollBy({ top: 73, behavior: 'smooth' });
      }
    }, AUTO_SCROLL_INTERVAL);

    return () => clearInterval(interval);
  }, [display?.kiosk_display_only]);

  if (loading) {
    return (
      <div className="kiosk-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error || !display) {
    const is410 = error?.status === 410;
    const is404 = error?.status === 404;

    return (
      <div className="kiosk-container">
        <div className="kiosk-error">
          <h1>{is410 ? 'Event Expired' : is404 ? 'Event Not Found' : 'Error'}</h1>
          <p>
            {is410
              ? 'This event has ended and is no longer accepting requests.'
              : is404
                ? 'This event does not exist.'
                : error?.message || 'This event may have expired.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        * {
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
          cursor: none;
        }
        body {
          overflow: hidden;
        }
        .kiosk-container {
          height: 100vh;
          background: var(--kiosk-bg, linear-gradient(135deg, #1a1a2e 0%, #16213e 100%));
          padding: 2rem;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }
        .kiosk-banner-bg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          z-index: 0;
          overflow: hidden;
        }
        .kiosk-banner-bg img {
          width: 100%;
          height: auto;
          display: block;
        }
        .kiosk-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
          position: relative;
          z-index: 1;
        }
        .kiosk-event-name {
          font-size: 3rem;
          font-weight: bold;
          color: #fff;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
          font-family: var(--font-display, 'Plus Jakarta Sans'), -apple-system, sans-serif;
        }
        .kiosk-qr {
          background: #fff;
          padding: 1rem;
          border-radius: 1rem;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .kiosk-qr-label {
          text-align: center;
          color: #333;
          font-size: 0.85rem;
          font-weight: 600;
          margin-top: 0.5rem;
          max-width: 120px;
        }
        .kiosk-closed-banner {
          background: rgba(239, 68, 68, 0.35);
          border: 2px solid rgba(239, 68, 68, 0.5);
          color: #fca5a5;
          padding: 1rem 2rem;
          border-radius: 1rem;
          font-size: 1.25rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }
        .kiosk-main {
          flex: 1;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 2rem;
          min-height: 0;
          position: relative;
          z-index: 1;
        }
        .kiosk-main-single {
          grid-template-columns: 1fr 1fr;
        }
        .now-playing-section {
          background: rgba(255,255,255,0.1);
          border-radius: 1.5rem;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          transition: opacity 1s ease-out;
        }
        .now-playing-section.fading {
          opacity: 0.5;
        }
        .now-playing-label {
          color: #22c55e;
          font-size: 1.125rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 600;
        }
        .live-badge {
          background: #ef4444;
          color: #fff;
          font-size: 0.65rem;
          padding: 0.2rem 0.5rem;
          border-radius: 0.25rem;
          font-weight: bold;
          animation: pulse-live 2s ease-in-out infinite;
        }
        @keyframes pulse-live {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .now-playing-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .now-playing-art {
          width: 200px;
          height: 200px;
          border-radius: 1rem;
          object-fit: cover;
          margin-bottom: 1.5rem;
          box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        }
        .now-playing-placeholder {
          width: 200px;
          height: 200px;
          border-radius: 1rem;
          background: rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1.5rem;
          font-size: 4rem;
        }
        .now-playing-title {
          font-size: 2rem;
          font-weight: bold;
          color: #fff;
          text-align: center;
          margin: 0 0 0.5rem;
          font-family: var(--font-display, 'Plus Jakarta Sans'), -apple-system, sans-serif;
        }
        .now-playing-artist {
          font-size: 1.375rem;
          color: #d1d5db;
          text-align: center;
          margin: 0;
        }
        .spectrum-bars {
          display: flex;
          gap: 4px;
          height: 60px;
          align-items: flex-end;
          margin-top: 1.5rem;
        }
        .spectrum-bar {
          width: 8px;
          background: linear-gradient(to top, #22c55e, #4ade80);
          border-radius: 4px;
          animation: spectrum 0.5s ease-in-out infinite alternate;
        }
        @keyframes spectrum {
          from { height: 20%; }
          to { height: 100%; }
        }
        .queue-section {
          background: rgba(255,255,255,0.05);
          border-radius: 1.5rem;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          min-height: 0;
          max-height: 100%;
        }
        .queue-label {
          color: #3b82f6;
          font-size: 1.125rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 1rem;
          flex-shrink: 0;
          font-weight: 600;
        }
        .queue-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .queue-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          background: rgba(255,255,255,0.05);
          padding: 0.75rem;
          border-radius: 0.75rem;
        }
        .queue-item-art {
          width: 48px;
          height: 48px;
          border-radius: 0.5rem;
          object-fit: cover;
        }
        .queue-item-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 0.5rem;
          background: rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .queue-item-info {
          flex: 1;
          min-width: 0;
        }
        .queue-item-title {
          color: #fff;
          font-size: 1.0625rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .queue-item-artist {
          color: #d1d5db;
          font-size: 0.9375rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vote-badge {
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          border-radius: 1rem;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .queue-item-new {
          animation: slide-in-glow 0.8s ease-out;
        }
        @keyframes slide-in-glow {
          0% {
            transform: translateX(-30px);
            opacity: 0;
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
          }
          30% {
            opacity: 1;
            box-shadow: 0 0 20px 4px rgba(34, 197, 94, 0.4);
          }
          100% {
            transform: translateX(0);
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
          }
        }
        .queue-empty {
          color: #6b7280;
          text-align: center;
          padding: 2rem;
        }
        .history-section {
          background: rgba(255,255,255,0.05);
          border-radius: 1.5rem;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          min-height: 0;
          max-height: 100%;
        }
        .history-label {
          color: #a855f7;
          font-size: 1.125rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 1rem;
          flex-shrink: 0;
          font-weight: 600;
        }
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .history-empty {
          color: #6b7280;
          text-align: center;
          padding: 2rem;
        }
        .history-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: rgba(255,255,255,0.03);
          padding: 0.5rem;
          border-radius: 0.5rem;
        }
        .history-item-art {
          width: 36px;
          height: 36px;
          border-radius: 0.375rem;
          object-fit: cover;
        }
        .history-item-placeholder {
          width: 36px;
          height: 36px;
          border-radius: 0.375rem;
          background: rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.875rem;
        }
        .history-item-info {
          flex: 1;
          min-width: 0;
        }
        .history-item-title {
          color: #d1d5db;
          font-size: 0.9375rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .history-item-artist {
          color: #9ca3af;
          font-size: 0.8125rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .requested-badge {
          background: #22c55e;
          color: #fff;
          font-size: 0.6rem;
          padding: 0.15rem 0.4rem;
          border-radius: 0.25rem;
          white-space: nowrap;
        }
        .request-button {
          margin-top: 1.5rem;
          align-self: center;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: #fff;
          border: none;
          padding: 1.25rem 2.5rem;
          font-size: 1.25rem;
          font-weight: bold;
          border-radius: 2rem;
          cursor: pointer;
          box-shadow: 0 10px 40px rgba(59, 130, 246, 0.4);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .request-button:hover {
          transform: scale(1.05);
          box-shadow: 0 15px 50px rgba(59, 130, 246, 0.5);
        }
        .request-button:active {
          transform: scale(0.98);
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 2rem;
        }
        .modal-content {
          background: #1f2937;
          border-radius: 1.5rem;
          padding: 2rem;
          width: 100%;
          max-width: 500px;
          max-height: 80vh;
          overflow-y: auto;
          transition: max-height 0.2s ease, margin-top 0.2s ease;
        }
        .modal-content.keyboard-active {
          max-width: 700px;
          max-height: 95vh;
          overflow-y: auto;
          padding: 1.25rem;
          padding-bottom: 280px;
        }
        .modal-overlay.keyboard-overlay-active {
          align-items: flex-start;
          padding-top: 1rem;
          padding-left: 1rem;
          padding-right: 1rem;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        .modal-title {
          font-size: 1.5rem;
          font-weight: bold;
          color: #fff;
          margin: 0;
        }
        .modal-close {
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 2rem;
          cursor: pointer;
          line-height: 1;
        }
        .search-form {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .search-input {
          flex: 1;
          background: #374151;
          border: none;
          border-radius: 0.5rem;
          padding: 1rem;
          color: #fff;
          font-size: 1rem;
        }
        .search-button {
          background: #3b82f6;
          border: none;
          border-radius: 0.5rem;
          padding: 1rem 1.5rem;
          color: #fff;
          font-weight: 500;
          cursor: pointer;
        }
        .search-results {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 300px;
          overflow-y: auto;
          transition: max-height 0.2s ease;
        }
        .search-results-compact {
          max-height: 50vh;
        }
        .search-result-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: #374151;
          padding: 0.75rem;
          border-radius: 0.5rem;
          border: none;
          cursor: pointer;
          text-align: left;
          width: 100%;
          color: #fff;
        }
        .search-result-item:hover {
          background: #4b5563;
        }
        .confirm-section {
          text-align: center;
        }
        .confirm-song {
          margin-bottom: 1.5rem;
        }
        .confirm-title {
          font-size: 1.25rem;
          font-weight: bold;
          color: #fff;
          margin: 0 0 0.25rem;
        }
        .confirm-artist {
          color: #9ca3af;
          margin: 0;
        }
        .note-input {
          width: 100%;
          background: #374151;
          border: none;
          border-radius: 0.5rem;
          padding: 1rem;
          color: #fff;
          font-size: 1rem;
          margin-bottom: 1rem;
        }
        .confirm-buttons {
          display: flex;
          gap: 1rem;
        }
        .confirm-submit {
          flex: 1;
          background: #22c55e;
          border: none;
          border-radius: 0.5rem;
          padding: 1rem;
          color: #fff;
          font-weight: bold;
          font-size: 1.1rem;
          cursor: pointer;
        }
        .confirm-back {
          background: #374151;
          border: none;
          border-radius: 0.5rem;
          padding: 1rem 1.5rem;
          color: #fff;
          cursor: pointer;
        }
        .success-message {
          text-align: center;
          padding: 2rem;
        }
        .success-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
        }
        .success-text {
          font-size: 1.5rem;
          color: #22c55e;
          font-weight: bold;
        }
        .success-vote-count {
          color: #9ca3af;
          margin-top: 0.5rem;
        }
        .search-result-art {
          width: 48px;
          height: 48px;
          border-radius: 4px;
          object-fit: cover;
        }
        .search-result-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 4px;
          background: rgba(255,255,255,0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,0.5);
        }
        .search-result-info {
          flex: 1;
          min-width: 0;
        }
        .search-result-title {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .search-result-artist {
          color: #9ca3af;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>

      <div
        className="kiosk-container"
        style={display.banner_colors ? {
          '--kiosk-bg': display.banner_kiosk_url
            ? safeColor(display.banner_colors[0], '#1a1a2e')
            : `linear-gradient(135deg, ${safeColor(display.banner_colors[0], '#1a1a2e')} 0%, ${safeColor(display.banner_colors[1], '#16213e')} 50%, ${safeColor(display.banner_colors[2], '#0f3460')} 100%)`,
        } as React.CSSProperties : undefined}
      >
        {display.banner_kiosk_url && (
          <div className="kiosk-banner-bg">
            <img
              src={display.banner_kiosk_url}
              alt=""
              onError={(e) => {
                const parent = e.currentTarget.parentElement;
                if (parent) parent.style.display = 'none';
              }}
            />
          </div>
        )}

        <div className="kiosk-header">
          <h1 className="kiosk-event-name">{display.event.name}</h1>
          {!display.requests_open ? (
            <div className="kiosk-closed-banner">
              Requests Closed
            </div>
          ) : (
            <div className="kiosk-qr">
              <QRCodeSVG value={display.qr_join_url} size={120} />
              <p className="kiosk-qr-label">Scan to request from phone</p>
            </div>
          )}
        </div>

        {/* Use StageLinQ now-playing if available, else fall back to request-based now_playing */}
        {(() => {
          // Check if now playing should be hidden (manual hide or auto-hide after 60 min)
          const isHidden = display.now_playing_hidden;

          // Use sticky (lastKnownNowPlaying) instead of raw stagelinqNowPlaying to avoid flickering
          const stickyNowPlaying = lastKnownNowPlaying ?? stagelinqNowPlaying;
          const nowPlaying = isHidden ? null : (stickyNowPlaying || (display.now_playing ? {
            title: display.now_playing.title,
            artist: display.now_playing.artist,
            album_art_url: display.now_playing.artwork_url,
            source: 'request',
          } : null));
          const isLive = stickyNowPlaying?.source != null && stickyNowPlaying.source !== 'manual' && stickyNowPlaying.source !== 'request';

          return (
            <div className={`kiosk-main ${nowPlaying ? '' : 'kiosk-main-single'}`}>
              {nowPlaying && (
                <div className={`now-playing-section ${nowPlayingFading ? 'fading' : ''}`}>
                  <div className="now-playing-label">
                    Now Playing
                    {isLive && <span className="live-badge">LIVE</span>}
                  </div>
                  <div className="now-playing-content">
                    {nowPlaying.album_art_url ? (
                      <img
                        src={nowPlaying.album_art_url}
                        alt={nowPlaying.title}
                        className="now-playing-art"
                      />
                    ) : (
                      <div className="now-playing-placeholder">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20 4v8.5a3.5 3.5 0 1 1-2-3.163V6l-9 1.5v9a3.5 3.5 0 1 1-2-3.163V5l13-1Z" />
                        </svg>
                      </div>
                    )}
                    <h2 className="now-playing-title">{nowPlaying.title}</h2>
                    <p className="now-playing-artist">{nowPlaying.artist}</p>
                    <div className="spectrum-bars">
                      {[...Array(12)].map((_, i) => (
                        <div
                          key={i}
                          className="spectrum-bar"
                          style={{ animationDelay: `${i * 0.1}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="queue-section">
                <div className="queue-label">Accepted Requests</div>
                {display.accepted_queue.length > 0 ? (
                  <div className="queue-list" ref={queueListRef}>
                    {display.accepted_queue.map((item) => (
                      <div key={item.id} className={`queue-item${newItemIds.has(item.id) ? ' queue-item-new' : ''}`}>
                        {item.artwork_url ? (
                          <img src={item.artwork_url} alt={item.title} className="queue-item-art" />
                        ) : (
                          <div className="queue-item-placeholder">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                              <path d="M20 4v8.5a3.5 3.5 0 1 1-2-3.163V6l-9 1.5v9a3.5 3.5 0 1 1-2-3.163V5l13-1Z" />
                            </svg>
                          </div>
                        )}
                        <div className="queue-item-info">
                          <div className="queue-item-title">{item.title}</div>
                          <div className="queue-item-artist">{item.artist}</div>
                        </div>
                        {item.vote_count > 0 && (
                          <span className="vote-badge">
                            {item.vote_count} {item.vote_count === 1 ? 'vote' : 'votes'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="queue-empty">
                    <p>No songs in queue.</p>
                    <p>Request one!</p>
                  </div>
                )}
              </div>

              {/* Play History Section - Always visible for consistent 3-column layout */}
              <div className="history-section">
                <div className="history-label">Recently Played</div>
                {playHistory.length > 0 ? (
                  <div className="history-list">
                    {playHistory.map((item) => (
                      <div key={item.id} className="history-item">
                        {item.album_art_url ? (
                          <img src={item.album_art_url} alt={item.title} className="history-item-art" />
                        ) : (
                          <div className="history-item-placeholder">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                              <path d="M20 4v8.5a3.5 3.5 0 1 1-2-3.163V6l-9 1.5v9a3.5 3.5 0 1 1-2-3.163V5l13-1Z" />
                            </svg>
                          </div>
                        )}
                        <div className="history-item-info">
                          <div className="history-item-title">{item.title}</div>
                          <div className="history-item-artist">{item.artist}</div>
                        </div>
                        {item.matched_request_id && (
                          <span className="requested-badge">Requested</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="history-empty">
                    <p>No songs played yet.</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {!display.kiosk_display_only && display.requests_open && (
          <button className="request-button" onClick={() => setShowRequestModal(true)}>
            ♪ Request a Song
          </button>
        )}
      </div>

      {showRequestModal && (
        <RequestModal
          code={code}
          onClose={() => setShowRequestModal(false)}
          onRequestsClosed={() => loadDisplay()}
        />
      )}
    </>
  );
}
