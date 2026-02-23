import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DashboardPage from '../page';
import { api } from '@/lib/api';

const mockPush = vi.fn();
const mockLogout = vi.fn();

let mockAuth = {
  isAuthenticated: true,
  isLoading: false,
  role: 'dj',
  logout: mockLogout,
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function setupDefaultMocks() {
  vi.spyOn(api, 'getEvents').mockResolvedValue([]);
  vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
  vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
  vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPush.mockClear();
    mockLogout.mockClear();
    mockAuth = {
      isAuthenticated: true,
      isLoading: false,
      role: 'dj',
      logout: mockLogout,
    };
  });

  it('renders events list', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Friday Party', code: 'FRI123', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Friday Party')).toBeInTheDocument();
    });
  });

  it('renders cloud provider status', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: true, user_id: '123', expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Cloud Providers')).toBeInTheDocument();
    });

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('renders activity log panel', async () => {
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Activity Log')).toBeInTheDocument();
    });
  });

  it('renders create event form', async () => {
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Create Event'));

    expect(screen.getByText('Create New Event')).toBeInTheDocument();
  });

  it('shows empty state when no events', async () => {
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No events yet. Create your first event!')).toBeInTheDocument();
    });
  });

  it('creates event and adds it to the list', async () => {
    setupDefaultMocks();
    vi.spyOn(api, 'createEvent').mockResolvedValue({
      id: 99,
      name: 'New Party',
      code: 'NP0001',
      is_active: true,
      expires_at: '2026-03-01T00:00:00Z',
      created_at: '2026-01-01',
      requests_open: true,
      now_playing_hidden: false,
      auto_hide_minutes: 10,
    } as never);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    // Open create form
    fireEvent.click(screen.getByText('Create Event'));
    expect(screen.getByText('Create New Event')).toBeInTheDocument();

    // Fill and submit
    fireEvent.change(screen.getByLabelText('Event Name'), {
      target: { value: 'New Party' },
    });
    fireEvent.submit(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('New Party')).toBeInTheDocument();
    });
    // Form should be hidden after creation
    expect(screen.queryByText('Create New Event')).not.toBeInTheDocument();
  });

  it('shows error when create event fails', async () => {
    setupDefaultMocks();
    vi.spyOn(api, 'createEvent').mockRejectedValue(new Error('Server error'));

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Create Event'));
    fireEvent.change(screen.getByLabelText('Event Name'), {
      target: { value: 'Bad Event' },
    });
    fireEvent.submit(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('calls logout on logout button click', async () => {
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Logout'));
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it('shows admin link for admin users', async () => {
    mockAuth = { ...mockAuth, role: 'admin' };
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });
  });

  it('does not show admin link for DJ users', async () => {
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows inactive badge for expired events', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Old Event', code: 'OLD123', is_active: false, expires_at: '2025-01-01T00:00:00Z', created_at: '2024-12-01', requests_open: false, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  it('cancels create event form', async () => {
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Create Event'));
    expect(screen.getByText('Create New Event')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Create New Event')).not.toBeInTheDocument();
  });
});
