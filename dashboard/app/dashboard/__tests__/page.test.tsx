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

  it('redirects to /login when not authenticated', async () => {
    mockAuth = { ...mockAuth, isAuthenticated: false, isLoading: false };
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to /pending when role is pending', async () => {
    mockAuth = { ...mockAuth, role: 'pending', isAuthenticated: true, isLoading: false };
    setupDefaultMocks();

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/pending');
    });
  });

  it('shows loading state when isLoading is true', async () => {
    mockAuth = { ...mockAuth, isLoading: true, isAuthenticated: false };
    setupDefaultMocks();

    render(<DashboardPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows selection mode when Advanced checkbox is checked', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Party Event', code: 'PTY01', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Party Event')).toBeInTheDocument();
    });

    const advancedCheckbox = screen.getByLabelText('Advanced');
    fireEvent.click(advancedCheckbox);

    expect(screen.getByLabelText('Select All')).toBeInTheDocument();
  });

  it('allows selecting all events and bulk deleting', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Event A', code: 'EVT01', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
      { id: 2, name: 'Event B', code: 'EVT02', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);
    vi.spyOn(api, 'bulkDeleteEvents').mockResolvedValue(undefined as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Event A')).toBeInTheDocument();
    });

    // Enable selection mode
    fireEvent.click(screen.getByLabelText('Advanced'));

    // Select all
    fireEvent.click(screen.getByLabelText('Select All'));

    // Delete selected
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));

    await waitFor(() => {
      expect(api.bulkDeleteEvents).toHaveBeenCalled();
    });
  });

  it('cancels bulk delete when user dismisses confirm dialog', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Event X', code: 'EVTX1', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);
    const bulkDeleteSpy = vi.spyOn(api, 'bulkDeleteEvents').mockResolvedValue(undefined as never);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Event X')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Advanced'));
    fireEvent.click(screen.getByLabelText('Select All'));
    await waitFor(() => screen.getByRole('button', { name: /delete selected/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));

    // bulkDeleteEvents should NOT have been called
    expect(bulkDeleteSpy).not.toHaveBeenCalled();
  });

  it('shows error when bulk delete fails', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Event Fail', code: 'EVTF1', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);
    vi.spyOn(api, 'bulkDeleteEvents').mockRejectedValue(new Error('Delete failed'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Event Fail')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Advanced'));
    fireEvent.click(screen.getByLabelText('Select All'));
    await waitFor(() => screen.getByRole('button', { name: /delete selected/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete selected/i }));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  it('deselects all events when Advanced is unchecked', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Event Toggle', code: 'TOG01', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Event Toggle')).toBeInTheDocument());

    const advancedCheckbox = screen.getByLabelText('Advanced');
    fireEvent.click(advancedCheckbox);
    fireEvent.click(screen.getByLabelText('Select All'));

    // Uncheck advanced — should clear selection
    fireEvent.click(advancedCheckbox);
    expect(screen.queryByLabelText('Select All')).not.toBeInTheDocument();
  });

  it('selects individual event in selection mode', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Pick Me', code: 'PCK01', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Pick Me')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Advanced'));
    fireEvent.click(screen.getByLabelText('Select event PCK01'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument();
    });
  });

  it('creates event with collection settings when showCollection is enabled', async () => {
    setupDefaultMocks();
    vi.spyOn(api, 'createEvent').mockResolvedValue({
      id: 99,
      name: 'Collection Event',
      code: 'COL001',
      is_active: true,
      expires_at: '2026-03-01T00:00:00Z',
      created_at: '2026-01-01',
      requests_open: true,
      now_playing_hidden: false,
      auto_hide_minutes: 10,
    } as never);
    vi.spyOn(api, 'patchCollectionSettings').mockResolvedValue(undefined as never);

    render(<DashboardPage />);

    await waitFor(() => screen.getByText('Dashboard'));

    fireEvent.click(screen.getByText('Create Event'));
    fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Collection Event' } });

    // Enable pre-event collection
    const toggleCheckbox = screen.getByRole('checkbox', { name: /enable pre-event voting/i });
    fireEvent.click(toggleCheckbox);

    // Set a submission cap
    const capInput = screen.getByLabelText('Submission cap per guest');
    fireEvent.change(capInput, { target: { value: '3' } });

    fireEvent.submit(screen.getByText('Create'));

    await waitFor(() => {
      expect(api.patchCollectionSettings).toHaveBeenCalledWith('COL001', expect.objectContaining({ submission_cap_per_guest: 3 }));
    });
  });

  it('shows error when collection settings fail after event creation', async () => {
    setupDefaultMocks();
    vi.spyOn(api, 'createEvent').mockResolvedValue({
      id: 88,
      name: 'Partial Event',
      code: 'PAR001',
      is_active: true,
      expires_at: '2026-03-01T00:00:00Z',
      created_at: '2026-01-01',
      requests_open: true,
      now_playing_hidden: false,
      auto_hide_minutes: 10,
    } as never);
    vi.spyOn(api, 'patchCollectionSettings').mockRejectedValue(new Error('Settings failed'));

    render(<DashboardPage />);

    await waitFor(() => screen.getByText('Dashboard'));

    fireEvent.click(screen.getByText('Create Event'));
    fireEvent.change(screen.getByLabelText('Event Name'), { target: { value: 'Partial Event' } });

    const toggleCheckbox = screen.getByRole('checkbox', { name: /enable pre-event voting/i });
    fireEvent.click(toggleCheckbox);

    const capInput = screen.getByLabelText('Submission cap per guest');
    fireEvent.change(capInput, { target: { value: '5' } });

    fireEvent.submit(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByText(/collection settings failed/i)).toBeInTheDocument();
    });
  });

  it('shows Beatport Connected when beatport is linked', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: true, expires_at: null, configured: true, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      const connectedTexts = screen.getAllByText('Connected');
      expect(connectedTexts.length).toBeGreaterThan(0);
    });
  });

  it('deselects an already selected event when toggled', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([
      { id: 1, name: 'Toggle Event', code: 'TGL01', is_active: true, expires_at: '2026-03-01T00:00:00Z', created_at: '2026-01-01', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 },
    ] as never[]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('Toggle Event')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Advanced'));

    // Select the event
    const eventCheckbox = screen.getByLabelText('Select event TGL01');
    fireEvent.click(eventCheckbox);

    // Should show delete button now
    await waitFor(() => expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument());

    // Deselect event
    fireEvent.click(eventCheckbox);

    // Delete button should be gone
    await waitFor(() => expect(screen.queryByRole('button', { name: /delete selected/i })).not.toBeInTheDocument());
  });
});
