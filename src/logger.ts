// ============================================================================
// Stderr Logger for MCP Server Diagnostics
// ============================================================================
// MCP uses stdout for JSON-RPC protocol; stderr is safe for diagnostic output.

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

export const setLogLevel = (level: LogLevel) => {
  currentLevel = level;
};

const log = (level: LogLevel, context: string, message: string, error?: unknown) => {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  const timestamp = new Date().toISOString();
  const detail = error
    ? ` | ${error instanceof Error ? error.message : String(error)}`
    : "";
  process.stderr.write(`[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}${detail}\n`);
};

export const logger = {
  debug: (context: string, message: string, error?: unknown) => log("debug", context, message, error),
  info: (context: string, message: string, error?: unknown) => log("info", context, message, error),
  warn: (context: string, message: string, error?: unknown) => log("warn", context, message, error),
  error: (context: string, message: string, error?: unknown) => log("error", context, message, error),
};