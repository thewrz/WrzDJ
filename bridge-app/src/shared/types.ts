/** Authentication state shared between main and renderer */
export interface AuthState {
  readonly isAuthenticated: boolean;
  readonly username: string | null;
  readonly apiUrl: string;
}

/** Bridge operational status */
export interface BridgeStatus {
  readonly isRunning: boolean;
  readonly connectedDevice: string | null;
  readonly eventCode: string | null;
  readonly eventName: string | null;
  readonly currentTrack: TrackDisplay | null;
  readonly deckStates: readonly DeckDisplay[];
}

/** Track info for display in the GUI */
export interface TrackDisplay {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly deckId: string;
  readonly startedAt: number;
}

/** Per-deck display state */
export interface DeckDisplay {
  readonly deckId: string;
  readonly state: string;
  readonly trackTitle: string | null;
  readonly trackArtist: string | null;
  readonly isPlaying: boolean;
  readonly isMaster: boolean;
  readonly faderLevel: number;
}

/** Bridge detection settings */
export interface BridgeSettings {
  readonly liveThresholdSeconds: number;
  readonly pauseGraceSeconds: number;
  readonly nowPlayingPauseSeconds: number;
  readonly useFaderDetection: boolean;
  readonly masterDeckPriority: boolean;
  readonly minPlaySeconds: number;
}

/** Event info from the backend */
export interface EventInfo {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly expiresAt: string;
}

/** Config passed to BridgeRunner.start() */
export interface BridgeRunnerConfig {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly eventCode: string;
  readonly settings: BridgeSettings;
}

/** IPC channel names */
export const IPC_CHANNELS = {
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_STATE: 'auth:getState',
  AUTH_CHANGED: 'auth:changed',
  EVENTS_FETCH: 'events:fetch',
  BRIDGE_START: 'bridge:start',
  BRIDGE_STOP: 'bridge:stop',
  BRIDGE_STATUS: 'bridge:status',
  BRIDGE_LOG: 'bridge:log',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
} as const;

/** Default bridge settings (fader/master defaults off for 3rd-party mixer compat) */
export const DEFAULT_SETTINGS: BridgeSettings = {
  liveThresholdSeconds: 15,
  pauseGraceSeconds: 3,
  nowPlayingPauseSeconds: 10,
  useFaderDetection: false,
  masterDeckPriority: false,
  minPlaySeconds: 5,
};
