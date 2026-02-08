'use client';

import { useEffect, useState } from 'react';
import { api, AdminEvent } from '@/lib/api';

export default function AdminEventsPage() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editEvent, setEditEvent] = useState<AdminEvent | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState('');
  const limit = 20;

  const loadEvents = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminEvents(page, limit);
      setEvents(data.items);
      setTotal(data.total);
    } catch {
      setError('Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [page]);

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEvent) return;
    setError('');
    try {
      await api.updateAdminEvent(editEvent.code, { name: editName });
      setEditEvent(null);
      loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event');
    }
  };

  const handleDelete = async (event: AdminEvent) => {
    if (!confirm(`Delete event "${event.name}" (${event.code})? This cannot be undone.`)) return;
    try {
      await api.deleteAdminEvent(event.code);
      loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete event');
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="container">
      <div className="header">
        <h1>Event Management</h1>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>
      )}

      {/* Edit Modal */}
      {editEvent && (
        <div className="modal-overlay" onClick={() => setEditEvent(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: '1rem' }}>Edit: {editEvent.code}</h2>
            <form onSubmit={handleEdit}>
              <div className="form-group">
                <label htmlFor="edit-event-name">Event Name</label>
                <input
                  id="edit-event-name"
                  className="input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn btn-primary">Save</button>
                <button
                  type="button"
                  className="btn"
                  style={{ background: '#333' }}
                  onClick={() => setEditEvent(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading events...</div>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Owner</th>
                <th>Requests</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td style={{ fontFamily: 'monospace', color: '#3b82f6' }}>{event.code}</td>
                  <td>{event.name}</td>
                  <td>{event.owner_username}</td>
                  <td>{event.request_count}</td>
                  <td>
                    {event.is_active ? (
                      new Date(event.expires_at) > new Date() ? (
                        <span className="badge badge-playing">Active</span>
                      ) : (
                        <span className="badge badge-played">Expired</span>
                      )
                    ) : (
                      <span className="badge badge-rejected">Inactive</span>
                    )}
                  </td>
                  <td>{new Date(event.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          setEditEvent(event);
                          setEditName(event.name);
                          setError('');
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(event)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-sm"
                style={{ background: '#333' }}
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span style={{ color: '#9ca3af' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-sm"
                style={{ background: '#333' }}
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
