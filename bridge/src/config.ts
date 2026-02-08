/**
 * Bridge configuration from environment variables.
 */
export const config = {
  /** WrzDJ API base URL */
  apiUrl: process.env.WRZDJ_API_URL || "http://localhost:8000",

  /** API key for authenticating with the backend */
  apiKey: process.env.WRZDJ_BRIDGE_API_KEY || "",

  /** Event code this bridge is serving */
  eventCode: process.env.WRZDJ_EVENT_CODE || "",

  /** Minimum seconds before reporting a new track (debounce threshold) */
  minPlaySeconds: parseInt(process.env.MIN_PLAY_SECONDS || "5", 10),

  /** Seconds of continuous play before reporting track as live */
  liveThresholdSeconds: parseInt(process.env.LIVE_THRESHOLD_SECONDS || "15", 10),

  /** Seconds current "now playing" deck must pause before switching to another deck */
  nowPlayingPauseSeconds: parseInt(process.env.NOW_PLAYING_PAUSE_SECONDS || "10", 10),

  /** Seconds of pause before resetting accumulated play time */
  pauseGraceSeconds: parseInt(process.env.PAUSE_GRACE_SECONDS || "3", 10),

  /** Whether to require fader > 0 for live detection (default: false for 3rd-party mixer compat) */
  useFaderDetection: process.env.USE_FADER_DETECTION === "true",

  /** Whether to only report from master deck (default: true, opt out with MASTER_DECK_PRIORITY=false) */
  masterDeckPriority: process.env.MASTER_DECK_PRIORITY !== "false",
};

/**
 * Validate required configuration at startup.
 * Throws if required env vars are missing.
 * Warns about insecure HTTP connections to remote servers.
 */
export function validateConfig(): void {
  if (!config.apiKey) {
    throw new Error(
      "WRZDJ_BRIDGE_API_KEY is required. Generate one with: openssl rand -hex 32"
    );
  }
  if (!config.eventCode) {
    throw new Error(
      "WRZDJ_EVENT_CODE is required. This is the event code from the DJ dashboard."
    );
  }

  // Validate numeric config values
  if (Number.isNaN(config.minPlaySeconds) || config.minPlaySeconds < 0) {
    throw new Error("MIN_PLAY_SECONDS must be a non-negative number");
  }
  if (Number.isNaN(config.liveThresholdSeconds) || config.liveThresholdSeconds < 0) {
    throw new Error("LIVE_THRESHOLD_SECONDS must be a non-negative number");
  }
  if (Number.isNaN(config.pauseGraceSeconds) || config.pauseGraceSeconds < 0) {
    throw new Error("PAUSE_GRACE_SECONDS must be a non-negative number");
  }
  if (Number.isNaN(config.nowPlayingPauseSeconds) || config.nowPlayingPauseSeconds < 0) {
    throw new Error("NOW_PLAYING_PAUSE_SECONDS must be a non-negative number");
  }

  // Warn if using HTTP with a non-localhost URL
  try {
    const url = new URL(config.apiUrl);
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol === "http:" && !isLocalhost) {
      console.warn(
        "[Bridge] WARNING: Using HTTP with a remote server. " +
        "Consider using HTTPS for production deployments to protect API keys."
      );
    }
  } catch {
    // Invalid URL format - will fail later when making requests
  }
}
