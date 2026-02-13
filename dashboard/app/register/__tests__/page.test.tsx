import { render, screen, waitFor } from '@testing-library/react';
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
}));

import { api } from '@/lib/api';

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
});
