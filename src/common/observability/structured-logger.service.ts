import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { getRequestId } from './request-context';

export interface StructuredLogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  message: string;
  context?: string;
  requestId?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

export type LogListener = (entry: StructuredLogEntry) => void;

@Injectable({ scope: Scope.TRANSIENT })
export class StructuredLogger implements LoggerService {
  private static readonly listeners: Set<LogListener> = new Set();
  private static readonly memoryBuffer: StructuredLogEntry[] = [];
  private static memoryBufferEnabled = false;

  private contextName?: string;

  constructor(context?: string) {
    this.contextName = context;
  }

  setContext(context: string): void {
    this.contextName = context;
  }

  log(message: unknown, context?: string): void {
    this.writeEntry('INFO', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.writeEntry('ERROR', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.writeEntry('WARN', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.writeEntry('DEBUG', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.writeEntry('DEBUG', message, context);
  }

  fatal(message: unknown, trace?: string, context?: string): void {
    this.writeEntry('FATAL', message, context, trace);
  }

  private writeEntry(
    level: StructuredLogEntry['level'],
    message: unknown,
    contextOverride?: string,
    stack?: string,
  ): void {
    const formattedMessage =
      typeof message === 'string'
        ? message
        : typeof message === 'object' && message !== null
          ? JSON.stringify(message)
          : String(message);

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: formattedMessage,
      context: contextOverride || this.contextName,
      requestId: getRequestId(),
    };

    if (stack) {
      entry.stack = stack;
    }

    // Deliver to registered listeners (for tests / metrics)
    for (const listener of StructuredLogger.listeners) {
      try {
        listener(entry);
      } catch {
        // Ignore listener error
      }
    }

    if (StructuredLogger.memoryBufferEnabled) {
      StructuredLogger.memoryBuffer.push(entry);
    }

    const json = JSON.stringify(entry);
    if (level === 'ERROR' || level === 'FATAL') {
      process.stderr.write(`${json}\n`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  }

  // --- Testing & telemetry inspection helpers ---

  static addListener(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  static enableMemoryBuffer(): void {
    this.memoryBufferEnabled = true;
    this.memoryBuffer.length = 0;
  }

  static disableMemoryBuffer(): void {
    this.memoryBufferEnabled = false;
    this.memoryBuffer.length = 0;
  }

  static getMemoryBuffer(): StructuredLogEntry[] {
    return [...this.memoryBuffer];
  }

  static clearMemoryBuffer(): void {
    this.memoryBuffer.length = 0;
  }
}
