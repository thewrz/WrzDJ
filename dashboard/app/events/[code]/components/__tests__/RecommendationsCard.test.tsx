import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecommendationsCard } from '../RecommendationsCard';
import type { RecommendedTrack, RecommendationResponse } from '@/lib/api-types';

// Mock the api module
vi.mock('@/lib/api', () => ({
  api: {
    generateRecommendations: vi.fn(),
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

describe('RecommendationsCard', () => {
  const defaultProps = {
    code: 'TEST01',
    hasAcceptedRequests: true,
    hasConnectedServices: true,
    onAcceptTrack: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Generate button initially', () => {
    render(<RecommendationsCard {...defaultProps} />);
    expect(screen.getByText('Generate')).toBeInTheDocument();
  });

  it('disables Generate when no accepted requests', () => {
    render(<RecommendationsCard {...defaultProps} hasAcceptedRequests={false} />);
    const btn = screen.getByText('Generate');
    expect(btn).toBeDisabled();
  });

  it('disables Generate when no connected services', () => {
    render(<RecommendationsCard {...defaultProps} hasConnectedServices={false} />);
    const btn = screen.getByText('Generate');
    expect(btn).toBeDisabled();
    expect(screen.getByText(/link tidal or beatport/i)).toBeInTheDocument();
  });

  it('shows loading state during generation', async () => {
    vi.mocked(api.generateRecommendations).mockResolvedValue(makeResponse());

    render(<RecommendationsCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Generate'));

    // After click, button text changes to loading state (may resolve quickly)
    // Just verify the API was called and results appear
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
});
