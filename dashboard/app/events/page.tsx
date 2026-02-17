'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, Event } from '@/lib/api';
import { useHelp } from '@/lib/help/HelpContext';
import { HelpSpot } from '@/components/help/HelpSpot';
import { HelpButton } from '@/components/help/HelpButton';
import { OnboardingOverlay } from '@/components/help/OnboardingOverlay';

const PAGE_ID = 'events';

export default function EventsPage() {
  const { isAuthenticated, isLoading, role, logout } = useAuth();
  const { hasSeenPage, startOnboarding } = useHelp();
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
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
      loadEvents();
    }
  }, [isAuthenticated]);

  // Auto-trigger onboarding for first-time visitors
  useEffect(() => {
    if (!isLoading && isAuthenticated && !loadingEvents && !hasSeenPage(PAGE_ID)) {
      const timer = setTimeout(() => startOnboarding(PAGE_ID), 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, isAuthenticated, loadingEvents, hasSeenPage, startOnboarding]);

  const loadEvents = async () => {
    try {
      const data = await api.getEvents();
      setEvents(data);
    } catch {
      setErrorMsg('Failed to load events');
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
      <HelpButton page={PAGE_ID} />
      <OnboardingOverlay page={PAGE_ID} />

      {errorMsg && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '0.75rem 1rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {errorMsg}
        </div>
      )}
      <HelpSpot spotId="events-header" page={PAGE_ID} order={1} title="Your Events" description="This is your events dashboard. All your DJ events appear here.">
        <div className="header">
          <h1>My Events</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {role === 'admin' && (
              <HelpSpot spotId="events-admin" page={PAGE_ID} order={3} title="Admin Panel" description="Access the admin panel to manage users, view all events, and configure integrations.">
                <Link href="/admin">
                  <button className="btn" style={{ background: '#6b21a8' }}>Admin</button>
                </Link>
              </HelpSpot>
            )}
            <HelpSpot spotId="events-create" page={PAGE_ID} order={2} title="Create Event" description="Click to create a new event. Each event gets a unique code and QR that guests scan to submit requests.">
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create Event
              </button>
            </HelpSpot>
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
      </HelpSpot>

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

      {loadingEvents ? (
        <div className="loading">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: '#9ca3af' }}>No events yet. Create your first event!</p>
        </div>
      ) : (
        <HelpSpot spotId="events-grid" page={PAGE_ID} order={4} title="Event Cards" description="Your events appear as cards. Click any card to manage its request queue, sync settings, and kiosk controls.">
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
        </HelpSpot>
      )}
    </div>
  );
}
