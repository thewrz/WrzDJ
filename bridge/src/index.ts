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
 *   USE_FADER_DETECTION     - Require fader > 0 for live detection (default: false)
 *   MASTER_DECK_PRIORITY    - Only report from master deck (default: false)
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
  nowPlayingPauseSeconds: config.nowPlayingPauseSeconds,
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
  console.log(`[Bridge] Now Playing Pause: ${config.nowPlayingPauseSeconds}s`);
  console.log(`[Bridge] Min Play Seconds: ${config.minPlaySeconds}s`);
  console.log(`[Bridge] Fader Detection: ${config.useFaderDetection}`);
  console.log(`[Bridge] Master Deck Priority: ${config.masterDeckPriority}`);

  // Forward DeckStateManager diagnostic logs to console
  deckManager.on("log", (message: string) => {
    console.log(`[Bridge] ${message}`);
  });

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

  // Configure StageLinQ options BEFORE accessing StageLinq.devices or
  // StageLinq.logger. The options setter resets the internal singleton
  // instance, so any event handlers registered beforehand are orphaned.
  StageLinq.options = {
    downloadDbSources: false,
    enableFileTranfer: true,
  };

  // Forward stagelinq library's internal debug logs to console
  StageLinq.logger.on("any", (...args: unknown[]) => {
    console.log(`[StageLinQ] ${args.map(String).join(" ")}`);
  });

  // Handle now-playing events from DJ equipment (track metadata + play state)
  // The nowPlaying event is emitted when a track starts playing on a deck
  StageLinq.devices.on("nowPlaying", (status) => {
    console.log(`[Bridge] StageLinQ nowPlaying event: deck=${status.deck ?? 'undefined'} title="${status.title ?? ''}" artist="${status.artist ?? ''}" play=${status.play} playState=${status.playState}`);

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
      // New track loaded - update info
      deckManager.updateTrackInfo(deckId, {
        title,
        artist,
        album: status.album,
      });
    }

    // Use EXPLICIT play state - don't assume true
    // The play/playState booleans indicate actual play state
    const isPlaying = status.play === true || status.playState === true;

    // Only update play state if we have explicit info
    if (typeof status.play === "boolean" || typeof status.playState === "boolean") {
      deckManager.updatePlayState(deckId, isPlaying);
    }
  });

  // Handle state changed events (play state, faders, master deck)
  // stagelinq v3 emits stateChanged for real-time state updates
  StageLinq.devices.on("stateChanged", (status) => {
    if (!status.deck) {
      console.log(`[Bridge] StageLinQ stateChanged event without deck ID, ignoring:`, JSON.stringify(status));
      return;
    }

    const deckId = status.deck;
    console.log(`[Bridge] StageLinQ stateChanged: deck=${deckId} play=${status.play} playState=${status.playState} externalMixerVolume=${status.externalMixerVolume} masterStatus=${status.masterStatus}`);

    // Update play state if provided
    if (typeof status.play === "boolean" || typeof status.playState === "boolean") {
      const isPlaying = status.play === true || status.playState === true;
      deckManager.updatePlayState(deckId, isPlaying);
    }

    // Update fader level if provided
    if (typeof status.externalMixerVolume === "number") {
      deckManager.updateFaderLevel(deckId, status.externalMixerVolume);
    }

    // Update master deck if provided
    if (status.masterStatus === true) {
      deckManager.setMasterDeck(deckId);
    }
  });

  // Handle per-device connection (emitted for each device that connects successfully)
  StageLinq.devices.on("connected", async (info) => {
    const deviceName = info?.software?.name || "Unknown Device";
    const deviceVersion = info?.software?.version || "unknown";
    const deviceAddress = info?.address || "unknown";
    console.log(`[Bridge] Device connected: ${deviceName} v${deviceVersion} at ${deviceAddress}`);
    await postBridgeStatus(true, deviceName);
  });

  // Handle all devices ready (StateMap initialized — track events will now flow)
  StageLinq.devices.on("ready", () => {
    console.log("[Bridge] All devices ready — StateMap initialized, listening for tracks");
  });

  // Handle device disconnect
  StageLinq.devices.on("disconnect", async () => {
    console.log("[Bridge] Device disconnected");
    await postBridgeStatus(false);
  });

  // Connect to StageLinQ network
  console.log("[Bridge] Connecting to StageLinQ network...");
  await StageLinq.connect();
  console.log("[Bridge] Listening for DJ equipment...");
}

// Run the bridge
main().catch((err: Error) => {
  console.error("[Bridge] Fatal error:", err.message);
  deckManager.destroy();
  process.exit(1);
});
