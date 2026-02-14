'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Event, TidalStatus, BeatportStatus, ActivityLogEntry } from '@/lib/api-types';
import { ActivityLogPanel } from './components/ActivityLogPanel';

export default function DashboardPage() {
  const { isAuthenticated, isLoading, role, logout } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [tidalStatus, setTidalStatus] = useState<TidalStatus | null>(null);
  const [beatportStatus, setBeatportStatus] = useState<BeatportStatus | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    } else if (!isLoading && role === 'pending') {
      router.push('/pending');
    }
  }, [isAuthenticated, isLoading, role, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const loadData = async () => {
    try {
      const [eventsData, tidalData, beatportData, logData] = await Promise.allSettled([
        api.getEvents(),
        api.getTidalStatus(),
        api.getBeatportStatus(),
        api.getActivityLog(),
      ]);

      if (eventsData.status === 'fulfilled') setEvents(eventsData.value);
      if (tidalData.status === 'fulfilled') setTidalStatus(tidalData.value);
      if (beatportData.status === 'fulfilled') setBeatportStatus(beatportData.value);
      if (logData.status === 'fulfilled') setActivityLog(logData.value);
    } catch {
      setErrorMsg('Failed to load dashboard data');
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventName.trim()) return;

    setCreating(true);
    try {
      const event = await api.createEvent(newEventName);
      setEvents([event, ...events]);
      setNewEventName('');
      setShowCreate(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setCreating(false);
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container">
      {errorMsg && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {errorMsg}
        </div>
      )}

      <div className="header">
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {role === 'admin' && (
            <Link href="/admin">
              <button className="btn" style={{ background: '#6b21a8' }}>Admin</button>
            </Link>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Create Event
          </button>
          <a
            href="https://github.com/thewrz/WrzDJ/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm"
            style={{ background: '#333', textDecoration: 'none', color: '#ededed' }}
          >
            Bridge App
          </a>
          <button className="btn" style={{ background: '#333' }} onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Create New Event</h2>
          <form onSubmit={handleCreateEvent}>
            <div className="form-group">
              <label htmlFor="eventName">Event Name</label>
              <input
                id="eventName"
                type="text"
                className="input"
                placeholder="Friday Night Party"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                type="button"
                className="btn"
                style={{ background: '#333' }}
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cloud Providers Status */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Cloud Providers</h3>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: tidalStatus?.linked ? '#22c55e' : '#6b7280',
                display: 'inline-block',
              }}
            />
            <span style={{ fontWeight: 500 }}>Tidal</span>
            <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              {tidalStatus?.linked ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: beatportStatus?.linked ? '#22c55e' : '#6b7280',
                display: 'inline-block',
              }}
            />
            <span style={{ fontWeight: 500 }}>Beatport</span>
            <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
              {beatportStatus?.linked ? 'Connected' : 'Not connected'}
            </span>
          </div>
        </div>
      </div>

      {/* Activity Log */}
      <ActivityLogPanel entries={activityLog} />

      {/* Events */}
      <h2 style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>My Events</h2>
      {loadingEvents ? (
        <div className="loading">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: '#9ca3af' }}>No events yet. Create your first event!</p>
        </div>
      ) : (
        <div className="event-grid">
          {events.map((event) => (
            <Link key={event.id} href={`/events/${event.code}`}>
              <div className="event-card" style={{ cursor: 'pointer' }}>
                <h3>{event.name}</h3>
                <div className="code">{event.code}</div>
                <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>
                  Expires: {new Date(event.expires_at).toLocaleString()}
                </p>
                {!event.is_active && (
                  <span className="badge badge-rejected" style={{ marginTop: '0.5rem' }}>
                    Inactive
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
