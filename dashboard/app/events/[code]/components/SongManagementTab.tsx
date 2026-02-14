'use client';

import type { SongRequest, PlayHistoryItem, RecommendedTrack } from '@/lib/api-types';
import { RequestQueueSection } from './RequestQueueSection';
import { SyncReportPanel } from './SyncReportPanel';
import { PlayHistorySection } from './PlayHistorySection';
import { RecommendationsCard } from './RecommendationsCard';

interface SongManagementTabProps {
  code: string;
  requests: SongRequest[];
  isExpiredOrArchived: boolean;
  connectedServices: string[];
  updating: number | null;
  acceptingAll: boolean;
  syncingRequest: number | null;
  onUpdateStatus: (requestId: number, status: string) => void;
  onAcceptAll: () => void;
  onSyncToTidal: (requestId: number) => void;
  onOpenTidalPicker: (requestId: number) => void;
  onOpenBeatportPicker: (requestId: number) => void;
  onScrollToSyncReport: (requestId: number) => void;
  syncReportExpanded: boolean;
  onToggleSyncReport: () => void;
  focusedSyncRequestId: number | null;
  onClearSyncFocus: () => void;
  playHistory: PlayHistoryItem[];
  playHistoryTotal: number;
  exportingHistory: boolean;
  onExportPlayHistory: () => void;
  tidalLinked: boolean;
  beatportLinked: boolean;
  onAcceptTrack: (track: RecommendedTrack) => Promise<void>;
  onDeleteRequest?: (requestId: number) => void;
  onRefreshMetadata?: (requestId: number) => void;
  deletingRequest?: number | null;
  refreshingRequest?: number | null;
}

export function SongManagementTab(props: SongManagementTabProps) {
  return (
    <>
      <RequestQueueSection
        requests={props.requests}
        isExpiredOrArchived={props.isExpiredOrArchived}
        connectedServices={props.connectedServices}
        updating={props.updating}
        acceptingAll={props.acceptingAll}
        syncingRequest={props.syncingRequest}
        onUpdateStatus={props.onUpdateStatus}
        onAcceptAll={props.onAcceptAll}
        onSyncToTidal={props.onSyncToTidal}
        onOpenTidalPicker={props.onOpenTidalPicker}
        onScrollToSyncReport={props.onScrollToSyncReport}
        onDeleteRequest={props.onDeleteRequest}
        onRefreshMetadata={props.onRefreshMetadata}
        deletingRequest={props.deletingRequest}
        refreshingRequest={props.refreshingRequest}
      />

      <SyncReportPanel
        requests={props.requests}
        connectedServices={props.connectedServices}
        expanded={props.syncReportExpanded}
        onToggleExpanded={props.onToggleSyncReport}
        focusedRequestId={props.focusedSyncRequestId}
        onClearFocus={props.onClearSyncFocus}
        onRetrySync={props.onSyncToTidal}
        onOpenTidalPicker={props.onOpenTidalPicker}
        onOpenBeatportPicker={props.onOpenBeatportPicker}
      />

      <PlayHistorySection
        items={props.playHistory}
        total={props.playHistoryTotal}
        exporting={props.exportingHistory}
        onExport={props.onExportPlayHistory}
      />

      {!props.isExpiredOrArchived && (
        <RecommendationsCard
          code={props.code}
          hasAcceptedRequests={props.requests.some(
            (r) => r.status === 'accepted' || r.status === 'played'
          )}
          tidalLinked={props.tidalLinked}
          beatportLinked={props.beatportLinked}
          onAcceptTrack={props.onAcceptTrack}
        />
      )}
    </>
  );
}
