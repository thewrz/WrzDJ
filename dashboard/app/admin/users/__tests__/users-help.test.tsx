import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    getAdminUsers: vi.fn().mockResolvedValue({
      items: [
        { id: 1, username: 'admin', is_active: true, role: 'admin', created_at: '2026-01-01T00:00:00Z', event_count: 3 },
      ],
      total: 1,
    }),
  },
  AdminUser: undefined,
}));

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

import AdminUsersPage from '../page';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <AdminUsersPage />
    </HelpProvider>
  );
}

describe('Admin users help integration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HelpButton renders on users page', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Toggle help mode' })).toBeInTheDocument();
  });

  it('HelpSpots exist for create, filters, table, and actions', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByTestId('help-spot-admin-create-user')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-role-filters')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-user-table')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-user-actions')).toBeInTheDocument();
  });

  it('first visit triggers onboarding after delay', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
  });

  it('subsequent visits do not auto-trigger onboarding', async () => {
    localStorageMock.setItem('wrzdj-help-seen-admin-users', '1');
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeInTheDocument();
  });
});
