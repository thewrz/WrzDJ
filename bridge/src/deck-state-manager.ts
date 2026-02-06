/**
 * Deck State Manager
 *
 * Manages a per-deck state machine to determine when tracks are truly "live"
 * (playing to the audience) vs being cued/prepared.
 *
 * State transitions:
 *   EMPTY -> LOADED (track loaded)
 *   LOADED -> CUEING (play started)
 *   CUEING -> PLAYING (threshold reached + conditions met)
 *   CUEING -> LOADED (paused)
 *   PLAYING -> ENDED (long pause)
 *   Any -> EMPTY (track unloaded)
 *   Any -> LOADED (new track loaded)
 */
import { EventEmitter } from "events";
import type {
  DeckState,
  DeckStateType,
  DeckStateManagerConfig,
  DeckLiveEvent,
  TrackInfo,
} from "./deck-state.js";

/** Default deck IDs (1-4) */
const DEFAULT_DECK_IDS = ["1", "2", "3", "4"];

/** Maximum number of decks to prevent unbounded map growth */
const MAX_DECKS = 16;

/**
 * Creates a fresh deck state for a given deck ID.
 */
function createEmptyDeckState(deckId: string): DeckState {
  return {
    deckId,
    state: "EMPTY",
    track: null,
    isPlaying: false,
    playStartTime: null,
    accumulatedPlayTime: 0,
    lastPauseTime: null,
    faderLevel: 1.0, // Default to full for systems without fader data
    isMaster: false,
    hasBeenReported: false,
  };
}

export class DeckStateManager extends EventEmitter {
  private readonly config: DeckStateManagerConfig;
  private readonly decks: Map<string, DeckState>;
  private readonly timers: Map<string, NodeJS.Timeout>;

  constructor(config: DeckStateManagerConfig) {
    super();
    this.config = config;
    this.decks = new Map();
    this.timers = new Map();

    // Initialize default decks
    for (const deckId of DEFAULT_DECK_IDS) {
      this.decks.set(deckId, createEmptyDeckState(deckId));
    }
  }

  /**
   * Get the current state of a deck.
   * @param deckId - The deck identifier (e.g., "1", "2", "3", "4")
   * @returns The current deck state
   * @throws Error if maximum deck limit is reached
   */
  getDeckState(deckId: string): DeckState {
    let state = this.decks.get(deckId);
    if (!state) {
      if (this.decks.size >= MAX_DECKS) {
        throw new Error(`Maximum deck limit (${MAX_DECKS}) reached`);
      }
      state = createEmptyDeckState(deckId);
      this.decks.set(deckId, state);
    }
    return state;
  }

  /**
   * Update track information for a deck.
   */
  updateTrackInfo(deckId: string, track: TrackInfo | null): void {
    const currentState = this.getDeckState(deckId);

    // Clear any pending timers
    this.clearTimer(deckId);

    if (track === null) {
      // Track unloaded - reset to empty
      this.decks.set(deckId, {
        ...createEmptyDeckState(deckId),
        faderLevel: currentState.faderLevel,
        isMaster: currentState.isMaster,
      });
      return;
    }

    // New track loaded - reset state but keep fader/master
    this.decks.set(deckId, {
      ...createEmptyDeckState(deckId),
      state: "LOADED",
      track: { ...track },
      faderLevel: currentState.faderLevel,
      isMaster: currentState.isMaster,
    });
  }

  /**
   * Update play/pause state for a deck.
   */
  updatePlayState(deckId: string, isPlaying: boolean): void {
    const currentState = this.getDeckState(deckId);

    // Can't play if no track loaded
    if (currentState.state === "EMPTY") {
      return;
    }

    // Already in this state
    if (currentState.isPlaying === isPlaying) {
      return;
    }

    if (isPlaying) {
      this.handlePlayStart(deckId, currentState);
    } else {
      this.handlePlayStop(deckId, currentState);
    }
  }

