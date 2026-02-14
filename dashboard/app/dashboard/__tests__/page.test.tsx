import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DashboardPage from '../page';
import { api } from '@/lib/api';

const mockPush = vi.fn();

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    role: 'dj',
    logout: vi.fn(),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPush.mockClear();
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
      expect(screen.getByText('Friday Party')).toBeTruthy();
    });
  });

  it('renders cloud provider status', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: true, user_id: '123', expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Cloud Providers')).toBeTruthy();
    });

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('renders activity log panel', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Activity Log')).toBeTruthy();
    });
  });

  it('renders create event form', async () => {
    vi.spyOn(api, 'getEvents').mockResolvedValue([]);
    vi.spyOn(api, 'getTidalStatus').mockResolvedValue({ linked: false, user_id: null, expires_at: null, integration_enabled: true });
    vi.spyOn(api, 'getBeatportStatus').mockResolvedValue({ linked: false, expires_at: null, configured: false, subscription: null, integration_enabled: true });
    vi.spyOn(api, 'getActivityLog').mockResolvedValue([]);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Create Event'));

    expect(screen.getByText('Create New Event')).toBeTruthy();
  });
});
