'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/lib/auth';
import { api, Event, SongRequest } from '@/lib/api';

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

  const [event, setEvent] = useState<Event | null>(null);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [updating, setUpdating] = useState<number | null>(null);

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

  const loadData = useCallback(async () => {
    try {
      const [eventData, requestsData] = await Promise.all([
        api.getEvent(code),
        api.getRequests(code),
      ]);
      setEvent(eventData);
      setRequests(requestsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();

      // Poll every 3 seconds
      const interval = setInterval(loadData, 3000);
      return () => clearInterval(interval);
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

  if (!event) {
    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center' }}>
          <p>Event not found or expired.</p>
          <Link href="/events" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Events
          </Link>
        </div>
      </div>
    );
  }

  // Use API's join_url if configured, otherwise use current origin
  const joinUrl = event.join_url || `${window.location.origin}/join/${event.code}`;
  const isExpired = new Date(event.expires_at) < new Date();

  return (
    <div className="container">
      <div className="header">
        <div>
          <Link href="/events" style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
            &larr; Back to Events
          </Link>
          <h1 style={{ marginTop: '0.5rem' }}>{event.name}</h1>
          <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
            {editingExpiry ? (
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
                <span style={{ color: isExpired ? '#ef4444' : '#9ca3af' }}>
                  {isExpired ? 'Expired: ' : 'Expires: '}
                  {new Date(event.expires_at).toLocaleString()}
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
          <div className="code" style={{ fontSize: '2rem', color: '#3b82f6' }}>
            {event.code}
          </div>
          <div className="qr-container">
            <QRCodeSVG value={joinUrl} size={150} />
          </div>
          <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.5rem' }}>
            Scan to join
          </p>
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
