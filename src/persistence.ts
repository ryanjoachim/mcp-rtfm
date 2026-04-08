// ============================================================================
// Global State, Search Engine, and State Persistence
// ============================================================================

import * as fs from "fs/promises";
import MiniSearch from "minisearch";
import type { DocState } from "./types.js";

// Initialize search engine
export const searchEngine = new MiniSearch({
  fields: ['title', 'content', 'category', 'tags'],
  storeFields: ['title', 'category', 'tags', 'lastUpdated'],
  searchOptions: {
    boost: { title: 2 },
    fuzzy: 0.2
  }
});

// Global application state
export let state: DocState = {
  metadata: {},
  contextCache: {},
  validationResults: {},
  symbolMap: {},
  // NOTE: lastPersistedAt intentionally omitted here - set after save
};

// Re-export types for convenience
export type { DocState, DocMetadata, SearchResult } from "./types.js";

// ============================================================================
// State Persistence
// ============================================================================

export const STATE_DIR = ".rtfm-state";

// Get the path to the persistence state directory for a project
export const getStatePath = (projectPath: string): string => {
  return `${projectPath}/.handoff_docs/${STATE_DIR}`;
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

    // Load lastPersistedAt from legacy completion.json (backwards compat)
    try {
      const completionPath = `${statePath}/completion.json`;
      const completionContent = await fs.readFile(completionPath, "utf8");
      const loadedCompletion = JSON.parse(completionContent);
      state.lastPersistedAt = loadedCompletion.lastPersistedAt;
    } catch {
      // No completion file or invalid JSON - that's fine
    }

    return true;
  } catch {
    return false;
  }
};