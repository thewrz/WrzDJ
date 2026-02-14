/**
 * Audio preview/embed framework for song cards.
 *
 * Provides source-specific embed URL builders for Spotify and Tidal,
 * with a consistent interface for the PreviewPlayer component.
 *
 * Beatport does not offer embeddable players — tracks from Beatport
 * can only link out to the external page.
 *
 * This module is the groundwork for issue #128.
 */

export type EmbeddableSource = 'spotify' | 'tidal';
export type PreviewSourceType = 'spotify' | 'tidal' | 'beatport';

export interface PreviewData {
  source: string;
  sourceUrl: string | null;
  previewUrl?: string | null; // Spotify 30s preview MP3
}

const SPOTIFY_TRACK_RE = /^https:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/;
const TIDAL_TRACK_RE = /^https:\/\/(?:tidal\.com\/browse\/track|listen\.tidal\.com\/track)\/(\d+)/;

/**
 * Convert a Spotify track URL to its embed iframe URL.
 * Returns null if the URL isn't a valid Spotify track link.
 */
export function getSpotifyEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(SPOTIFY_TRACK_RE);
  if (!match) return null;
  return `https://open.spotify.com/embed/track/${match[1]}`;
}

/**
 * Convert a Tidal track URL to its embed iframe URL.
 * Returns null if the URL isn't a valid Tidal track link.
 */
export function getTidalEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(TIDAL_TRACK_RE);
  if (!match) return null;
  return `https://embed.tidal.com/tracks/${match[1]}`;
}

/**
 * Determine the preview source type from request/search data.
 */
export function getPreviewSource(data: PreviewData): PreviewSourceType | null {
  const src = data.source.toLowerCase();
  if (src === 'spotify') return 'spotify';
  if (src === 'tidal') return 'tidal';
  if (src === 'beatport') return 'beatport';
  return null;
}

/**
 * Check if a track from the given source can be embedded as an audio preview.
 * Currently supports Spotify and Tidal iframe embeds.
 */
export function canEmbed(data: PreviewData): boolean {
  if (!data.sourceUrl) return false;
  const source = getPreviewSource(data);
  if (source === 'spotify') return SPOTIFY_TRACK_RE.test(data.sourceUrl);
  if (source === 'tidal') return TIDAL_TRACK_RE.test(data.sourceUrl);
  return false;
}

/**
 * Get the embed iframe URL for a track, regardless of source.
 * Returns null if the source doesn't support embedding.
 */
export function getEmbedUrl(data: PreviewData): string | null {
  const source = getPreviewSource(data);
  if (source === 'spotify') return getSpotifyEmbedUrl(data.sourceUrl);
  if (source === 'tidal') return getTidalEmbedUrl(data.sourceUrl);
  return null;
}
