'use client';

import type { Event, ArchivedEvent, TidalStatus, BeatportStatus } from '@/lib/api-types';
import { KioskControlsCard } from './KioskControlsCard';
import { PairedKiosksCard } from './PairedKiosksCard';
import { StreamOverlayCard } from './StreamOverlayCard';
import { BridgeStatusCard } from './BridgeStatusCard';
import { CloudProvidersCard } from './CloudProvidersCard';
import { EventCustomizationCard } from './EventCustomizationCard';
import { HelpSpot } from '@/components/help/HelpSpot';

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
      <HelpSpot spotId="event-kiosk" page="event-manage" order={1} title="Kiosk Controls" description="Toggle requests open/closed, show/hide now-playing, enable display-only mode.">
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
      </HelpSpot>

      <PairedKiosksCard eventCode={props.code} />

      <HelpSpot spotId="event-customization" page="event-manage" order={2} title="Event Customization" description="Upload a banner image to brand your event's kiosk and join pages.">
        <EventCustomizationCard
          event={props.event}
          uploadingBanner={props.uploadingBanner}
          onBannerSelect={props.onBannerSelect}
          onDeleteBanner={props.onDeleteBanner}
        />
      </HelpSpot>

      <HelpSpot spotId="event-stream-overlay" page="event-manage" order={3} title="Stream Overlay" description="Copy the OBS browser source URL to show currently playing track on your stream.">
        <StreamOverlayCard code={props.code} />
      </HelpSpot>

      <HelpSpot spotId="event-bridge" page="event-manage" order={4} title="Bridge Status" description="Shows whether the Bridge App is connected for automatic now-playing detection.">
        <BridgeStatusCard bridgeConnected={props.bridgeConnected} />
      </HelpSpot>

      <HelpSpot spotId="event-cloud" page="event-manage" order={5} title="Cloud Providers" description="Connect Tidal and Beatport to sync accepted requests to your streaming playlists.">
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
      </HelpSpot>
    </>
  );
}
