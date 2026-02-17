/**
 * Computes visual emphasis for request items based on their status.
 * NEW requests get a prominent blue accent, ACCEPTED gets purple, PLAYING gets green.
 * This helps DJs instantly distinguish request states while scanning the queue.
 */

import type { CSSProperties } from 'react';

const EMPHASIS_MAP: Record<string, CSSProperties> = {
  new: { borderLeft: '4px solid #3b82f6', background: 'rgba(59, 130, 246, 0.05)' },
  accepted: { borderLeft: '4px solid #8b5cf6' },
  playing: { borderLeft: '4px solid #22c55e' },
};

const CLASS_MAP: Record<string, string> = {
  new: 'request-new',
  accepted: 'request-accepted',
  playing: 'request-playing',
};

export function getRequestEmphasisStyle(status: string): CSSProperties {
  return { ...(EMPHASIS_MAP[status] ?? {}) };
}

export function getRequestEmphasisClass(status: string): string {
  return CLASS_MAP[status] ?? '';
}
