#!/usr/bin/env node

// Main entry point - imports and starts the server
import { main } from "./handlers/index.js";
import { logger } from "./logger.js";

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  logger.info("server", `Received ${signal}, shutting down gracefully...`);
  // State is persisted after each tool invocation, so we just exit cleanly
  logger.info("server", "Graceful shutdown complete.");
  process.exit(0);
};

// Register signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// main() is synchronous but server.connect() internally handles async
try {
  main();
} catch (error: unknown) {
  logger.error("server", "Server error", error);
  process.exit(1);
}
