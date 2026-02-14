import { describe, it, expect } from 'vitest';
import {
  getSpotifyEmbedUrl,
  getTidalEmbedUrl,
  getPreviewSource,
  canEmbed,
  type PreviewData,
} from '../preview-embed';

describe('getSpotifyEmbedUrl', () => {
  it('converts a Spotify track URL to embed URL', () => {
    const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh';
    expect(getSpotifyEmbedUrl(url)).toBe(
      'https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh'
    );
  });

  it('converts a Spotify URL with query params', () => {
    const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc123';
    expect(getSpotifyEmbedUrl(url)).toBe(
      'https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh'
    );
  });

  it('returns null for non-Spotify URLs', () => {
    expect(getSpotifyEmbedUrl('https://tidal.com/track/12345')).toBeNull();
    expect(getSpotifyEmbedUrl(null)).toBeNull();
  });

  it('returns null for invalid Spotify URLs', () => {
    expect(getSpotifyEmbedUrl('https://open.spotify.com/album/abc')).toBeNull();
    expect(getSpotifyEmbedUrl('https://open.spotify.com/artist/abc')).toBeNull();
  });
});

describe('getTidalEmbedUrl', () => {
  it('converts a Tidal track URL to embed URL', () => {
    const url = 'https://tidal.com/browse/track/12345678';
    expect(getTidalEmbedUrl(url)).toBe(
      'https://embed.tidal.com/tracks/12345678'
    );
  });

  it('handles listen.tidal.com URLs', () => {
    const url = 'https://listen.tidal.com/track/12345678';
    expect(getTidalEmbedUrl(url)).toBe(
      'https://embed.tidal.com/tracks/12345678'
    );
  });

  it('returns null for non-Tidal URLs', () => {
    expect(getTidalEmbedUrl('https://open.spotify.com/track/abc')).toBeNull();
    expect(getTidalEmbedUrl(null)).toBeNull();
  });
});

describe('getPreviewSource', () => {
  it('identifies Spotify source from source field', () => {
    const data: PreviewData = { source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' };
    expect(getPreviewSource(data)).toBe('spotify');
  });

  it('identifies Tidal source from source field', () => {
    const data: PreviewData = { source: 'tidal', sourceUrl: 'https://tidal.com/browse/track/123' };
    expect(getPreviewSource(data)).toBe('tidal');
  });

  it('identifies Beatport source from source field', () => {
    const data: PreviewData = { source: 'beatport', sourceUrl: 'https://beatport.com/track/abc/123' };
    expect(getPreviewSource(data)).toBe('beatport');
  });

  it('returns null for unknown sources', () => {
    const data: PreviewData = { source: 'shazam', sourceUrl: null };
    expect(getPreviewSource(data)).toBeNull();
  });
});

describe('canEmbed', () => {
  it('returns true for Spotify tracks', () => {
    expect(canEmbed({ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' })).toBe(true);
  });

  it('returns true for Tidal tracks', () => {
    expect(canEmbed({ source: 'tidal', sourceUrl: 'https://tidal.com/browse/track/123' })).toBe(true);
  });

  it('returns false for Beatport (no embed support)', () => {
    expect(canEmbed({ source: 'beatport', sourceUrl: 'https://beatport.com/track/abc/123' })).toBe(false);
  });

  it('returns false when sourceUrl is null', () => {
    expect(canEmbed({ source: 'spotify', sourceUrl: null })).toBe(false);
  });
});
