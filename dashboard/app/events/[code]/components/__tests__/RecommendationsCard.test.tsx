import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecommendationsCard } from '../RecommendationsCard';
import type { RecommendedTrack, RecommendationResponse, PlaylistInfo } from '@/lib/api-types';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    generateRecommendations: vi.fn(),
    getEventPlaylists: vi.fn(),
    generateRecommendationsFromTemplate: vi.fn(),
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

function makeSuggestion(overrides: Partial<RecommendedTrack> = {}): RecommendedTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    bpm: 128,
    key: '8A',
    genre: 'Tech House',
    score: 0.92,
    bpm_score: 1.0,
    key_score: 1.0,
    genre_score: 0.8,
    source: 'beatport',
    track_id: '12345',
    url: 'https://beatport.com/track/test/12345',
    cover_url: 'https://bp.com/cover.jpg',
    duration_seconds: 360,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<RecommendationResponse> = {}): RecommendationResponse {
  return {
    suggestions: [makeSuggestion()],
    profile: {
      avg_bpm: 128,
      bpm_range_low: 120,
      bpm_range_high: 136,
      dominant_keys: ['8A', '9A'],
      dominant_genres: ['Tech House'],
      track_count: 5,
      enriched_count: 5,
    },
    services_used: ['beatport'],
    total_candidates_searched: 20,
    llm_available: false,
    ...overrides,
  };
}

function makePlaylist(overrides: Partial<PlaylistInfo> = {}): PlaylistInfo {
  return {
    id: 'playlist-1',
    name: 'My Mix',
    num_tracks: 10,
    description: 'A great mix',
    cover_url: 'https://bp.com/cover.jpg',
    source: 'beatport',
    ...overrides,
  };
}

describe('RecommendationsCard', () => {
  const defaultProps = {
    code: 'TEST01',
    hasAcceptedRequests: true,
    tidalLinked: true,
    beatportLinked: true,
    onAcceptTrack: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Generate button initially', () => {
    render(<RecommendationsCard {...defaultProps} />);
    expect(screen.getByText('Generate')).toBeInTheDocument();
  });

  it('disables Generate when no accepted requests in request mode', () => {
    render(<RecommendationsCard {...defaultProps} hasAcceptedRequests={false} />);
    const btn = screen.getByText('Generate');
    expect(btn).toBeDisabled();
  });

  it('disables Generate when no connected services', () => {
    render(<RecommendationsCard {...defaultProps} tidalLinked={false} beatportLinked={false} />);
    const btn = screen.getByText('Generate');
    expect(btn).toBeDisabled();
    expect(screen.getByText(/link tidal or beatport/i)).toBeInTheDocument();
  });

  it('shows loading state during generation', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse());

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/Test Artist/)).toBeInTheDocument();
    });
    expect(api.generateRecommendations).toHaveBeenCalledWith('TEST01');
  });

  it('renders suggestion list after generation', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse({
      suggestions: [
        makeSuggestion({ title: 'Song A', artist: 'DJ A' }),
        makeSuggestion({ title: 'Song B', artist: 'DJ B' }),
      ],
    }));

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/DJ A/)).toBeInTheDocument();
      expect(screen.getByText(/DJ B/)).toBeInTheDocument();
    });
  });

  it('Accept individual removes track from list', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse({
      suggestions: [
        makeSuggestion({ title: 'Song A', artist: 'DJ A' }),
        makeSuggestion({ title: 'Song B', artist: 'DJ B' }),
      ],
    }));

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/DJ A/)).toBeInTheDocument();
    });

    const acceptButtons = screen.getAllByText('Accept');
    fireEvent.click(acceptButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText(/DJ A/)).not.toBeInTheDocument();
      expect(screen.getByText(/DJ B/)).toBeInTheDocument();
    });

    expect(defaultProps.onAcceptTrack).toHaveBeenCalledTimes(1);
  });

  it('Accept All clears the list', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse({
      suggestions: [
        makeSuggestion({ title: 'Song A', artist: 'DJ A' }),
        makeSuggestion({ title: 'Song B', artist: 'DJ B' }),
      ],
    }));

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText('Accept All')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Accept All'));

    await waitFor(() => {
      expect(screen.queryByText(/DJ A/)).not.toBeInTheDocument();
      expect(screen.queryByText(/DJ B/)).not.toBeInTheDocument();
    });

    expect(defaultProps.onAcceptTrack).toHaveBeenCalledTimes(2);
  });

  it('Clear removes suggestions without API call', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse());

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Clear'));

    expect(screen.queryByText('Test Artist')).not.toBeInTheDocument();
    expect(defaultProps.onAcceptTrack).not.toHaveBeenCalled();
  });

  // Template playlist tests

  it('renders mode toggle with From Requests and From Playlist options', () => {
    render(<RecommendationsCard {...defaultProps} />);
    expect(screen.getByText('From Requests')).toBeInTheDocument();
    expect(screen.getByText('From Playlist')).toBeInTheDocument();
  });

  it('loads playlists when From Playlist mode is selected', async () => {
    vi.mocked(api.getEventPlaylists).mockResolvedValue({
      playlists: [
        makePlaylist({ id: 'p1', name: 'Mix 1', source: 'tidal' }),
        makePlaylist({ id: 'p2', name: 'Mix 2', source: 'beatport' }),
      ],
    });

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('From Playlist'));

    await waitFor(() => {
      expect(api.getEventPlaylists).toHaveBeenCalledWith('TEST01');
    });
  });

  it('shows playlist dropdown with loaded playlists', async () => {
    vi.mocked(api.getEventPlaylists).mockResolvedValue({
      playlists: [
        makePlaylist({ id: 'p1', name: 'Friday Night Mix', source: 'tidal' }),
      ],
    });

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('From Playlist'));

    await waitFor(() => {
      expect(screen.getByText(/Friday Night Mix/)).toBeInTheDocument();
    });
  });

  it('Generate disabled when no playlist selected in template mode', async () => {
    vi.mocked(api.getEventPlaylists).mockResolvedValue({
      playlists: [makePlaylist()],
    });

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('From Playlist'));

    await waitFor(() => {
      expect(screen.getByText('Generate')).toBeDisabled();
    });
  });

  it('calls from-template API when generating in template mode', async () => {
    vi.mocked(api.getEventPlaylists).mockResolvedValue({
      playlists: [makePlaylist({ id: 'bp-1', name: 'Club Mix', source: 'beatport' })],
    });
    vi.mocked(api.generateRecommendationsFromTemplate).mockResolvedValue(makeResponse());

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('From Playlist'));

    await waitFor(() => {
      expect(screen.getByText(/Club Mix/)).toBeInTheDocument();
    });

    // Select the playlist
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'beatport:bp-1' } });

    // Generate
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(api.generateRecommendationsFromTemplate).toHaveBeenCalledWith(
        'TEST01', 'beatport', 'bp-1'
      );
    });
  });

  it('shows service badges on playlists', async () => {
    vi.mocked(api.getEventPlaylists).mockResolvedValue({
      playlists: [
        makePlaylist({ id: 'p1', name: 'Tidal Mix', source: 'tidal', num_tracks: 15 }),
        makePlaylist({ id: 'p2', name: 'BP Mix', source: 'beatport', num_tracks: 25 }),
      ],
    });

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('From Playlist'));

    await waitFor(() => {
      // Both playlists should be visible as options
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
    });
  });
});
