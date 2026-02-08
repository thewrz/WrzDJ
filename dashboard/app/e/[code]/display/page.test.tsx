import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import KioskDisplayPage from './page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ code: 'TEST123' }),
}));

// Mock qrcode.react
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value}>QR Code</div>
  ),
}));

// Mock API responses
const mockKioskDisplay = {
  event: { code: 'TEST123', name: 'Test Event' },
  qr_join_url: 'https://example.com/join/TEST123',
  accepted_queue: [
    { id: 1, title: 'Song 1', artist: 'Artist 1', artwork_url: null, vote_count: 0 },
    { id: 2, title: 'Song 2', artist: 'Artist 2', artwork_url: null, vote_count: 0 },
  ],
  now_playing: null,
  now_playing_hidden: false,
  updated_at: new Date().toISOString(),
  banner_url: null,
  banner_kiosk_url: null,
  banner_colors: null,
};

const mockNowPlaying = {
  title: 'Currently Playing Song',
  artist: 'Current Artist',
  album: 'Current Album',
  album_art_url: 'https://example.com/art.jpg',
  spotify_uri: null,
  started_at: new Date().toISOString(),
  source: 'stagelinq',
  matched_request_id: null,
  bridge_connected: true,
};

const mockPlayHistory = {
  items: [
    { id: 1, title: 'History Song 1', artist: 'History Artist 1', album: null, album_art_url: null, spotify_uri: null, matched_request_id: null, source: 'stagelinq', started_at: new Date().toISOString(), ended_at: null, play_order: 1 },
    { id: 2, title: 'History Song 2', artist: 'History Artist 2', album: null, album_art_url: null, spotify_uri: null, matched_request_id: 1, source: 'stagelinq', started_at: new Date().toISOString(), ended_at: null, play_order: 2 },
  ],
  total: 2,
};

// Mock API module
vi.mock('@/lib/api', () => ({
  api: {
    getKioskDisplay: vi.fn(),
    getNowPlaying: vi.fn(),
    getPlayHistory: vi.fn(),
    search: vi.fn(),
    submitRequest: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { api } from '@/lib/api';

describe('KioskDisplayPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Three-column layout', () => {
    it('renders 3 columns when now-playing exists', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      // Wait for loading to finish
      await screen.findByText('Test Event');

      // All three sections should be present
      expect(screen.getByText('Now Playing')).toBeInTheDocument();
      expect(screen.getByText('Accepted Requests')).toBeInTheDocument();
      expect(screen.getByText('Recently Played')).toBeInTheDocument();

      // Now playing content should show
      expect(screen.getByText('Currently Playing Song')).toBeInTheDocument();
      expect(screen.getByText('Current Artist')).toBeInTheDocument();
    });

    it('renders 2 columns when no now-playing (queue + history only)', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(null);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      // Now Playing section should NOT be present
      expect(screen.queryByText('Now Playing')).not.toBeInTheDocument();

      // Queue and history should still be present
      expect(screen.getByText('Accepted Requests')).toBeInTheDocument();
      expect(screen.getByText('Recently Played')).toBeInTheDocument();
    });

    it('shows history section as a separate column, not nested in queue', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      // Find the sections by their labels
      const queueLabel = screen.getByText('Accepted Requests');
      const historyLabel = screen.getByText('Recently Played');

      // Get their parent section elements
      const queueSection = queueLabel.closest('.queue-section');
      const historySection = historyLabel.closest('.history-section');

      // History section should NOT be inside queue section
      expect(queueSection).not.toContainElement(historySection as HTMLElement);

      // Both should be direct children of kiosk-main
      expect(queueSection?.parentElement?.classList.contains('kiosk-main')).toBe(true);
      expect(historySection?.parentElement?.classList.contains('kiosk-main')).toBe(true);
    });

    it('displays accepted requests in the queue section', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      // Queue items should be displayed
      expect(screen.getByText('Song 1')).toBeInTheDocument();
      expect(screen.getByText('Artist 1')).toBeInTheDocument();
      expect(screen.getByText('Song 2')).toBeInTheDocument();
      expect(screen.getByText('Artist 2')).toBeInTheDocument();
    });

    it('displays play history in the history section', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      // History items should be displayed
      expect(screen.getByText('History Song 1')).toBeInTheDocument();
      expect(screen.getByText('History Artist 1')).toBeInTheDocument();
      expect(screen.getByText('History Song 2')).toBeInTheDocument();
    });

    it('shows "Requested" badge for history items that were requests', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      // One history item has matched_request_id, should show badge
      expect(screen.getByText('Requested')).toBeInTheDocument();
    });
  });

  describe('Empty states', () => {
    it('shows empty queue message when no accepted requests', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue({
        ...mockKioskDisplay,
        accepted_queue: [],
      });
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue(mockPlayHistory);

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      expect(screen.getByText('No songs in queue.')).toBeInTheDocument();
    });

    it('still shows history section when history is empty', async () => {
      vi.mocked(api.getKioskDisplay).mockResolvedValue(mockKioskDisplay);
      vi.mocked(api.getNowPlaying).mockResolvedValue(mockNowPlaying);
      vi.mocked(api.getPlayHistory).mockResolvedValue({ items: [], total: 0 });

      render(<KioskDisplayPage />);

      await screen.findByText('Test Event');

      // History section should still be present (for 3-column layout consistency)
      expect(screen.getByText('Recently Played')).toBeInTheDocument();
    });
  });
});
