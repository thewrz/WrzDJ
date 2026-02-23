import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminAISettingsPage from '../page';
import { api } from '@/lib/api';

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    role: 'admin',
    logout: vi.fn(),
  }),
}));

vi.mock('@/lib/help/HelpContext', () => ({
  useHelp: () => ({
    helpMode: false,
    onboardingActive: false,
    currentStep: 0,
    activeSpotId: null,
    toggleHelpMode: vi.fn(),
    registerSpot: vi.fn(() => vi.fn()),
    getSpotsForPage: vi.fn(() => []),
    startOnboarding: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    skipOnboarding: vi.fn(),
    hasSeenPage: vi.fn(() => true),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/ai',
}));

describe('AdminAISettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    vi.spyOn(api, 'getAISettings').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(api, 'getAIModels').mockImplementation(() => new Promise(() => {}));

    render(<AdminAISettingsPage />);
    expect(screen.getByText('Loading AI settings...')).toBeInTheDocument();
  });

  it('renders settings after load', async () => {
    vi.spyOn(api, 'getAISettings').mockResolvedValue({
      llm_enabled: true,
      llm_model: 'claude-haiku-4-5-20251001',
      llm_rate_limit_per_minute: 3,
      api_key_configured: true,
      api_key_masked: '...abcd',
    });
    vi.spyOn(api, 'getAIModels').mockResolvedValue({
      models: [
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
        { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
      ],
    });

    render(<AdminAISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('AI / LLM Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('...abcd')).toBeInTheDocument();
  });

  it('shows not configured badge when no API key', async () => {
    vi.spyOn(api, 'getAISettings').mockResolvedValue({
      llm_enabled: false,
      llm_model: 'claude-haiku-4-5-20251001',
      llm_rate_limit_per_minute: 3,
      api_key_configured: false,
      api_key_masked: 'Not configured',
    });
    vi.spyOn(api, 'getAIModels').mockResolvedValue({ models: [] });

    render(<AdminAISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Not Configured')).toBeInTheDocument();
    });
  });

  it('calls updateAISettings on save', async () => {
    vi.spyOn(api, 'getAISettings').mockResolvedValue({
      llm_enabled: true,
      llm_model: 'claude-haiku-4-5-20251001',
      llm_rate_limit_per_minute: 3,
      api_key_configured: true,
      api_key_masked: '...abcd',
    });
    vi.spyOn(api, 'getAIModels').mockResolvedValue({
      models: [{ id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }],
    });
    const updateSpy = vi.spyOn(api, 'updateAISettings').mockResolvedValue({
      llm_enabled: true,
      llm_model: 'claude-haiku-4-5-20251001',
      llm_rate_limit_per_minute: 3,
      api_key_configured: true,
      api_key_masked: '...abcd',
    });

    render(<AdminAISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Save Settings')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled();
    });
  });

  it('shows error on fetch failure', async () => {
    vi.spyOn(api, 'getAISettings').mockRejectedValue(new Error('Network error'));
    vi.spyOn(api, 'getAIModels').mockRejectedValue(new Error('Network error'));

    render(<AdminAISettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load AI settings')).toBeInTheDocument();
    });
  });
});
