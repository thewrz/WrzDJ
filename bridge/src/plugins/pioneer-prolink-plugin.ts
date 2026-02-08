/**
 * Pioneer PRO DJ LINK Equipment Source Plugin
 *
 * Connects to Pioneer DJ equipment (CDJs) via the PRO DJ LINK protocol.
 * Uses the prolink-connect library to join the network as a virtual device,
 * monitor CDJ status packets, and query track metadata from CDJ databases.
 *
 * Important caveats:
 *   - Cannot coexist with Rekordbox on the same machine (same protocol slots)
 *   - Requires Ethernet connection — CDJs must be on the same LAN
 *   - On-air detection requires a DJM mixer connected via Ethernet;
 *     without one, isOnAir defaults to true (fader becomes a no-op)
 *   - Occupies one virtual CDJ slot (max 5 real CDJs when plugin is running)
 */
import { EventEmitter } from "events";

import { bringOnline, CDJStatus, DeviceType } from "alphatheta-connect";
import type { Device, ProlinkNetwork } from "alphatheta-connect";

import type {
  EquipmentSourcePlugin,
  PluginCapabilities,
  PluginConfigOption,
  PluginInfo,
} from "../plugin-types.js";

export class PioneerProlinkPlugin extends EventEmitter implements EquipmentSourcePlugin {
  readonly info: PluginInfo = {
    id: "pioneer-prolink",
    name: "Pioneer PRO DJ LINK",
    description: "Connects to Pioneer DJ equipment via PRO DJ LINK network",
  };

  readonly capabilities: PluginCapabilities = {
    multiDeck: true,
    playState: true,
    faderLevel: true,
    masterDeck: true,
    albumMetadata: true,
  };

  readonly configOptions: readonly PluginConfigOption[] = [];

  private running = false;
  private network: ProlinkNetwork | null = null;

  /** Per-deck track ID cache for detecting track changes */
  private deckTrackIds = new Map<string, number>();

  get isRunning(): boolean {
    return this.running;
  }

  async start(_config?: Record<string, unknown>): Promise<void> {
    if (this.running) {
      throw new Error("Pioneer PRO DJ LINK plugin is already running");
    }

    this.deckTrackIds.clear();

    this.emit("log", "Bringing PRO DJ LINK network online...");
    const network = await bringOnline();

    try {
      this.emit("log", "Waiting for first CDJ to appear...");
      await network.autoconfigFromPeers();

      this.emit("log", "Connecting as virtual device...");
      network.connect();
    } catch (err) {
      try {
        await network.disconnect()();
      } catch {
        // Best effort cleanup
      }
      throw err;
    }

    this.network = network;
    this.running = true;

    this.wireEvents();
    this.emit("ready");
    this.emit("log", "Connected to PRO DJ LINK network");
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.deckTrackIds.clear();

    if (this.network) {
      try {
        await this.network.disconnect()();
      } catch {
        // Best effort on shutdown
      }
      this.network = null;
    }

    this.removeAllListeners();
  }

  private wireEvents(): void {
    if (!this.network) return;

    // Device discovery
    this.network.deviceManager.on("connected", (device: Device) => {
      if (!this.running || device.type !== DeviceType.CDJ) return;
      this.emit("log", `CDJ connected: ${device.name} (ID ${device.id})`);
      this.emit("connection", { connected: true, deviceName: device.name });
    });

    this.network.deviceManager.on("disconnected", (device: Device) => {
      if (!this.running || device.type !== DeviceType.CDJ) return;
      this.emit("log", `CDJ disconnected: ${device.name} (ID ${device.id})`);
      this.emit("connection", { connected: false, deviceName: device.name });
    });

    // CDJ status updates — statusEmitter is guaranteed non-null after connect()
    const statusEmitter = this.network.statusEmitter;
    if (!statusEmitter) return;

    statusEmitter.on("status", (status: CDJStatus.State) => {
      if (!this.running) return;
      const deckId = String(status.deviceId);

      // Play state
      const isPlaying = status.playState === CDJStatus.PlayState.Playing;
      this.emit("playState", { deckId, isPlaying });

      // Fader (on-air maps to binary fader level)
      const level = status.isOnAir ? 1.0 : 0.0;
      this.emit("fader", { deckId, level });

      // Master deck
      if (status.isMaster) {
        this.emit("masterDeck", { deckId });
      }

      // Track change detection
      this.handleTrackChange(status, deckId);
    });
  }

  private handleTrackChange(status: CDJStatus.State, deckId: string): void {
    const previousTrackId = this.deckTrackIds.get(deckId);
    const currentTrackId = status.trackId;

    if (currentTrackId === previousTrackId) return;

    this.deckTrackIds.set(deckId, currentTrackId);

    // Track unloaded
    if (currentTrackId === 0) {
      this.emit("track", { deckId, track: null });
      return;
    }

    // Fetch metadata asynchronously
    this.fetchTrackMetadata(status, deckId);
  }

  private fetchTrackMetadata(status: CDJStatus.State, deckId: string): void {
    const db = this.network?.db;
    if (!db) return;

    db.getMetadata({
      deviceId: status.trackDeviceId,
      trackSlot: status.trackSlot,
      trackType: status.trackType,
      trackId: status.trackId,
    })
      .then((track) => {
        if (!track) {
          this.emit("log", `No metadata for track ${status.trackId} on deck ${deckId}`);
          return;
        }

        this.emit("track", {
          deckId,
          track: {
            title: track.title,
            artist: track.artist?.name ?? "",
            album: track.album?.name,
          },
        });

        this.emit(
          "log",
          `Track on deck ${deckId}: "${track.title}" by ${track.artist?.name ?? "Unknown"}`,
        );
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("log", `Failed to fetch metadata for track ${status.trackId}: ${message}`);
      });
  }
}
