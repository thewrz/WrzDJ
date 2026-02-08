/**
 * Type declarations for stagelinq library
 *
 * The official types are incomplete - this extends them with the events
 * that are actually emitted at runtime.
 */
declare module "stagelinq" {
  import { EventEmitter } from "events";

  interface DeviceInfo {
    software?: { name?: string; version?: string };
    address?: string;
  }

  interface NowPlayingStatus {
    title?: string;
    artist?: string;
    album?: string;
    deck?: string;
    /** Explicit play state from PlayerStatus.play */
    play?: boolean;
    /** Alternative play state from PlayerStatus.playState */
    playState?: boolean;
    /** Master deck status from PlayerStatus.masterStatus */
    masterStatus?: boolean;
    /** Fader level (0-1) */
    faderLevel?: number;
    /** @deprecated Use play or playState instead */
    isPlaying?: boolean;
  }

  interface StateChangedData {
    deck?: string;
    /** Explicit play state */
    play?: boolean;
    /** Alternative play state */
    playState?: boolean;
    /** Fader level (0-1) */
    faderLevel?: number;
    /** Master deck status */
    masterStatus?: boolean;
  }

  interface StageLinqOptions {
    maxRetries?: number;
    downloadDbSources?: boolean;
    /** Note: typo is in the stagelinq library API */
    enableFileTranfer?: boolean;
  }

  interface DevicesEmitter extends EventEmitter {
    on(event: "nowPlaying", listener: (status: NowPlayingStatus) => void): this;
    on(event: "stateChanged", listener: (status: StateChangedData) => void): this;
    on(event: "trackLoaded", listener: (status: NowPlayingStatus) => void): this;
    on(event: "connected", listener: (info: DeviceInfo) => void): this;
    on(event: "ready", listener: () => void): this;
    on(event: "disconnect", listener: () => void): this;
  }

  export const StageLinq: {
    options: StageLinqOptions;
    devices: DevicesEmitter;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
}
