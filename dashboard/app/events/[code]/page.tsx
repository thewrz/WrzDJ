'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/lib/auth';
import { api, ApiError, Event, ArchivedEvent, SongRequest, PlayHistoryItem, TidalStatus, TidalSearchResult } from '@/lib/api';

// Removed 'played' from filter since played tracks appear in Play History section
type StatusFilter = 'all' | 'new' | 'accepted' | 'playing' | 'rejected';

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
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [updating, setUpdating] = useState<number | null>(null);
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

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const loadData = useCallback(async (): Promise<boolean> => {
    try {
      const [eventData, requestsData, historyData, displaySettings, tidalStatusData] = await Promise.all([
        api.getEvent(code),
        api.getRequests(code),
        api.getPlayHistory(code).catch(() => ({ items: [], total: 0 })),
        api.getDisplaySettings(code).catch(() => ({ now_playing_hidden: false })),
        api.getTidalStatus().catch(() => ({ linked: false, user_id: null, expires_at: null })),
      ]);
      setEvent(eventData);
      setRequests(requestsData);
      setPlayHistory(historyData.items);
      setPlayHistoryTotal(historyData.total);
      setNowPlayingHidden(displaySettings.now_playing_hidden);
      setTidalStatus(tidalStatusData);
      setTidalSyncEnabled(eventData.tidal_sync_enabled ?? false);
      setEventStatus('active');
      setError(null);
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
        setError({ message: err.message, status: err.status });
        if (err.status === 404) {
          return false; // Stop polling on 404
        }
      } else {
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
      console.error('Failed to update status:', err);
    } finally {
      setUpdating(null);
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
      console.error('Failed to update expiry:', err);
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
      console.error('Failed to delete event:', err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await api.exportEventCsv(code);
    } catch (err) {
      console.error('Failed to export:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPlayHistoryCsv = async () => {
    setExportingHistory(true);
    try {
      await api.exportPlayHistoryCsv(code);
    } catch (err) {
      console.error('Failed to export play history:', err);
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
      console.error('Failed to toggle now playing visibility:', err);
    } finally {
      setTogglingNowPlaying(false);
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
      const { auth_url } = await api.getTidalAuthUrl();
      window.location.href = auth_url;
    } catch (err) {
      console.error('Failed to get Tidal auth URL:', err);
    }
  };

  const handleSyncToTidal = async (requestId: number) => {
    setSyncingRequest(requestId);
    try {
      const result = await api.syncRequestToTidal(requestId);
      // Update the request in the list
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

  const filteredRequests = requests.filter((r) =>
    filter === 'all' ? true : r.status === filter
  );

  const statusCounts = {
    all: requests.length,
    new: requests.filter((r) => r.status === 'new').length,
    accepted: requests.filter((r) => r.status === 'accepted').length,
    playing: requests.filter((r) => r.status === 'playing').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
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
          <Link href="/events" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  // Use API's join_url if configured, otherwise use current origin
  const joinUrl = event.join_url || `${window.location.origin}/join/${event.code}`;
  const isExpiredOrArchived = eventStatus === 'expired' || eventStatus === 'archived';

  return (
    <div className="container">
      <div className="header">
        <div>
          <Link href="/events" style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
            &larr; Back to Events
          </Link>
          <h1 style={{ marginTop: '0.5rem' }}>{event.name}</h1>
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
                  style={{ background: '#3b82f6', padding: '0.25rem 0.5rem' }}
                  onClick={handleExportCsv}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  style={{ padding: '0.25rem 0.5rem' }}
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
                  style={{ background: '#333', padding: '0.25rem 0.5rem' }}
                  onClick={handleEditExpiry}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  style={{ padding: '0.25rem 0.5rem' }}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="code" style={{ fontSize: '2rem', color: isExpiredOrArchived ? '#6b7280' : '#3b82f6' }}>
            {event.code}
          </div>
          {!isExpiredOrArchived && (
            <>
              <div className="qr-container">
                <QRCodeSVG value={joinUrl} size={150} />
              </div>
              <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                Scan to join
              </p>
            </>
          )}
        </div>
      </div>

      {/* Kiosk Display Settings */}
      {!isExpiredOrArchived && (
        <div
          className="card"
          style={{
            marginBottom: '1rem',
            padding: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontWeight: 500 }}>Kiosk Display Settings</span>
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              Control what guests see on the kiosk display
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              Now Playing:
            </span>
            <button
              className={`btn btn-sm ${nowPlayingHidden ? 'btn-danger' : 'btn-success'}`}
              style={{ minWidth: '100px' }}
              onClick={handleToggleNowPlaying}
              disabled={togglingNowPlaying}
            >
              {togglingNowPlaying ? '...' : nowPlayingHidden ? 'Hidden' : 'Visible'}
            </button>
          </div>
        </div>
      )}

      {/* Tidal Sync Settings */}
      {!isExpiredOrArchived && (
        <div
          className="card"
          style={{
            marginBottom: '1rem',
            padding: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontWeight: 500 }}>Tidal Playlist Sync</span>
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
              Auto-add accepted requests to a Tidal playlist for SC6000
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {tidalStatus?.linked ? (
              <>
                <span style={{ color: '#10b981', fontSize: '0.875rem' }}>
                  Tidal Connected
                </span>
                <button
                  className={`btn btn-sm ${tidalSyncEnabled ? 'btn-success' : ''}`}
                  style={{
                    minWidth: '100px',
                    background: tidalSyncEnabled ? undefined : '#333',
                  }}
                  onClick={handleToggleTidalSync}
                  disabled={togglingTidalSync}
                >
                  {togglingTidalSync ? '...' : tidalSyncEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </>
            ) : (
              <button
                className="btn btn-sm"
                style={{ background: '#0066ff' }}
                onClick={handleConnectTidal}
              >
                Connect Tidal
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tabs">
        {(['all', 'new', 'accepted', 'playing', 'rejected'] as StatusFilter[]).map((status) => (
          <button
            key={status}
            className={`tab ${filter === status ? 'active' : ''}`}
            onClick={() => setFilter(status)}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
          </button>
        ))}
      </div>

      {filteredRequests.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: '#9ca3af' }}>
            {filter === 'all'
              ? 'No requests yet. Share the QR code with your guests!'
              : `No ${filter} requests.`}
          </p>
        </div>
      ) : (
        <div className="request-list">
          {filteredRequests.map((request) => (
            <div key={request.id} className="request-item">
              <div className="request-info">
                <h3>
                  {request.song_title}
                  {request.source_url && (
                    <a
                      href={request.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}
                    >
                      ↗
                    </a>
                  )}
                </h3>
                <p>{request.artist}</p>
                {request.note && <div className="note">{request.note}</div>}
                <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  {new Date(request.created_at).toLocaleTimeString()}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {/* Tidal Sync Status */}
                {tidalSyncEnabled && request.status === 'accepted' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {request.tidal_sync_status === 'synced' && (
                      <span
                        title="Synced to Tidal"
                        style={{
                          color: '#10b981',
                          fontSize: '1rem',
                          cursor: 'default',
                        }}
                      >
                        T
                      </span>
                    )}
                    {request.tidal_sync_status === 'pending' && (
                      <span
                        title="Syncing..."
                        style={{
                          color: '#f59e0b',
                          fontSize: '0.875rem',
                        }}
                      >
                        ...
                      </span>
                    )}
                    {request.tidal_sync_status === 'not_found' && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#f59e0b', padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                        onClick={() => handleOpenTidalPicker(request.id)}
                        title="Track not found - click to link manually"
                      >
                        Link
                      </button>
                    )}
                    {request.tidal_sync_status === 'error' && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#ef4444', padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                        onClick={() => handleSyncToTidal(request.id)}
                        disabled={syncingRequest === request.id}
                        title="Sync failed - click to retry"
                      >
                        {syncingRequest === request.id ? '...' : 'Retry'}
                      </button>
                    )}
                    {!request.tidal_sync_status && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#0066ff', padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                        onClick={() => handleSyncToTidal(request.id)}
                        disabled={syncingRequest === request.id}
                        title="Sync to Tidal"
                      >
                        {syncingRequest === request.id ? '...' : 'Sync'}
                      </button>
                    )}
                  </div>
                )}
                <span className={`badge badge-${request.status}`}>{request.status}</span>
                {!isExpiredOrArchived && (
                  <div className="request-actions">
                    {request.status === 'new' && (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => updateStatus(request.id, 'accepted')}
                          disabled={updating === request.id}
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => updateStatus(request.id, 'rejected')}
                          disabled={updating === request.id}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {request.status === 'accepted' && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => updateStatus(request.id, 'playing')}
                          disabled={updating === request.id}
                        >
                          Playing
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => updateStatus(request.id, 'rejected')}
                          disabled={updating === request.id}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {request.status === 'playing' && (
                      <button
                        className="btn btn-warning btn-sm"
                        onClick={() => updateStatus(request.id, 'played')}
                        disabled={updating === request.id}
                      >
                        Played
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Play History Section */}
      {playHistory.length > 0 && (
        <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              Play History
              <span style={{ color: '#9ca3af', fontWeight: 'normal', marginLeft: '0.5rem' }}>
                ({playHistoryTotal} {playHistoryTotal === 1 ? 'track' : 'tracks'})
              </span>
            </h2>
            <button
              className="btn btn-sm"
              style={{ background: '#8b5cf6', padding: '0.25rem 0.75rem' }}
              onClick={handleExportPlayHistoryCsv}
              disabled={exportingHistory}
            >
              {exportingHistory ? 'Exporting...' : 'Export Play History'}
            </button>
          </div>
          <div className="request-list">
            {playHistory.map((item) => (
              <div key={item.id} className="request-item" style={{ padding: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
                  {item.album_art_url ? (
                    <img
                      src={item.album_art_url}
                      alt={item.title}
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '4px',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '4px',
                        background: '#333',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                      }}
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M20 4v8.5a3.5 3.5 0 1 1-2-3.163V6l-9 1.5v9a3.5 3.5 0 1 1-2-3.163V5l13-1Z" />
                      </svg>
                    </div>
                  )}
                  <div className="request-info" style={{ flex: 1 }}>
                    <h3 style={{ margin: 0 }}>{item.title}</h3>
                    <p style={{ margin: '0.25rem 0 0', color: '#9ca3af' }}>{item.artist}</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                      {new Date(item.started_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span
                    className="badge"
                    style={{
                      background: item.source === 'stagelinq' ? '#8b5cf6' : '#3b82f6',
                      color: '#fff',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                      fontSize: '0.75rem',
                    }}
                  >
                    {item.source === 'stagelinq' ? 'Live' : 'Manual'}
                  </span>
                  {item.matched_request_id && (
                    <span
                      className="badge"
                      style={{
                        background: '#10b981',
                        color: '#fff',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                      }}
                    >
                      Requested
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            className="card"
            style={{ maxWidth: '400px', margin: '1rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '1rem' }}>Delete Event?</h2>
            <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
              This will permanently delete "{event.name}" and all {requests.length} song requests. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                className="btn btn-danger"
                onClick={handleDeleteEvent}
                disabled={deleting}
                style={{ flex: 1 }}
              >
                {deleting ? 'Deleting...' : 'Delete Event'}
              </button>
              <button
                className="btn"
                style={{ background: '#333' }}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tidal Track Picker Modal */}
      {showTidalPicker !== null && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !linkingTrack && setShowTidalPicker(null)}
        >
          <div
            className="card"
            style={{ maxWidth: '500px', maxHeight: '80vh', margin: '1rem', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '1rem' }}>Link Tidal Track</h2>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input
                type="text"
                className="input"
                placeholder="Search Tidal..."
                value={tidalSearchQuery}
                onChange={(e) => setTidalSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchTidal()}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleSearchTidal}
                disabled={searchingTidal}
              >
                {searchingTidal ? '...' : 'Search'}
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {tidalSearchResults.length === 0 ? (
                <p style={{ color: '#9ca3af', textAlign: 'center' }}>
                  {searchingTidal ? 'Searching...' : 'Search for a track to link'}
                </p>
              ) : (
                tidalSearchResults.map((track) => (
                  <div
                    key={track.track_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem',
                      borderBottom: '1px solid #333',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleLinkTidalTrack(showTidalPicker, track.track_id)}
                  >
                    {track.cover_url ? (
                      <img
                        src={track.cover_url}
                        alt={track.title}
                        style={{ width: '48px', height: '48px', borderRadius: '4px' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '4px',
                          background: '#333',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#9ca3af',
                        }}
                      >
                        <span style={{ fontSize: '1.5rem' }}>T</span>
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{track.title}</div>
                      <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{track.artist}</div>
                      {track.album && (
                        <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{track.album}</div>
                      )}
                    </div>
                    {linkingTrack && (
                      <span style={{ color: '#9ca3af' }}>...</span>
                    )}
                  </div>
                ))
              )}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <button
                className="btn"
                style={{ background: '#333', width: '100%' }}
                onClick={() => setShowTidalPicker(null)}
                disabled={linkingTrack}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
