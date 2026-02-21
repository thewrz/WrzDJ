/**
 * Tests for Traktor Broadcast Plugin
 *
 * Tests ICY metadata parsing, StreamTitle parsing, and plugin lifecycle.
 */
import http from "http";
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

  it("exposes configOptions with port option", () => {
    plugin = new TraktorBroadcastPlugin();
    expect(plugin.configOptions).toHaveLength(1);
    const portOpt = plugin.configOptions[0];
    expect(portOpt.key).toBe("port");
    expect(portOpt.type).toBe("number");
    expect(portOpt.default).toBe(8123);
    expect(portOpt.min).toBe(1024);
    expect(portOpt.max).toBe(65535);
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

  it("clears active connections on stop", async () => {
    plugin = new TraktorBroadcastPlugin();
    await plugin.start({ port: 0 });

    // Verify the activeConnections set exists and is initially empty
    const connections = (plugin as unknown as Record<string, Set<unknown>>).activeConnections;
    expect(connections).toBeInstanceOf(Set);

    await plugin.stop();

    // After stop, connections set should be empty
    expect(connections.size).toBe(0);
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

  it("emits different track when metadata changes", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    const controller1 = new AbortController();
    const controller2 = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Artist A - Song One';",
        signal: controller1.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Artist B - Song Two';",
        signal: controller2.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller1.abort();
      controller2.abort();
    }

    expect(tracks).toHaveLength(2);
    expect(tracks[0].track?.title).toBe("Song One");
    expect(tracks[1].track?.title).toBe("Song Two");
  });

  it("emits disconnect event when connection closes", async () => {
    plugin = new TraktorBroadcastPlugin();
    const connections: PluginConnectionEvent[] = [];
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    const controller = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Artist - Track';",
        signal: controller.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller.abort();
    }

    // Wait for disconnect event to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have connected:true followed by connected:false
    expect(connections.some((c) => c.connected === true)).toBe(true);
    expect(connections.some((c) => c.connected === false)).toBe(true);
  });

  it("handles malformed metadata without crashing", async () => {
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
        body: "StreamTitle='';",
        signal: controller.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller.abort();
    }

    expect(tracks).toHaveLength(0);
  });

  it("handles GET requests without crashing", async () => {
    plugin = new TraktorBroadcastPlugin();
    const connections: PluginConnectionEvent[] = [];
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    // GET request (not typical Traktor behavior, but should not crash)
    const controller = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        signal: controller.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller.abort();
    }
    // Should still emit a connection event
    expect(connections.length).toBeGreaterThanOrEqual(1);
  });

  it("throws on invalid port configuration", async () => {
    plugin = new TraktorBroadcastPlugin();
    await expect(plugin.start({ port: -1 })).rejects.toThrow("Invalid port");
    await expect(plugin.start({ port: 99999 })).rejects.toThrow("Invalid port");
  });

  it("parses ICY metadata from binary stream with icy-metaint header", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    // Build a proper ICY binary stream:
    // [metaInt bytes of audio] [1 byte length prefix] [metadata padded to 16 * lengthByte]
    const metaInt = 32; // small interval for testing
    const metadataStr = "StreamTitle='ICY Artist - ICY Track';";
    const metaLengthByte = Math.ceil(metadataStr.length / 16);
    const paddedLength = metaLengthByte * 16;
    const metadataBuf = Buffer.alloc(paddedLength);
    metadataBuf.write(metadataStr, "utf-8");

    // audio data (32 bytes of silence) + length prefix + metadata
    const audioBuf = Buffer.alloc(metaInt);
    const lengthBuf = Buffer.from([metaLengthByte]);
    const payload = Buffer.concat([audioBuf, lengthBuf, metadataBuf]);

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "PUT",
          headers: {
            "Content-Type": "audio/mpeg",
            "icy-metaint": String(metaInt),
          },
        },
        () => {},
      );
      req.on("error", () => {}); // swallow
      req.write(payload);
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 200);
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0].track?.artist).toBe("ICY Artist");
    expect(tracks[0].track?.title).toBe("ICY Track");
  });

  it("handles ICY stream with zero-length metadata block", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    const metaInt = 16;
    // audio data (16 bytes) + length prefix 0 (no metadata) + more audio (16 bytes) + length prefix + actual metadata
    const metadataStr = "StreamTitle='Zero Test Artist - Zero Test Track';";
    const metaLengthByte = Math.ceil(metadataStr.length / 16);
    const paddedLength = metaLengthByte * 16;
    const metadataBuf = Buffer.alloc(paddedLength);
    metadataBuf.write(metadataStr, "utf-8");

    const audioPart1 = Buffer.alloc(metaInt);
    const zeroLengthByte = Buffer.from([0]); // no metadata this interval
    const audioPart2 = Buffer.alloc(metaInt);
    const realLengthByte = Buffer.from([metaLengthByte]);
    const payload = Buffer.concat([audioPart1, zeroLengthByte, audioPart2, realLengthByte, metadataBuf]);

    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "PUT",
          headers: {
            "Content-Type": "audio/mpeg",
            "icy-metaint": String(metaInt),
          },
        },
        () => {},
      );
      req.on("error", () => {});
      req.write(payload);
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 200);
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0].track?.title).toBe("Zero Test Track");
  });

  it("handles multiple ICY metadata updates in one connection", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    const metaInt = 16;

    function buildIcyBlock(metadataStr: string): Buffer {
      const metaLengthByte = Math.ceil(metadataStr.length / 16);
      const paddedLength = metaLengthByte * 16;
      const metadataBuf = Buffer.alloc(paddedLength);
      metadataBuf.write(metadataStr, "utf-8");
      const audioBuf = Buffer.alloc(metaInt);
      const lengthBuf = Buffer.from([metaLengthByte]);
      return Buffer.concat([audioBuf, lengthBuf, metadataBuf]);
    }

    const block1 = buildIcyBlock("StreamTitle='DJ A - Track One';");
    const block2 = buildIcyBlock("StreamTitle='DJ B - Track Two';");
    const payload = Buffer.concat([block1, block2]);

    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "PUT",
          headers: {
            "Content-Type": "audio/mpeg",
            "icy-metaint": String(metaInt),
          },
        },
        () => {},
      );
      req.on("error", () => {});
      req.write(payload);
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 200);
    });

    expect(tracks).toHaveLength(2);
    expect(tracks[0].track?.title).toBe("Track One");
    expect(tracks[1].track?.title).toBe("Track Two");
  });

  it("cascade: connect → metadata → disconnect → reconnect → new metadata", async () => {
    plugin = new TraktorBroadcastPlugin();
    const tracks: PluginTrackEvent[] = [];
    const connections: PluginConnectionEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ port: 0 });
    const port = getPort(plugin);

    // First connection with track
    const controller1 = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='First Artist - First Track';",
        signal: controller1.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller1.abort();
    }

    // Wait for disconnect to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second connection with different track
    const controller2 = new AbortController();
    try {
      fetch(`http://127.0.0.1:${port}/`, {
        method: "PUT",
        headers: { "Content-Type": "audio/mpeg" },
        body: "StreamTitle='Second Artist - Second Track';",
        signal: controller2.signal,
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      controller2.abort();
    }

    // Should have two track events from the full lifecycle
    expect(tracks).toHaveLength(2);
    expect(tracks[0].track?.artist).toBe("First Artist");
    expect(tracks[1].track?.artist).toBe("Second Artist");

    // Should have multiple connection events (connect, disconnect, connect)
    const connectEvents = connections.filter((c) => c.connected);
    const disconnectEvents = connections.filter((c) => !c.connected);
    expect(connectEvents.length).toBeGreaterThanOrEqual(2);
    expect(disconnectEvents.length).toBeGreaterThanOrEqual(1);
  });
});
