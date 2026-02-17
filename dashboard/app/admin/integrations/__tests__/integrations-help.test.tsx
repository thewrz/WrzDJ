import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    getIntegrations: vi.fn().mockResolvedValue({
      services: [
        {
          service: 'spotify',
          display_name: 'Spotify',
          enabled: true,
          configured: true,
          capabilities: { auth: 'configured', catalog_search: 'configured', playlist_sync: 'not_implemented' },
          last_check_error: null,
        },
      ],
    }),
  },
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

import AdminIntegrationsPage from '../page';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <AdminIntegrationsPage />
    </HelpProvider>
  );
}

describe('Admin integrations help integration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HelpButton renders on integrations page', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Toggle help mode' })).toBeInTheDocument();
  });

  it('HelpSpots exist for service table, toggles, and badge legend', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByTestId('help-spot-admin-service-table')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-service-toggles')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-badge-legend')).toBeInTheDocument();
  });

  it('first visit triggers onboarding after delay', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
  });

  it('subsequent visits do not auto-trigger onboarding', async () => {
    localStorageMock.setItem('wrzdj-help-seen-admin-integrations', '1');
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeInTheDocument();
  });
});
