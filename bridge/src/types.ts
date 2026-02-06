/**
 * TypeScript interfaces for bridge data structures.
 */

/** Track information from StageLinQ */
export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  deck?: string;
}

/** Payload sent to POST /api/bridge/nowplaying */
export interface NowPlayingPayload {
  event_code: string;
  title: string;
  artist: string;
  album?: string | null;
  deck?: string | null;
}

/** Payload sent to POST /api/bridge/status */
export interface BridgeStatusPayload {
  event_code: string;
  connected: boolean;
  device_name?: string | null;
}
