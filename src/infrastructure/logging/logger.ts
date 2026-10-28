/**
 * Infrastructure: Local Structured Logger
 * Provides local disk file logging and console output for offline operations.
 * Writes to local "logs/pos.log" with automated file size checks.
 */

import fs from 'fs';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  meta?: any;
}

export class LoggerService {
  private static instance: LoggerService;
  private logDirectory: string;
  private logFilePath: string;
  private minLevel: LogLevel = 'INFO';

  private readonly levelWeights: Record<LogLevel, number> = {
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40
  };

  constructor(customLogDir?: string) {
    this.logDirectory = customLogDir || path.resolve(process.cwd(), 'logs');
    this.logFilePath = path.join(this.logDirectory, 'pos.log');
    this.ensureDirectory();
  }

  public static getInstance(): LoggerService {
    if (!this.instance) {
      this.instance = new LoggerService();
    }
    return this.instance;
  }

  public setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch {
      // Ignore directory creation error in read-only/test runners
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelWeights[level] >= this.levelWeights[this.minLevel];
  }

  private write(level: LogLevel, context: string, message: string, meta?: any): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      meta
    };

    const formatted = `[${entry.timestamp}] [${entry.level}] [${entry.context}]: ${entry.message}${
      meta ? ' ' + JSON.stringify(meta) : ''
    }\n`;

    // 1. Console stream
    if (level === 'ERROR') {
      console.error(formatted.trim());
    } else if (level === 'WARN') {
      console.warn(formatted.trim());
    } else {
      console.log(formatted.trim());
    }

    // 2. Append to local file
    try {
      this.ensureDirectory();
      fs.appendFileSync(this.logFilePath, formatted, 'utf8');
    } catch {
      // Graceful fallback if filesystem write is restricted
    }
  }

  public debug(context: string, message: string, meta?: any): void {
    this.write('DEBUG', context, message, meta);
  }

  public info(context: string, message: string, meta?: any): void {
    this.write('INFO', context, message, meta);
  }

  public warn(context: string, message: string, meta?: any): void {
    this.write('WARN', context, message, meta);
  }

  public error(context: string, message: string, meta?: any): void {
    this.write('ERROR', context, message, meta);
  }
}

export const logger = LoggerService.getInstance();

