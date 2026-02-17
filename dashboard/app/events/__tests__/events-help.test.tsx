import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, role: 'admin', logout: vi.fn() }),
}));

// Mock api
vi.mock('@/lib/api', () => ({
  api: {
    getEvents: vi.fn().mockResolvedValue([
      { id: 1, name: 'Test Event', code: 'ABC', expires_at: '2026-12-31T00:00:00Z', is_active: true },
    ]),
  },
}));

// localStorage mock
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

import EventsPage from '../page';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <EventsPage />
    </HelpProvider>
  );
}

describe('Events page help integration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HelpButton renders on events page', async () => {
    renderWithProviders();
    // Wait for events to load
    await vi.advanceTimersByTimeAsync(100);

    expect(screen.getByRole('button', { name: 'Toggle help mode' })).toBeInTheDocument();
  });

  it('HelpSpots exist for header, create, admin, grid', async () => {
    renderWithProviders();
    await vi.advanceTimersByTimeAsync(100);

    expect(screen.getByTestId('help-spot-events-header')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-events-create')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-events-admin')).toBeInTheDocument();
  });

  it('event grid HelpSpot appears after events load', async () => {
    renderWithProviders();
    await vi.advanceTimersByTimeAsync(200);

    expect(screen.getByTestId('help-spot-events-grid')).toBeInTheDocument();
  });

  it('first visit triggers onboarding after delay', async () => {
    renderWithProviders();
    // Flush promises for API call
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // Advance past 500ms auto-trigger delay
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // Onboarding should have auto-triggered
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
  });

  it('subsequent visits do not auto-trigger onboarding', async () => {
    localStorageMock.setItem('wrzdj-help-seen-events', '1');

    renderWithProviders();
    await vi.advanceTimersByTimeAsync(600);

    expect(screen.queryByTestId('onboarding-overlay')).not.toBeInTheDocument();
  });
});
