/**
 * WrzDJ StageLinQ Bridge
 *
 * Connects to Denon DJ equipment via StageLinQ protocol and reports
 * track changes to the WrzDJ backend.
 *
 * Environment variables:
 *   WRZDJ_API_URL           - Backend API URL (default: http://localhost:8000)
 *   WRZDJ_BRIDGE_API_KEY    - API key for authentication (required)
 *   WRZDJ_EVENT_CODE        - Event code to report tracks for (required)
 *   MIN_PLAY_SECONDS        - Debounce threshold in seconds (default: 5)
 *   LIVE_THRESHOLD_SECONDS  - Seconds before track is considered "live" (default: 8)
 *   PAUSE_GRACE_SECONDS     - Seconds of pause tolerated before resetting (default: 3)
 *   USE_FADER_DETECTION     - Require fader > 0 for live detection (default: true)
 *   MASTER_DECK_PRIORITY    - Only report from master deck (default: true)
 */
import { StageLinq } from "stagelinq";
import { config, validateConfig } from "./config.js";
import {
  postBridgeStatus,
  postNowPlaying,
  shouldSkipTrack,
  updateLastTrack,
} from "./bridge.js";
import { DeckStateManager } from "./deck-state-manager.js";
import type { DeckLiveEvent } from "./deck-state.js";

// Create deck state manager for robust track detection
const deckManager = new DeckStateManager({
  liveThresholdSeconds: config.liveThresholdSeconds,
  pauseGraceSeconds: config.pauseGraceSeconds,
  useFaderDetection: config.useFaderDetection,
  masterDeckPriority: config.masterDeckPriority,
});

async function main(): Promise<void> {
  console.log("[Bridge] WrzDJ StageLinQ Bridge starting...");

  // Validate configuration
  validateConfig();
  console.log(`[Bridge] API URL: ${config.apiUrl}`);
  console.log(`[Bridge] Event Code: ${config.eventCode}`);
  console.log(`[Bridge] Live Threshold: ${config.liveThresholdSeconds}s`);
  console.log(`[Bridge] Pause Grace: ${config.pauseGraceSeconds}s`);
  console.log(`[Bridge] Fader Detection: ${config.useFaderDetection}`);
  console.log(`[Bridge] Master Deck Priority: ${config.masterDeckPriority}`);

  // Handle track going "live" (after threshold, with conditions met)
  deckManager.on("deckLive", async (event: DeckLiveEvent) => {
    const { deckId, track } = event;

    // Apply existing deduplication logic
    if (shouldSkipTrack(track.artist, track.title)) {
      return;
    }

    console.log(
      `[Bridge] Deck ${deckId} LIVE: "${track.title}" by ${track.artist}`
    );

    // Update tracking state and post to backend
    updateLastTrack(track.artist, track.title);
    await postNowPlaying(track.title, track.artist, track.album, deckId);
  });

  // Handle now-playing events from DJ equipment (track metadata + play state)
  // The nowPlaying event is emitted when a track starts playing on a deck
  StageLinq.devices.on("nowPlaying", (status) => {
    const deckId = status.deck || "1";
    const title = status.title || "";
    const artist = status.artist || "";
    const currentState = deckManager.getDeckState(deckId);

    if (!title) {
      // Track unloaded or stopped
      deckManager.updateTrackInfo(deckId, null);
      return;
    }

    // Check if this is a new track (different from current)
    const isNewTrack =
      !currentState.track ||
      currentState.track.title !== title ||
      currentState.track.artist !== artist;

    if (isNewTrack) {
      // New track loaded - update info and start playing
      deckManager.updateTrackInfo(deckId, {
        title,
        artist,
        album: status.album,
      });
    }

    // The nowPlaying event implies the track is playing
    // Use explicit isPlaying if provided, otherwise assume true
    const isPlaying = status.isPlaying !== false;
    deckManager.updatePlayState(deckId, isPlaying);
  });

  // Handle state map events (play state, faders, master deck)
  // Note: stagelinq v3 may emit these - if not, we fall back to timing-only detection
  StageLinq.devices.on("stateMap", (state) => {
    if (!state.deck) return;

    const deckId = state.deck;

    // Update play state if provided
    if (typeof state.isPlaying === "boolean") {
      deckManager.updatePlayState(deckId, state.isPlaying);
    }

    // Update fader level if provided
    if (typeof state.faderLevel === "number") {
      deckManager.updateFaderLevel(deckId, state.faderLevel);
    }

    // Update master deck if provided
    if (state.isMaster === true) {
      deckManager.setMasterDeck(deckId);
    }
  });

  // Handle device ready events
  StageLinq.devices.on("ready", async (info) => {
    const deviceName = info?.software?.name || "Unknown Device";
    console.log(`[Bridge] Device ready: ${deviceName}`);
    await postBridgeStatus(true, deviceName);
  });

  // Handle device disconnect
  StageLinq.devices.on("disconnect", async () => {
    console.log("[Bridge] Device disconnected");
    await postBridgeStatus(false);
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Bridge] Received ${signal}, shutting down...`);
    deckManager.destroy(); // Clean up timers and listeners
    await postBridgeStatus(false);
    await StageLinq.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Connect to StageLinQ network
  console.log("[Bridge] Connecting to StageLinQ network...");
  await StageLinq.connect();
  console.log("[Bridge] Listening for DJ equipment...");
}

// Run the bridge
main().catch((err: Error) => {
  console.error("[Bridge] Fatal error:", err.message);
  process.exit(1);
});
