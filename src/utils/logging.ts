/**
 * src/utils/logging.ts — Client-side structured logging
 * Minimal console wrapper with timestamp, level, and module name.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  return `[${timestamp()}] [${level.toUpperCase()}] [${module}] ${message}`;
}

class Logger {
  private readonly module: string;
  private minLevel: LogLevel = 'info';

  constructor(module: string) {
    this.module = module;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog('debug')) return;
    console.debug(formatMessage('debug', this.module, message), data !== undefined ? data : '');
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog('info')) return;
    console.info(formatMessage('info', this.module, message), data !== undefined ? data : '');
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog('warn')) return;
    console.warn(formatMessage('warn', this.module, message), data !== undefined ? data : '');
  }

  error(message: string, data?: unknown): void {
    if (!this.shouldLog('error')) return;
    console.error(formatMessage('error', this.module, message), data !== undefined ? data : '');
  }
}

/**
 * Create a logger for a specific module.
 * Usage:
 *   import { createLogger } from './utils/logging.js';
 *   const log = createLogger('manifest');
 *   log.info('Loaded manifest', { entries: 9 });
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

/** Default app-wide logger. */
export const logger = createLogger('app');
