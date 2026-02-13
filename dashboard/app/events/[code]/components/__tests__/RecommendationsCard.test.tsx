import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecommendationsCard } from '../RecommendationsCard';
import type {
  RecommendedTrack,
  RecommendationResponse,
  PlaylistInfo,
  LLMRecommendationResponse,
} from '@/lib/api-types';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    generateRecommendations: vi.fn(),
    getEventPlaylists: vi.fn(),
    generateRecommendationsFromTemplate: vi.fn(),
    generateLLMRecommendations: vi.fn(),
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

function makeLLMResponse(
  overrides: Partial<LLMRecommendationResponse> = {}
): LLMRecommendationResponse {
  return {
    suggestions: [makeSuggestion()],
    profile: {
      avg_bpm: 128,
      bpm_range_low: 120,
      bpm_range_high: 136,
      dominant_keys: ['8A'],
      dominant_genres: ['Tech House'],
      track_count: 5,
      enriched_count: 5,
    },
    services_used: ['beatport'],
    total_candidates_searched: 15,
    llm_queries: [
      {
        search_query: 'dark techno',
        target_bpm: 130,
        target_key: '8A',
        target_genre: 'Techno',
        reasoning: 'DJ wants darker sounds',
      },
    ],
    llm_available: true,
    llm_model: 'claude-haiku-4-5-20251001',
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

  // AI Assist (LLM) tests

  it('shows AI Assist button when llm_available is true', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(
      makeResponse({ llm_available: true })
    );

    render(<RecommendationsCard {...defaultProps} />);

    // Initially no AI Assist button
    expect(screen.queryByText('AI Assist')).not.toBeInTheDocument();

    // Generate to get llm_available from response
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument();
    });
  });

  it('does not show AI Assist button when llm_available is false', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(
      makeResponse({ llm_available: false })
    );

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/Test Artist/)).toBeInTheDocument();
    });

    expect(screen.queryByText('AI Assist')).not.toBeInTheDocument();
  });

  it('shows prompt input in AI Assist mode', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(
      makeResponse({ llm_available: true })
    );

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('AI Assist'));

    expect(screen.getByPlaceholderText(/recommend some more/)).toBeInTheDocument();
  });

  it('calls LLM API with prompt when generating in AI Assist mode', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(
      makeResponse({ llm_available: true })
    );
    vi.mocked(api.generateLLMRecommendations).mockResolvedValue(makeLLMResponse());

    render(<RecommendationsCard {...defaultProps} />);

    // First generate to discover llm_available
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument();
    });

    // Switch to AI Assist mode
    fireEvent.click(screen.getByText('AI Assist'));

    // Type a prompt
    const input = screen.getByPlaceholderText(/recommend some more/);
    fireEvent.change(input, { target: { value: 'dark techno vibes' } });

    // Generate
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(api.generateLLMRecommendations).toHaveBeenCalledWith('TEST01', 'dark techno vibes');
    });
  });

  it('shows AI reasoning toggle after LLM generation', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(
      makeResponse({ llm_available: true })
    );
    vi.mocked(api.generateLLMRecommendations).mockResolvedValue(makeLLMResponse());

    render(<RecommendationsCard {...defaultProps} />);

    // Get llm_available
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument();
    });

    // Switch to LLM mode and generate
    fireEvent.click(screen.getByText('AI Assist'));
    const input = screen.getByPlaceholderText(/recommend some more/);
    fireEvent.change(input, { target: { value: 'dark techno' } });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/Show AI reasoning/)).toBeInTheDocument();
    });

    // Click to expand reasoning
    fireEvent.click(screen.getByText(/Show AI reasoning/));

    await waitFor(() => {
      expect(screen.getByText('dark techno')).toBeInTheDocument();
      expect(screen.getByText(/DJ wants darker sounds/)).toBeInTheDocument();
    });
  });

  it('disables Generate in AI Assist mode when prompt is too short', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(
      makeResponse({ llm_available: true })
    );

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText('AI Assist')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('AI Assist'));

    // Empty prompt — should be disabled
    expect(screen.getByText('Generate')).toBeDisabled();

    // Two chars — still disabled (min 3)
    const input = screen.getByPlaceholderText(/recommend some more/);
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(screen.getByText('Generate')).toBeDisabled();

    // Three chars — enabled
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByText('Generate')).not.toBeDisabled();
  });

  // Persistence tests

  it('preserves suggestions when switching modes and back', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse({
      suggestions: [
        makeSuggestion({ title: 'Persisted Song', artist: 'DJ Persist' }),
      ],
    }));
    vi.mocked(api.getEventPlaylists).mockResolvedValue({ playlists: [makePlaylist()] });

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/DJ Persist/)).toBeInTheDocument();
    });

    // Switch to From Playlist — suggestions should swap out
    fireEvent.click(screen.getByText('From Playlist'));
    expect(screen.queryByText(/DJ Persist/)).not.toBeInTheDocument();

    // Switch back to From Requests — suggestions should be restored
    fireEvent.click(screen.getByText('From Requests'));
    expect(screen.getByText(/DJ Persist/)).toBeInTheDocument();
  });

  it('Clear removes cached results for current mode', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse({
      suggestions: [makeSuggestion({ title: 'Gone', artist: 'DJ Gone' })],
    }));
    vi.mocked(api.getEventPlaylists).mockResolvedValue({ playlists: [makePlaylist()] });

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByText(/DJ Gone/)).toBeInTheDocument();
    });

    // Clear
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByText(/DJ Gone/)).not.toBeInTheDocument();

    // Switch away and back — should still be cleared
    fireEvent.click(screen.getByText('From Playlist'));
    fireEvent.click(screen.getByText('From Requests'));
    expect(screen.queryByText(/DJ Gone/)).not.toBeInTheDocument();
  });
});
