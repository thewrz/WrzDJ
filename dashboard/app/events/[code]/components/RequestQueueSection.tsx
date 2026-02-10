'use client';

import { useMemo, useState } from 'react';
import { SongRequest } from '@/lib/api';
import { StatusFilter } from './types';

interface RequestQueueSectionProps {
  requests: SongRequest[];
  isExpiredOrArchived: boolean;
  tidalSyncEnabled: boolean;
  updating: number | null;
  acceptingAll: boolean;
  syncingRequest: number | null;
  onUpdateStatus: (requestId: number, status: string) => void;
  onAcceptAll: () => void;
  onSyncToTidal: (requestId: number) => void;
  onOpenTidalPicker: (requestId: number) => void;
}

export function RequestQueueSection({
  requests,
  isExpiredOrArchived,
  tidalSyncEnabled,
  updating,
  acceptingAll,
  syncingRequest,
  onUpdateStatus,
  onAcceptAll,
  onSyncToTidal,
  onOpenTidalPicker,
}: RequestQueueSectionProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');

  const statusCounts = useMemo(
    () => ({
      all: requests.length,
      new: requests.filter((r) => r.status === 'new').length,
      accepted: requests.filter((r) => r.status === 'accepted').length,
      playing: requests.filter((r) => r.status === 'playing').length,
      rejected: requests.filter((r) => r.status === 'rejected').length,
    }),
    [requests]
  );

  const filteredRequests = useMemo(
    () => requests.filter((r) => (filter === 'all' ? true : r.status === filter)),
    [requests, filter]
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['all', 'new', 'accepted', 'playing', 'rejected'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              className={`tab ${filter === status ? 'active' : ''}`}
              onClick={() => setFilter(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
            </button>
          ))}
        </div>
        {!isExpiredOrArchived && statusCounts.new > 0 && (
          <button
            className="btn btn-success btn-sm"
            onClick={onAcceptAll}
            disabled={acceptingAll}
            style={{ marginLeft: 'auto' }}
          >
            {acceptingAll ? 'Accepting...' : `Accept All (${statusCounts.new})`}
          </button>
        )}
      </div>

      {filteredRequests.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: '#9ca3af' }}>
            {filter === 'all'
              ? 'No requests yet. Share the QR code with your guests!'
              : `No ${filter} requests.`}
          </p>
        </div>
      ) : (
        <div className="request-list scrollable-list" style={{ marginBottom: '1rem' }}>
          {filteredRequests.map((request) => (
            <div key={request.id} className="request-item">
              <div className="request-info">
                <h3>
                  {request.song_title}
                  {request.source_url && (
                    <a
                      href={request.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}
                    >
                      ↗
                    </a>
                  )}
                </h3>
                <p>{request.artist}</p>
                {request.note && <div className="note">{request.note}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', margin: 0 }}>
                    {new Date(request.created_at).toLocaleTimeString()}
                  </p>
                  {request.vote_count > 0 && (
                    <span
                      style={{
                        background: request.vote_count >= 5 ? '#f59e0b' : '#3b82f6',
                        color: '#fff',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '1rem',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                      }}
                    >
                      {request.vote_count} {request.vote_count === 1 ? 'vote' : 'votes'}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {/* Tidal Sync Status */}
                {tidalSyncEnabled && request.status === 'accepted' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {request.tidal_sync_status === 'synced' && (
                      <span
                        title="Synced to Tidal"
                        style={{ color: '#10b981', fontSize: '1rem', cursor: 'default' }}
                      >
                        T
                      </span>
                    )}
                    {request.tidal_sync_status === 'pending' && (
                      <span title="Syncing..." style={{ color: '#f59e0b', fontSize: '0.875rem' }}>
                        ...
                      </span>
                    )}
                    {request.tidal_sync_status === 'not_found' && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#f59e0b', padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                        onClick={() => onOpenTidalPicker(request.id)}
                        title="Track not found - click to link manually"
                      >
                        Link
                      </button>
                    )}
                    {request.tidal_sync_status === 'error' && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#ef4444', padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                        onClick={() => onSyncToTidal(request.id)}
                        disabled={syncingRequest === request.id}
                        title="Sync failed - click to retry"
                      >
                        {syncingRequest === request.id ? '...' : 'Retry'}
                      </button>
                    )}
                    {!request.tidal_sync_status && (
                      <button
                        className="btn btn-sm"
                        style={{ background: '#0066ff', padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                        onClick={() => onSyncToTidal(request.id)}
                        disabled={syncingRequest === request.id}
                        title="Sync to Tidal"
                      >
                        {syncingRequest === request.id ? '...' : 'Sync'}
                      </button>
                    )}
                  </div>
                )}
                <span className={`badge badge-${request.status}`}>{request.status}</span>
                {!isExpiredOrArchived && (
                  <div className="request-actions">
                    {request.status === 'new' && (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'accepted')}
                          disabled={updating === request.id}
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'rejected')}
                          disabled={updating === request.id}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {request.status === 'accepted' && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'playing')}
                          disabled={updating === request.id}
                        >
                          Playing
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'rejected')}
                          disabled={updating === request.id}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {request.status === 'playing' && (
                      <button
                        className="btn btn-warning btn-sm"
                        onClick={() => onUpdateStatus(request.id, 'played')}
                        disabled={updating === request.id}
                      >
                        Played
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
