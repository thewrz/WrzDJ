/**
 * Tests for Traktor Broadcast Plugin
 *
 * Tests ICY metadata parsing, StreamTitle parsing, and plugin lifecycle.
 */
import { describe, it, expect, afterEach } from "vitest";
import { parseStreamTitle, TraktorBroadcastPlugin } from "../plugins/traktor-broadcast-plugin.js";
import type { PluginTrackEvent, PluginConnectionEvent } from "../plugin-types.js";

describe("parseStreamTitle", () => {
  it("parses standard Artist - Title format", () => {
    const result = parseStreamTitle("StreamTitle='Daft Punk - Around The World';");
    expect(result).toEqual({ artist: "Daft Punk", title: "Around The World" });
  });

  it("parses raw Artist - Title without StreamTitle wrapper", () => {
    const result = parseStreamTitle("Daft Punk - Around The World");
    expect(result).toEqual({ artist: "Daft Punk", title: "Around The World" });
  });

  it("handles title with multiple dashes", () => {
    const result = parseStreamTitle("StreamTitle='The Artist - The Song - Remix';");
    expect(result).toEqual({ artist: "The Artist", title: "The Song - Remix" });
  });

  it("handles title-only (no separator)", () => {
    const result = parseStreamTitle("StreamTitle='Some Track';");
    expect(result).toEqual({ artist: "", title: "Some Track" });
  });

  it("returns null for empty string", () => {
    expect(parseStreamTitle("")).toBeNull();
  });

  it("returns null for whitespace-only", () => {
    expect(parseStreamTitle("   ")).toBeNull();
  });

  it("returns null for empty StreamTitle", () => {
    expect(parseStreamTitle("StreamTitle='';")).toBeNull();
  });

  it("trims whitespace from artist and title", () => {
    const result = parseStreamTitle("StreamTitle='  Artist  -  Title  ';");
    expect(result).toEqual({ artist: "Artist", title: "Title" });
  });
});

/** Helper to get the dynamically assigned port from the plugin's server */
function getPort(plugin: TraktorBroadcastPlugin): number {
  const server = (plugin as unknown as Record<string, { address(): { port: number } }>).server;
  return server.address().port;
}

describe("TraktorBroadcastPlugin", () => {
  let plugin: TraktorBroadcastPlugin;

  afterEach(async () => {
    if (plugin?.isRunning) {
      await plugin.stop();
    }
  });

  it("has correct metadata", () => {
    plugin = new TraktorBroadcastPlugin();
    expect(plugin.info.id).toBe("traktor-broadcast");
    expect(plugin.capabilities.multiDeck).toBe(false);
    expect(plugin.capabilities.playState).toBe(false);
    expect(plugin.capabilities.faderLevel).toBe(false);
    expect(plugin.capabilities.masterDeck).toBe(false);
    expect(plugin.capabilities.albumMetadata).toBe(false);
  });

  it("starts and stops cleanly", async () => {
    plugin = new TraktorBroadcastPlugin();
    expect(plugin.isRunning).toBe(false);

    await plugin.start({ port: 0 });
    expect(plugin.isRunning).toBe(true);

    await plugin.stop();
    expect(plugin.isRunning).toBe(false);
  });

  it("throws when starting an already-running plugin", async () => {
    plugin = new TraktorBroadcastPlugin();
    await plugin.start({ port: 0 });
    await expect(plugin.start({ port: 0 })).rejects.toThrow("already running");
  });

  it("stop is idempotent when not running", async () => {
    plugin = new TraktorBroadcastPlugin();
    await plugin.stop();
  });

  it("emits connection event on incoming request", async () => {
    plugin = new TraktorBroadcastPlugin();
    const connections: PluginConnectionEvent[] = [];
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    // Use AbortController to prevent hanging on streaming response
    const controller = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Deadmau5 - Strobe';",
        signal: controller.signal,
      }).catch(() => {}); // Swallow abort error

      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller.abort();
    }

    expect(connections.length).toBeGreaterThanOrEqual(1);
    expect(connections[0].connected).toBe(true);
  });

  it("emits track events when metadata is received", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    const controller = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Deadmau5 - Strobe';",
        signal: controller.signal,
      }).catch(() => {});

      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller.abort();
    }

    expect(tracks).toHaveLength(1);
    expect(tracks[0].track?.title).toBe("Strobe");
    expect(tracks[0].track?.artist).toBe("Deadmau5");
    expect(tracks[0].deckId).toBe("1");
  });

  it("deduplicates identical consecutive tracks", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    // Send same metadata twice in separate requests
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Artist - Song';",
        signal: controller1.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Artist - Song';",
        signal: controller2.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller1.abort();
      controller2.abort();
    }

    expect(tracks).toHaveLength(1);
  });
});
