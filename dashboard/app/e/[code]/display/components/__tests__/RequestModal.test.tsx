import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RequestModal } from '../RequestModal';

vi.mock('simple-keyboard', () => ({
  default: class MockKeyboard {
    setOptions = vi.fn();
    setInput = vi.fn();
    destroy = vi.fn();
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    search: vi.fn(),
    submitRequest: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { api, ApiError } from '@/lib/api';

const mockOnClose = vi.fn();
const mockOnRequestsClosed = vi.fn();

function renderModal() {
  return render(
    <RequestModal
      code="TEST01"
      onClose={mockOnClose}
      onRequestsClosed={mockOnRequestsClosed}
    />
  );
}

const mockResults = [
  {
    title: 'Strobe', artist: 'deadmau5', spotify_id: 'sp1',
    url: 'https://open.spotify.com/track/1', album_art: 'https://example.com/art.jpg',
    album: 'For Lack of a Better Name', popularity: 80, preview_url: null,
    source: 'spotify' as const, genre: null, bpm: null, key: null,
  },
  {
    title: 'Levels', artist: 'Avicii', spotify_id: 'sp2',
    url: null, album_art: null,
    album: null, popularity: 90, preview_url: null,
    source: 'spotify' as const, genre: null, bpm: null, key: null,
  },
];

describe('RequestModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders search form initially', () => {
    renderModal();
    expect(screen.getByText('Request a Song')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search for a song...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('does not search with empty query', async () => {
    renderModal();
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });
    expect(api.search).not.toHaveBeenCalled();
  });

  it('searches and displays results', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    expect(api.search).toHaveBeenCalledWith('strobe');
    expect(screen.getByText('Strobe')).toBeInTheDocument();
    expect(screen.getByText('deadmau5')).toBeInTheDocument();
    expect(screen.getByText('Levels')).toBeInTheDocument();
  });

  it('handles search error gracefully', async () => {
    vi.mocked(api.search).mockRejectedValue(new Error('Network error'));

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'test' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    // Should not crash — results are empty
    expect(screen.queryByText('Strobe')).not.toBeInTheDocument();
  });

  it('selects a song and shows confirmation view', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    // Click on a result
    fireEvent.click(screen.getByText('Strobe'));

    expect(screen.getByText('Confirm Request')).toBeInTheDocument();
    expect(screen.getByText('Strobe')).toBeInTheDocument();
    expect(screen.getByText('deadmau5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('goes back from confirmation to search results', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    fireEvent.click(screen.getByText('Strobe'));
    expect(screen.getByText('Confirm Request')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Request a Song')).toBeInTheDocument();
  });

  it('submits request and shows success message', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);
    vi.mocked(api.submitRequest).mockResolvedValue({
      id: 1,
      artist: 'deadmau5',
      song_title: 'Strobe',
      status: 'new',
      is_duplicate: false,
      vote_count: 0,
    } as never);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    fireEvent.click(screen.getByText('Strobe'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    });

    expect(screen.getByText('Request Submitted!')).toBeInTheDocument();
  });

  it('shows "Vote Added!" for duplicate requests', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);
    vi.mocked(api.submitRequest).mockResolvedValue({
      id: 1,
      artist: 'deadmau5',
      song_title: 'Strobe',
      status: 'new',
      is_duplicate: true,
      vote_count: 3,
    } as never);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    fireEvent.click(screen.getByText('Strobe'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    });

    expect(screen.getByText('Vote Added!')).toBeInTheDocument();
    expect(screen.getByText('3 people want this song!')).toBeInTheDocument();
  });

  it('auto-closes after 2.5s on success', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);
    vi.mocked(api.submitRequest).mockResolvedValue({
      id: 1,
      artist: 'deadmau5',
      song_title: 'Strobe',
      status: 'new',
      is_duplicate: false,
      vote_count: 0,
    } as never);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    fireEvent.click(screen.getByText('Strobe'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    });

    expect(mockOnClose).not.toHaveBeenCalled();

    // Advance past 2.5s auto-close
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('calls onRequestsClosed on 403 error', async () => {
    vi.mocked(api.search).mockResolvedValue(mockResults);
    vi.mocked(api.submitRequest).mockRejectedValue(
      new (ApiError as unknown as new (msg: string, status: number) => Error)('Requests closed', 403)
    );

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'strobe' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    fireEvent.click(screen.getByText('Strobe'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }));
    });

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnRequestsClosed).toHaveBeenCalled();
  });

  it('closes on inactivity timeout (60s)', () => {
    renderModal();

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('resets inactivity timer on keydown', () => {
    renderModal();

    // Advance 50s (not yet timed out)
    act(() => {
      vi.advanceTimersByTime(50000);
    });
    expect(mockOnClose).not.toHaveBeenCalled();

    // Activity resets the timer
    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });

    // Advance another 50s from the reset point
    act(() => {
      vi.advanceTimersByTime(50000);
    });
    expect(mockOnClose).not.toHaveBeenCalled();

    // 60s after reset → should close
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(mockOnClose).toHaveBeenCalledOnce();
  });

  it('closes when clicking overlay', () => {
    renderModal();

    // The overlay is the outermost div
    const overlay = screen.getByText('Request a Song').closest('.modal-overlay');
    if (overlay) {
      fireEvent.click(overlay);
    }

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders placeholder icon for results without album art', async () => {
    vi.mocked(api.search).mockResolvedValue([
      {
        title: 'No Art Song', artist: 'Unknown', spotify_id: 'sp3', url: null, album_art: null,
        album: null, popularity: 0, preview_url: null, source: 'spotify' as const,
        genre: null, bpm: null, key: null,
      },
    ]);

    renderModal();

    fireEvent.change(screen.getByPlaceholderText('Search for a song...'), {
      target: { value: 'no art' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Search' }));
    });

    expect(screen.getByText('No Art Song')).toBeInTheDocument();
    // Should render SVG placeholder instead of img
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
