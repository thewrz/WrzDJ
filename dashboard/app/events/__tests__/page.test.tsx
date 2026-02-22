import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

// Mock help components to simple pass-throughs
vi.mock('@/components/help/HelpSpot', () => ({
  HelpSpot: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/help/HelpButton', () => ({
  HelpButton: () => null,
}));
vi.mock('@/components/help/OnboardingOverlay', () => ({
  OnboardingOverlay: () => null,
}));

// Variable-based auth mock for role testing
let mockRole = 'dj';
let mockIsAuthenticated = true;
let mockIsLoading = false;
const mockLogout = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    isLoading: mockIsLoading,
    role: mockRole,
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

function mockEvent(overrides = {}) {
  return {
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
    ...overrides,
  };
}

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'dj';
    mockIsAuthenticated = true;
    mockIsLoading = false;
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
    vi.mocked(api.getEvents).mockResolvedValue([mockEvent()]);

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

  it('shows inactive badge for inactive events', async () => {
    vi.mocked(api.getEvents).mockResolvedValue([mockEvent({ is_active: false })]);

    render(<EventsPage />);

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  describe('Loading & auth redirects', () => {
    it('shows Loading while auth is resolving', () => {
      mockIsLoading = true;
      mockIsAuthenticated = false;
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('shows "Loading events..." during fetch', async () => {
      let resolveEvents!: (v: never[]) => void;
      vi.mocked(api.getEvents).mockImplementation(
        () => new Promise((r) => { resolveEvents = r; }),
      );

      render(<EventsPage />);

      expect(screen.getByText('Loading events...')).toBeInTheDocument();

      await act(async () => { resolveEvents([]); });
    });

    it('redirects unauthenticated users to /login', () => {
      mockIsAuthenticated = false;
      mockIsLoading = false;
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    it('redirects pending users to /pending', () => {
      mockRole = 'pending';
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      expect(mockPush).toHaveBeenCalledWith('/pending');
    });
  });

  describe('Create event form', () => {
    it('shows form when Create Event clicked', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

      expect(screen.getByLabelText('Event Name')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('creates event and adds to list', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      const newEvent = mockEvent({ id: 2, code: 'NEW01', name: 'New Party' });
      vi.mocked(api.createEvent).mockResolvedValue(newEvent);

      render(<EventsPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'New Party' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      expect(api.createEvent).toHaveBeenCalledWith('New Party');
      await waitFor(() => {
        expect(screen.getByText('New Party')).toBeInTheDocument();
      });
    });

    it('hides form and resets input after create', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      vi.mocked(api.createEvent).mockResolvedValue(mockEvent());

      render(<EventsPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Test' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      await waitFor(() => {
        expect(screen.queryByLabelText('Event Name')).not.toBeInTheDocument();
      });
    });

    it('shows error when create fails', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      vi.mocked(api.createEvent).mockRejectedValue(new Error('Name taken'));

      render(<EventsPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Dup' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      await waitFor(() => {
        expect(screen.getByText('Name taken')).toBeInTheDocument();
      });
    });

    it('disables button while creating', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);
      let resolveCreate!: (v: ReturnType<typeof mockEvent>) => void;
      vi.mocked(api.createEvent).mockImplementation(
        () => new Promise((r) => { resolveCreate = r; }),
      );

      render(<EventsPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Test' } });
      fireEvent.submit(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Creating...' })).toBeDisabled();
      });

      await act(async () => { resolveCreate(mockEvent()); });
    });

    it('does not submit with empty name', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      // Leave input empty (required attribute prevents native submit, but our handler also checks)
      const input = screen.getByLabelText('Event Name');
      fireEvent.change(input, { target: { value: '   ' } });
      await act(async () => {
        fireEvent.submit(screen.getByRole('button', { name: 'Create' }));
      });

      expect(api.createEvent).not.toHaveBeenCalled();
    });

    it('hides form on Cancel', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);
      await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
      expect(screen.getByLabelText('Event Name')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Event Name')).not.toBeInTheDocument();
      expect(api.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('Logout', () => {
    it('calls logout on Logout click', async () => {
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

      expect(mockLogout).toHaveBeenCalledOnce();
    });
  });

  describe('Admin role', () => {
    it('shows Admin button for admin role', async () => {
      mockRole = 'admin';
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    });

    it('hides Admin button for dj role', async () => {
      mockRole = 'dj';
      vi.mocked(api.getEvents).mockResolvedValue([]);

      render(<EventsPage />);

      expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    });
  });
});
