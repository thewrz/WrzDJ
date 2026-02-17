import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    getAdminSettings: vi.fn().mockResolvedValue({
      registration_enabled: true,
      search_rate_limit_per_minute: 10,
    }),
  },
  SystemSettings: undefined,
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

import AdminSettingsPage from '../page';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <AdminSettingsPage />
    </HelpProvider>
  );
}

describe('Admin settings help integration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HelpButton renders on settings page', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Toggle help mode' })).toBeInTheDocument();
  });

  it('HelpSpots exist for registration, rate limit, and save', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByTestId('help-spot-admin-registration')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-rate-limit')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-save-settings')).toBeInTheDocument();
  });

  it('first visit triggers onboarding after delay', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
  });

  it('subsequent visits do not auto-trigger onboarding', async () => {
    localStorageMock.setItem('wrzdj-help-seen-admin-settings', '1');
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeInTheDocument();
  });
});
