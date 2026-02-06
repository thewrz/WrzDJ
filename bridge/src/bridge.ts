/**
 * Bridge logic for communicating with WrzDJ backend.
 */
import { config } from "./config.js";
import type { BridgeStatusPayload, NowPlayingPayload } from "./types.js";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

/** Track key for deduplication (artist::title, lowercase) */
let lastTrackKey: string | null = null;

/** Timestamp of last successful POST */
let lastPostTime = 0;

/**
 * Generate a unique key for a track (used for deduplication).
 */
function makeTrackKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
}

/**
 * Check if we should skip this track (duplicate or too soon).
 */
export function shouldSkipTrack(artist: string, title: string): boolean {
  // Skip if no title
  if (!title) {
    return true;
  }

  // Skip if same track as last
  const key = makeTrackKey(artist, title);
  if (key === lastTrackKey) {
    return true;
  }

  // Debounce rapid changes (5 second cooldown)
  const now = Date.now();
  if (now - lastPostTime < config.minPlaySeconds * 1000) {
    console.log(
      `[Bridge] Debouncing track change (${now - lastPostTime}ms since last, threshold: ${config.minPlaySeconds}s)`
    );
    return true;
  }

  return false;
}

/**
 * Update the last track info after successful POST.
 */
export function updateLastTrack(artist: string, title: string): void {
  lastTrackKey = makeTrackKey(artist, title);
  lastPostTime = Date.now();
}

/**
 * Make an HTTP POST with retry logic.
 */
async function postWithRetry(
  endpoint: string,
  payload: NowPlayingPayload | BridgeStatusPayload
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${config.apiUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-API-Key": config.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      console.log(`[Bridge] POST ${endpoint} succeeded`);
      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.log(
          `[Bridge] Retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms: ${lastError.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  console.error(
    `[Bridge] POST ${endpoint} failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`
  );
}

/**
 * Post a now-playing update to the backend.
 */
export async function postNowPlaying(
  title: string,
  artist: string,
  album?: string,
  deck?: string
): Promise<void> {
  const payload: NowPlayingPayload = {
    event_code: config.eventCode,
    title,
    artist,
    album: album ?? null,
    deck: deck ?? null,
  };

  console.log(`[Bridge] Now Playing: "${title}" by ${artist}`);
  await postWithRetry("/api/bridge/nowplaying", payload);
}

/**
 * Post bridge connection status to the backend.
 */
export async function postBridgeStatus(
  connected: boolean,
  deviceName?: string
): Promise<void> {
  const payload: BridgeStatusPayload = {
    event_code: config.eventCode,
    connected,
    device_name: deviceName ?? null,
  };

  console.log(
    `[Bridge] Status: ${connected ? "Connected" : "Disconnected"}${deviceName ? ` (${deviceName})` : ""}`
  );
  await postWithRetry("/api/bridge/status", payload);
}
