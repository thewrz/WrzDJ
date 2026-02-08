/**
 * PluginBridge — translation layer between equipment source plugins and DeckStateManager.
 *
 * Normalizes plugin events into DeckStateManager calls.
 * Synthesizes missing data based on plugin capabilities:
 *   - playState=false → calls updatePlayState(true) when metadata changes
 *   - multiDeck=false → assigns virtual deck ID "1"
 */
import { EventEmitter } from "events";

import { DeckStateManager } from "./deck-state-manager.js";
import type { DeckLiveEvent, DeckStateManagerConfig } from "./deck-state.js";
import type {
  EquipmentSourcePlugin,
  PluginConnectionEvent,
  PluginFaderEvent,
  PluginMasterDeckEvent,
  PluginPlayStateEvent,
  PluginTrackEvent,
} from "./plugin-types.js";

/** Default virtual deck ID for single-deck plugins */
const VIRTUAL_DECK_ID = "1";

/**
 * PluginBridge connects an EquipmentSourcePlugin to a DeckStateManager,
 * translating plugin events and synthesizing missing data.
 *
 * Events emitted:
 *   'deckLive' - forwarded from DeckStateManager when a track goes live
 *   'connection' - forwarded from the plugin (connected/disconnected)
 *   'log' - diagnostic messages from both plugin and DeckStateManager
 *   'error' - errors from the plugin
 */
export class PluginBridge extends EventEmitter {
  private readonly plugin: EquipmentSourcePlugin;
  private readonly deckManager: DeckStateManager;
  private running = false;

  constructor(plugin: EquipmentSourcePlugin, config: DeckStateManagerConfig) {
    super();
    this.plugin = plugin;
    this.deckManager = new DeckStateManager(config);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get pluginInfo() {
    return this.plugin.info;
  }

  get pluginCapabilities() {
    return this.plugin.capabilities;
  }

  /** Access the underlying DeckStateManager (for status queries). */
  get manager(): DeckStateManager {
    return this.deckManager;
  }

  async start(pluginConfig?: Record<string, unknown>): Promise<void> {
    if (this.running) {
      throw new Error("PluginBridge is already running");
    }

    this.running = true;
    this.wireEvents();

    try {
      await this.plugin.start(pluginConfig);
    } catch (err) {
      this.running = false;
      this.cleanup();
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    try {
      await this.plugin.stop();
    } catch {
      // Best effort on shutdown
    }

    this.cleanup();
  }

  private cleanup(): void {
    this.deckManager.destroy();
    this.plugin.removeAllListeners();
  }

  private wireEvents(): void {
    // Forward DeckStateManager events
    this.deckManager.on("deckLive", (event: DeckLiveEvent) => {
      this.emit("deckLive", event);
    });

    this.deckManager.on("log", (message: string) => {
      this.emit("log", message);
    });

    // Wire plugin events
    this.plugin.on("track", (event: PluginTrackEvent) => {
      this.handleTrack(event);
    });

    this.plugin.on("playState", (event: PluginPlayStateEvent) => {
      this.handlePlayState(event);
    });

    this.plugin.on("fader", (event: PluginFaderEvent) => {
      this.handleFader(event);
    });

    this.plugin.on("masterDeck", (event: PluginMasterDeckEvent) => {
      this.handleMasterDeck(event);
    });

    this.plugin.on("connection", (event: PluginConnectionEvent) => {
      this.emit("connection", event);
    });

    this.plugin.on("ready", () => {
      this.emit("ready");
    });

    this.plugin.on("log", (message: string) => {
      this.emit("log", `[${this.plugin.info.id}] ${message}`);
    });

    this.plugin.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  private normalizeDeckId(deckId: string): string {
    if (!this.plugin.capabilities.multiDeck) {
      return VIRTUAL_DECK_ID;
    }
    return deckId;
  }

  private handleTrack(event: PluginTrackEvent): void {
    const deckId = this.normalizeDeckId(event.deckId);
    this.deckManager.updateTrackInfo(deckId, event.track);

    // Synthesize play state for plugins that lack it
    if (!this.plugin.capabilities.playState && event.track !== null) {
      this.deckManager.updatePlayState(deckId, true);
    }
  }

  private handlePlayState(event: PluginPlayStateEvent): void {
    const deckId = this.normalizeDeckId(event.deckId);
    this.deckManager.updatePlayState(deckId, event.isPlaying);
  }

  private handleFader(event: PluginFaderEvent): void {
    const deckId = this.normalizeDeckId(event.deckId);
    this.deckManager.updateFaderLevel(deckId, event.level);
  }

  private handleMasterDeck(event: PluginMasterDeckEvent): void {
    const deckId = this.normalizeDeckId(event.deckId);
    this.deckManager.setMasterDeck(deckId);
  }
}
