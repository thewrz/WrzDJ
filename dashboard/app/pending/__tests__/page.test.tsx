import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PendingPage from '../page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    role: 'pending',
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getMe: vi.fn().mockResolvedValue({ role: 'pending' }),
  },
}));

describe('PendingPage', () => {
  it('logout button uses theme-safe background', () => {
    render(<PendingPage />);
    const btn = screen.getByRole('button', { name: /logout/i });
    expect(btn).toHaveAttribute('style', expect.stringContaining('var(--surface-raised)'));
  });
});
