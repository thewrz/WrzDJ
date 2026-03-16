'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MyRequestInfo } from '@/lib/api-types';
import { api } from '@/lib/api';

interface MyRequestsTrackerProps {
  eventCode: string;
  /** Incrementing counter — triggers a re-fetch when bumped */
  refreshKey: number;
  /** Called with all loaded my-request IDs so parent can track them */
  onRequestIdsLoaded: (ids: Set<number>) => void;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  new: { label: 'Pending', className: 'my-req-badge-pending' },
  accepted: { label: 'Accepted', className: 'my-req-badge-accepted' },
  playing: { label: 'Playing', className: 'my-req-badge-playing' },
  played: { label: 'Played', className: 'my-req-badge-played' },
  rejected: { label: 'Declined', className: 'my-req-badge-rejected' },
};

export default function MyRequestsTracker({
  eventCode,
  refreshKey,
  onRequestIdsLoaded,
}: MyRequestsTrackerProps) {
  const [myRequests, setMyRequests] = useState<MyRequestInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const loadMyRequests = useCallback(async () => {
    try {
      const data = await api.getMyRequests(eventCode);
      setMyRequests(data.requests);
      onRequestIdsLoaded(new Set(data.requests.map((r) => r.id)));
    } catch {
      // Silently fail — tracker is a nice-to-have
    } finally {
      setLoading(false);
    }
  }, [eventCode, onRequestIdsLoaded]);

  useEffect(() => {
    loadMyRequests();
  }, [loadMyRequests]);

  // Re-fetch when parent signals a change (new submission or SSE status change)
  useEffect(() => {
    if (refreshKey > 0) {
      loadMyRequests();
    }
  }, [refreshKey, loadMyRequests]);

  if (loading || myRequests.length === 0) return null;

  return (
    <div className="my-requests-tracker">
      <button
        className="my-requests-header"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span className="my-requests-title">
          My Requests ({myRequests.length})
        </span>
        <span className={`my-requests-chevron ${collapsed ? 'collapsed' : ''}`}>
          &#9660;
        </span>
      </button>

      {!collapsed && (
        <div className="my-requests-list">
          {myRequests.map((req) => {
            const config = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.new;
            return (
              <div key={req.id} className="my-request-item">
                {req.artwork_url ? (
                  <img
                    src={req.artwork_url}
                    alt=""
                    className="guest-request-item-art"
                  />
                ) : (
                  <div
                    className="guest-request-item-art"
                    style={{
                      background: '#333',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: '1.25rem', color: '#666' }}>&#9835;</span>
                  </div>
                )}
                <div className="guest-request-item-info">
                  <div className="guest-request-item-title">{req.title}</div>
                  <div className="guest-request-item-artist">{req.artist}</div>
                </div>
                <span className={`badge ${config.className}`}>
                  {config.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
