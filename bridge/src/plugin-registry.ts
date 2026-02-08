/**
 * Plugin registry for WrzDJ Bridge.
 *
 * Stores plugin factory functions keyed by plugin ID.
 * Plugins register themselves via registerPlugin() and are
 * instantiated on demand via getPlugin().
 */
import type { EquipmentSourcePlugin } from "./plugin-types.js";

type PluginFactory = () => EquipmentSourcePlugin;

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

/** List all registered plugin IDs. */
export function listPlugins(): string[] {
  return [...registry.keys()];
}

/** Clear the registry (for testing). */
export function clearRegistry(): void {
  registry.clear();
}
