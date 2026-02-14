'use client';

import { useMemo, useState } from 'react';
import { SongRequest } from '@/lib/api';
import { StatusFilter } from './types';
import { SyncStatusBadges } from './SyncStatusBadges';
import { KeyBadge, BpmBadge, GenreBadge } from '@/components/MusicBadges';
import { computeBpmContext } from '@/lib/bpm-stats';

interface RequestQueueSectionProps {
  requests: SongRequest[];
  isExpiredOrArchived: boolean;
  connectedServices: string[];
  updating: number | null;
  acceptingAll: boolean;
  syncingRequest: number | null;
  onUpdateStatus: (requestId: number, status: string) => void;
  onAcceptAll: () => void;
  onSyncToTidal: (requestId: number) => void;
  onOpenTidalPicker: (requestId: number) => void;
  onScrollToSyncReport?: (requestId: number) => void;
  onDeleteRequest?: (requestId: number) => Promise<void>;
  onRefreshMetadata?: (requestId: number) => Promise<void>;
  deletingRequest?: number | null;
  refreshingRequest?: number | null;
}

export function RequestQueueSection({
  requests,
  isExpiredOrArchived,
  connectedServices,
  updating,
  acceptingAll,
  syncingRequest,
  onUpdateStatus,
  onAcceptAll,
  onSyncToTidal,
  onOpenTidalPicker,
  onScrollToSyncReport,
  onDeleteRequest,
  onRefreshMetadata,
  deletingRequest,
  refreshingRequest,
}: RequestQueueSectionProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [advancedMode, setAdvancedMode] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);

  const statusCounts = useMemo(() => {
    const counts = { all: requests.length, new: 0, accepted: 0, playing: 0, played: 0, rejected: 0 };
    for (const r of requests) {
      const s = r.status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    return counts;
  }, [requests]);

  // Compute BPM context from the DJ's active set (accepted + playing)
  // so badges show proximity relative to the current musical direction
  const bpmContext = useMemo(() => {
    const activeBpms = requests
      .filter((r) => r.status === 'accepted' || r.status === 'playing')
      .map((r) => r.bpm)
      .filter((b): b is number => b != null);
    return computeBpmContext(activeBpms);
  }, [requests]);

  const filteredRequests = useMemo(
    () => requests.filter((r) => (filter === 'all' ? true : r.status === filter)),
    [requests, filter]
  );

  const handleDeleteAll = async () => {
    const count = filteredRequests.length;
    if (count === 0) return;
    if (!window.confirm(`Delete all ${count} ${filter === 'all' ? '' : filter + ' '}request${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setDeletingAll(true);
    try {
      const ids = filteredRequests.map((r) => r.id);
      for (const id of ids) {
        await onDeleteRequest?.(id);
      }
    } finally {
      setDeletingAll(false);
    }
  };

  const handleRefreshAll = async () => {
    if (filteredRequests.length === 0) return;
    setRefreshingAll(true);
    try {
      const ids = filteredRequests.map((r) => r.id);
      for (const id of ids) {
        await onRefreshMetadata?.(id);
      }
    } finally {
      setRefreshingAll(false);
    }
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['all', 'new', 'accepted', 'playing', 'played', 'rejected'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              className={`tab ${filter === status ? 'active' : ''}`}
              onClick={() => setFilter(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
            </button>
          ))}
        </div>
        {!isExpiredOrArchived && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginLeft: 'auto' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: '#9ca3af', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={advancedMode}
                onChange={(e) => setAdvancedMode(e.target.checked)}
                style={{ accentColor: '#3b82f6' }}
              />
              Advanced
            </label>
            {statusCounts.new > 0 && (
              <button
                className="btn btn-success btn-sm"
                onClick={onAcceptAll}
                disabled={acceptingAll}
              >
                {acceptingAll ? 'Accepting...' : `Accept All (${statusCounts.new})`}
              </button>
            )}
            {advancedMode && (
              <>
                <button
                  className="btn btn-sm"
                  style={{ background: '#374151', fontSize: '0.7rem' }}
                  onClick={handleRefreshAll}
                  disabled={refreshingAll || filteredRequests.length === 0}
                >
                  {refreshingAll ? 'Refreshing...' : 'Refresh All'}
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: '#991b1b', fontSize: '0.7rem' }}
                  onClick={handleDeleteAll}
                  disabled={deletingAll || filteredRequests.length === 0}
                >
                  {deletingAll ? 'Deleting...' : 'Delete All'}
                </button>
              </>
            )}
          </div>
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
            <div key={request.id} id={`request-${request.id}`} className="request-item">
              <div className="request-info">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
                  <h3 style={{ margin: 0 }}>
                    {request.song_title}
                  </h3>
                  {request.source_url && (
                    <a
                      href={request.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '0.75rem', flexShrink: 0 }}
                    >
                      ↗
                    </a>
                  )}
                </div>
                <p>{request.artist}</p>
                {(request.bpm || request.musical_key || request.genre) && (
                  <div style={{
                    display: 'flex', gap: '0.375rem', marginTop: '0.25rem',
                    flexWrap: 'wrap', alignItems: 'center',
                  }}>
                    <BpmBadge
                      bpm={request.bpm}
                      avgBpm={bpmContext.average}
                      isOutlier={request.bpm != null ? bpmContext.isOutlier(request.bpm) : false}
                    />
                    <KeyBadge musicalKey={request.musical_key} />
                    <GenreBadge genre={request.genre} />
                  </div>
                )}
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
                <SyncStatusBadges
                  request={request}
                  connectedServices={connectedServices}
                  syncingRequest={syncingRequest}
                  onSyncToTidal={onSyncToTidal}
                  onOpenTidalPicker={onOpenTidalPicker}
                  onScrollToSyncReport={onScrollToSyncReport}
                />
                <span className={`badge badge-${request.status}`}>{request.status}</span>
                {!isExpiredOrArchived && (
                  <div className="request-actions">
                    {request.status === 'new' && (
                      <>
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'accepted')}
                          disabled={updating !== null}
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'rejected')}
                          disabled={updating !== null}
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
                          disabled={updating !== null}
                        >
                          Playing
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onUpdateStatus(request.id, 'rejected')}
                          disabled={updating !== null}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {request.status === 'playing' && (
                      <button
                        className="btn btn-warning btn-sm"
                        onClick={() => onUpdateStatus(request.id, 'played')}
                        disabled={updating !== null}
                      >
                        Played
                      </button>
                    )}
                    {advancedMode && (
                      <>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#374151', fontSize: '0.7rem' }}
                          onClick={() => onRefreshMetadata?.(request.id)}
                          disabled={refreshingRequest === request.id}
                          title="Re-fetch BPM, key, and genre from external services"
                        >
                          {refreshingRequest === request.id ? '...' : 'Refresh'}
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#991b1b', fontSize: '0.7rem' }}
                          onClick={() => {
                            if (window.confirm(`Delete "${request.song_title}" by ${request.artist}?`)) {
                              onDeleteRequest?.(request.id);
                            }
                          }}
                          disabled={deletingRequest === request.id}
                        >
                          {deletingRequest === request.id ? '...' : 'Delete'}
                        </button>
                      </>
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
