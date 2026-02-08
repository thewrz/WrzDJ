/**
 * Built-in plugin auto-registration.
 *
 * Import this module to register all built-in plugins with the registry.
 */
import { registerPlugin } from "../plugin-registry.js";
import { StageLinqPlugin } from "./stagelinq-plugin.js";
import { TraktorBroadcastPlugin } from "./traktor-broadcast-plugin.js";

registerPlugin("stagelinq", () => new StageLinqPlugin());
registerPlugin("traktor-broadcast", () => new TraktorBroadcastPlugin());
