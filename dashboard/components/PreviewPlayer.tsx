'use client';

import { canEmbed, getEmbedUrl, type PreviewData } from '@/lib/preview-embed';

/**
 * Embeddable audio preview player for song cards.
 *
 * Renders a source-specific iframe embed (Spotify or Tidal) when available.
 * Falls back to nothing if the source doesn't support embedding.
 *
 * This is the framework stub for issue #128 — the full implementation will
 * add expand/collapse behavior, loading states, and Beatport fallback.
 */
export function PreviewPlayer({ data }: { data: PreviewData }) {
  if (!canEmbed(data)) return null;

  const embedUrl = getEmbedUrl(data);
  if (!embedUrl) return null;

  return (
    <div
      style={{
        width: '100%',
        borderRadius: '0.5rem',
        overflow: 'hidden',
        marginTop: '0.5rem',
      }}
    >
      <iframe
        src={embedUrl}
        width="100%"
        height="80"
        frameBorder="0"
        allow="encrypted-media"
        loading="lazy"
        title="Audio preview"
        style={{
          borderRadius: '0.5rem',
          border: 'none',
        }}
      />
    </div>
  );
}
