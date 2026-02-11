/**
 * BridgeRunner wraps the PluginBridge for GUI lifecycle control.
 * Delegates equipment detection to the configured plugin via the plugin system.
 */
import { EventEmitter } from 'events';
import { PluginBridge } from '@bridge/plugin-bridge.js';
import { getPlugin } from '@bridge/plugin-registry.js';
import type { DeckLiveEvent, DeckState } from '@bridge/deck-state.js';
import type { NowPlayingPayload, BridgeStatusPayload } from '@bridge/types.js';
import type { PluginConnectionEvent } from '@bridge/plugin-types.js';
import { checkEventHealth } from './event-health-service.js';
import { detectSubnetConflicts, formatConflictWarnings } from './network-check.js';
import type { BridgeRunnerConfig, BridgeStatus, DeckDisplay, TrackDisplay } from '../shared/types.js';

// Register built-in plugins
import '@bridge/plugins/index.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

/**
 * BridgeRunner manages the lifecycle of the bridge via plugins.
 *
 * Events:
 *   'statusChanged' - emitted whenever bridge status changes (for IPC forwarding)
 *   'log' - emitted with log messages for the GUI console
 */
export class BridgeRunner extends EventEmitter {
  private pluginBridge: PluginBridge | null = null;
  private config: BridgeRunnerConfig | null = null;
  private running = false;
  private connectedDevice: string | null = null;
  private currentTrack: TrackDisplay | null = null;
  private lastTrackKey: string | null = null;
  private lastPostTime = 0;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private stopReason: string | null = null;
  private networkWarnings: string[] = [];

  get isRunning(): boolean {
    return this.running;
  }

