'use client';

import { PlayHistoryItem } from '@/lib/api';

const MusicIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M20 4v8.5a3.5 3.5 0 1 1-2-3.163V6l-9 1.5v9a3.5 3.5 0 1 1-2-3.163V5l13-1Z" />
  </svg>
);

interface PlayHistorySectionProps {
  items: PlayHistoryItem[];
  total: number;
  exporting: boolean;
  onExport: () => void;
}

export function PlayHistorySection({ items, total, exporting, onExport }: PlayHistorySectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
          Play History
          <span style={{ color: '#9ca3af', fontWeight: 'normal', marginLeft: '0.5rem' }}>
            ({total} {total === 1 ? 'track' : 'tracks'})
          </span>
        </h2>
        <button
          className="btn btn-sm"
          style={{ background: '#8b5cf6', padding: '0.25rem 0.75rem' }}
          onClick={onExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : 'Export Play History'}
        </button>
      </div>
      <div className="request-list">
        {items.map((item) => (
          <div key={item.id} className="request-item" style={{ padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 }}>
              {item.album_art_url ? (
                <img
                  src={item.album_art_url}
                  alt={item.title}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '4px',
                    objectFit: 'cover',
                  }}
                />
              ) : (
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
                  <MusicIcon />
                </div>
              )}
              <div className="request-info" style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>{item.title}</h3>
                <p style={{ margin: '0.25rem 0 0', color: '#9ca3af' }}>{item.artist}</p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                  {new Date(item.started_at).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                className="badge"
                style={{
                  background: item.source === 'stagelinq' ? '#8b5cf6' : '#3b82f6',
                  color: '#fff',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                }}
              >
                {item.source === 'stagelinq' ? 'Live' : 'Manual'}
              </span>
              {item.matched_request_id && (
                <span
                  className="badge"
                  style={{
                    background: '#10b981',
                    color: '#fff',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.75rem',
                  }}
                >
                  Requested
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
