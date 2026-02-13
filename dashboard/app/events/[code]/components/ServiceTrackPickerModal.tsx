'use client';

import type { TidalSearchResult, BeatportSearchResult } from '@/lib/api-types';

type ServiceType = 'tidal' | 'beatport';

interface ServiceTrackPickerModalProps {
  service: ServiceType;
  requestId: number;
  searchQuery: string;
  tidalResults: TidalSearchResult[];
  beatportResults: BeatportSearchResult[];
  searching: boolean;
  linking: boolean;
  onSearchQueryChange: (query: string) => void;
  onSearch: () => void;
  onSelectTrack: (requestId: number, trackId: string) => void;
  onCancel: () => void;
}

const SERVICE_CONFIG = {
  tidal: { label: 'Tidal', color: '#0066ff', placeholder: 'Search Tidal...' },
  beatport: { label: 'Beatport', color: '#01ff28', placeholder: 'Search Beatport...' },
} as const;

export function ServiceTrackPickerModal({
  service,
  requestId,
  searchQuery,
  tidalResults,
  beatportResults,
  searching,
  linking,
  onSearchQueryChange,
  onSearch,
  onSelectTrack,
  onCancel,
}: ServiceTrackPickerModalProps) {
  const config = SERVICE_CONFIG[service];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={() => !linking && onCancel()}
    >
      <div
        className="card"
        style={{
          maxWidth: '500px',
          maxHeight: '80vh',
          margin: '1rem',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1rem' }}>Link {config.label} Track</h2>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            className="input"
            placeholder={config.placeholder}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            style={{ flex: 1 }}
          />
          <button
            className="btn btn-primary"
            onClick={onSearch}
            disabled={searching}
            style={{ background: config.color, color: service === 'beatport' ? '#000' : undefined }}
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {service === 'tidal' ? (
            <TidalResultsList
              results={tidalResults}
              searching={searching}
              linking={linking}
              requestId={requestId}
              onSelect={onSelectTrack}
            />
          ) : (
            <BeatportResultsList
              results={beatportResults}
              searching={searching}
              linking={linking}
              requestId={requestId}
              onSelect={onSelectTrack}
            />
          )}
        </div>
        <div style={{ marginTop: '1rem' }}>
          <button
            className="btn"
            style={{ background: '#333', width: '100%' }}
            onClick={onCancel}
            disabled={linking}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TidalResultsList({
  results,
  searching,
  linking,
  requestId,
  onSelect,
}: {
  results: TidalSearchResult[];
  searching: boolean;
  linking: boolean;
  requestId: number;
  onSelect: (requestId: number, trackId: string) => void;
}) {
  if (results.length === 0) {
    return (
      <p style={{ color: '#9ca3af', textAlign: 'center' }}>
        {searching ? 'Searching...' : 'Search for a track to link'}
      </p>
    );
  }

  return (
    <>
      {results.map((track) => (
        <div
          key={track.track_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem',
            borderBottom: '1px solid #333',
            cursor: 'pointer',
          }}
          onClick={() => onSelect(requestId, track.track_id)}
        >
          {track.cover_url ? (
            <img
              src={track.cover_url}
              alt={track.title}
              style={{ width: '48px', height: '48px', borderRadius: '4px' }}
            />
          ) : (
            <TrackPlaceholder label="T" />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{track.title}</div>
            <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{track.artist}</div>
            {track.album && (
              <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>{track.album}</div>
            )}
          </div>
          {linking && <span style={{ color: '#9ca3af' }}>...</span>}
        </div>
      ))}
    </>
  );
}

function BeatportResultsList({
  results,
  searching,
  linking,
  requestId,
  onSelect,
}: {
  results: BeatportSearchResult[];
  searching: boolean;
  linking: boolean;
  requestId: number;
  onSelect: (requestId: number, trackId: string) => void;
}) {
  if (results.length === 0) {
    return (
      <p style={{ color: '#9ca3af', textAlign: 'center' }}>
        {searching ? 'Searching...' : 'Search for a track to link'}
      </p>
    );
  }

  return (
    <>
      {results.map((track) => (
        <div
          key={track.track_id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem',
            borderBottom: '1px solid #333',
            cursor: 'pointer',
          }}
          onClick={() => onSelect(requestId, track.track_id)}
        >
          {track.cover_url ? (
            <img
              src={track.cover_url}
              alt={track.title}
              style={{ width: '48px', height: '48px', borderRadius: '4px' }}
            />
          ) : (
            <TrackPlaceholder label="B" />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>
              {track.title}
              {track.mix_name && (
                <span style={{ color: '#9ca3af', fontWeight: 400 }}> ({track.mix_name})</span>
              )}
            </div>
            <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{track.artist}</div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.125rem' }}>
              {track.label && (
                <span style={{ color: '#6b7280', fontSize: '0.7rem' }}>{track.label}</span>
              )}
              {track.bpm && (
                <span style={{ color: '#6b7280', fontSize: '0.7rem' }}>{track.bpm} BPM</span>
              )}
              {track.key && (
                <span style={{ color: '#6b7280', fontSize: '0.7rem' }}>{track.key}</span>
              )}
            </div>
          </div>
          {linking && <span style={{ color: '#9ca3af' }}>...</span>}
        </div>
      ))}
    </>
  );
}

function TrackPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        width: '48px',
        height: '48px',
        borderRadius: '4px',
        background: '#333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9ca3af',
      }}
    >
      <span style={{ fontSize: '1.5rem' }}>{label}</span>
    </div>
  );
}
