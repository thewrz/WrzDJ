import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from '../page';

// Mock next/navigation
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

// Mock auth hook
const mockLogin = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    login: mockLogin,
  }),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    getPublicSettings: vi.fn().mockResolvedValue({
      registration_enabled: false,
      turnstile_site_key: '',
    }),
  },
}));

import { api } from '@/lib/api';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('renders login form with username and password fields', () => {
    render(<LoginPage />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('renders page heading', () => {
    render(<LoginPage />);
    expect(screen.getByText('WrzDJ Login')).toBeInTheDocument();
  });

  it('calls login and redirects on successful submit', async () => {
    mockLogin.mockResolvedValue(undefined);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays error message on failed login', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'baduser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'badpass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
    });
  });

  it('shows Create Account link when registration is enabled', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });
  });

  it('redirects to redirect param after login', async () => {
    mockSearchParams = new URLSearchParams('redirect=/kiosk-link/ABC234');
    mockLogin.mockResolvedValue(undefined);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/kiosk-link/ABC234');
    });
  });

  it('defaults to /dashboard when no redirect param', async () => {
    mockLogin.mockResolvedValue(undefined);

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('hides Create Account link when registration is disabled', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: false,
      turnstile_site_key: '',
    });

    render(<LoginPage />);

    // Give time for the async settings to resolve
    await waitFor(() => {
      expect(screen.queryByText('Create Account')).not.toBeInTheDocument();
    });
  });
});
