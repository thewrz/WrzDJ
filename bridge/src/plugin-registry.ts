/**
 * Plugin registry for WrzDJ Bridge.
 *
 * Stores plugin factory functions keyed by plugin ID.
 * Plugins register themselves via registerPlugin() and are
 * instantiated on demand via getPlugin().
 */
import type {
  EquipmentSourcePlugin,
  PluginCapabilities,
  PluginConfigOption,
  PluginInfo,
} from "./plugin-types.js";

type PluginFactory = () => EquipmentSourcePlugin;

/** Serializable plugin metadata (no EventEmitter, safe for IPC). */
export interface PluginMeta {
  readonly info: PluginInfo;
  readonly capabilities: PluginCapabilities;
  readonly configOptions: readonly PluginConfigOption[];
}

const registry = new Map<string, PluginFactory>();

/** Register a plugin factory. Throws if ID is already registered. */
export function registerPlugin(id: string, factory: PluginFactory): void {
  if (registry.has(id)) {
    throw new Error(`Plugin "${id}" is already registered`);
  }
  registry.set(id, factory);
}

/** Create a plugin instance by ID. Returns null if not found. */
export function getPlugin(id: string): EquipmentSourcePlugin | null {
  const factory = registry.get(id);
  return factory ? factory() : null;
}

/** Get serializable metadata for a plugin by ID. Returns null if not found. */
export function getPluginMeta(id: string): PluginMeta | null {
  const factory = registry.get(id);
  if (!factory) return null;

  const instance = factory();
  return {
    info: { ...instance.info },
    capabilities: { ...instance.capabilities },
    configOptions: [...instance.configOptions],
  };
}

/** Get serializable metadata for all registered plugins. */
export function listPluginMeta(): PluginMeta[] {
  return [...registry.keys()].map((id) => getPluginMeta(id)!);
}

/** List all registered plugin IDs. */
export function listPlugins(): string[] {
  return [...registry.keys()];
}

/** Clear the registry (for testing). */
export function clearRegistry(): void {
  registry.clear();
}
