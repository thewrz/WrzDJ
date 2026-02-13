'use client';

import { useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import type {
  RecommendedTrack,
  EventMusicProfile,
  RecommendationResponse,
  PlaylistInfo,
} from '@/lib/api-types';

type Mode = 'requests' | 'template';

interface RecommendationsCardProps {
  code: string;
  hasAcceptedRequests: boolean;
  tidalLinked: boolean;
  beatportLinked: boolean;
  onAcceptTrack: (track: RecommendedTrack) => Promise<void>;
}

export function RecommendationsCard({
  code,
  hasAcceptedRequests,
  tidalLinked,
  beatportLinked,
  onAcceptTrack,
}: RecommendationsCardProps) {
  const hasConnectedServices = tidalLinked || beatportLinked;

  const [suggestions, setSuggestions] = useState<RecommendedTrack[]>([]);
  const [profile, setProfile] = useState<EventMusicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  // Template playlist state
  const [mode, setMode] = useState<Mode>('requests');
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);

  const loadPlaylists = useCallback(async () => {
    if (playlistsLoaded) return;
    setLoadingPlaylists(true);
    try {
      const result = await api.getEventPlaylists(code);
      setPlaylists(result.playlists);
      setPlaylistsLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load playlists');
    } finally {
      setLoadingPlaylists(false);
    }
  }, [code, playlistsLoaded]);

  const handleModeChange = (newMode: Mode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setSuggestions([]);
    setProfile(null);
    setError(null);
    setSelectedPlaylist(null);
    if (newMode === 'template') {
      loadPlaylists();
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      let result: RecommendationResponse;
      if (mode === 'template' && selectedPlaylist) {
        const [source, playlistId] = selectedPlaylist.split(':');
        result = await api.generateRecommendationsFromTemplate(code, source, playlistId);
      } else {
        result = await api.generateRecommendations(code);
      }
      setSuggestions(result.suggestions);
      setProfile(result.profile);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate suggestions');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (track: RecommendedTrack) => {
    const trackKey = `${track.artist}-${track.title}`;
    setAcceptingId(trackKey);
    try {
      await onAcceptTrack(track);
      setSuggestions((prev) => prev.filter((s) => `${s.artist}-${s.title}` !== trackKey));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to accept track');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleAcceptAll = async () => {
    setAcceptingAll(true);
    try {
      for (const track of suggestions) {
        await onAcceptTrack(track);
      }
      setSuggestions([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to accept all tracks');
    } finally {
      setAcceptingAll(false);
    }
  };

  const handleClear = () => {
    setSuggestions([]);
    setProfile(null);
    setError(null);
  };

  const canGenerate = (() => {
    if (!hasConnectedServices || loading) return false;
    if (mode === 'requests') return hasAcceptedRequests;
    return !!selectedPlaylist;
  })();

  const modeButtonStyle = (active: boolean) => ({
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    border: 'none',
    borderRadius: '0.25rem',
    cursor: 'pointer' as const,
    background: active ? '#3b82f6' : '#374151',
    color: active ? '#fff' : '#9ca3af',
  });

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '0.75rem',
      }}>
        <span style={{ fontWeight: 600 }}>Song Suggestions</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {suggestions.length > 0 && (
            <>
              <button
                className="btn btn-sm"
                style={{ background: '#10b981' }}
                onClick={handleAcceptAll}
                disabled={acceptingAll || loading}
              >
                {acceptingAll ? 'Accepting...' : 'Accept All'}
              </button>
              <button
                className="btn btn-sm"
                style={{ background: '#6b7280' }}
                onClick={handleClear}
                disabled={loading}
              >
                Clear
              </button>
            </>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Mode toggle */}
      {hasConnectedServices && (
        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem' }}>
          <button
            style={modeButtonStyle(mode === 'requests')}
            onClick={() => handleModeChange('requests')}
          >
            From Requests
          </button>
          <button
            style={modeButtonStyle(mode === 'template')}
            onClick={() => handleModeChange('template')}
          >
            From Playlist
          </button>
        </div>
      )}

      {/* Playlist selector in template mode */}
      {mode === 'template' && hasConnectedServices && (
        <div style={{ marginBottom: '0.75rem' }}>
          {loadingPlaylists ? (
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
              Loading playlists...
            </p>
          ) : playlists.length > 0 ? (
            <select
              value={selectedPlaylist || ''}
              onChange={(e) => setSelectedPlaylist(e.target.value || null)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                background: '#1a1a1a',
                color: '#ededed',
                border: '1px solid #374151',
                fontSize: '0.875rem',
              }}
            >
              <option value="">Select a playlist...</option>
              {playlists.map((p) => (
                <option key={`${p.source}:${p.id}`} value={`${p.source}:${p.id}`}>
                  [{p.source}] {p.name} ({p.num_tracks} tracks)
                </option>
              ))}
            </select>
          ) : playlistsLoaded ? (
            <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
              No playlists found on connected services.
            </p>
          ) : null}
        </div>
      )}

      {!hasConnectedServices && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
          Link Tidal or Beatport to get song suggestions.
        </p>
      )}

      {hasConnectedServices && mode === 'requests' && !hasAcceptedRequests
        && suggestions.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
          Accept some requests first to build a music profile.
        </p>
      )}

      {error && (
        <div style={{ color: '#fca5a5', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
          {error}
        </div>
      )}

      {profile && (
        <div style={{
          fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.75rem',
          display: 'flex', gap: '0.75rem', flexWrap: 'wrap',
        }}>
          {profile.avg_bpm && <span>~{Math.round(profile.avg_bpm)} BPM</span>}
          {profile.dominant_keys.length > 0 && (
            <span>{profile.dominant_keys.join(', ')}</span>
          )}
          {profile.dominant_genres.length > 0 && (
            <span>{profile.dominant_genres.join(', ')}</span>
          )}
          <span>{profile.enriched_count}/{profile.track_count} enriched</span>
        </div>
      )}

      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {suggestions.map((track) => {
            const trackKey = `${track.artist}-${track.title}`;
            const isAccepting = acceptingId === trackKey;
            return (
              <div
                key={trackKey}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem',
                  borderRadius: '0.375rem',
                  background: '#1a1a1a',
                  overflow: 'hidden',
                }}
              >
                {track.cover_url && (
                  <img
                    src={track.cover_url}
                    alt=""
                    style={{
                      width: 40, height: 40,
                      borderRadius: '0.25rem', objectFit: 'cover',
                    }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: '0.375rem',
                  }}>
                    <span style={{
                      fontWeight: 500, fontSize: '0.875rem',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {track.artist} &mdash; {track.title}
                    </span>
                    {track.url && (
                      <a
                        href={track.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '0.75rem', flexShrink: 0 }}
                      >
                        ↗
                      </a>
                    )}
                  </div>
                  <div style={{
                    fontSize: '0.75rem', color: '#9ca3af',
                    display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
                  }}>
                    {track.bpm && <span>{track.bpm} BPM</span>}
                    {track.key && <span>{track.key}</span>}
                    {track.genre && <span>{track.genre}</span>}
                    <span style={{ color: '#3b82f6' }}>
                      Score: {track.score.toFixed(2)}
                    </span>
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  style={{ background: '#10b981', flexShrink: 0 }}
                  onClick={() => handleAccept(track)}
                  disabled={isAccepting || acceptingAll}
                >
                  {isAccepting ? '...' : 'Accept'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
