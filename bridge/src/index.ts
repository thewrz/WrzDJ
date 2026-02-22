/**
 * WrzDJ Bridge
 *
 * Connects to DJ equipment via a plugin system and reports track changes
 * to the WrzDJ backend.
 *
 * Environment variables:
 *   WRZDJ_API_URL           - Backend API URL (default: http://localhost:8000)
 *   WRZDJ_BRIDGE_API_KEY    - API key for authentication (required)
 *   WRZDJ_EVENT_CODE        - Event code to report tracks for (required)
 *   WRZDJ_PLUGIN            - Plugin to use (default: stagelinq)
 *   MIN_PLAY_SECONDS        - Debounce threshold in seconds (default: 5)
 *   LIVE_THRESHOLD_SECONDS  - Seconds before track is considered "live" (default: 15)
 *   PAUSE_GRACE_SECONDS     - Seconds of pause tolerated before resetting (default: 3)
 *   USE_FADER_DETECTION     - Require fader > 0 for live detection (default: false)
 *   MASTER_DECK_PRIORITY    - Only report from master deck (default: false)
 */
import { config, validateConfig } from "./config.js";
import {
  clearNowPlaying,
  postBridgeStatus,
  postNowPlaying,
  shouldSkipTrack,
  updateLastTrack,
} from "./bridge.js";
import type { DeckLiveEvent } from "./deck-state.js";
import { Logger } from "./logger.js";
import { getPlugin } from "./plugin-registry.js";
import { PluginBridge } from "./plugin-bridge.js";
import type { PluginConnectionEvent } from "./plugin-types.js";

const log = new Logger("Bridge");

// Register built-in plugins
import "./plugins/index.js";

let pluginBridge: PluginBridge | null = null;

async function main(): Promise<void> {
  log.info("WrzDJ Bridge starting...");

  // Validate configuration
  validateConfig();
  log.info(`API URL: ${config.apiUrl}`);
  log.info(`Event Code: ${config.eventCode}`);
  log.info(`Plugin: ${config.plugin}`);
  log.info(`Live Threshold: ${config.liveThresholdSeconds}s`);
  log.info(`Pause Grace: ${config.pauseGraceSeconds}s`);
  log.info(`Now Playing Pause: ${config.nowPlayingPauseSeconds}s`);
  log.info(`Min Play Seconds: ${config.minPlaySeconds}s`);
  log.info(`Fader Detection: ${config.useFaderDetection}`);
  log.info(`Master Deck Priority: ${config.masterDeckPriority}`);

  // Create the plugin
  const plugin = getPlugin(config.plugin);
  if (!plugin) {
    throw new Error(
      `Unknown plugin "${config.plugin}". Available plugins: stagelinq`
    );
  }

  // Create the plugin bridge
  pluginBridge = new PluginBridge(plugin, {
    liveThresholdSeconds: config.liveThresholdSeconds,
    pauseGraceSeconds: config.pauseGraceSeconds,
    nowPlayingPauseSeconds: config.nowPlayingPauseSeconds,
    useFaderDetection: config.useFaderDetection,
    masterDeckPriority: config.masterDeckPriority,
  });

  // Forward logs
  pluginBridge.on("log", (message: string) => {
    log.info(message);
  });

  // Handle track going "live"
  pluginBridge.on("deckLive", async (event: DeckLiveEvent) => {
    const { deckId, track } = event;

    if (shouldSkipTrack(track.artist, track.title)) {
      return;
    }

    log.info(`Deck ${deckId} LIVE: "${track.title}" by ${track.artist}`);

    updateLastTrack(track.artist, track.title);
    await postNowPlaying(track.title, track.artist, track.album, deckId);
  });

  // Handle heartbeat — keep bridge_last_seen fresh on the backend
  pluginBridge.on("heartbeat", async () => {
    await postBridgeStatus(true);
  });

  // Handle authoritative now-playing clear
  pluginBridge.on("clearNowPlaying", async () => {
    await clearNowPlaying();
  });

  // Handle connection status
  pluginBridge.on("connection", async (event: PluginConnectionEvent) => {
    if (event.connected) {
      log.info(`Device connected: ${event.deviceName}`);
      await postBridgeStatus(true, event.deviceName);
    } else {
      log.info("Device disconnected");
      await postBridgeStatus(false);
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info(`Received ${signal}, shutting down...`);
    if (pluginBridge) {
      await pluginBridge.stop();
    }
    await clearNowPlaying();
    await postBridgeStatus(false);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start the plugin bridge
  await pluginBridge.start();
}

// Run the bridge
main().catch((err: Error) => {
  log.error(`Fatal error: ${err.message}`);
  if (pluginBridge) {
    pluginBridge.stop().catch(() => {});
  }
  process.exit(1);
});
