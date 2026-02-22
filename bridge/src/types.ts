/**
 * TypeScript interfaces for bridge data structures.
 */

/** Payload sent to POST /api/bridge/nowplaying */
export interface NowPlayingPayload {
  event_code: string;
  title: string;
  artist: string;
  album?: string | null;
  deck?: string | null;
  /** True when this track is being replayed from the buffer after backend recovery */
  delayed?: boolean;
}

/** Payload sent to POST /api/bridge/status */
export interface BridgeStatusPayload {
  event_code: string;
  connected: boolean;
  device_name?: string | null;
}
