import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    getAdminSettings: vi.fn(),
    updateAdminSettings: vi.fn(),
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
import { api, type SystemSettings } from '@/lib/api';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <AdminSettingsPage />
    </HelpProvider>
  );
}

const defaultSettings = {
  registration_enabled: true,
  search_rate_limit_per_minute: 10,
  spotify_enabled: true,
  tidal_enabled: true,
  beatport_enabled: true,
  bridge_enabled: true,
  llm_enabled: true,
  llm_model: 'claude-haiku-4-5-20251001',
  llm_rate_limit_per_minute: 6,
};

describe('AdminSettingsPage', () => {
  beforeEach(() => {
    localStorageMock.clear();
    // Suppress onboarding so it doesn't interfere with tests
    localStorageMock.setItem('wrzdj-help-seen-admin-settings', '1');
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state initially', () => {
    vi.mocked(api.getAdminSettings).mockReturnValue(new Promise(() => {}));

    renderWithProviders();

    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });

  it('loads and displays settings', async () => {
    vi.mocked(api.getAdminSettings).mockResolvedValue(defaultSettings);

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(screen.getByText('System Settings')).toBeInTheDocument();
    expect(screen.getByLabelText(/Search Rate Limit/)).toHaveValue(10);
  });

  it('shows error when settings fail to load', async () => {
    vi.mocked(api.getAdminSettings).mockRejectedValue(new Error('Network error'));

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
  });

  it('toggles registration checkbox', async () => {
    vi.mocked(api.getAdminSettings).mockResolvedValue(defaultSettings);

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('changes rate limit input', async () => {
    vi.mocked(api.getAdminSettings).mockResolvedValue(defaultSettings);

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const input = screen.getByLabelText(/Search Rate Limit/);
    fireEvent.change(input, { target: { value: '50' } });
    expect(input).toHaveValue(50);
  });

  it('saves settings successfully', async () => {
    vi.mocked(api.getAdminSettings).mockResolvedValue(defaultSettings);
    vi.mocked(api.updateAdminSettings).mockResolvedValue({
      ...defaultSettings,
      registration_enabled: false,
    });

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Toggle registration off
    fireEvent.click(screen.getByRole('checkbox'));

    // Click save and flush async
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText('Settings saved')).toBeInTheDocument();
    expect(api.updateAdminSettings).toHaveBeenCalledWith(
      expect.objectContaining({ registration_enabled: false })
    );
  });

  it('shows error when save fails and UI remains editable', async () => {
    vi.mocked(api.getAdminSettings).mockResolvedValue(defaultSettings);
    vi.mocked(api.updateAdminSettings).mockRejectedValue(new Error('Permission denied'));

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    // Save button should be re-enabled after failure
    expect(screen.getByRole('button', { name: 'Save Settings' })).not.toBeDisabled();
  });

  it('shows Saving... text while request is in flight', async () => {
    vi.mocked(api.getAdminSettings).mockResolvedValue(defaultSettings);
    let resolveUpdate!: (value: SystemSettings | PromiseLike<SystemSettings>) => void;
    vi.mocked(api.updateAdminSettings).mockReturnValue(
      new Promise<SystemSettings>((resolve) => { resolveUpdate = resolve; })
    );

    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    });

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    // Clean up - resolve the promise so test doesn't leak
    await act(async () => {
      resolveUpdate!(defaultSettings);
      await vi.advanceTimersByTimeAsync(100);
    });
  });
});
