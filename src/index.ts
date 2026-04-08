#!/usr/bin/env node

// Main entry point - imports and starts the server
import { main } from "./handlers/index.js";

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  console.error(`\nReceived ${signal}, shutting down gracefully...`);
  // State is persisted after each tool invocation, so we just exit cleanly
  console.error("Graceful shutdown complete.");
  process.exit(0);
};

// Register signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// main() is synchronous but server.connect() internally handles async
try {
  main();
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("Server error:", errorMessage);
  process.exit(1);
}
