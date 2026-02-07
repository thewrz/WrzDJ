/**
 * BridgeRunner wraps the existing StageLinQ bridge code for GUI lifecycle control.
 * Imports DeckStateManager directly and replicates the event wiring from bridge/src/index.ts.
 */
import { EventEmitter } from 'events';
import { StageLinq } from 'stagelinq';
import { DeckStateManager } from '../../bridge/src/deck-state-manager.js';
import type { DeckLiveEvent, DeckState } from '../../bridge/src/deck-state.js';
import type { NowPlayingPayload, BridgeStatusPayload } from '../../bridge/src/types.js';
import type { BridgeRunnerConfig, BridgeStatus, DeckDisplay, TrackDisplay } from '../shared/types.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

/**
 * BridgeRunner manages the lifecycle of the StageLinQ bridge.
 *
 * Events:
 *   'statusChanged' - emitted whenever bridge status changes (for IPC forwarding)
 *   'log' - emitted with log messages for the GUI console
 */
export class BridgeRunner extends EventEmitter {
  private deckManager: DeckStateManager | null = null;
  private config: BridgeRunnerConfig | null = null;
  private running = false;
  private connectedDevice: string | null = null;
  private currentTrack: TrackDisplay | null = null;
  private lastTrackKey: string | null = null;
  private lastPostTime = 0;

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

    this.log(`Starting bridge for event ${config.eventCode}...`);
    this.log(`API URL: ${config.apiUrl}`);
    this.log(`Live Threshold: ${config.settings.liveThresholdSeconds}s`);
    this.log(`Fader Detection: ${config.settings.useFaderDetection}`);
    this.log(`Master Deck Priority: ${config.settings.masterDeckPriority}`);

    this.deckManager = new DeckStateManager({
      liveThresholdSeconds: config.settings.liveThresholdSeconds,
      pauseGraceSeconds: config.settings.pauseGraceSeconds,
      nowPlayingPauseSeconds: config.settings.nowPlayingPauseSeconds,
      useFaderDetection: config.settings.useFaderDetection,
      masterDeckPriority: config.settings.masterDeckPriority,
    });

    this.wireEvents();
    this.emitStatus();

    try {
      this.log('Connecting to StageLinQ network...');
      await StageLinq.connect();
      this.log('Listening for DJ equipment...');
    } catch (err) {
      this.running = false;
      this.deckManager.destroy();
      this.deckManager = null;
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Failed to connect: ${message}`);
      this.emitStatus();
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.log('Stopping bridge...');
    this.running = false;

    if (this.deckManager) {
      this.deckManager.destroy();
      this.deckManager = null;
    }

    try {
      await this.postBridgeStatus(false);
      await StageLinq.disconnect();
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

    if (this.deckManager) {
      for (const deckId of ['1', '2', '3', '4']) {
        try {
          const state: DeckState = this.deckManager.getDeckState(deckId);
          deckStates.push({
            deckId: state.deckId,
            state: state.state,
            trackTitle: state.track?.title ?? null,
            trackArtist: state.track?.artist ?? null,
            isPlaying: state.isPlaying,
            isMaster: state.isMaster,
            faderLevel: state.faderLevel,
          });
        } catch {
          // Skip if deck doesn't exist
        }
      }
    }

    return {
      isRunning: this.running,
      connectedDevice: this.connectedDevice,
      eventCode: this.config?.eventCode ?? null,
      eventName: null,
      currentTrack: this.currentTrack,
      deckStates,
    };
  }

  private wireEvents(): void {
    if (!this.deckManager) return;

    // Handle track going "live"
    this.deckManager.on('deckLive', async (event: DeckLiveEvent) => {
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

    // Handle nowPlaying events from DJ equipment
    StageLinq.devices.on('nowPlaying', (status) => {
      if (!this.deckManager) return;

      const deckId = status.deck || '1';
      const title = status.title || '';
      const artist = status.artist || '';
      const currentState = this.deckManager.getDeckState(deckId);

      if (!title) {
        this.deckManager.updateTrackInfo(deckId, null);
        this.emitStatus();
        return;
      }

      const isNewTrack =
        !currentState.track ||
        currentState.track.title !== title ||
        currentState.track.artist !== artist;

      if (isNewTrack) {
        this.deckManager.updateTrackInfo(deckId, {
          title,
          artist,
          album: status.album,
        });
      }

      const isPlaying = status.play === true || status.playState === true;
      if (typeof status.play === 'boolean' || typeof status.playState === 'boolean') {
        this.deckManager.updatePlayState(deckId, isPlaying);
      }

      this.emitStatus();
    });

    // Handle state changes (faders, master deck, play state)
    StageLinq.devices.on('stateChanged', (status) => {
      if (!this.deckManager || !status.deck) return;

      const deckId = status.deck;

      if (typeof status.play === 'boolean' || typeof status.playState === 'boolean') {
        const isPlaying = status.play === true || status.playState === true;
        this.deckManager.updatePlayState(deckId, isPlaying);
      }

      if (typeof status.faderLevel === 'number') {
        this.deckManager.updateFaderLevel(deckId, status.faderLevel);
      }

      if (status.masterStatus === true) {
        this.deckManager.setMasterDeck(deckId);
      }

      this.emitStatus();
    });

    // Handle device ready
    StageLinq.devices.on('ready', async (info) => {
      const deviceName = info?.software?.name || 'Unknown Device';
      this.connectedDevice = deviceName;
      this.log(`Device ready: ${deviceName}`);
      this.emitStatus();
      await this.postBridgeStatus(true, deviceName);
    });

    // Handle device disconnect
    StageLinq.devices.on('disconnect', async () => {
      this.connectedDevice = null;
      this.log('Device disconnected');
      this.emitStatus();
      await this.postBridgeStatus(false);
    });
  }

  // --- Track deduplication (replicated from bridge/src/bridge.ts) ---

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

        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    this.log(`POST ${endpoint} failed: ${lastError?.message}`);
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

  // --- Status emission ---

  private emitStatus(): void {
    this.emit('statusChanged', this.getStatus());
  }

  private log(message: string): void {
    console.log(`[Bridge] ${message}`);
    this.emit('log', message);
  }
}
