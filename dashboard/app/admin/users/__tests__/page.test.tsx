import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminUsersPage from '../page';

// Mock API
vi.mock('@/lib/api', () => ({
  api: {
    getAdminUsers: vi.fn(),
    createAdminUser: vi.fn(),
    updateAdminUser: vi.fn(),
    deleteAdminUser: vi.fn(),
  },
  AdminUser: undefined,
}));

import { api } from '@/lib/api';

const mockUsers = {
  items: [
    {
      id: 1,
      username: 'admin',
      is_active: true,
      role: 'admin',
      created_at: '2026-01-01T00:00:00Z',
      event_count: 3,
    },
    {
      id: 2,
      username: 'djbob',
      is_active: true,
      role: 'dj',
      created_at: '2026-01-15T00:00:00Z',
      event_count: 1,
    },
    {
      id: 3,
      username: 'pending_user',
      is_active: true,
      role: 'pending',
      created_at: '2026-02-01T00:00:00Z',
      event_count: 0,
    },
  ],
  total: 3,
  page: 1,
  limit: 20,
};

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getAdminUsers).mockResolvedValue(mockUsers);
  });

  it('renders page heading and create button', async () => {
    render(<AdminUsersPage />);

    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create User' })).toBeInTheDocument();
  });

  it('displays users in a table', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      // Username "admin" also appears as the role badge text, so use getAllByText
      expect(screen.getAllByText('admin').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('djbob')).toBeInTheDocument();
      expect(screen.getByText('pending_user')).toBeInTheDocument();
    });
  });

  it('renders table column headers', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('Username')).toBeInTheDocument();
      expect(screen.getByText('Role')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Events')).toBeInTheDocument();
      expect(screen.getByText('Created')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  it('renders role filter tabs', async () => {
    render(<AdminUsersPage />);

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admins' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DJs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument();
  });

  it('renders edit and delete buttons for each user', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      const editButtons = screen.getAllByRole('button', { name: 'Edit' });
      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
      expect(editButtons).toHaveLength(3);
      expect(deleteButtons).toHaveLength(3);
    });
  });

  it('shows error when API fails', async () => {
    vi.mocked(api.getAdminUsers).mockRejectedValue(new Error('Network error'));

    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load users')).toBeInTheDocument();
    });
  });

  it('calls getAdminUsers on mount', async () => {
    render(<AdminUsersPage />);

    await waitFor(() => {
      expect(api.getAdminUsers).toHaveBeenCalledWith(1, 20, undefined);
    });
  });
});
