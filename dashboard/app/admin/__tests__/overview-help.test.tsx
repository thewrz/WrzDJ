import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    getAdminStats: vi.fn().mockResolvedValue({
      total_users: 5,
      active_users: 4,
      pending_users: 1,
      total_events: 10,
      active_events: 3,
      total_requests: 50,
    }),
  },
  SystemStats: undefined,
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

import AdminOverviewPage from '../page';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <AdminOverviewPage />
    </HelpProvider>
  );
}

describe('Admin overview help integration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HelpButton renders on overview page', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Toggle help mode' })).toBeInTheDocument();
  });

  it('HelpSpots exist for stats, pending, and actions', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByTestId('help-spot-admin-stats')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-pending')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-actions')).toBeInTheDocument();
  });

  it('first visit triggers onboarding after delay', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
  });

  it('subsequent visits do not auto-trigger onboarding', async () => {
    localStorageMock.setItem('wrzdj-help-seen-admin-overview', '1');
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeInTheDocument();
  });
});
