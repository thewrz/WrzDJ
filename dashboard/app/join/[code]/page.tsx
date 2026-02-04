'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, Event, SearchResult } from '@/lib/api';

export default function JoinEventPage() {
  const params = useParams();
  const code = params.code as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedSong, setSelectedSong] = useState<SearchResult | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    loadEvent();
  }, [code]);

  const loadEvent = async () => {
    try {
      const data = await api.getEvent(code);
      setEvent(data);
    } catch (err) {
      setError('Event not found or has expired.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults([]);
    try {
      const results = await api.search(searchQuery);
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedSong) return;

    setSubmitting(true);
    try {
      await api.submitRequest(code, selectedSong.artist, selectedSong.title, note || undefined);
      setSubmitted(true);
    } catch (err) {
      console.error('Submit failed:', err);
      setError('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedSong(null);
    setNote('');
    setSubmitted(false);
  };

  if (loading) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem' }}>Oops!</h1>
          <p style={{ color: '#9ca3af' }}>{error || 'Event not found.'}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem', color: '#22c55e' }}>Request Submitted!</h1>
          <p style={{ marginBottom: '1rem' }}>
            <strong>{selectedSong?.title}</strong> by <strong>{selectedSong?.artist}</strong>
          </p>
          <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
            The DJ will see your request soon.
          </p>
          <button className="btn btn-primary" onClick={resetForm}>
            Request Another Song
          </button>
        </div>
      </div>
    );
  }

  if (selectedSong) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="card">
          <h2 style={{ marginBottom: '1rem' }}>Confirm Request</h2>
          <div style={{ marginBottom: '1rem' }}>
            <h3>{selectedSong.title}</h3>
            <p style={{ color: '#9ca3af' }}>{selectedSong.artist}</p>
          </div>
          <div className="form-group">
            <label htmlFor="note">Add a note (optional)</label>
            <input
              id="note"
              type="text"
              className="input"
              placeholder="e.g., It's my birthday!"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
            <button
              className="btn"
              style={{ background: '#333' }}
              onClick={() => setSelectedSong(null)}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '500px' }}>
      <div className="card">
        <h1 style={{ marginBottom: '0.5rem' }}>{event.name}</h1>
        <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>Request a song</p>

        <form onSubmit={handleSearch}>
          <div className="form-group">
            <input
              type="text"
              className="input"
              placeholder="Search for a song or artist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {searchResults.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Search Results</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {searchResults.map((result, index) => (
              <button
                key={index}
                className="request-item"
                style={{
                  cursor: 'pointer',
                  border: 'none',
                  textAlign: 'left',
                  width: '100%'
                }}
                onClick={() => setSelectedSong(result)}
              >
                <div className="request-info">
                  <h3 style={{ fontSize: '1rem' }}>{result.title}</h3>
                  <p>{result.artist}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
