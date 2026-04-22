'use client';

import { z } from 'zod';

export const collectionSchema = z
  .object({
    collection_opens_at: z.string().optional(),
    live_starts_at: z.string().optional(),
    submission_cap_per_guest: z.number().int().min(0).max(100).optional(),
  })
  .refine(
    (v) => {
      if (v.collection_opens_at && v.live_starts_at) {
        return new Date(v.collection_opens_at) < new Date(v.live_starts_at);
      }
      return true;
    },
    { message: 'Collection opens must be before live starts' },
  );

export interface CollectionFieldsetProps {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  collectionOpensAt: string;
  onCollectionOpensAtChange: (next: string) => void;
  liveStartsAt: string;
  onLiveStartsAtChange: (next: string) => void;
  submissionCap: number;
  onSubmissionCapChange: (next: number) => void;
  error?: string | null;
}

export function CollectionFieldset(props: CollectionFieldsetProps) {
  const {
    enabled,
    onEnabledChange,
    collectionOpensAt,
    onCollectionOpensAtChange,
    liveStartsAt,
    onLiveStartsAtChange,
    submissionCap,
    onSubmissionCapChange,
    error,
  } = props;

  return (
    <div style={{ borderTop: '1px solid #333', paddingTop: '0.75rem', marginBottom: '1rem' }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          style={{ accentColor: '#3b82f6' }}
        />
        Enable pre-event voting
      </label>

      {enabled && (
        <div
          style={{
            marginTop: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div className="form-group">
            <label htmlFor="collection-opens-at" style={{ fontSize: '0.875rem' }}>
              Collection opens at
            </label>
            <input
              id="collection-opens-at"
              type="datetime-local"
              className="input"
              value={collectionOpensAt}
              onChange={(e) => onCollectionOpensAtChange(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="live-starts-at" style={{ fontSize: '0.875rem' }}>
              Live starts at
            </label>
            <input
              id="live-starts-at"
              type="datetime-local"
              className="input"
              value={liveStartsAt}
              onChange={(e) => onLiveStartsAtChange(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="submission-cap" style={{ fontSize: '0.875rem' }}>
              Submission cap per guest
            </label>
            <input
              id="submission-cap"
              type="number"
              min={0}
              max={100}
              className="input"
              value={submissionCap}
              onChange={(e) => onSubmissionCapChange(Number(e.target.value))}
              style={{ width: '6rem' }}
            />
            <p style={{ color: '#9ca3af', fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
              0 = unlimited picks per guest
            </p>
          </div>
          {error && <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
