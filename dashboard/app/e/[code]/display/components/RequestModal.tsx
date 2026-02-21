'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { api, ApiError, SearchResult } from '@/lib/api';

const INACTIVITY_TIMEOUT = 60000; // 60 seconds

interface RequestModalProps {
  code: string;
  onClose: () => void;
  onRequestsClosed: () => void;
}

export function RequestModal({ code, onClose, onRequestsClosed }: RequestModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedSong, setSelectedSong] = useState<SearchResult | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitIsDuplicate, setSubmitIsDuplicate] = useState(false);
  const [submitVoteCount, setSubmitVoteCount] = useState(0);

  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);

  // Inactivity timeout
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      closeModal();
    }, INACTIVITY_TIMEOUT);
  }, [closeModal]);

  useEffect(() => {
    resetInactivityTimer();

    const handleActivity = () => resetInactivityTimer();
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('pointerdown', handleActivity);
    window.addEventListener('pointermove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    return () => {
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('pointermove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [resetInactivityTimer]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setSearchResults([]);
    try {
      const results = await api.search(searchQuery);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedSong) return;

    setSubmitting(true);
    try {
      const result = await api.submitRequest(
        code,
        selectedSong.artist,
        selectedSong.title,
        note || undefined,
        selectedSong.url || undefined,
        selectedSong.album_art || undefined
      );
      setSubmitted(true);
      setSubmitIsDuplicate(result.is_duplicate ?? false);
      setSubmitVoteCount(result.vote_count);
      // Auto-close after 2.5 seconds
      setTimeout(() => {
        closeModal();
      }, 2500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        closeModal();
        onRequestsClosed();
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !submitting && closeModal()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {submitted ? 'Success!' : selectedSong ? 'Confirm Request' : 'Request a Song'}
          </h2>
          {!submitted && (
            <button className="modal-close" onClick={closeModal}>&times;</button>
          )}
        </div>

        {submitted ? (
          <div className="success-message">
            <div className="success-icon">✓</div>
            <p className="success-text">
              {submitIsDuplicate ? 'Vote Added!' : 'Request Submitted!'}
            </p>
            {submitIsDuplicate && submitVoteCount > 0 && (
              <p className="success-vote-count">
                {submitVoteCount} {submitVoteCount === 1 ? 'person wants' : 'people want'} this song!
              </p>
            )}
          </div>
        ) : selectedSong ? (
          <div className="confirm-section">
            <div className="confirm-song">
              <h3 className="confirm-title">{selectedSong.title}</h3>
              <p className="confirm-artist">{selectedSong.artist}</p>
            </div>
            <input
              type="text"
              className="note-input"
              placeholder="Add a note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <div className="confirm-buttons">
              <button
                className="confirm-submit"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </button>
              <button className="confirm-back" onClick={() => setSelectedSong(null)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={handleSearch} className="search-form">
              <input
                type="text"
                className="search-input"
                placeholder="Search for a song..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <button type="submit" className="search-button" disabled={searching}>
                {searching ? '...' : 'Search'}
              </button>
            </form>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((result, index) => (
                  <button
                    key={result.spotify_id || index}
                    className="search-result-item"
                    onClick={() => setSelectedSong(result)}
                  >
                    {result.album_art ? (
                      <img
                        src={result.album_art}
                        alt={result.title}
                        className="search-result-art"
                      />
                    ) : (
                      <div className="search-result-placeholder">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                          <path d="M20 4v8.5a3.5 3.5 0 1 1-2-3.163V6l-9 1.5v9a3.5 3.5 0 1 1-2-3.163V5l13-1Z" />
                        </svg>
                      </div>
                    )}
                    <div className="search-result-info">
                      <div className="search-result-title">{result.title}</div>
                      <div className="search-result-artist">{result.artist}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
