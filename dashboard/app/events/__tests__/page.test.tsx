import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EventsPage from '../page';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock help context
vi.mock('@/lib/help/HelpContext', () => ({
  useHelp: () => ({
    helpMode: false, onboardingActive: false, currentStep: 0, activeSpotId: null,
    toggleHelpMode: vi.fn(), registerSpot: vi.fn(() => vi.fn()),
    getSpotsForPage: vi.fn(() => []), startOnboarding: vi.fn(),
    nextStep: vi.fn(), prevStep: vi.fn(), skipOnboarding: vi.fn(),
    hasSeenPage: vi.fn(() => true),
  }),
}));

// Mock auth hook
const mockLogout = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    role: 'dj',
    logout: mockLogout,
  }),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    getEvents: vi.fn(),
    createEvent: vi.fn(),
  },
  Event: undefined,
}));

import { api } from '@/lib/api';

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading and create button', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<EventsPage />);

    expect(screen.getByText('My Events')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Event' })).toBeInTheDocument();
  });

  it('shows empty state when no events exist', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<EventsPage />);

    await waitFor(() => {
      expect(screen.getByText(/No events yet/)).toBeInTheDocument();
    });
  });

  it('displays events when loaded', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([
      {
        id: 1,
        code: 'EVT01',
        name: 'Friday Night',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: '2026-01-02T00:00:00Z',
        is_active: true,
        join_url: null,
        tidal_sync_enabled: false,
        tidal_playlist_id: null,
        beatport_sync_enabled: false,
        beatport_playlist_id: null,
        banner_url: null,
        banner_kiosk_url: null,
        banner_colors: null,
        requests_open: true,
      },
    ]);

    render(<EventsPage />);

    await waitFor(() => {
      expect(screen.getByText('Friday Night')).toBeInTheDocument();
      expect(screen.getByText('EVT01')).toBeInTheDocument();
    });
  });

  it('shows error message when API call fails', async () => {
    vi.mocked(api.getEvents).mockRejectedValue(new Error('Network error'));

    render(<EventsPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load events')).toBeInTheDocument();
    });
  });

  it('shows logout button', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([]);

    render(<EventsPage />);

    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });
});
