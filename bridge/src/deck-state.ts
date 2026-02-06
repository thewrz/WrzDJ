/**
 * TypeScript interfaces for deck state management.
 */

/** Possible states for a deck in the state machine */
export type DeckStateType = "EMPTY" | "LOADED" | "CUEING" | "PLAYING" | "ENDED";

/** Track information */
export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
}

/** Complete state of a single deck */
export interface DeckState {
  deckId: string;
  state: DeckStateType;
  track: TrackInfo | null;
  isPlaying: boolean;
  playStartTime: number | null;
  accumulatedPlayTime: number;
  lastPauseTime: number | null;
  faderLevel: number;
  isMaster: boolean;
  hasBeenReported: boolean;
}

/** Configuration options for the deck state manager */
export interface DeckStateManagerConfig {
  /** Seconds of continuous play before reporting track as live */
  liveThresholdSeconds: number;
  /** Seconds of pause before resetting accumulated play time */
  pauseGraceSeconds: number;
  /** Whether to require fader > 0 for live detection */
  useFaderDetection: boolean;
  /** Whether to only report from master deck */
  masterDeckPriority: boolean;
}

/** Event payload when a deck goes live */
export interface DeckLiveEvent {
  deckId: string;
  track: TrackInfo;
}
