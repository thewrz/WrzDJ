import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LogFileWriter } from '../log-file-writer.js';

describe('LogFileWriter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'log-writer-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes log entries to file', () => {
    const writer = new LogFileWriter(tempDir);
    writer.write('info', 'Hello world');
    writer.write('error', 'Something failed');

    const logPath = writer.getLogPath();
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[INFO\] Hello world$/);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[ERROR\] Something failed$/);
  });

  it('creates logs directory if it does not exist', () => {
    const nestedDir = join(tempDir, 'nested', 'logs');
    const writer = new LogFileWriter(nestedDir);
    writer.write('info', 'test');

    expect(existsSync(join(nestedDir, 'bridge.log'))).toBe(true);
  });

  it('rotates log file when exceeding 1MB', () => {
    const writer = new LogFileWriter(tempDir);

    // Write enough data to exceed 1MB
    const bigMessage = 'x'.repeat(10_000);
    for (let i = 0; i < 110; i++) {
      writer.write('info', bigMessage);
    }

    const logPath = writer.getLogPath();
    const backupPath = join(tempDir, 'bridge.log.1');

    // Backup should exist after rotation
    expect(existsSync(backupPath)).toBe(true);

    // Current log should be smaller than the backup (it was just rotated)
    const currentSize = readFileSync(logPath).length;
    const backupSize = readFileSync(backupPath).length;
    expect(currentSize).toBeLessThan(backupSize);
  });

  it('getLogPath returns the correct path', () => {
    const writer = new LogFileWriter(tempDir);
    expect(writer.getLogPath()).toBe(join(tempDir, 'bridge.log'));
  });

  it('includes all log levels in output', () => {
    const writer = new LogFileWriter(tempDir);
    writer.write('debug', 'debug msg');
    writer.write('info', 'info msg');
    writer.write('warn', 'warn msg');
    writer.write('error', 'error msg');

    const content = readFileSync(writer.getLogPath(), 'utf-8');
    expect(content).toContain('[DEBUG]');
    expect(content).toContain('[INFO]');
    expect(content).toContain('[WARN]');
    expect(content).toContain('[ERROR]');
  });
});
