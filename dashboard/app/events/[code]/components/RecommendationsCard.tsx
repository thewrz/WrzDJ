'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { RecommendedTrack, EventMusicProfile, RecommendationResponse } from '@/lib/api-types';

interface RecommendationsCardProps {
  code: string;
  hasAcceptedRequests: boolean;
  hasConnectedServices: boolean;
  onAcceptTrack: (track: RecommendedTrack) => Promise<void>;
}

export function RecommendationsCard({
  code,
  hasAcceptedRequests,
  hasConnectedServices,
  onAcceptTrack,
}: RecommendationsCardProps) {
  const [suggestions, setSuggestions] = useState<RecommendedTrack[]>([]);
  const [profile, setProfile] = useState<EventMusicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result: RecommendationResponse = await api.generateRecommendations(code);
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

  const canGenerate = hasAcceptedRequests && hasConnectedServices && !loading;

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
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

      {!hasConnectedServices && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
          Link Tidal or Beatport to get song suggestions.
        </p>
      )}

      {hasConnectedServices && !hasAcceptedRequests && suggestions.length === 0 && (
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
        <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {profile.avg_bpm && <span>~{Math.round(profile.avg_bpm)} BPM</span>}
          {profile.dominant_keys.length > 0 && <span>{profile.dominant_keys.join(', ')}</span>}
          {profile.dominant_genres.length > 0 && <span>{profile.dominant_genres.join(', ')}</span>}
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
                }}
              >
                {track.cover_url && (
                  <img
                    src={track.cover_url}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: '0.25rem', objectFit: 'cover' }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {track.artist} &mdash; {track.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {track.bpm && <span>{track.bpm} BPM</span>}
                    {track.key && <span>{track.key}</span>}
                    {track.genre && <span>{track.genre}</span>}
                    <span style={{ color: '#3b82f6' }}>Score: {track.score.toFixed(2)}</span>
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
