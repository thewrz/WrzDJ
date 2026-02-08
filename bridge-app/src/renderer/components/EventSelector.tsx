import { useState, useEffect } from 'react';
import { api } from '../api.js';
import type { EventInfo } from '../../shared/types.js';

interface EventSelectorProps {
  selectedCode: string | null;
  onSelect: (event: EventInfo) => void;
}

export function EventSelector({ selectedCode, onSelect }: EventSelectorProps) {
  const [events, setEvents] = useState<readonly EventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.fetchEvents();
      setEvents(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-title">Select Event</div>
        <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>Loading events...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-title">Select Event</div>
        <div className="error-message">{error}</div>
        <button className="btn btn-ghost btn-sm" onClick={loadEvents}>
          Retry
        </button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Select Event</div>
        <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
          No active events. Create an event on the WrzDJ dashboard first.
        </p>
        <button className="btn btn-ghost btn-sm" onClick={loadEvents} style={{ marginTop: '0.5rem' }}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Select Event</div>
      <div className="event-list">
        {events.map((event) => (
          <div
            key={event.id}
            className={`event-item ${selectedCode === event.code ? 'selected' : ''}`}
            onClick={() => onSelect(event)}
          >
            <span className="event-item-name">{event.name}</span>
            <span className="event-item-code">{event.code}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