  async start(config: BridgeRunnerConfig): Promise<void> {
    if (this.running) {
      throw new Error('Bridge is already running');
    }

    this.config = config;
    this.running = true;
    this.lastTrackKey = null;
    this.lastPostTime = 0;
    this.currentTrack = null;
    this.connectedDevice = null;
    this.stopReason = null;
    this.networkWarnings = [];

    const protocol = config.settings.protocol || 'stagelinq';

    this.log(`Starting bridge for event ${config.eventCode}...`);
    this.log(`API URL: ${config.apiUrl}`);
    this.log(`Protocol: ${protocol}`);
    this.log(`Live Threshold: ${config.settings.liveThresholdSeconds}s`);
    this.log(`Fader Detection: ${config.settings.useFaderDetection}`);
    this.log(`Master Deck Priority: ${config.settings.masterDeckPriority}`);

    // Check for network interface conflicts (affects broadcast-based protocols)
    const conflicts = detectSubnetConflicts();
    if (conflicts.length > 0) {
      this.networkWarnings = formatConflictWarnings(conflicts);
      for (const warning of this.networkWarnings) {
        this.log(`WARNING: ${warning}`);
      }
    }

    // Create the plugin
    const plugin = getPlugin(protocol);
    if (!plugin) {
      this.running = false;
      const err = new Error(`Unknown protocol "${protocol}"`);
      this.log(err.message);
      this.emitStatus();
      throw err;
    }

    // Create the PluginBridge
    this.pluginBridge = new PluginBridge(plugin, {
      liveThresholdSeconds: config.settings.liveThresholdSeconds,
      pauseGraceSeconds: config.settings.pauseGraceSeconds,
      nowPlayingPauseSeconds: config.settings.nowPlayingPauseSeconds,
      useFaderDetection: config.settings.useFaderDetection,
      masterDeckPriority: config.settings.masterDeckPriority,
    });

    this.wireEvents();
    this.emitStatus();

    try {
      await this.pluginBridge.start(config.settings.pluginConfig);
      this.log('Plugin started, listening for DJ equipment...');
      this.startHealthCheck();
    } catch (err) {
      this.running = false;
      this.pluginBridge = null;
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Failed to connect: ${message}`);
      this.emitStatus();
      throw err;
    }
  }

  async stop(reason?: string): Promise<void> {
    if (!this.running) return;

    this.stopHealthCheck();

    if (reason) {
      this.stopReason = reason;
      this.log(`Stopping bridge: ${reason}`);
    } else {
      this.log('Stopping bridge...');
    }

    this.running = false;

    if (this.pluginBridge) {
      await this.pluginBridge.stop();
      this.pluginBridge = null;
    }

    try {
      await this.clearNowPlaying();
      await this.postBridgeStatus(false);
    } catch {
      // Best effort on shutdown
    }

    this.connectedDevice = null;
    this.currentTrack = null;
    this.emitStatus();
    this.log('Bridge stopped.');
  }

  getStatus(): BridgeStatus {
    const deckStates: DeckDisplay[] = [];

    if (this.pluginBridge) {
      const manager = this.pluginBridge.manager;
      for (const deckId of manager.getDeckIds()) {
        const state: DeckState = manager.getDeckState(deckId);
        if (state.state === 'EMPTY' && !state.track) continue;
        deckStates.push({
          deckId: state.deckId,
          state: state.state,
          trackTitle: state.track?.title ?? null,
          trackArtist: state.track?.artist ?? null,
          isPlaying: state.isPlaying,
          isMaster: state.isMaster,
          faderLevel: state.faderLevel,
        });
      }
    }

    return {
      isRunning: this.running,
      connectedDevice: this.connectedDevice,
      eventCode: this.config?.eventCode ?? null,
      eventName: null,
      currentTrack: this.currentTrack,
      deckStates,
      stopReason: this.stopReason,
      networkWarnings: this.networkWarnings,
    };
  }

  private wireEvents(): void {
    if (!this.pluginBridge) return;

    // Handle track going "live"
    this.pluginBridge.on('deckLive', async (event: DeckLiveEvent) => {
      const { deckId, track } = event;

      if (this.shouldSkipTrack(track.artist, track.title)) return;

      this.log(`Deck ${deckId} LIVE: "${track.title}" by ${track.artist}`);

      this.updateLastTrack(track.artist, track.title);
      this.currentTrack = {
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        deckId,
        startedAt: Date.now(),
      };

      this.emitStatus();
      await this.postNowPlaying(track.title, track.artist, track.album, deckId);
    });

    // Handle connection status from plugin
    this.pluginBridge.on('connection', async (event: PluginConnectionEvent) => {
      if (event.connected) {
        this.connectedDevice = event.deviceName ?? 'Unknown Device';
        this.log(`Device connected: ${this.connectedDevice}`);
        this.emitStatus();
        await this.postBridgeStatus(true, this.connectedDevice);
      } else {
        this.connectedDevice = null;
        this.log('Device disconnected');
        this.emitStatus();
        await this.postBridgeStatus(false);
      }
    });

    // Handle heartbeat — keep bridge_last_seen fresh on the backend
    this.pluginBridge.on('heartbeat', async () => {
      await this.postBridgeStatus(true, this.connectedDevice ?? undefined);
    });

    // Handle authoritative now-playing clear
    this.pluginBridge.on('clearNowPlaying', async () => {
      this.currentTrack = null;
      this.emitStatus();
      await this.clearNowPlaying();
    });

    // Forward plugin ready
    this.pluginBridge.on('ready', () => {
      this.log('All devices ready — listening for tracks');
    });

    // Forward logs
    this.pluginBridge.on('log', (message: string) => {
      this.log(message);
    });

    // Forward status updates when deck state changes
    this.pluginBridge.manager.on('log', () => {
      this.emitStatus();
    });
  }

  // --- Track deduplication ---

  private makeTrackKey(artist: string, title: string): string {
    return `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
  }

  private shouldSkipTrack(artist: string, title: string): boolean {
    if (!title) return true;

    const key = this.makeTrackKey(artist, title);
    if (key === this.lastTrackKey) return true;

    const now = Date.now();
    if (this.config && now - this.lastPostTime < this.config.settings.minPlaySeconds * 1000) {
      this.log(`Debouncing track change (${now - this.lastPostTime}ms since last)`);
      return true;
    }

    return false;
  }

  private updateLastTrack(artist: string, title: string): void {
    this.lastTrackKey = this.makeTrackKey(artist, title);
    this.lastPostTime = Date.now();
  }

  // --- HTTP communication ---

  private async postWithRetry(
    endpoint: string,
    payload: NowPlayingPayload | BridgeStatusPayload,
  ): Promise<void> {
    if (!this.config) return;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bridge-API-Key': this.config.apiKey,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`HTTP ${response.status}: ${text}`);
        }

        this.log(`POST ${endpoint} succeeded`);
        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          this.log(`Retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms: ${lastError.message}`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    this.log(`POST ${endpoint} failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
  }

  private async postNowPlaying(
    title: string,
    artist: string,
    album?: string,
    deck?: string,
  ): Promise<void> {
    if (!this.config) return;

    const payload: NowPlayingPayload = {
      event_code: this.config.eventCode,
      title,
      artist,
      album: album ?? null,
      deck: deck ?? null,
    };

    await this.postWithRetry('/api/bridge/nowplaying', payload);
  }

  private async postBridgeStatus(connected: boolean, deviceName?: string): Promise<void> {
    if (!this.config) return;

    const payload: BridgeStatusPayload = {
      event_code: this.config.eventCode,
      connected,
      device_name: deviceName ?? null,
    };

    await this.postWithRetry('/api/bridge/status', payload);
  }

  private async clearNowPlaying(): Promise<void> {
    if (!this.config) return;

    const endpoint = `/api/bridge/nowplaying/${this.config.eventCode}`;
    try {
      const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
        method: 'DELETE',
        headers: {
          'X-Bridge-API-Key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        this.log(`DELETE ${endpoint} failed: HTTP ${response.status}: ${text}`);
      } else {
        this.log(`DELETE ${endpoint} succeeded`);
      }
    } catch (err) {
      this.log(`DELETE ${endpoint} failed: ${(err as Error).message}`);
    }
  }

  // --- Event health check ---

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.running || !this.config) return;

    const status = await checkEventHealth(this.config.apiUrl, this.config.eventCode);

    if (status === 'not_found') {
      this.log('Event no longer exists — stopping bridge');
      await this.stop('Event was deleted');
    } else if (status === 'expired') {
      this.log('Event has expired or been archived — stopping bridge');
      await this.stop('Event expired or archived');
    }
    // 'active' and 'error' — do nothing (don't stop on transient errors)
  }

  // --- Status emission ---

  private emitStatus(): void {
    this.emit('statusChanged', this.getStatus());
  }

  private log(message: string): void {
    console.log(`[Bridge] ${message}`);
    this.emit('log', message);
  }
}
