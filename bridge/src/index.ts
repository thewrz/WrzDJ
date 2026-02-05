/**
 * WrzDJ StageLinQ Bridge
 *
 * Connects to Denon DJ equipment via StageLinQ protocol and reports
 * track changes to the WrzDJ backend.
 *
 * Environment variables:
 *   WRZDJ_API_URL        - Backend API URL (default: http://localhost:8000)
 *   WRZDJ_BRIDGE_API_KEY - API key for authentication (required)
 *   WRZDJ_EVENT_CODE     - Event code to report tracks for (required)
 *   MIN_PLAY_SECONDS     - Debounce threshold in seconds (default: 5)
 */
import { StageLinq } from "stagelinq";
import { config, validateConfig } from "./config.js";
import {
  postBridgeStatus,
  postNowPlaying,
  shouldSkipTrack,
  updateLastTrack,
} from "./bridge.js";

async function main(): Promise<void> {
  console.log("[Bridge] WrzDJ StageLinQ Bridge starting...");

  // Validate configuration
  validateConfig();
  console.log(`[Bridge] API URL: ${config.apiUrl}`);
  console.log(`[Bridge] Event Code: ${config.eventCode}`);
  console.log(`[Bridge] Debounce: ${config.minPlaySeconds}s`);

  // Initialize StageLinQ client
  const stagelinq = new StageLinq({ downloadDbSources: false });

  // Handle now-playing events from DJ equipment
  stagelinq.devices.on("nowPlaying", async (status: unknown) => {
    const trackStatus = status as {
      title?: string;
      artist?: string;
      album?: string;
      deck?: string;
    };

    const title = trackStatus.title || "";
    const artist = trackStatus.artist || "";

    // Skip if we should debounce or dedupe
    if (shouldSkipTrack(artist, title)) {
      return;
    }

    // Update tracking state and post to backend
    updateLastTrack(artist, title);
    await postNowPlaying(title, artist, trackStatus.album, trackStatus.deck);
  });

  // Handle device ready events
  stagelinq.devices.on("ready", async (info: unknown) => {
    const deviceInfo = info as {
      software?: { name?: string; version?: string };
      address?: string;
    };
    const deviceName = deviceInfo?.software?.name || "Unknown Device";
    console.log(`[Bridge] Device ready: ${deviceName}`);
    await postBridgeStatus(true, deviceName);
  });

  // Handle device disconnect
  stagelinq.devices.on("disconnect", async () => {
    console.log("[Bridge] Device disconnected");
    await postBridgeStatus(false);
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Bridge] Received ${signal}, shutting down...`);
    await postBridgeStatus(false);
    await stagelinq.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Connect to StageLinQ network
  console.log("[Bridge] Connecting to StageLinQ network...");
  await stagelinq.connect();
  console.log("[Bridge] Listening for DJ equipment...");
}

// Run the bridge
main().catch((err: Error) => {
  console.error("[Bridge] Fatal error:", err.message);
  process.exit(1);
});
