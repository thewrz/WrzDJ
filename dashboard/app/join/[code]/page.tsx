'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError, Event, GuestRequestInfo, SearchResult } from '@/lib/api';

const CONFIRMATION_DISPLAY_MS = 3000;
const FADE_ANIMATION_MS = 500;
const POLL_INTERVAL_MS = 10000;
const BACKOFF_INTERVAL_MS = 60000;

export default function JoinEventPage() {
  const params = useParams();
  const code = params.code as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [selectedSong, setSelectedSong] = useState<SearchResult | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitIsDuplicate, setSubmitIsDuplicate] = useState(false);
  const [submitVoteCount, setSubmitVoteCount] = useState(0);

  // Request list view state
  const [showRequestList, setShowRequestList] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [guestRequests, setGuestRequests] = useState<GuestRequestInfo[]>([]);
  const [pollInterval, setPollInterval] = useState(POLL_INTERVAL_MS);

  const loadEvent = useCallback(async () => {
    try {
      const data = await api.getEvent(code);
      setEvent(data);
      setError(null);

      // Check if this client has already requested for this event
      try {
        const { has_requested } = await api.checkHasRequested(code);
        if (has_requested) {
          setShowRequestList(true);
        }
      } catch {
        // Silently fall back to search form if check fails
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ message: err.message, status: err.status });
      } else {
        setError({ message: 'Event not found or has expired.', status: 0 });
      }
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  // Fade-out timer after successful submission
  useEffect(() => {
    if (!submitted) return;

    const fadeTimer = setTimeout(() => {
      setFadingOut(true);
    }, CONFIRMATION_DISPLAY_MS);

    const listTimer = setTimeout(() => {
      setShowRequestList(true);
      setFadingOut(false);
    }, CONFIRMATION_DISPLAY_MS + FADE_ANIMATION_MS);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(listTimer);
    };
  }, [submitted]);

  // Poll for guest request list
  const loadRequests = useCallback(async () => {
    try {
      const data = await api.getPublicRequests(code);
      setGuestRequests(data.requests);
      setPollInterval(POLL_INTERVAL_MS);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setPollInterval(BACKOFF_INTERVAL_MS);
      }
    }
  }, [code]);

  useEffect(() => {
    if (!showRequestList) return;

    loadRequests();
    const intervalId = setInterval(loadRequests, pollInterval);
    return () => clearInterval(intervalId);
  }, [showRequestList, loadRequests, pollInterval]);

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
    setSubmitError('');
    try {
      const result = await api.submitRequest(code, selectedSong.artist, selectedSong.title, note || undefined, selectedSong.url || undefined, selectedSong.album_art || undefined);
      setSubmitted(true);
      setSubmitIsDuplicate(result.is_duplicate ?? false);
      setSubmitVoteCount(result.vote_count);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setEvent((prev) => prev ? { ...prev, requests_open: false } : prev);
        setSelectedSong(null);
        return;
      }
      setSubmitError('Failed to submit request. Please try again.');
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
    setSubmitIsDuplicate(false);
    setSubmitVoteCount(0);
    setFadingOut(false);
    setShowRequestList(false);
  };

  if (loading) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error || !event) {
    const is410 = error?.status === 410;
    const is404 = error?.status === 404;

    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem' }}>
            {is410 ? 'Event Expired' : is404 ? 'Event Not Found' : 'Oops!'}
          </h1>
          <p style={{ color: '#9ca3af' }}>
            {is410
              ? 'This event has ended and is no longer accepting requests.'
              : is404
                ? 'This event does not exist.'
                : error?.message || 'Event not found.'}
          </p>
        </div>
      </div>
    );
  }

  if (showRequestList) {
    return (
      <div className="guest-request-list-container">
        {event.banner_url && (
          <div className="join-banner-bg">
            <img src={event.banner_url} alt="" />
          </div>
        )}
        <div className="container" style={{ maxWidth: '500px', flex: 1, position: 'relative', zIndex: 1 }}>
          <h2 style={{ marginBottom: '0.5rem' }}>{event.name}</h2>
          <p style={{ color: '#9ca3af', marginBottom: '1rem' }}>
            {guestRequests.length} {guestRequests.length === 1 ? 'request' : 'requests'}
          </p>

          {guestRequests.length > 0 ? (
            <div className="guest-request-list">
              {guestRequests.map((req) => (
                <div key={req.id} className="guest-request-item">
                  {req.artwork_url ? (
                    <img
                      src={req.artwork_url}
                      alt={req.title}
                      className="guest-request-item-art"
                    />
                  ) : (
                    <div
                      className="guest-request-item-art"
                      style={{ background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <span style={{ fontSize: '1.25rem', color: '#666' }}>&#9835;</span>
                    </div>
                  )}
                  <div className="guest-request-item-info">
                    <div className="guest-request-item-title">{req.title}</div>
                    <div className="guest-request-item-artist">{req.artist}</div>
                  </div>
                  <div className="guest-request-item-meta">
                    <span className={`badge ${req.status === 'accepted' ? 'badge-accepted-guest' : 'badge-pending'}`}>
                      {req.status === 'accepted' ? 'Accepted' : 'Pending'}
                    </span>
                    {req.vote_count > 0 && (
                      <span className="guest-vote-badge">
                        {req.vote_count} {req.vote_count === 1 ? 'vote' : 'votes'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', color: '#9ca3af' }}>
              <p>No requests yet. Be the first!</p>
            </div>
          )}
        </div>

        {event.requests_open && (
          <div className="sticky-bottom-button">
            <button className="btn btn-primary" onClick={resetForm}>
              Request a Song
            </button>
          </div>
        )}
        {!event.requests_open && (
          <div className="sticky-bottom-button">
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '0.75rem' }}>
              Requests are closed for this event
            </div>
          </div>
        )}
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className={`card${fadingOut ? ' fade-out' : ''}`} style={{ textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem', color: '#22c55e' }}>
            {submitIsDuplicate ? 'Vote Added!' : 'Request Submitted!'}
          </h1>
          <p style={{ marginBottom: '1rem' }}>
            <strong>{selectedSong?.title}</strong> by <strong>{selectedSong?.artist}</strong>
          </p>
          <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
            {submitIsDuplicate
              ? `Someone already requested this song. Your vote has been added! ${submitVoteCount} ${submitVoteCount === 1 ? 'person wants' : 'people want'} this song.`
              : 'The DJ will see your request soon.'}
          </p>
        </div>
      </div>
    );
  }

  if (selectedSong) {
    return (
      <div className="container" style={{ maxWidth: '500px' }}>
        <div className="card">
          <h2 style={{ marginBottom: '1rem' }}>Confirm Request</h2>
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {selectedSong.album_art && (
              <img
                src={selectedSong.album_art}
                alt={selectedSong.album || selectedSong.title}
                style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover' }}
              />
            )}
            <div>
              <h3 style={{ margin: 0 }}>{selectedSong.title}</h3>
              <p style={{ color: '#9ca3af', margin: '0.25rem 0 0 0' }}>{selectedSong.artist}</p>
              {selectedSong.album && (
                <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>{selectedSong.album}</p>
              )}
            </div>
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
          {submitError && (
            <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{submitError}</p>
          )}
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

  if (!event.requests_open) {
    return (
      <div className="join-page-wrapper">
        {event.banner_url && (
          <div className="join-banner-bg">
            <img src={event.banner_url} alt="" />
          </div>
        )}
        <div className="container" style={{ maxWidth: '500px', position: 'relative', zIndex: 1 }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <h1 style={{ marginBottom: '0.5rem' }}>{event.name}</h1>
            <p style={{ color: '#9ca3af', marginTop: '1rem' }}>
              Requests are closed for this event
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page-wrapper">
      {event.banner_url && (
        <div className="join-banner-bg">
          <img src={event.banner_url} alt="" />
        </div>
      )}
      <div className="container" style={{ maxWidth: '500px', position: 'relative', zIndex: 1 }}>
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
                key={result.spotify_id || index}
                className="request-item"
                style={{
                  cursor: 'pointer',
                  border: 'none',
                  textAlign: 'left',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem'
                }}
                onClick={() => setSelectedSong(result)}
              >
                {result.album_art && (
                  <img
                    src={result.album_art}
                    alt={result.album || result.title}
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '4px',
                      objectFit: 'cover',
                      flexShrink: 0
                    }}
                  />
                )}
                <div className="request-info" style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: '1rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.title}</h3>
                  <p style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.artist}</p>
                  {result.album && (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.album}</p>
                  )}
                </div>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: `conic-gradient(#22c55e ${result.popularity}%, #333 ${result.popularity}%)`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.65rem',
                    flexShrink: 0
                  }}
                  title={`Popularity: ${result.popularity}%`}
                >
                  {result.popularity}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
