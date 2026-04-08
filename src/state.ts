// ============================================================================
// Global State and Search Engine
// ============================================================================

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
  currentFile: null,
  completedFiles: [],
  inProgress: false,
  lastReadFile: null,
  lastReadContent: null,
  continueToNext: false,
  metadata: {},
  contextCache: {},
  templateOverrides: {},
  validationResults: {},
  symbolMap: {},
  // NOTE: lastPersistedAt intentionally omitted here - set by persistence module
};

// Re-export for convenience
export type { DocState, DocMetadata, DocTemplate, SearchResult } from "./types.js";
