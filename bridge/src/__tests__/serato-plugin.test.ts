/**
 * Tests for Serato DJ Plugin
 *
 * Tests plugin lifecycle, metadata, event emission, and deduplication.
 * Uses temporary directories with hand-crafted binary session files.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { appendFileSync, mkdtempSync, unlinkSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SeratoPlugin } from "../plugins/serato-plugin.js";
import type { PluginTrackEvent, PluginConnectionEvent } from "../plugin-types.js";

// ---------------------------------------------------------------------------
// Binary helpers (same as parser tests — kept inline for isolation)
// ---------------------------------------------------------------------------

function encodeUtf16BE(str: string): Buffer {
  const buf = Buffer.alloc((str.length + 1) * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2);
  }
  return buf;
}

function buildField(fieldId: number, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(fieldId, 0);
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

function buildTextField(fieldId: number, text: string): Buffer {
  return buildField(fieldId, encodeUtf16BE(text));
}

function buildU32Field(fieldId: number, value: number): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt32BE(value, 0);
  return buildField(fieldId, data);
}

function wrapChunk(tag: string, content: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(tag, 0, 4, "ascii");
  header.writeUInt32BE(content.length, 4);
  return Buffer.concat([header, content]);
}

function buildOentChunk(fields: Buffer[]): Buffer {
  const adatContent = Buffer.concat(fields);
  const adatChunk = wrapChunk("adat", adatContent);
  return wrapChunk("oent", adatChunk);
}

function buildTrackChunk(
  title: string,
  artist: string,
  deck: number,
  album?: string
): Buffer {
  const fields = [
    buildTextField(2, title),
    buildTextField(6, artist),
    buildU32Field(52, deck),
  ];
  if (album) {
    fields.push(buildTextField(8, album));
  }
  return buildOentChunk(fields);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SeratoPlugin", () => {
  let plugin: SeratoPlugin;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "serato-plugin-test-"));
    plugin = new SeratoPlugin();
  });

  afterEach(async () => {
    if (plugin?.isRunning) {
      await plugin.stop();
    }
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  // -- Metadata --

  it("has correct metadata", () => {
    expect(plugin.info.id).toBe("serato");
    expect(plugin.info.name).toBe("Serato DJ");
  });

  it("has correct capabilities", () => {
    expect(plugin.capabilities.multiDeck).toBe(true);
    expect(plugin.capabilities.playState).toBe(false);
    expect(plugin.capabilities.faderLevel).toBe(false);
    expect(plugin.capabilities.masterDeck).toBe(false);
    expect(plugin.capabilities.albumMetadata).toBe(true);
  });

  it("exposes configOptions", () => {
    expect(plugin.configOptions).toHaveLength(2);

    const pathOpt = plugin.configOptions.find((o) => o.key === "seratoPath");
    expect(pathOpt).toBeDefined();
    expect(pathOpt!.type).toBe("string");
    expect(pathOpt!.default).toBe("");

    const pollOpt = plugin.configOptions.find((o) => o.key === "pollInterval");
    expect(pollOpt).toBeDefined();
    expect(pollOpt!.type).toBe("number");
    expect(pollOpt!.default).toBe(1000);
    expect(pollOpt!.min).toBe(200);
    expect(pollOpt!.max).toBe(10000);
  });

  // -- Lifecycle --

  it("starts and stops cleanly", async () => {
    expect(plugin.isRunning).toBe(false);

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    expect(plugin.isRunning).toBe(true);

    await plugin.stop();
    expect(plugin.isRunning).toBe(false);
  });

  it("throws when starting an already-running plugin", async () => {
    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await expect(
      plugin.start({ seratoPath: tmpDir, pollInterval: 200 })
    ).rejects.toThrow("already running");
  });

  it("stop is idempotent when not running", async () => {
    await plugin.stop(); // should not throw
  });

  it("rejects invalid pollInterval", async () => {
    await expect(
      plugin.start({ seratoPath: tmpDir, pollInterval: 50 })
    ).rejects.toThrow("Invalid pollInterval");
  });

  // -- Connection events --

  it("emits connection false when no session files exist", async () => {
    const connections: PluginConnectionEvent[] = [];
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    // Give it a tick to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(connections.some((c) => c.connected === false)).toBe(true);
  });

  it("emits connection true when session file exists", async () => {
    // Create a session file
    writeFileSync(join(tmpDir, "test.session"), Buffer.alloc(0));

    const connections: PluginConnectionEvent[] = [];
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(connections.some((c) => c.connected === true)).toBe(true);
    expect(
      connections.find((c) => c.connected === true)?.deviceName
    ).toBe("Serato DJ");
  });

  // -- Track events --

  it("emits track events when new bytes appear in session file", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Append a track entry
    const chunk = buildTrackChunk("Strobe", "Deadmau5", 1, "Random Album Title");
    writeFileSync(sessionFile, chunk);

    // Wait for poll
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.track?.title).toBe("Strobe");
    expect(tracks[0]!.track?.artist).toBe("Deadmau5");
    expect(tracks[0]!.track?.album).toBe("Random Album Title");
    expect(tracks[0]!.deckId).toBe("1");
  });

  it("emits tracks on different decks", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Append two tracks on different decks
    const chunk1 = buildTrackChunk("Track A", "Artist A", 1);
    const chunk2 = buildTrackChunk("Track B", "Artist B", 2);
    writeFileSync(sessionFile, Buffer.concat([chunk1, chunk2]));

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.deckId).toBe("1");
    expect(tracks[1]!.deckId).toBe("2");
  });

  it("deduplicates identical consecutive tracks on the same deck", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Write same track twice on deck 1
    const chunk1 = buildTrackChunk("Same Song", "Same Artist", 1);
    const chunk2 = buildTrackChunk("Same Song", "Same Artist", 1);
    writeFileSync(sessionFile, Buffer.concat([chunk1, chunk2]));

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(1);
  });

  it("does not deduplicate same track on different decks", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Same track on two different decks
    const chunk1 = buildTrackChunk("Same Song", "Same Artist", 1);
    const chunk2 = buildTrackChunk("Same Song", "Same Artist", 2);
    writeFileSync(sessionFile, Buffer.concat([chunk1, chunk2]));

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(2);
  });

  it("omits album field when not present", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const chunk = buildTrackChunk("Title", "Artist", 1);
    writeFileSync(sessionFile, chunk);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.track?.album).toBeUndefined();
  });

  it("skips entries with no title and no artist", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Empty OENT — no title or artist fields
    const emptyChunk = buildOentChunk([buildU32Field(52, 1)]);
    const realChunk = buildTrackChunk("Real Track", "Real Artist", 1);
    writeFileSync(sessionFile, Buffer.concat([emptyChunk, realChunk]));

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.track?.title).toBe("Real Track");
  });

  // -- Incremental file growth --

  it("detects incrementally appended tracks across poll cycles", async () => {
    const sessionFile = join(tmpDir, "test.session");
    // Start with one track already in the file
    const initialChunk = buildTrackChunk("Initial Song", "Initial Artist", 1);
    writeFileSync(sessionFile, initialChunk);

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    // Wait past first poll — initial track should NOT be emitted (offset starts at file end)
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(tracks).toHaveLength(0);

    // Now append a new track (simulating Serato loading a new track)
    const newChunk = buildTrackChunk("New Song", "New Artist", 2);
    appendFileSync(sessionFile, newChunk);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.track?.title).toBe("New Song");
    expect(tracks[0]!.deckId).toBe("2");
  });

  it("allows re-emitting a track on the same deck after a different track", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Track A → Track B → Track A again on the same deck
    const chunkA = buildTrackChunk("Track A", "Artist", 1);
    const chunkB = buildTrackChunk("Track B", "Artist", 1);
    const chunkA2 = buildTrackChunk("Track A", "Artist", 1);
    writeFileSync(sessionFile, Buffer.concat([chunkA, chunkB, chunkA2]));

    await new Promise((resolve) => setTimeout(resolve, 400));

    // All three should be emitted (A→B breaks dedup, B→A breaks dedup)
    expect(tracks).toHaveLength(3);
    expect(tracks[0]!.track?.title).toBe("Track A");
    expect(tracks[1]!.track?.title).toBe("Track B");
    expect(tracks[2]!.track?.title).toBe("Track A");
  });

  it("defaults deck to '1' when deck field is 0", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const tracks: PluginTrackEvent[] = [];
    plugin.on("track", (e: PluginTrackEvent) => tracks.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Track with deck=0 (no deck field set)
    const chunk = buildTrackChunk("No Deck", "Artist", 0);
    writeFileSync(sessionFile, chunk);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.deckId).toBe("1");
  });

  it("emits log events during operation", async () => {
    writeFileSync(join(tmpDir, "test.session"), Buffer.alloc(0));

    const logs: string[] = [];
    plugin.on("log", (msg: string) => logs.push(msg));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((m) => m.includes("Watching session file"))).toBe(true);
  });

  it("emits connection false when session file is deleted", async () => {
    const sessionFile = join(tmpDir, "test.session");
    writeFileSync(sessionFile, Buffer.alloc(0));

    const connections: PluginConnectionEvent[] = [];
    plugin.on("connection", (e: PluginConnectionEvent) => connections.push(e));

    await plugin.start({ seratoPath: tmpDir, pollInterval: 200 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have connected
    expect(connections.some((c) => c.connected === true)).toBe(true);

    // Delete the session file
    unlinkSync(sessionFile);

    // Wait for poll to detect the deletion
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(connections.some((c) => c.connected === false)).toBe(true);
  });
});
