import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SongManagementTab } from '../SongManagementTab';

vi.mock('../RequestQueueSection', () => ({
  RequestQueueSection: () => <div data-testid="request-queue">RequestQueue</div>,
}));

vi.mock('../SyncReportPanel', () => ({
  SyncReportPanel: () => <div data-testid="sync-report">SyncReport</div>,
}));

vi.mock('../PlayHistorySection', () => ({
  PlayHistorySection: () => <div data-testid="play-history">PlayHistory</div>,
}));

vi.mock('../RecommendationsCard', () => ({
  RecommendationsCard: () => <div data-testid="recommendations">Recommendations</div>,
}));

const baseProps = {
  code: 'ABC123',
  requests: [
    { id: 1, song_title: 'Test', artist_name: 'Artist', status: 'accepted', vote_count: 0, created_at: '', event_id: 1 },
  ] as never[],
  isExpiredOrArchived: false,
  connectedServices: [],
  updating: null,
  acceptingAll: false,
  syncingRequest: null,
  onUpdateStatus: vi.fn(),
  onAcceptAll: vi.fn(),
  onSyncToTidal: vi.fn(),
  onOpenTidalPicker: vi.fn(),
  onOpenBeatportPicker: vi.fn(),
  onScrollToSyncReport: vi.fn(),
  syncReportExpanded: false,
  onToggleSyncReport: vi.fn(),
  focusedSyncRequestId: null,
  onClearSyncFocus: vi.fn(),
  playHistory: [],
  playHistoryTotal: 0,
  exportingHistory: false,
  onExportPlayHistory: vi.fn(),
  tidalLinked: false,
  beatportLinked: false,
  onAcceptTrack: vi.fn(),
};

describe('SongManagementTab', () => {
  it('renders RequestQueueSection', () => {
    render(<SongManagementTab {...baseProps} />);
    expect(screen.getByTestId('request-queue')).toBeTruthy();
  });

  it('renders SyncReportPanel', () => {
    render(<SongManagementTab {...baseProps} />);
    expect(screen.getByTestId('sync-report')).toBeTruthy();
  });

  it('renders PlayHistorySection', () => {
    render(<SongManagementTab {...baseProps} />);
    expect(screen.getByTestId('play-history')).toBeTruthy();
  });

  it('renders RecommendationsCard when not expired', () => {
    render(<SongManagementTab {...baseProps} />);
    expect(screen.getByTestId('recommendations')).toBeTruthy();
  });

  it('hides RecommendationsCard when expired', () => {
    render(<SongManagementTab {...baseProps} isExpiredOrArchived={true} />);
    expect(screen.queryByTestId('recommendations')).toBeNull();
  });
});