  /**
   * Handle play starting on a deck.
   */
  private handlePlayStart(deckId: string, currentState: DeckState): void {
    const now = Date.now();
    let accumulatedTime = 0;

    // Check if we're resuming within grace period
    if (currentState.lastPauseTime !== null) {
      const pauseDuration = now - currentState.lastPauseTime;
      const graceMs = this.config.pauseGraceSeconds * 1000;

      if (pauseDuration <= graceMs) {
        // Within grace period - keep accumulated time
        accumulatedTime = currentState.accumulatedPlayTime;
      }
      // Else: pause was too long, reset accumulated time
    }

    // Determine new state
    let newState: DeckStateType = "CUEING";
    if (currentState.state === "PLAYING" || currentState.state === "ENDED") {
      // Resuming from PLAYING or ENDED state
      newState = "PLAYING";
    }

    this.decks.set(deckId, {
      ...currentState,
      state: newState,
      isPlaying: true,
      playStartTime: now,
      accumulatedPlayTime: accumulatedTime,
      lastPauseTime: null,
    });

    // If CUEING, start the threshold timer
    if (newState === "CUEING") {
      this.startThresholdTimer(deckId, accumulatedTime);
    }
  }

  /**
   * Handle play stopping on a deck.
   */
  private handlePlayStop(deckId: string, currentState: DeckState): void {
    const now = Date.now();

    // Calculate how much play time we accumulated
    let totalAccumulated = currentState.accumulatedPlayTime;
    if (currentState.playStartTime !== null) {
      totalAccumulated += now - currentState.playStartTime;
    }

    // Clear threshold timer
    this.clearTimer(deckId);

    // Determine new state based on current state
    let newState: DeckStateType;
    if (currentState.state === "PLAYING") {
      // Stay in PLAYING during brief pause
      newState = "PLAYING";
      // Start grace period timer
      this.startGracePeriodTimer(deckId);
    } else {
      // CUEING -> LOADED
      newState = "LOADED";
    }

    this.decks.set(deckId, {
      ...currentState,
      state: newState,
      isPlaying: false,
      playStartTime: null,
      accumulatedPlayTime: totalAccumulated,
      lastPauseTime: now,
    });
  }

  /**
   * Start the threshold timer for transitioning CUEING -> PLAYING.
   */
  private startThresholdTimer(deckId: string, accumulatedTime: number): void {
    const thresholdMs = this.config.liveThresholdSeconds * 1000;
    const remainingMs = Math.max(0, thresholdMs - accumulatedTime);

    const timer = setTimeout(() => {
      this.onThresholdReached(deckId);
    }, remainingMs);

    this.timers.set(deckId, timer);
  }

  /**
   * Start the grace period timer for transitioning PLAYING -> ENDED.
   */
  private startGracePeriodTimer(deckId: string): void {
    const graceMs = this.config.pauseGraceSeconds * 1000;

    const timer = setTimeout(() => {
      this.onGracePeriodExpired(deckId);
    }, graceMs);

    this.timers.set(deckId, timer);
  }

  /**
   * Called when the play threshold is reached.
   */
  private onThresholdReached(deckId: string): void {
    const currentState = this.getDeckState(deckId);

    // Must still be in CUEING state and playing
    if (currentState.state !== "CUEING" || !currentState.isPlaying) {
      return;
    }

    // Transition to PLAYING
    this.decks.set(deckId, {
      ...currentState,
      state: "PLAYING",
    });

    // Check if we should report now
    this.checkAndReport(deckId);
  }

  /**
   * Called when grace period expires after pausing in PLAYING state.
   */
  private onGracePeriodExpired(deckId: string): void {
    const currentState = this.getDeckState(deckId);

    // Must be in PLAYING state and not currently playing
    if (currentState.state !== "PLAYING" || currentState.isPlaying) {
      return;
    }

    // Transition to ENDED
    this.decks.set(deckId, {
      ...currentState,
      state: "ENDED",
    });
  }

