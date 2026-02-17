import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    getAISettings: vi.fn().mockResolvedValue({
      llm_enabled: true,
      llm_model: 'claude-haiku-4-5-20251001',
      llm_rate_limit_per_minute: 3,
      api_key_configured: true,
      api_key_masked: '...abcd',
    }),
    getAIModels: vi.fn().mockResolvedValue({
      models: [{ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }],
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

import AdminAISettingsPage from '../page';
import { HelpProvider } from '@/lib/help/HelpContext';

function renderWithProviders() {
  return render(
    <HelpProvider>
      <AdminAISettingsPage />
    </HelpProvider>
  );
}

describe('Admin AI settings help integration', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HelpButton renders on AI settings page', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByRole('button', { name: 'Toggle help mode' })).toBeInTheDocument();
  });

  it('HelpSpots exist for key, enable, model, and rate', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getByTestId('help-spot-admin-ai-key')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-ai-enable')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-ai-model')).toBeInTheDocument();
    expect(screen.getByTestId('help-spot-admin-ai-rate')).toBeInTheDocument();
  });

  it('first visit triggers onboarding after delay', async () => {
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument();
  });

  it('subsequent visits do not auto-trigger onboarding', async () => {
    localStorageMock.setItem('wrzdj-help-seen-admin-ai', '1');
    renderWithProviders();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.queryByTestId('onboarding-overlay')).not.toBeInTheDocument();
  });
});
