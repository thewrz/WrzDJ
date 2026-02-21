import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RegisterPage from '../page';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    getPublicSettings: vi.fn(),
    register: vi.fn(),
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

import { api } from '@/lib/api';

function fillForm(overrides: Partial<Record<string, string>> = {}) {
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: overrides.username ?? 'testuser' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: overrides.email ?? 'test@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: overrides.password ?? 'password123' },
  });
  fireEvent.change(screen.getByLabelText('Confirm Password'), {
    target: { value: overrides.confirm ?? 'password123' },
  });
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    vi.mocked(api.getPublicSettings).mockReturnValue(new Promise(() => {})); // never resolves

    render(<RegisterPage />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows disabled message when registration is off', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: false,
      turnstile_site_key: '',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Registration Disabled')).toBeInTheDocument();
      expect(screen.getByText(/Contact an administrator/)).toBeInTheDocument();
    });
  });

  it('renders registration form when enabled', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument();
  });

  it('shows sign in link', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Sign In')).toBeInTheDocument();
    });
  });

  it('shows back to login button when disabled', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: false,
      turnstile_site_key: '',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back to Login' })).toBeInTheDocument();
    });
  });

  it('shows error when passwords do not match', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });

    fillForm({ confirm: 'different-password' });
    fireEvent.submit(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
    expect(api.register).not.toHaveBeenCalled();
  });

  it('shows success message after registration', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });
    vi.mocked(api.register).mockResolvedValue({
      status: 'ok',
      message: 'Your account is pending admin approval.',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });

    fillForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(screen.getByText('Registration Submitted')).toBeInTheDocument();
      expect(screen.getByText('Your account is pending admin approval.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Go to Login' })).toBeInTheDocument();
  });

  it('shows API error message on registration failure', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });
    vi.mocked(api.register).mockRejectedValue(new Error('Username already taken'));

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });

    fillForm();
    fireEvent.submit(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(screen.getByText('Username already taken')).toBeInTheDocument();
    });
  });

  it('handles settings fetch failure gracefully', async () => {
    vi.mocked(api.getPublicSettings).mockRejectedValue(new Error('Network error'));

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Registration Disabled')).toBeInTheDocument();
    });
  });

  it('shows registration form when enabled but Turnstile disabled (no site key)', async () => {
    vi.mocked(api.getPublicSettings).mockResolvedValue({
      registration_enabled: true,
      turnstile_site_key: '',
    });

    render(<RegisterPage />);

    await waitFor(() => {
      expect(screen.getByText('Create Account')).toBeInTheDocument();
    });
    // No turnstile widget should render when site key is empty
    expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
  });
});
