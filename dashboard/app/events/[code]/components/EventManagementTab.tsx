'use client';

import type { Event, ArchivedEvent, TidalStatus, BeatportStatus } from '@/lib/api-types';
import { KioskControlsCard } from './KioskControlsCard';
import { StreamOverlayCard } from './StreamOverlayCard';
import { BridgeStatusCard } from './BridgeStatusCard';
import { CloudProvidersCard } from './CloudProvidersCard';
import { EventCustomizationCard } from './EventCustomizationCard';

interface EventManagementTabProps {
  code: string;
  event: Event | ArchivedEvent;
  bridgeConnected: boolean;
  requestsOpen: boolean;
  togglingRequests: boolean;
  onToggleRequests: () => void;
  nowPlayingHidden: boolean;
  togglingNowPlaying: boolean;
  onToggleNowPlaying: () => void;
  autoHideInput: string;
  autoHideMinutes: number;
  savingAutoHide: boolean;
  onAutoHideInputChange: (value: string) => void;
  onSaveAutoHide: () => void;
  kioskDisplayOnly: boolean;
  togglingDisplayOnly: boolean;
  onToggleDisplayOnly: () => void;
  tidalStatus: TidalStatus | null;
  tidalSyncEnabled: boolean;
  togglingTidalSync: boolean;
  onToggleTidalSync: () => void;
  onConnectTidal: () => void;
  onDisconnectTidal: () => void;
  beatportStatus: BeatportStatus | null;
  beatportSyncEnabled: boolean;
  togglingBeatportSync: boolean;
  onToggleBeatportSync: () => void;
  onConnectBeatport: () => void;
  onDisconnectBeatport: () => void;
  uploadingBanner: boolean;
  onBannerSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDeleteBanner: () => void;
}

export function EventManagementTab(props: EventManagementTabProps) {
  return (
    <>
      <KioskControlsCard
        code={props.code}
        requestsOpen={props.requestsOpen}
        togglingRequests={props.togglingRequests}
        onToggleRequests={props.onToggleRequests}
        nowPlayingHidden={props.nowPlayingHidden}
        togglingNowPlaying={props.togglingNowPlaying}
        onToggleNowPlaying={props.onToggleNowPlaying}
        autoHideInput={props.autoHideInput}
        autoHideMinutes={props.autoHideMinutes}
        savingAutoHide={props.savingAutoHide}
        onAutoHideInputChange={props.onAutoHideInputChange}
        onSaveAutoHide={props.onSaveAutoHide}
        kioskDisplayOnly={props.kioskDisplayOnly}
        togglingDisplayOnly={props.togglingDisplayOnly}
        onToggleDisplayOnly={props.onToggleDisplayOnly}
      />

      <StreamOverlayCard code={props.code} />

      <BridgeStatusCard bridgeConnected={props.bridgeConnected} />

      <CloudProvidersCard
        tidalStatus={props.tidalStatus}
        tidalSyncEnabled={props.tidalSyncEnabled}
        togglingTidalSync={props.togglingTidalSync}
        onToggleTidalSync={props.onToggleTidalSync}
        onConnectTidal={props.onConnectTidal}
        onDisconnectTidal={props.onDisconnectTidal}
        beatportStatus={props.beatportStatus}
        beatportSyncEnabled={props.beatportSyncEnabled}
        togglingBeatportSync={props.togglingBeatportSync}
        onToggleBeatportSync={props.onToggleBeatportSync}
        onConnectBeatport={props.onConnectBeatport}
        onDisconnectBeatport={props.onDisconnectBeatport}
      />

      <EventCustomizationCard
        event={props.event}
        uploadingBanner={props.uploadingBanner}
        onBannerSelect={props.onBannerSelect}
        onDeleteBanner={props.onDeleteBanner}
      />
    </>
  );
}
