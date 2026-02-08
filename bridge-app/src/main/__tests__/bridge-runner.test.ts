import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the plugin system before importing BridgeRunner
vi.mock('@bridge/plugin-bridge.js', () => {
  const { EventEmitter } = require('events');
  class MockPluginBridge extends EventEmitter {
    private _running = false;
    manager = new EventEmitter();
    constructor() {
      super();
      this.manager.getDeckIds = () => [];
      this.manager.getDeckState = () => ({});
      this.manager.destroy = vi.fn();
    }
    get isRunning() { return this._running; }
    async start() { this._running = true; }
    async stop() { this._running = false; }
  }
  return { PluginBridge: MockPluginBridge };
});

vi.mock('@bridge/plugin-registry.js', () => {
  const { EventEmitter } = require('events');
  return {
    getPlugin: vi.fn(() => {
      const plugin = new EventEmitter();
      Object.assign(plugin, {
        info: { id: 'mock', name: 'Mock', description: 'Mock plugin' },
        capabilities: {
          multiDeck: false,
          playState: false,
          faderLevel: false,
          masterDeck: false,
          albumMetadata: false,
        },
        isRunning: false,
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
      });
      return plugin;
    }),
  };
});

vi.mock('@bridge/plugins/index.js', () => ({}));

// Mock the health check service
vi.mock('../event-health-service.js', () => ({
  checkEventHealth: vi.fn(),
}));

// Mock fetch for postBridgeStatus calls
const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
global.fetch = mockFetch;

import { BridgeRunner } from '../bridge-runner.js';
import { checkEventHealth } from '../event-health-service.js';
import type { BridgeRunnerConfig } from '../../shared/types.js';

const mockedCheckEventHealth = vi.mocked(checkEventHealth);

const TEST_CONFIG: BridgeRunnerConfig = {
  apiUrl: 'https://api.wrzdj.com',
  apiKey: 'test-key',
  eventCode: 'ABC123',
  settings: {
    protocol: 'mock',
    liveThresholdSeconds: 15,
    pauseGraceSeconds: 3,
    nowPlayingPauseSeconds: 10,
    useFaderDetection: false,
    masterDeckPriority: false,
    minPlaySeconds: 5,
  },
};

describe('BridgeRunner', () => {
  let runner: BridgeRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedCheckEventHealth.mockResolvedValue('active');
    runner = new BridgeRunner();
  });

  afterEach(async () => {
    if (runner.isRunning) {
      await runner.stop();
    }
    vi.useRealTimers();
  });

  it('starts and stops cleanly', async () => {
    await runner.start(TEST_CONFIG);
    expect(runner.isRunning).toBe(true);

    const status = runner.getStatus();
    expect(status.eventCode).toBe('ABC123');
    expect(status.stopReason).toBeNull();

    await runner.stop();
    expect(runner.isRunning).toBe(false);
  });

  it('includes stopReason as null initially', async () => {
    const status = runner.getStatus();
    expect(status.stopReason).toBeNull();
  });

  it('sets stopReason when stopped with a reason', async () => {
    await runner.start(TEST_CONFIG);
    await runner.stop('Event was deleted');

    const status = runner.getStatus();
    expect(status.stopReason).toBe('Event was deleted');
    expect(status.isRunning).toBe(false);
  });

  it('clears stopReason on next start', async () => {
    await runner.start(TEST_CONFIG);
    await runner.stop('Event was deleted');
    expect(runner.getStatus().stopReason).toBe('Event was deleted');

    await runner.start(TEST_CONFIG);
    expect(runner.getStatus().stopReason).toBeNull();
  });

  it('auto-stops when health check returns not_found', async () => {
    await runner.start(TEST_CONFIG);
    expect(runner.isRunning).toBe(true);

    mockedCheckEventHealth.mockResolvedValue('not_found');

    // Advance timer to trigger health check
    await vi.advanceTimersByTimeAsync(30_000);

    expect(runner.isRunning).toBe(false);
    expect(runner.getStatus().stopReason).toBe('Event was deleted');
  });

  it('auto-stops when health check returns expired', async () => {
    await runner.start(TEST_CONFIG);
    expect(runner.isRunning).toBe(true);

    mockedCheckEventHealth.mockResolvedValue('expired');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(runner.isRunning).toBe(false);
    expect(runner.getStatus().stopReason).toBe('Event expired or archived');
  });

  it('does not stop on health check error (transient failure)', async () => {
    await runner.start(TEST_CONFIG);
    expect(runner.isRunning).toBe(true);

    mockedCheckEventHealth.mockResolvedValue('error');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(runner.isRunning).toBe(true);
    expect(runner.getStatus().stopReason).toBeNull();
  });

  it('does not stop when health check returns active', async () => {
    await runner.start(TEST_CONFIG);
    expect(runner.isRunning).toBe(true);

    mockedCheckEventHealth.mockResolvedValue('active');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(runner.isRunning).toBe(true);
  });

  it('health check is called with correct arguments', async () => {
    await runner.start(TEST_CONFIG);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockedCheckEventHealth).toHaveBeenCalledWith(
      'https://api.wrzdj.com',
      'ABC123',
    );
  });

  it('stops health check timer when bridge is stopped', async () => {
    await runner.start(TEST_CONFIG);
    await runner.stop();

    mockedCheckEventHealth.mockResolvedValue('not_found');
    await vi.advanceTimersByTimeAsync(60_000);

    // Health check should not have been called after stop
    expect(mockedCheckEventHealth).not.toHaveBeenCalled();
  });

  it('emits statusChanged with stopReason on auto-stop', async () => {
    const statusChanges: Array<{ isRunning: boolean; stopReason: string | null }> = [];
    runner.on('statusChanged', (status) => {
      statusChanges.push({ isRunning: status.isRunning, stopReason: status.stopReason });
    });

    await runner.start(TEST_CONFIG);
    mockedCheckEventHealth.mockResolvedValue('not_found');
    await vi.advanceTimersByTimeAsync(30_000);

    const lastStatus = statusChanges[statusChanges.length - 1];
    expect(lastStatus.isRunning).toBe(false);
    expect(lastStatus.stopReason).toBe('Event was deleted');
  });
});
