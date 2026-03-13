/**
 * Contract tests for the `alphatheta-connect` npm package.
 *
 * These tests import the REAL library (no vi.mock) and validate that the API
 * surface our PioneerProlinkPlugin depends on still exists with expected values.
 * They intentionally do NOT call bringOnline() (which opens UDP sockets).
 *
 * The PlayState enum values are the highest-value assertions here: if Playing
 * changes from 3 to something else, the plugin silently stops detecting play
 * state — mocked unit tests would still pass, users would be broken.
 *
 * Reference: bridge/src/plugins/pioneer-prolink-plugin.ts
 */
import { describe, expect, it } from "vitest";

import { bringOnline, CDJStatus, DeviceType } from "alphatheta-connect";

describe("alphatheta-connect API contract", () => {
  it("exports bringOnline as a function", () => {
    // DO NOT call — would open UDP sockets
    expect(typeof bringOnline).toBe("function");
  });

  it("exports CDJStatus with PlayState enum", () => {
    expect(CDJStatus).toBeDefined();
    expect(CDJStatus.PlayState).toBeDefined();

    // These exact integer values are what the plugin compares against.
    // If any change, PioneerProlinkPlugin.wireEvents() will silently break.
    expect(CDJStatus.PlayState.Empty).toBe(0);
    expect(CDJStatus.PlayState.Loading).toBe(2);
    expect(CDJStatus.PlayState.Playing).toBe(3);
    expect(CDJStatus.PlayState.Looping).toBe(4);
    expect(CDJStatus.PlayState.Paused).toBe(5);
    expect(CDJStatus.PlayState.Cued).toBe(6);
    expect(CDJStatus.PlayState.Cuing).toBe(7);
    expect(CDJStatus.PlayState.PlatterHeld).toBe(8);
    expect(CDJStatus.PlayState.Searching).toBe(9);
    expect(CDJStatus.PlayState.SpunDown).toBe(14);
    expect(CDJStatus.PlayState.Ended).toBe(17);
  });

  it("exports DeviceType enum with expected values", () => {
    expect(DeviceType).toBeDefined();

    // The plugin filters devices by type === DeviceType.CDJ
    expect(DeviceType.CDJ).toBe(1);
    expect(DeviceType.Mixer).toBe(3);
    expect(DeviceType.Rekordbox).toBe(4);
  });
});
