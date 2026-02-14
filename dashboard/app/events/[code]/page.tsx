'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/lib/auth';
import { api, ApiError, Event, ArchivedEvent, SongRequest, PlayHistoryItem, TidalStatus, TidalSearchResult, BeatportStatus } from '@/lib/api';
import type { BeatportSearchResult, NowPlayingInfo } from '@/lib/api-types';
import { DeleteEventModal } from './components/DeleteEventModal';
import { NowPlayingBadge } from './components/NowPlayingBadge';
import { TidalLoginModal } from './components/TidalLoginModal';
import { BeatportLoginModal } from './components/BeatportLoginModal';
import { ServiceTrackPickerModal } from './components/ServiceTrackPickerModal';
import { RequestQueueSection } from './components/RequestQueueSection';
import { PlayHistorySection } from './components/PlayHistorySection';
import { SongManagementTab } from './components/SongManagementTab';
import { EventManagementTab } from './components/EventManagementTab';
import type { RecommendedTrack } from '@/lib/api-types';

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EventQueuePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const code = params.code as string;

  const [event, setEvent] = useState<Event | ArchivedEvent | null>(null);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [playHistory, setPlayHistory] = useState<PlayHistoryItem[]>([]);
  const [playHistoryTotal, setPlayHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);

  const [eventStatus, setEventStatus] = useState<'active' | 'expired' | 'archived'>('active');
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  const [editingExpiry, setEditingExpiry] = useState(false);
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [updatingExpiry, setUpdatingExpiry] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Now playing visibility toggle
  const [nowPlayingHidden, setNowPlayingHidden] = useState(false);
  const [togglingNowPlaying, setTogglingNowPlaying] = useState(false);
  const [autoHideMinutes, setAutoHideMinutes] = useState(10);
  const [autoHideInput, setAutoHideInput] = useState('10');
  const [savingAutoHide, setSavingAutoHide] = useState(false);

  // Requests open/closed toggle
  const [requestsOpen, setRequestsOpen] = useState(true);
  const [togglingRequests, setTogglingRequests] = useState(false);

  // Bridge / now-playing state
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);

  // Tidal sync state
  const [tidalStatus, setTidalStatus] = useState<TidalStatus | null>(null);
  const [tidalSyncEnabled, setTidalSyncEnabled] = useState(false);
  const [togglingTidalSync, setTogglingTidalSync] = useState(false);
  const [syncingRequest, setSyncingRequest] = useState<number | null>(null);
  const [showTidalPicker, setShowTidalPicker] = useState<number | null>(null);
  const [tidalSearchQuery, setTidalSearchQuery] = useState('');
  const [tidalSearchResults, setTidalSearchResults] = useState<TidalSearchResult[]>([]);
  const [searchingTidal, setSearchingTidal] = useState(false);
  const [linkingTrack, setLinkingTrack] = useState(false);

  // Beatport sync state
  const [beatportStatus, setBeatportStatus] = useState<BeatportStatus | null>(null);
  const [beatportSyncEnabled, setBeatportSyncEnabled] = useState(false);
  const [togglingBeatportSync, setTogglingBeatportSync] = useState(false);
  const [showBeatportPicker, setShowBeatportPicker] = useState<number | null>(null);
  const [beatportSearchQuery, setBeatportSearchQuery] = useState('');
  const [beatportSearchResults, setBeatportSearchResults] = useState<BeatportSearchResult[]>([]);
  const [searchingBeatport, setSearchingBeatport] = useState(false);
  const [linkingBeatportTrack, setLinkingBeatportTrack] = useState(false);

  // Sync report panel state
  const [syncReportExpanded, setSyncReportExpanded] = useState(false);
  const [focusedSyncRequestId, setFocusedSyncRequestId] = useState<number | null>(null);

  // Inline action error (auto-dismissing)
  const [actionError, setActionError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'songs' | 'manage'>('songs');

  // Banner upload state
  const [uploadingBanner, setUploadingBanner] = useState(false);

  // Tidal device login state
  const [showTidalLogin, setShowTidalLogin] = useState(false);
  const [tidalLoginUrl, setTidalLoginUrl] = useState('');
  const [tidalLoginCode, setTidalLoginCode] = useState('');
  const [tidalLoginPolling, setTidalLoginPolling] = useState(false);

  // Beatport login modal state
  const [showBeatportLogin, setShowBeatportLogin] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Auto-dismiss action errors after 5 seconds
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async (): Promise<boolean> => {
    try {
      const [eventData, requestsData, historyData, displaySettings, tidalStatusData, beatportStatusData, nowPlayingData] = await Promise.all([
        api.getEvent(code),
        api.getRequests(code),
        api.getPlayHistory(code).catch((): undefined => undefined),
        api.getDisplaySettings(code).catch(() => ({ now_playing_hidden: false, now_playing_auto_hide_minutes: 10, requests_open: true })),
        api.getTidalStatus().catch(() => ({ linked: false, user_id: null, expires_at: null, integration_enabled: true })),
        api.getBeatportStatus().catch(() => ({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true })),
        api.getNowPlaying(code).catch((): undefined => undefined),
      ]);
      setEvent(eventData);
      setRequests(requestsData);
      if (historyData !== undefined) {
        setPlayHistory(historyData.items);
        setPlayHistoryTotal(historyData.total);
      }
      setNowPlayingHidden(displaySettings.now_playing_hidden);
      setRequestsOpen(displaySettings.requests_open ?? true);
      const serverAutoHide = displaySettings.now_playing_auto_hide_minutes ?? 10;
      setAutoHideMinutes(serverAutoHide);
      if (!savingAutoHide) {
        setAutoHideInput(String(serverAutoHide));
      }
      setTidalStatus(tidalStatusData);
      setTidalSyncEnabled(eventData.tidal_sync_enabled ?? false);
      setBeatportStatus(beatportStatusData);
      setBeatportSyncEnabled(eventData.beatport_sync_enabled ?? false);
      if (nowPlayingData !== undefined) {
        setBridgeConnected(nowPlayingData?.bridge_connected ?? false);
        setNowPlaying(nowPlayingData ?? null);
      }
      setEventStatus('active');
      setError(null);
      hasLoadedRef.current = true;
      return true; // Continue polling
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        // Event is expired/archived - try to get from archived list
        try {
          const [archivedEvents, requestsData] = await Promise.all([
            api.getArchivedEvents(),
            api.getRequests(code), // Still works for owners
          ]);
          const archivedEvent = archivedEvents.find((e) => e.code === code);
          if (archivedEvent) {
            setEvent(archivedEvent);
            setRequests(requestsData);
            setEventStatus(archivedEvent.status);
            setError(null);
            return false; // Stop polling - event is expired
          }
        } catch {
          // Fall through to error handling
        }
        setError({ message: err.message, status: err.status });
        return false;
      }

      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError({ message: err.message, status: err.status });
          return false; // Stop polling on 404
        }
      }
      // For transient errors: only set error if this is the initial load (no data yet)
      if (!hasLoadedRef.current) {
        setError({ message: 'Failed to load event', status: 0 });
      }
      return true; // Continue polling for transient errors
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (isAuthenticated) {
      let intervalId: NodeJS.Timeout | null = null;
      let stopped = false;

      const poll = async () => {
        const shouldContinue = await loadData();
        if (!shouldContinue) {
          stopped = true;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      };

      poll();

      // Poll every 3 seconds unless stopped
      intervalId = setInterval(() => {
        if (!stopped) {
          poll();
        }
      }, 3000);

      return () => {
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    }
  }, [isAuthenticated, loadData]);

  const updateStatus = async (requestId: number, status: string) => {
    setUpdating(requestId);
    try {
      const updated = await api.updateRequestStatus(requestId, status);
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? updated : r))
      );
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setUpdating(null);
    }
  };

  const handleAcceptAll = async () => {
    setAcceptingAll(true);
    try {
      await api.acceptAllRequests(code);
      const updatedRequests = await api.getRequests(code);
      setRequests(updatedRequests);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to accept all requests');
    } finally {
      setAcceptingAll(false);
    }
  };

  const handleEditExpiry = () => {
    if (event) {
      setNewExpiryDate(toLocalDateTimeString(new Date(event.expires_at)));
      setEditingExpiry(true);
    }
  };

  const handleSaveExpiry = async () => {
    if (!newExpiryDate) return;

    setUpdatingExpiry(true);
    try {
      const expiresAt = new Date(newExpiryDate).toISOString();
      const updated = await api.updateEvent(code, { expires_at: expiresAt });
      setEvent(updated);
      setEditingExpiry(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update expiry');
    } finally {
      setUpdatingExpiry(false);
    }
  };

  const handleDeleteEvent = async () => {
    setDeleting(true);
    try {
      await api.deleteEvent(code);
      router.push('/events');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete event');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await api.exportEventCsv(code);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to export');
    } finally {
      setExporting(false);
    }
  };

  const handleExportPlayHistoryCsv = async () => {
    setExportingHistory(true);
    try {
      await api.exportPlayHistoryCsv(code);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to export play history');
    } finally {
      setExportingHistory(false);
    }
  };

  const handleToggleNowPlaying = async () => {
    setTogglingNowPlaying(true);
    try {
      const newHidden = !nowPlayingHidden;
      await api.setNowPlayingVisibility(code, newHidden);
      setNowPlayingHidden(newHidden);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to toggle now playing');
    } finally {
      setTogglingNowPlaying(false);
    }
  };

  const handleSaveAutoHide = async () => {
    const value = parseInt(autoHideInput, 10);
    if (isNaN(value) || value < 1 || value > 1440) return;
    setSavingAutoHide(true);
    try {
      const result = await api.setAutoHideMinutes(code, value);
      setAutoHideMinutes(result.now_playing_auto_hide_minutes);
      setAutoHideInput(String(result.now_playing_auto_hide_minutes));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update auto-hide timeout');
    } finally {
      setSavingAutoHide(false);
    }
  };

  const handleToggleRequests = async () => {
    setTogglingRequests(true);
    try {
      const newOpen = !requestsOpen;
      await api.setRequestsOpen(code, newOpen);
      setRequestsOpen(newOpen);
    } catch {
      // Silently fail — next poll will restore the server state
    } finally {
      setTogglingRequests(false);
    }
  };

  const handleToggleTidalSync = async () => {
    if (!event) return;
    setTogglingTidalSync(true);
    try {
      const newEnabled = !tidalSyncEnabled;
      await api.updateTidalEventSettings(event.id, { tidal_sync_enabled: newEnabled });
      setTidalSyncEnabled(newEnabled);
    } catch (err) {
      console.error('Failed to toggle Tidal sync:', err);
    } finally {
      setTogglingTidalSync(false);
    }
  };

  const handleConnectTidal = async () => {
    try {
      const { verification_url, user_code } = await api.startTidalAuth();
      setTidalLoginUrl(verification_url);
      setTidalLoginCode(user_code);
      setShowTidalLogin(true);
      setTidalLoginPolling(true);

      // Start polling for completion
      const pollInterval = setInterval(async () => {
        try {
          const result = await api.checkTidalAuth();
          if (result.complete) {
            clearInterval(pollInterval);
            setTidalLoginPolling(false);
            setShowTidalLogin(false);
            setTidalStatus({ linked: true, user_id: result.user_id || null, expires_at: null, integration_enabled: true });
          } else if (result.error) {
            clearInterval(pollInterval);
            setTidalLoginPolling(false);
            setActionError(`Tidal login failed: ${result.error}`);
          }
        } catch (err) {
          console.error('Failed to check Tidal auth:', err);
        }
      }, 2000);

      // Stop polling after 10 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setTidalLoginPolling(false);
      }, 10 * 60 * 1000);
    } catch (err) {
      console.error('Failed to start Tidal auth:', err);
    }
  };

  const handleCancelTidalLogin = async () => {
    try {
      await api.cancelTidalAuth();
    } catch (err) {
      console.error('Failed to cancel Tidal auth:', err);
    }
    setShowTidalLogin(false);
    setTidalLoginPolling(false);
  };

  const handleDisconnectTidal = async () => {
    try {
      await api.disconnectTidal();
      setTidalStatus({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
      setTidalSyncEnabled(false);
    } catch (err) {
      console.error('Failed to disconnect Tidal:', err);
    }
  };

  const handleSyncToTidal = async (requestId: number) => {
    setSyncingRequest(requestId);
    try {
      const result = await api.syncRequestToTidal(requestId);
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? { ...r, tidal_track_id: result.tidal_track_id, tidal_sync_status: result.status }
            : r
        )
      );
    } catch (err) {
      console.error('Failed to sync to Tidal:', err);
    } finally {
      setSyncingRequest(null);
    }
  };

  const handleOpenTidalPicker = (requestId: number) => {
    const request = requests.find((r) => r.id === requestId);
    if (request) {
      setTidalSearchQuery(`${request.artist} ${request.song_title}`);
      setShowTidalPicker(requestId);
      setTidalSearchResults([]);
    }
  };

  const handleSearchTidal = async () => {
    if (!tidalSearchQuery.trim()) return;
    setSearchingTidal(true);
    try {
      const results = await api.searchTidal(tidalSearchQuery);
      setTidalSearchResults(results);
    } catch (err) {
      console.error('Failed to search Tidal:', err);
    } finally {
      setSearchingTidal(false);
    }
  };

  const handleLinkTidalTrack = async (requestId: number, tidalTrackId: string) => {
    setLinkingTrack(true);
    try {
      const result = await api.linkTidalTrack(requestId, tidalTrackId);
      setRequests((prev) =>
        prev.map((r) =>
          r.id === requestId
            ? { ...r, tidal_track_id: result.tidal_track_id, tidal_sync_status: result.status }
            : r
        )
      );
      setShowTidalPicker(null);
    } catch (err) {
      console.error('Failed to link Tidal track:', err);
    } finally {
      setLinkingTrack(false);
    }
  };

  const handleOpenBeatportPicker = (requestId: number) => {
    const request = requests.find((r) => r.id === requestId);
    if (request) {
      setBeatportSearchQuery(`${request.artist} ${request.song_title}`);
      setShowBeatportPicker(requestId);
      setBeatportSearchResults([]);
    }
  };

  const handleSearchBeatport = async () => {
    if (!beatportSearchQuery.trim()) return;
    setSearchingBeatport(true);
    try {
      const results = await api.searchBeatport(beatportSearchQuery);
      setBeatportSearchResults(results);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to search Beatport');
    } finally {
      setSearchingBeatport(false);
    }
  };

  const handleLinkBeatportTrack = async (requestId: number, beatportTrackId: string) => {
    setLinkingBeatportTrack(true);
    try {
      await api.linkBeatportTrack(requestId, beatportTrackId);
      // Reload requests to get updated sync_results_json
      const updatedRequests = await api.getRequests(code);
      setRequests(updatedRequests);
      setShowBeatportPicker(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to link Beatport track');
    } finally {
      setLinkingBeatportTrack(false);
    }
  };

  // Beatport handlers
  const handleToggleBeatportSync = async () => {
    if (!event) return;
    setTogglingBeatportSync(true);
    try {
      const newEnabled = !beatportSyncEnabled;
      await api.updateBeatportEventSettings(event.id, { beatport_sync_enabled: newEnabled });
      setBeatportSyncEnabled(newEnabled);
    } catch {
      setActionError('Failed to toggle Beatport sync');
    } finally {
      setTogglingBeatportSync(false);
    }
  };

  const handleConnectBeatport = () => {
    setShowBeatportLogin(true);
  };

  const handleBeatportLogin = async (username: string, password: string) => {
    await api.loginBeatport(username, password);
    // Refetch status to get subscription info
    const status = await api.getBeatportStatus().catch(() => ({ linked: true, expires_at: null, configured: true, subscription: null, integration_enabled: true }));
    setBeatportStatus(status);
    setShowBeatportLogin(false);
  };

  const handleDisconnectBeatport = async () => {
    try {
      await api.disconnectBeatport();
      setBeatportStatus({ linked: false, expires_at: null, configured: true, subscription: null, integration_enabled: true });
      setBeatportSyncEnabled(false);
    } catch {
      setActionError('Failed to disconnect Beatport');
    }
  };

  const handleScrollToSyncReport = (requestId: number) => {
    setFocusedSyncRequestId(requestId);
    setSyncReportExpanded(true);
    // Scroll to sync report panel after a tick so it renders expanded
    setTimeout(() => {
      const panel = document.getElementById('sync-report-panel');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  const handleBannerSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setActionError('File size must be under 5MB');
      e.target.value = '';
      return;
    }

    setUploadingBanner(true);
    try {
      const updated = await api.uploadEventBanner(code, file);
      setEvent(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to upload banner');
    } finally {
      setUploadingBanner(false);
      e.target.value = '';
    }
  };

  const handleDeleteBanner = async () => {
    try {
      const updated = await api.deleteEventBanner(code);
      setEvent(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete banner');
    }
  };

  const handleAcceptRecommendedTrack = async (track: RecommendedTrack) => {
    await api.submitRequest(
      code,
      track.artist,
      track.title,
      undefined,
      track.url || undefined,
      track.cover_url || undefined,
    );
    // Refresh request list
    const updatedRequests = await api.getRequests(code);
    setRequests(updatedRequests);
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading event...</div>
      </div>
    );
  }

  if (error || !event) {
    const is410 = error?.status === 410;
    const is404 = error?.status === 404;

    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '1rem' }}>
            {is410 ? 'Event Expired' : is404 ? 'Event Not Found' : 'Error'}
          </h2>
          <p style={{ color: '#9ca3af', marginBottom: '1rem' }}>
            {is410
              ? 'This event has expired and is no longer accepting requests.'
              : is404
                ? 'This event does not exist.'
                : error?.message || 'Event not found or expired.'}
          </p>
          <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  // Build list of connected + enabled services for sync badges
  const connectedServices: string[] = [];
  if (tidalStatus?.linked && tidalSyncEnabled) connectedServices.push('tidal');
  if (beatportStatus?.linked && beatportSyncEnabled) connectedServices.push('beatport');

  // Use API's join_url if configured, otherwise use current origin
  const joinUrl = event.join_url || `${window.location.origin}/join/${event.code}`;
  const isExpiredOrArchived = eventStatus === 'expired' || eventStatus === 'archived';

  return (
    <div className="container">
      {actionError && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {actionError}
        </div>
      )}

      {/* 1. Header */}
      <div className="header">
        <div>
          <Link href="/dashboard" style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
            &larr; Back to Events
          </Link>
          <h1 style={{ marginTop: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{event.name}</h1>
          <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
            {isExpiredOrArchived ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span
                  className="badge"
                  style={{
                    background: eventStatus === 'archived' ? '#6b7280' : '#ef4444',
                    color: '#fff',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '0.25rem',
                    textTransform: 'uppercase',
                    fontSize: '0.75rem',
                  }}
                >
                  {eventStatus}
                </span>
                <span style={{ color: '#9ca3af' }}>
                  {new Date(event.expires_at).toLocaleString()}
                </span>
                <button
                  className="btn btn-sm"
                  style={{ background: '#3b82f6' }}
                  onClick={handleExportCsv}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </button>
              </div>
            ) : editingExpiry ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ color: '#9ca3af' }}>Expires:</span>
                <input
                  type="datetime-local"
                  className="input"
                  style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
                  value={newExpiryDate}
                  onChange={(e) => setNewExpiryDate(e.target.value)}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveExpiry}
                  disabled={updatingExpiry}
                >
                  {updatingExpiry ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: '#333' }}
                  onClick={() => setEditingExpiry(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#9ca3af' }}>
                  Expires: {new Date(event.expires_at).toLocaleString()}
                </span>
                <button
                  className="btn btn-sm"
                  style={{ background: '#333' }}
                  onClick={handleEditExpiry}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
        {!isExpiredOrArchived && nowPlaying && (
          <NowPlayingBadge nowPlaying={nowPlaying} />
        )}
        <div style={{ textAlign: 'center' }}>
          <div className="code" style={{ fontSize: '2rem', color: isExpiredOrArchived ? '#6b7280' : '#3b82f6' }}>
            {event.code}
          </div>
          {!isExpiredOrArchived && (
            <>
              <div className="qr-container">
                <QRCodeSVG value={joinUrl} size={100} />
              </div>
              <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                Scan to join
              </p>
            </>
          )}
        </div>
      </div>

      {/* Tabs or direct content for expired/archived */}
      {isExpiredOrArchived ? (
        <>
          <RequestQueueSection
            requests={requests}
            isExpiredOrArchived={isExpiredOrArchived}
            connectedServices={connectedServices}
            updating={updating}
            acceptingAll={acceptingAll}
            syncingRequest={syncingRequest}
            onUpdateStatus={updateStatus}
            onAcceptAll={handleAcceptAll}
            onSyncToTidal={handleSyncToTidal}
            onOpenTidalPicker={handleOpenTidalPicker}
            onScrollToSyncReport={handleScrollToSyncReport}
          />
          <PlayHistorySection
            items={playHistory}
            total={playHistoryTotal}
            exporting={exportingHistory}
            onExport={handleExportPlayHistoryCsv}
          />
        </>
      ) : (
        <>
          <div className="event-tabs">
            <button
              className={`event-tab${activeTab === 'songs' ? ' active' : ''}`}
              onClick={() => setActiveTab('songs')}
            >
              Song Management
            </button>
            <button
              className={`event-tab${activeTab === 'manage' ? ' active' : ''}`}
              onClick={() => setActiveTab('manage')}
            >
              Event Management
            </button>
          </div>

          {activeTab === 'songs' && (
            <SongManagementTab
              code={code}
              requests={requests}
              isExpiredOrArchived={false}
              connectedServices={connectedServices}
              updating={updating}
              acceptingAll={acceptingAll}
              syncingRequest={syncingRequest}
              onUpdateStatus={updateStatus}
              onAcceptAll={handleAcceptAll}
              onSyncToTidal={handleSyncToTidal}
              onOpenTidalPicker={handleOpenTidalPicker}
              onOpenBeatportPicker={handleOpenBeatportPicker}
              onScrollToSyncReport={handleScrollToSyncReport}
              syncReportExpanded={syncReportExpanded}
              onToggleSyncReport={() => setSyncReportExpanded((prev) => !prev)}
              focusedSyncRequestId={focusedSyncRequestId}
              onClearSyncFocus={() => setFocusedSyncRequestId(null)}
              playHistory={playHistory}
              playHistoryTotal={playHistoryTotal}
              exportingHistory={exportingHistory}
              onExportPlayHistory={handleExportPlayHistoryCsv}
              tidalLinked={!!tidalStatus?.linked}
              beatportLinked={!!beatportStatus?.linked}
              onAcceptTrack={handleAcceptRecommendedTrack}
            />
          )}

          {activeTab === 'manage' && (
            <EventManagementTab
              code={code}
              event={event}
              bridgeConnected={bridgeConnected}
              requestsOpen={requestsOpen}
              togglingRequests={togglingRequests}
              onToggleRequests={handleToggleRequests}
              nowPlayingHidden={nowPlayingHidden}
              togglingNowPlaying={togglingNowPlaying}
              onToggleNowPlaying={handleToggleNowPlaying}
              autoHideInput={autoHideInput}
              autoHideMinutes={autoHideMinutes}
              savingAutoHide={savingAutoHide}
              onAutoHideInputChange={setAutoHideInput}
              onSaveAutoHide={handleSaveAutoHide}
              tidalStatus={tidalStatus}
              tidalSyncEnabled={tidalSyncEnabled}
              togglingTidalSync={togglingTidalSync}
              onToggleTidalSync={handleToggleTidalSync}
              onConnectTidal={handleConnectTidal}
              onDisconnectTidal={handleDisconnectTidal}
              beatportStatus={beatportStatus}
              beatportSyncEnabled={beatportSyncEnabled}
              togglingBeatportSync={togglingBeatportSync}
              onToggleBeatportSync={handleToggleBeatportSync}
              onConnectBeatport={handleConnectBeatport}
              onDisconnectBeatport={handleDisconnectBeatport}
              uploadingBanner={uploadingBanner}
              onBannerSelect={handleBannerSelect}
              onDeleteBanner={handleDeleteBanner}
            />
          )}
        </>
      )}

      {/* Modals */}
      {showDeleteConfirm && (
        <DeleteEventModal
          eventName={event.name}
          requestCount={requests.length}
          deleting={deleting}
          onConfirm={handleDeleteEvent}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {showTidalLogin && (
        <TidalLoginModal
          loginUrl={tidalLoginUrl}
          userCode={tidalLoginCode}
          polling={tidalLoginPolling}
          onCancel={handleCancelTidalLogin}
        />
      )}

      {showBeatportLogin && (
        <BeatportLoginModal
          onSubmit={handleBeatportLogin}
          onCancel={() => setShowBeatportLogin(false)}
        />
      )}

      {showTidalPicker !== null && (
        <ServiceTrackPickerModal
          service="tidal"
          requestId={showTidalPicker}
          searchQuery={tidalSearchQuery}
          tidalResults={tidalSearchResults}
          beatportResults={[]}
          searching={searchingTidal}
          linking={linkingTrack}
          onSearchQueryChange={setTidalSearchQuery}
          onSearch={handleSearchTidal}
          onSelectTrack={handleLinkTidalTrack}
          onCancel={() => setShowTidalPicker(null)}
        />
      )}

      {showBeatportPicker !== null && (
        <ServiceTrackPickerModal
          service="beatport"
          requestId={showBeatportPicker}
          searchQuery={beatportSearchQuery}
          tidalResults={[]}
          beatportResults={beatportSearchResults}
          searching={searchingBeatport}
          linking={linkingBeatportTrack}
          onSearchQueryChange={setBeatportSearchQuery}
          onSearch={handleSearchBeatport}
          onSelectTrack={handleLinkBeatportTrack}
          onCancel={() => setShowBeatportPicker(null)}
        />
      )}
    </div>
  );
}
