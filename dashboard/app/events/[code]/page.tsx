'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/lib/auth';
import { api, ApiError, Event, ArchivedEvent, SongRequest } from '@/lib/api';

type StatusFilter = 'all' | 'new' | 'accepted' | 'playing' | 'played' | 'rejected';

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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [updating, setUpdating] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const [eventStatus, setEventStatus] = useState<'active' | 'expired' | 'archived'>('active');
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  const [editingExpiry, setEditingExpiry] = useState(false);
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [updatingExpiry, setUpdatingExpiry] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  const loadData = useCallback(async (): Promise<boolean> => {
    try {
      const [eventData, requestsData] = await Promise.all([
        api.getEvent(code),
        api.getRequests(code),
      ]);
      setEvent(eventData);
      setRequests(requestsData);
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

  const filteredRequests = requests.filter((r) =>
    filter === 'all' ? true : r.status === filter
  );

  const statusCounts = {
    all: requests.length,
    new: requests.filter((r) => r.status === 'new').length,
    accepted: requests.filter((r) => r.status === 'accepted').length,
    playing: requests.filter((r) => r.status === 'playing').length,
    played: requests.filter((r) => r.status === 'played').length,
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

      <div className="tabs">
        {(['all', 'new', 'accepted', 'playing', 'played', 'rejected'] as StatusFilter[]).map((status) => (
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
    </div>
  );
}
