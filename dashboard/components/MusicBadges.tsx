'use client';

import { getCamelotColor } from '@/lib/camelot-colors';
import { getBpmColor } from '@/lib/bpm-color';

const BADGE_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.2rem 0.5rem',
  borderRadius: '0.25rem',
  fontSize: '0.8rem',
  fontWeight: 700,
  lineHeight: 1.4,
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  minHeight: '1.5rem',
};

export function KeyBadge({ musicalKey }: { musicalKey: string | null }) {
  if (!musicalKey) return null;

  const color = getCamelotColor(musicalKey);
  const displayText = color.camelotCode ?? musicalKey;

  return (
    <span
      aria-label={`Key: ${displayText}`}
      style={{
        ...BADGE_BASE,
        backgroundColor: color.bg,
        color: color.text,
      }}
    >
      {displayText}
    </span>
  );
}

export function BpmBadge({
  bpm,
  avgBpm,
  isOutlier,
}: {
  bpm: number | null;
  avgBpm?: number | null;
  isOutlier?: boolean;
}) {
  if (bpm == null) return null;

  const rounded = Math.round(bpm);
  const color = getBpmColor(bpm, avgBpm ?? null, isOutlier);

  return (
    <span
      aria-label={`BPM: ${rounded}`}
      style={{
        ...BADGE_BASE,
        backgroundColor: color.bg,
        color: color.text,
      }}
    >
      {rounded}
    </span>
  );
}

export function GenreBadge({ genre }: { genre: string | null }) {
  if (!genre) return null;

  return (
    <span
      aria-label={`Genre: ${genre}`}
      style={{
        ...BADGE_BASE,
        backgroundColor: '#1f2937',
        color: '#d1d5db',
      }}
    >
      {genre}
    </span>
  );
}
