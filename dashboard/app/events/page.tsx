'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, Event } from '@/lib/api';

export default function EventsPage() {
  const { isAuthenticated, isLoading, role, logout } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    } else if (!isLoading && role === 'pending') {
      router.push('/pending');
    }
  }, [isAuthenticated, isLoading, role, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadEvents();
    }
  }, [isAuthenticated]);

  const loadEvents = async () => {
    try {
      const data = await api.getEvents();
      setEvents(data);
    } catch (err) {
      console.error('Failed to load events:', err);
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
      console.error('Failed to create event:', err);
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
      <div className="header">
        <h1>My Events</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {role === 'admin' && (
            <Link href="/admin">
              <button className="btn" style={{ background: '#6b21a8' }}>Admin</button>
            </Link>
          )}
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Create Event
          </button>
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
