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
    <div className="collection-fieldset">
      <label className="collection-fieldset-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        Enable pre-event voting
      </label>

      {enabled && (
        <div className="collection-fieldset-fields">
          <div className="form-group">
            <label htmlFor="collection-opens-at">Collection opens at</label>
            <input
              id="collection-opens-at"
              type="datetime-local"
              className="input"
              value={collectionOpensAt}
              onChange={(e) => onCollectionOpensAtChange(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="live-starts-at">Live starts at</label>
            <input
              id="live-starts-at"
              type="datetime-local"
              className="input"
              value={liveStartsAt}
              onChange={(e) => onLiveStartsAtChange(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="submission-cap">Submission cap per guest</label>
            <input
              id="submission-cap"
              type="number"
              min={0}
              max={100}
              className="input collection-fieldset-cap"
              value={submissionCap}
              onChange={(e) => onSubmissionCapChange(Number(e.target.value))}
            />
            <p className="collection-fieldset-hint">0 = unlimited picks per guest</p>
          </div>
          {error && <p className="collection-fieldset-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
