import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventManagementTab } from '../EventManagementTab';

vi.mock('@/lib/help/HelpContext', () => ({
  useHelp: () => ({
    helpMode: false, onboardingActive: false, currentStep: 0, activeSpotId: null,
    toggleHelpMode: vi.fn(), registerSpot: vi.fn(() => vi.fn()),
    getSpotsForPage: vi.fn(() => []), startOnboarding: vi.fn(),
    nextStep: vi.fn(), prevStep: vi.fn(), skipOnboarding: vi.fn(),
    hasSeenPage: vi.fn(() => false),
  }),
}));

vi.mock('../KioskControlsCard', () => ({
  KioskControlsCard: () => <div data-testid="kiosk-controls">KioskControls</div>,
}));

vi.mock('../StreamOverlayCard', () => ({
  StreamOverlayCard: () => <div data-testid="stream-overlay">StreamOverlay</div>,
}));

vi.mock('../BridgeStatusCard', () => ({
  BridgeStatusCard: () => <div data-testid="bridge-status">BridgeStatus</div>,
}));

vi.mock('../CloudProvidersCard', () => ({
  CloudProvidersCard: () => <div data-testid="cloud-providers">CloudProviders</div>,
}));

vi.mock('../EventCustomizationCard', () => ({
  EventCustomizationCard: () => <div data-testid="event-customization">EventCustomization</div>,
}));

const baseProps = {
  code: 'ABC123',
  event: { id: 1, name: 'Test', code: 'ABC123', is_active: true, expires_at: '', created_at: '', requests_open: true, now_playing_hidden: false, auto_hide_minutes: 10 } as never,
  bridgeConnected: false,
  requestsOpen: true,
  togglingRequests: false,
  onToggleRequests: vi.fn(),
  nowPlayingHidden: false,
  togglingNowPlaying: false,
  onToggleNowPlaying: vi.fn(),
  autoHideInput: '10',
  autoHideMinutes: 10,
  savingAutoHide: false,
  onAutoHideInputChange: vi.fn(),
  onSaveAutoHide: vi.fn(),
  tidalStatus: null,
  tidalSyncEnabled: false,
  togglingTidalSync: false,
  onToggleTidalSync: vi.fn(),
  onConnectTidal: vi.fn(),
  onDisconnectTidal: vi.fn(),
  beatportStatus: null,
  beatportSyncEnabled: false,
  togglingBeatportSync: false,
  onToggleBeatportSync: vi.fn(),
  onConnectBeatport: vi.fn(),
  onDisconnectBeatport: vi.fn(),
  kioskDisplayOnly: false,
  togglingDisplayOnly: false,
  onToggleDisplayOnly: vi.fn(),
  uploadingBanner: false,
  onBannerSelect: vi.fn(),
  onDeleteBanner: vi.fn(),
};

describe('EventManagementTab', () => {
  it('renders KioskControlsCard', () => {
    render(<EventManagementTab {...baseProps} />);
    expect(screen.getByTestId('kiosk-controls')).toBeTruthy();
  });

  it('renders StreamOverlayCard', () => {
    render(<EventManagementTab {...baseProps} />);
    expect(screen.getByTestId('stream-overlay')).toBeTruthy();
  });

  it('renders BridgeStatusCard', () => {
    render(<EventManagementTab {...baseProps} />);
    expect(screen.getByTestId('bridge-status')).toBeTruthy();
  });

  it('renders CloudProvidersCard', () => {
    render(<EventManagementTab {...baseProps} />);
    expect(screen.getByTestId('cloud-providers')).toBeTruthy();
  });

  it('renders EventCustomizationCard', () => {
    render(<EventManagementTab {...baseProps} />);
    expect(screen.getByTestId('event-customization')).toBeTruthy();
  });
});
