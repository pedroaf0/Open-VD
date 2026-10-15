/**
 * In-page debug log buffer.
 *
 * Intercepts `console.*` and keeps the last `MAX` messages in memory so they can
 * be rendered on screen. This is used to diagnose problems (e.g. ZIP
 * decompression on iOS Safari) directly on the device, since the phone has no
 * easy way to open DevTools.
 */

/**
 * Liga/desliga o ícone flutuante de depuração (e a captura de console.*).
 * Mude para `false` em produção para remover o botão Dębug da tela.
 */
export const DEBUG_OVERLAY_ENABLED = false;

export type LogLevel = "log" | "info" | "warn" | "error";

export type DebugLogEntry = {
  id: number;
  ts: string;
  level: LogLevel;
  msg: string;
};

const MAX = 1000;
let entries: DebugLogEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (a && typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
}

function push(level: LogLevel, args: unknown[]): void {
  const entry: DebugLogEntry = {
    id: seq++,
    ts: new Date().toISOString().slice(11, 23),
    level,
    msg: format(args),
  };
  entries.push(entry);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  emit();
}

function emit(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  }
}

export function dbg(level: LogLevel, ...args: unknown[]): void {
  push(level, args);
}
export function dbgLog(...args: unknown[]): void {
  push("log", args);
}
export function dbgInfo(...args: unknown[]): void {
  push("info", args);
}
export function dbgWarn(...args: unknown[]): void {
  push("warn", args);
}
export function dbgError(...args: unknown[]): void {
  push("error", args);
}

export function getDebugLog(): readonly DebugLogEntry[] {
  return entries;
}

export function clearDebugLog(): void {
  entries = [];
  emit();
}

export function subscribeDebugLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let hooked = false;

/** Redirect `console.*` into the in-page buffer (browser only). */
export function hookConsole(): void {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args: unknown[]) => {
    orig.log(...args);
    push("log", args);
  };
  console.info = (...args: unknown[]) => {
    orig.info(...args);
    push("info", args);
  };
  console.warn = (...args: unknown[]) => {
    orig.warn(...args);
    push("warn", args);
  };
  console.error = (...args: unknown[]) => {
    orig.error(...args);
    push("error", args);
  };
}
