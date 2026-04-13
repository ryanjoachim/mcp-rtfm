// ============================================================================
// Project-Scoped State Management
// ============================================================================

import * as fs from "fs/promises";
import MiniSearch from "minisearch";
import { logger } from "./logger.js";
import type { DocState, DocMetadata } from "./types.js";

const STATE_DIR = ".rtfm-state";

// Initialize a fresh search engine with the standard configuration
const createSearchEngine = () => new MiniSearch({
  fields: ['title', 'content', 'category', 'tags'],
  storeFields: ['title', 'category', 'tags', 'lastUpdated'],
  searchOptions: {
    boost: { title: 2 },
    fuzzy: 0.2
  }
});

// Create a fresh default state
const createDefaultState = (): DocState => ({
  metadata: {},
  contextCache: {},
  lastPersistedAt: undefined,
});

export class ProjectContext {
  readonly projectPath: string;
  state: DocState;
  searchEngine: MiniSearch;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.state = createDefaultState();
    this.searchEngine = createSearchEngine();
  }

  invalidateContextCache(): void {
    this.state.contextCache = {};
  }

  resetState(): void {
    const preserved = this.state.lastPersistedAt;
    this.state = createDefaultState();
    this.state.lastPersistedAt = preserved;
    this.searchEngine.removeAll();
  }

  async saveStateToDisk(): Promise<void> {
    const statePath = `${this.projectPath}/.handoff_docs/${STATE_DIR}`;

    try {
      await fs.mkdir(statePath, { recursive: true });

      await fs.writeFile(
        `${statePath}/metadata.json`,
        JSON.stringify(this.state.metadata, null, 2),
        "utf8"
      );

      const searchIndexDump = this.searchEngine.toJSON();
      await fs.writeFile(
        `${statePath}/search-index.json`,
        JSON.stringify(searchIndexDump),
        "utf8"
      );

      this.state.lastPersistedAt = new Date().toISOString();
    } catch (error) {
      logger.error("persistence", "Failed to save state to disk", error);
    }
  }

  async loadStateFromDisk(): Promise<boolean> {
    const statePath = `${this.projectPath}/.handoff_docs/${STATE_DIR}`;

    try {
      const files = await fs.readdir(statePath);
      if (files.length === 0) return false;

      try {
        const metadataContent = await fs.readFile(`${statePath}/metadata.json`, "utf8");
        this.state.metadata = JSON.parse(metadataContent);
      } catch (error) {
        logger.warn("persistence", "Failed to load metadata", error);
      }

      try {
        const searchIndexContent = await fs.readFile(`${statePath}/search-index.json`, "utf8");
        const searchIndexDump = JSON.parse(searchIndexContent);

        if (searchIndexDump && searchIndexDump.documents) {
          this.searchEngine.removeAll();
          for (const [docId, docData] of Object.entries(searchIndexDump.documents)) {
            this.searchEngine.add({ id: docId, ...(docData as object) });
          }
        }
      } catch (error) {
        logger.warn("persistence", "Failed to load search index", error);
      }

      try {
        const completionContent = await fs.readFile(`${statePath}/completion.json`, "utf8");
        const loadedCompletion = JSON.parse(completionContent);
        this.state.lastPersistedAt = loadedCompletion.lastPersistedAt;
      } catch (error) {
        logger.warn("persistence", "Failed to load completion data", error);
      }

      return true;
    } catch (error) {
      logger.warn("persistence", "State directory not found or unreadable", error);
      return false;
    }
  }
}

// Singleton manager that holds one ProjectContext per project path
export class ProjectContextManager {
  private contexts = new Map<string, ProjectContext>();

  getContext(projectPath: string): ProjectContext {
    let ctx = this.contexts.get(projectPath);
    if (!ctx) {
      ctx = new ProjectContext(projectPath);
      this.contexts.set(projectPath, ctx);
    }
    return ctx;
  }

  clearContext(projectPath: string): void {
    this.contexts.delete(projectPath);
  }

  clearAll(): void {
    this.contexts.clear();
  }
}

export const contextManager = new ProjectContextManager();