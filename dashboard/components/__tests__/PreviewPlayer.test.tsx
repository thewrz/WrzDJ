import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PreviewPlayer } from '../PreviewPlayer';

describe('PreviewPlayer', () => {
  describe('rendering rules', () => {
    it('renders nothing when sourceUrl is null', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: null }} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing for unknown/unsupported sources', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'shazam', sourceUrl: 'https://shazam.com/track/123' }} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing for manual source', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'manual', sourceUrl: null }} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders a toggle button for Spotify source', () => {
      render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      expect(screen.getByRole('button')).toBeDefined();
    });

    it('renders a toggle button for Tidal source', () => {
      render(
        <PreviewPlayer data={{ source: 'tidal', sourceUrl: 'https://tidal.com/browse/track/123' }} />
      );
      expect(screen.getByRole('button')).toBeDefined();
    });

    it('renders a link for Beatport source (no toggle)', () => {
      render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: 'https://beatport.com/track/x/1' }} />
      );
      const link = screen.getByRole('link');
      expect(link).toBeDefined();
      // Should not have a toggle button
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('toggle behavior (Spotify/Tidal)', () => {
    it('starts collapsed — no iframe in DOM', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('click toggle → iframe appears', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      expect(container.querySelector('iframe')).not.toBeNull();
    });

    it('click toggle again → iframe removed from DOM', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      const button = screen.getByRole('button');
      fireEvent.click(button); // expand
      fireEvent.click(button); // collapse
      expect(container.querySelector('iframe')).toBeNull();
    });

    it('button aria-label updates to reflect expanded state', () => {
      render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('iframe correctness', () => {
    it('Spotify iframe has correct embed src', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc123' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('src')).toBe('https://open.spotify.com/embed/track/abc123');
    });

    it('Tidal iframe has correct embed src', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'tidal', sourceUrl: 'https://tidal.com/browse/track/456789' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('src')).toBe('https://embed.tidal.com/tracks/456789');
    });

    it('iframe has title attribute for accessibility', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('title')).toBeTruthy();
    });

    it('iframe has allow="encrypted-media"', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('allow')).toContain('encrypted-media');
    });

    it('iframe has loading="lazy"', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('loading')).toBe('lazy');
    });

    it('iframe has sandbox for defense-in-depth', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      const sandbox = iframe?.getAttribute('sandbox') ?? '';
      expect(sandbox).toContain('allow-scripts');
      expect(sandbox).toContain('allow-same-origin');
    });
  });

  describe('Beatport fallback', () => {
    it('renders an <a> element with the source URL', () => {
      render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: 'https://beatport.com/track/x/1' }} />
      );
      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('https://beatport.com/track/x/1');
    });

    it('opens in new tab with security attrs', () => {
      render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: 'https://beatport.com/track/x/1' }} />
      );
      const link = screen.getByRole('link');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    });

    it('renders nothing for Beatport with null sourceUrl', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: null }} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing for Beatport with non-http sourceUrl', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: 'javascript:alert(1)' }} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('link text includes Beatport label', () => {
      render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: 'https://beatport.com/track/x/1' }} />
      );
      const link = screen.getByRole('link');
      expect(link.textContent).toContain('Beatport');
    });

    it('link has aria-label for screen readers', () => {
      render(
        <PreviewPlayer data={{ source: 'beatport', sourceUrl: 'https://beatport.com/track/x/1' }} />
      );
      const link = screen.getByRole('link');
      expect(link.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('toggle button has aria-label', () => {
      render(
        <PreviewPlayer data={{ source: 'spotify', sourceUrl: 'https://open.spotify.com/track/abc' }} />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toBeTruthy();
    });

    it('iframe has descriptive title', () => {
      const { container } = render(
        <PreviewPlayer data={{ source: 'tidal', sourceUrl: 'https://tidal.com/browse/track/123' }} />
      );
      fireEvent.click(screen.getByRole('button'));
      const iframe = container.querySelector('iframe');
      expect(iframe?.getAttribute('title')).toMatch(/preview/i);
    });
  });
});
