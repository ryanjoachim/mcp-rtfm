// ============================================================================
// State Persistence and File Locking
// ============================================================================

import * as fs from "fs/promises";
import { state, searchEngine } from "./state.js";

export const STATE_DIR = ".rtfm-state";

// Get the path to the persistence state directory for a project
export const getStatePath = (projectPath: string): string => {
  return `${projectPath}/.handoff_docs/${STATE_DIR}`;
};

// File locking for concurrent update protection with timeout
export const fileLocks: Record<string, Promise<void>> = {};

const LOCK_TIMEOUT_MS = 30000; // 30 second timeout per operation

export const withFileLock = async (filePath: string, fn: () => Promise<void>): Promise<void> => {
  const lockKey = filePath;

  // Wait for existing lock with timeout
  const startTime = Date.now();
  while (fileLocks[lockKey]) {
    if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
      throw new Error(`Timeout waiting for lock on ${filePath}`);
    }
    await fileLocks[lockKey];
  }

  let release: () => void;
  const lockPromise = new Promise<void>((resolve, reject) => {
    release = resolve;
    // Reject after timeout to prevent permanent blocking
    setTimeout(() => {
      if (fileLocks[lockKey] === lockPromise) {
        delete fileLocks[lockKey];
        reject(new Error(`Lock timeout for ${filePath}`));
      }
    }, LOCK_TIMEOUT_MS);
  });
  fileLocks[lockKey] = lockPromise;

  try {
    await fn();
  } finally {
    delete fileLocks[lockKey];
    release!();
  }
};

// Save state to disk for persistence across restarts
export const saveStateToDisk = async (projectPath: string): Promise<void> => {
  const statePath = getStatePath(projectPath);

  try {
    await fs.mkdir(statePath, { recursive: true });

    // Save metadata
    const metadataPath = `${statePath}/metadata.json`;
    await fs.writeFile(metadataPath, JSON.stringify(state.metadata, null, 2), "utf8");

    // Save search index as JSON
    const searchIndexPath = `${statePath}/search-index.json`;
    const searchIndexDump = searchEngine.toJSON();
    await fs.writeFile(searchIndexPath, JSON.stringify(searchIndexDump), "utf8");

    // Save template overrides
    const templatesPath = `${statePath}/templates.json`;
    await fs.writeFile(templatesPath, JSON.stringify(state.templateOverrides), "utf8");

    // Save completion state
    const completionPath = `${statePath}/completion.json`;
    await fs.writeFile(completionPath, JSON.stringify({
      completedFiles: state.completedFiles,
      currentFile: state.currentFile,
      inProgress: state.inProgress,
      lastReadFile: state.lastReadFile,
      lastPersistedAt: new Date().toISOString()
    }), "utf8");

    // Only update lastPersistedAt after successful save
    state.lastPersistedAt = new Date().toISOString();
  } catch (error) {
    console.error("Failed to save state to disk:", error);
    // Non-fatal: continue without persistence
  }
};

// Load persisted state from disk on startup
export const loadStateFromDisk = async (projectPath: string): Promise<boolean> => {
  const statePath = getStatePath(projectPath);

  try {
    const files = await fs.readdir(statePath);

    if (files.length === 0) {
      return false;
    }

    // Load metadata
    try {
      const metadataPath = `${statePath}/metadata.json`;
      const metadataContent = await fs.readFile(metadataPath, "utf8");
      const loadedMetadata = JSON.parse(metadataContent);
      state.metadata = loadedMetadata;
    } catch {
      // No metadata file or invalid JSON
    }

    // Load search index
    try {
        const searchIndexPath = `${statePath}/search-index.json`;
        const searchIndexContent = await fs.readFile(searchIndexPath, "utf8");
        const searchIndexDump = JSON.parse(searchIndexContent);

        // MiniSearch v7 uses searchEngine.replace() to restore from JSON
        // We need to re-add all documents from the stored data
        if (searchIndexDump && searchIndexDump.documents) {
          searchEngine.removeAll();
          for (const [docId, docData] of Object.entries(searchIndexDump.documents)) {
            searchEngine.add({
              id: docId,
              ...(docData as object)
            });
          }
        }
      } catch {
        // No search index file or invalid JSON
      }

    // Load template overrides
    try {
      const templatesPath = `${statePath}/templates.json`;
      const templatesContent = await fs.readFile(templatesPath, "utf8");
      const loadedTemplates = JSON.parse(templatesContent);
      state.templateOverrides = loadedTemplates;
    } catch {
      // No templates file or invalid JSON
    }

    // Load completion state (includes lastPersistedAt - bug fix)
    try {
      const completionPath = `${statePath}/completion.json`;
      const completionContent = await fs.readFile(completionPath, "utf8");
      const loadedCompletion = JSON.parse(completionContent);
      state.completedFiles = loadedCompletion.completedFiles || [];
      state.currentFile = loadedCompletion.currentFile;
      state.inProgress = loadedCompletion.inProgress || false;
      state.lastReadFile = loadedCompletion.lastReadFile;
      state.lastPersistedAt = loadedCompletion.lastPersistedAt;
    } catch {
      // No completion file or invalid JSON
    }

    return true;
  } catch {
    return false;
  }
};
