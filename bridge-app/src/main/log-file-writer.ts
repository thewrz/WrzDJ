/**
 * Rotating file-based log writer for bridge-app.
 *
 * Writes structured log entries to a rotating log file in Electron's
 * logs directory. Rotates when the file exceeds MAX_FILE_SIZE_BYTES,
 * keeping one backup file (.1).
 *
 * Log format: `TIMESTAMP [LEVEL] message\n`
 */
import { appendFileSync, statSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { LogLevel } from '../shared/types.js';

const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB
const LOG_FILENAME = 'bridge.log';
const BACKUP_FILENAME = 'bridge.log.1';

export class LogFileWriter {
  private readonly logPath: string;
  private readonly backupPath: string;
  private currentSize = 0;
  private initialized = false;

  constructor(logsDir: string) {
    this.logPath = join(logsDir, LOG_FILENAME);
    this.backupPath = join(logsDir, BACKUP_FILENAME);
  }

  /** Get the path to the current log file. */
  getLogPath(): string {
    return this.logPath;
  }

  /** Write a log entry to the file. */
  write(level: LogLevel, message: string): void {
    if (!this.initialized) {
      this.initialize();
    }

    const timestamp = new Date().toISOString();
    const line = `${timestamp} [${level.toUpperCase()}] ${message}\n`;

    try {
      appendFileSync(this.logPath, line, 'utf-8');
      this.currentSize += Buffer.byteLength(line, 'utf-8');

      if (this.currentSize >= MAX_FILE_SIZE_BYTES) {
        this.rotate();
      }
    } catch {
      // Swallow write errors — logging should never crash the app
    }
  }

  private initialize(): void {
    this.initialized = true;

    // Ensure directory exists
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        return;
      }
    }

    // Read current file size for rotation tracking
    try {
      const stat = statSync(this.logPath);
      this.currentSize = stat.size;
    } catch {
      this.currentSize = 0;
    }
  }

  private rotate(): void {
    try {
      // Overwrite backup with current log
      renameSync(this.logPath, this.backupPath);
      this.currentSize = 0;
    } catch {
      // Rotation failure is non-fatal
    }
  }
}
