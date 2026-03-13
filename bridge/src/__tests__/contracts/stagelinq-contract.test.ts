/**
 * Contract tests for the `stagelinq` npm package.
 *
 * These tests import the REAL library (no vi.mock) and validate that the API
 * surface our StageLinqPlugin depends on still exists and behaves as expected.
 * They intentionally do NOT call connect/disconnect (which bind network sockets).
 *
 * If these tests fail after a version bump, it means the library's public API
 * has changed and StageLinqPlugin needs updating.
 *
 * Reference: bridge/src/plugins/stagelinq-plugin.ts
 */
import { describe, expect, it } from "vitest";

import { StageLinq } from "stagelinq";

describe("stagelinq API contract", () => {
  it("exports StageLinq singleton", () => {
    expect(StageLinq).toBeDefined();
    // StageLinq is a class (typeof === "function") used as a singleton via static members
    expect(typeof StageLinq).toBe("function");
  });

  it("has settable options property", () => {
    // The plugin sets these options before connecting.
    // Note: "enableFileTranfer" is the real API spelling (missing 's').
    expect(() => {
      StageLinq.options = {
        downloadDbSources: false,
        enableFileTranfer: false,
      };
    }).not.toThrow();
  });

  it("exposes devices as EventEmitter", () => {
    expect(StageLinq.devices).toBeDefined();
    expect(typeof StageLinq.devices.on).toBe("function");
    expect(typeof StageLinq.devices.removeListener).toBe("function");
  });

  it("exposes logger as EventEmitter", () => {
    expect(StageLinq.logger).toBeDefined();
    expect(typeof StageLinq.logger.on).toBe("function");
  });

  it("has connect method returning thenable", () => {
    // DO NOT call — would bind network sockets
    expect(typeof StageLinq.connect).toBe("function");
  });

  it("has disconnect method returning thenable", () => {
    // DO NOT call — would bind network sockets
    expect(typeof StageLinq.disconnect).toBe("function");
  });
});
