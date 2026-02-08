/**
 * Tests for plugin registry.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "events";
import {
  registerPlugin,
  getPlugin,
  getPluginMeta,
  listPluginMeta,
  listPlugins,
  clearRegistry,
} from "../plugin-registry.js";
import type { EquipmentSourcePlugin } from "../plugin-types.js";

function createMockPlugin(id = "mock"): EquipmentSourcePlugin {
  const emitter = new EventEmitter() as EquipmentSourcePlugin;
  Object.assign(emitter, {
    info: { id, name: "Mock Plugin", description: "Test plugin" },
    capabilities: {
      multiDeck: true,
      playState: true,
      faderLevel: false,
      masterDeck: false,
      albumMetadata: false,
    },
    configOptions: [
      { key: "port", label: "Port", type: "number", default: 9000, min: 1024, max: 65535 },
    ],
    isRunning: false,
    start: async () => {},
    stop: async () => {},
  });
  return emitter;
}

describe("Plugin Registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  it("registers and retrieves a plugin", () => {
    registerPlugin("mock", () => createMockPlugin());
    const plugin = getPlugin("mock");
    expect(plugin).not.toBeNull();
    expect(plugin!.info.id).toBe("mock");
  });

  it("returns null for unregistered plugin", () => {
    expect(getPlugin("nonexistent")).toBeNull();
  });

  it("throws on duplicate registration", () => {
    registerPlugin("mock", () => createMockPlugin());
    expect(() => registerPlugin("mock", () => createMockPlugin())).toThrow(
      'Plugin "mock" is already registered'
    );
  });

  it("lists registered plugin IDs", () => {
    registerPlugin("alpha", () => createMockPlugin("alpha"));
    registerPlugin("beta", () => createMockPlugin("beta"));
    expect(listPlugins()).toEqual(["alpha", "beta"]);
  });

  it("creates fresh instances on each getPlugin call", () => {
    registerPlugin("mock", () => createMockPlugin());
    const a = getPlugin("mock");
    const b = getPlugin("mock");
    expect(a).not.toBe(b);
  });

  it("starts empty after clearRegistry", () => {
    registerPlugin("mock", () => createMockPlugin());
    clearRegistry();
    expect(listPlugins()).toEqual([]);
  });

  it("returns plugin metadata via getPluginMeta", () => {
    registerPlugin("mock", () => createMockPlugin());
    const meta = getPluginMeta("mock");
    expect(meta).not.toBeNull();
    expect(meta!.info.id).toBe("mock");
    expect(meta!.capabilities.multiDeck).toBe(true);
    expect(meta!.capabilities.faderLevel).toBe(false);
    expect(meta!.configOptions).toHaveLength(1);
    expect(meta!.configOptions[0].key).toBe("port");
    expect(meta!.configOptions[0].default).toBe(9000);
  });

  it("returns null from getPluginMeta for unregistered plugin", () => {
    expect(getPluginMeta("nonexistent")).toBeNull();
  });

  it("lists metadata for all registered plugins", () => {
    registerPlugin("alpha", () => createMockPlugin("alpha"));
    registerPlugin("beta", () => createMockPlugin("beta"));
    const metas = listPluginMeta();
    expect(metas).toHaveLength(2);
    expect(metas[0].info.id).toBe("alpha");
    expect(metas[1].info.id).toBe("beta");
  });
});
