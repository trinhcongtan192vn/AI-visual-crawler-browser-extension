import { LOG_PREFIX } from './constants';

type Level = 'debug' | 'info' | 'warn' | 'error';

function fmt(module: string, level: Level, args: unknown[]) {
  return [`${LOG_PREFIX}[${module}]`, ...args];
}

export function createLogger(module: string) {
  return {
    debug: (...args: unknown[]) => console.debug(...fmt(module, 'debug', args)),
    info: (...args: unknown[]) => console.info(...fmt(module, 'info', args)),
    warn: (...args: unknown[]) => console.warn(...fmt(module, 'warn', args)),
    error: (...args: unknown[]) => console.error(...fmt(module, 'error', args))
  };
}

export type Logger = ReturnType<typeof createLogger>;
