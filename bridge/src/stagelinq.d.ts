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
    isPlaying?: boolean;
  }

  interface StateMapData {
    deck?: string;
    isPlaying?: boolean;
    faderLevel?: number;
    isMaster?: boolean;
  }

  interface DevicesEmitter extends EventEmitter {
    on(event: "nowPlaying", listener: (status: NowPlayingStatus) => void): this;
    on(event: "stateMap", listener: (state: StateMapData) => void): this;
    on(event: "ready", listener: (info: DeviceInfo) => void): this;
    on(event: "disconnect", listener: () => void): this;
  }

  export const StageLinq: {
    devices: DevicesEmitter;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
}