  /**
   * Update the fader level for a deck.
   */
  updateFaderLevel(deckId: string, level: number): void {
    const currentState = this.getDeckState(deckId);

    // Clamp level to 0-1 range
    const clampedLevel = Math.max(0, Math.min(1, level));

    const wasLow = currentState.faderLevel === 0;
    const isNowUp = clampedLevel > 0;

    this.decks.set(deckId, {
      ...currentState,
      faderLevel: clampedLevel,
    });

    // If fader just came up and we're in PLAYING, check if we should report
    if (wasLow && isNowUp && currentState.state === "PLAYING") {
      this.checkAndReport(deckId);
    }
  }

  /**
   * Set which deck is the master deck.
   */
  setMasterDeck(deckId: string): void {
    const previousMasterState = [...this.decks.values()].find((d) => d.isMaster);

    // Clear master from all decks
    for (const [id, state] of this.decks) {
      if (state.isMaster) {
        this.decks.set(id, {
          ...state,
          isMaster: false,
        });
      }
    }

    // Set new master
    const currentState = this.getDeckState(deckId);
    this.decks.set(deckId, {
      ...currentState,
      isMaster: true,
    });

    // If this deck is in PLAYING and wasn't master before, check if we should report
    const updatedState = this.getDeckState(deckId);
    if (
      updatedState.state === "PLAYING" &&
      (!previousMasterState || previousMasterState.deckId !== deckId)
    ) {
      this.checkAndReport(deckId);
    }
  }

  /**
   * Check if any deck has been explicitly set as master.
   */
  private hasMasterDeck(): boolean {
    return [...this.decks.values()].some((d) => d.isMaster);
  }

  /**
   * Check if a track should be reported and emit event if so.
   */
  private checkAndReport(deckId: string): void {
    const state = this.getDeckState(deckId);

    // Must be in PLAYING state
    if (state.state !== "PLAYING") {
      return;
    }

    // Must not have been reported already
    if (state.hasBeenReported) {
      return;
    }

    // Check fader if enabled
    if (this.config.useFaderDetection && state.faderLevel === 0) {
      return;
    }

    // Check master deck priority if enabled
    // If no master deck is set, allow any deck to report
    if (this.config.masterDeckPriority && this.hasMasterDeck() && !state.isMaster) {
      return;
    }

    // All conditions met - report!
    if (state.track) {
      this.decks.set(deckId, {
        ...state,
        hasBeenReported: true,
      });

      const event: DeckLiveEvent = {
        deckId,
        track: { ...state.track },
      };

      this.emit("deckLive", event);
    }
  }

  /**
   * Check if a track should be reported (external check).
   */
  shouldReportTrack(deckId: string): boolean {
    const state = this.getDeckState(deckId);

    // Must be in PLAYING state and not already reported
    if (state.state !== "PLAYING" || state.hasBeenReported) {
      return false;
    }

    // Check fader if enabled
    if (this.config.useFaderDetection && state.faderLevel === 0) {
      return false;
    }

    // Check master deck priority if enabled
    // If no master deck is set, allow any deck to report
    if (this.config.masterDeckPriority && this.hasMasterDeck() && !state.isMaster) {
      return false;
    }

    return true;
  }

  /**
   * Clear a pending timer for a deck.
   */
  private clearTimer(deckId: string): void {
    const timer = this.timers.get(deckId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(deckId);
    }
  }

  /**
   * Clean up all resources. MUST be called when the manager is no longer needed
   * to prevent memory leaks from active timers.
   *
   * This method:
   * - Clears all pending timers (threshold and grace period)
   * - Removes all event listeners
   *
   * @example
   * const manager = new DeckStateManager(config);
   * // ... use manager ...
   * manager.destroy(); // Clean up when done
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.removeAllListeners();
  }
}
